/* Standalone UI. API keys are read only from the password input, never persisted. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SETTINGS_KEY = 'paper-review-settings-v1';
  const state = { paper: null, responsePdf: null, records: [], current: null, busy: false, chatBusy: false, db: null, ready: null, memoryOnly: false, controller: null, chatController: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const errorMessage = error => {
    let message = error?.name === 'AbortError' ? '処理を中止しました。' : String(error?.message || '処理に失敗しました。');
    const key = $('api-key').value.trim();
    if (key) message = message.split(key).join('[APIキー]');
    return message.replace(/sk-[a-zA-Z0-9_-]+/g, '[APIキー]');
  };
  function notice(message, error = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
    $('notice').hidden = !message;
  }
  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  async function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('IndexedDB is unavailable'));
      const request = indexedDB.open('paper-review-standalone', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('reviews', { keyPath: 'id' });
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Storage is blocked'));
    });
  }
  async function databaseOperation(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction('reviews', mode);
      const request = operation(tx.objectStore('reviews'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error || request?.error);
      tx.onabort = () => reject(tx.error || new Error('保存が中断されました。'));
    });
  }
  async function saveRecord(record) {
    await state.ready;
    const i = state.records.findIndex(item => item.id === record.id);
    if (i < 0) state.records.unshift(record); else state.records[i] = record;
    state.records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    $('history-count').textContent = state.records.length;
    if (!state.db || state.memoryOnly) return false;
    try {
      await databaseOperation('readwrite', store => store.put(record));
      return true;
    } catch {
      notice('ブラウザに保存できませんでした。結果はこの画面に残っています。ページを閉じる前にJSONを書き出してください。', true);
      return false;
    }
  }
  function loadSettings() {
    try {
      const prefs = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (typeof prefs.venue === 'string') $('venue').value = prefs.venue.slice(0, 200);
      if (['緩め', 'やや厳しめ', '厳しめ'].includes(prefs.strictness)) $('strictness').value = prefs.strictness;
      if (ReviewModels.MODELS.some(item => item.id === prefs.model) || prefs.model === 'custom') $('model').value = prefs.model;
      if (typeof prefs.customModel === 'string') $('custom-model').value = prefs.customModel.slice(0, 100);
      if (typeof prefs.customPrompt === 'string') $('custom-prompt').value = prefs.customPrompt.slice(0, 30000);
      updateModel(typeof prefs.reasoningEffort === 'string' ? prefs.reasoningEffort : '');
    } catch { /* Settings are optional, including under file://. */ }
    updateModel();
  }
  function saveSettings(showNotice = true) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ venue: $('venue').value, strictness: $('strictness').value, model: $('model').value, reasoningEffort: $('reasoning-effort').value, customModel: $('custom-model').value, customPrompt: $('custom-prompt').value }));
      if (showNotice) notice('会議・厳しさ・モデル・思考量・プロンプトを保存しました。');
    } catch { if (showNotice) notice('このブラウザでは設定を保存できません。入力した設定は今回の査読に使用できます。', true); }
  }
  function updateModel(preferred = $('reasoning-effort').value) {
    $('custom-model-field').hidden = $('model').value !== 'custom';
    const model = selectedModel();
    const options = ['', ...ReviewModels.getEfforts(model)];
    $('reasoning-effort').innerHTML = options.map(value => `<option value="${esc(value)}">${esc(ReviewModels.formatEffort(value))}</option>`).join('');
    $('reasoning-effort').value = options.includes(preferred) ? preferred : '';
    $('reasoning-effort').disabled = state.busy || options.length === 1;
    updateEffortHelp(preferred && !options.includes(preferred));
  }
  function updateEffortHelp(wasReset = false) {
    const model = selectedModel();
    const known = ReviewModels.getModel(model);
    const prefix = wasReset ? 'このモデルに対応しない思考量だったため、既定に戻しました。' : '';
    const compatibility = known ? 'このモデルが対応する全段階を選べます。' : '手入力モデルは、指定した思考量に対応するか確認してください。';
    const extended = ReviewModels.completionLimit(model, $('reasoning-effort').value, 24000) > 24000;
    $('reasoning-help').textContent = prefix + compatibility + (extended ? '高い思考量のため生成上限を拡大します。' : '') + '思考量が多いほど時間・料金が増える場合があります。';
  }
  function selectedModel() { return $('model').value === 'custom' ? $('custom-model').value.trim() : $('model').value; }
  function updateKey() {
    const hasKey = Boolean($('api-key').value.trim());
    $('key-dot').classList.toggle('ready', hasKey);
    $('key-status').textContent = hasKey ? '入力済み · この画面内のみ' : 'キーはこの画面内だけで保持';
  }
  function showView(view, { scroll = true } = {}) {
    ['new', 'history', 'result'].forEach(name => { $(`${name}-view`).hidden = name !== view; });
    document.querySelectorAll('.nav-item').forEach(button => {
      const active = button.dataset.nav === view || (view === 'result' && button.dataset.nav === 'history');
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (view === 'history') renderHistory();
    if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });
  }
  async function navigate(view) {
    await state.ready;
    if (state.busy || state.chatBusy) { notice('現在の処理が終わるか、中止してから移動してください。'); return; }
    notice('');
    showView(view);
  }
  function setBusy(busy) {
    state.busy = busy;
    $('review-form').querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = busy; });
    document.querySelectorAll('[data-nav]').forEach(el => { el.disabled = busy; });
    $('progress-panel').hidden = !busy;
    $('start-review').innerHTML = busy ? '査読を実行中…' : '査読を開始 <span aria-hidden="true">↗</span>';
    $('cancel-review').disabled = false;
    if (!busy) updateModel();
  }
  async function selectPdf(file, response = false) {
    if (state.busy) return;
    const key = response ? 'responsePdf' : 'paper';
    try {
      if (file) await ReviewAPI.validatePdf(file);
      state[key] = file || null;
      notice('');
    } catch (error) {
      state[key] = null;
      $(response ? 'response-file' : 'paper-file').value = '';
      notice(errorMessage(error), true);
    }
    updateFiles();
  }
  function updateFiles() {
    const file = state.paper;
    $('paper-label').textContent = file ? file.name : 'PDFをここにドロップ';
    $('paper-meta').textContent = file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · クリックして変更` : 'またはクリックしてファイルを選択';
    $('paper-drop').classList.toggle('selected', Boolean(file));
    $('clear-paper').hidden = !file;
    $('clear-response').hidden = !state.responsePdf;
    $('response-file-label').textContent = state.responsePdf ? `${state.responsePdf.name} (${(state.responsePdf.size / 1024 / 1024).toFixed(2)} MB)` : 'PDFとテキストは併用できます';
  }
  async function startReview(event) {
    event.preventDefault();
    if (state.busy) return;
    const apiKey = $('api-key').value.trim();
    if (!apiKey) { notice('OpenAI APIキーを入力してください。', true); $('api-key').focus(); return; }
    if (!state.paper) { notice('論文PDFを選んでください。', true); $('paper-file').focus(); return; }
    const model = selectedModel();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model)) { notice('利用するモデルIDを入力してください。', true); $('custom-model').focus(); return; }
    const input = { apiKey, model, reasoningEffort: $('reasoning-effort').value, paper: state.paper, responsePdf: state.responsePdf, responseText: $('response-text').value.trim(), venue: $('venue').value.trim(), strictness: $('strictness').value, customPrompt: $('custom-prompt').value.trim() };
    saveSettings(false);
    notice('');
    setBusy(true);
    state.controller = new AbortController();
    $('progress-title').textContent = '査読を準備しています';
    $('progress-message').textContent = 'PDFを確認しています。';
    $('elapsed').textContent = '0:00';
    const startTime = Date.now();
    const timer = setInterval(() => { const seconds = Math.floor((Date.now() - startTime) / 1000); $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }, 1000);
    $('progress-panel').scrollIntoView({ block: 'center', behavior: 'auto' });
    try {
      const output = await ReviewAPI.runReview({ ...input, signal: state.controller.signal, onProgress: progress => {
        $('progress-title').textContent = progress.stage === 'reviewing' ? '論文を読み、査読しています' : progress.stage === 'cleaning' ? '結果を仕上げています' : 'PDFを準備しています';
        $('progress-message').textContent = progress.message;
        const stage = progress.stage === 'reviewing' ? 'review' : progress.stage === 'cleaning' ? 'save' : 'upload';
        document.querySelectorAll('[data-stage]').forEach(el => el.classList.toggle('active', el.dataset.stage === stage));
      } });
      const record = { id: uid(), createdAt: new Date().toISOString(), pdfName: input.paper.name, responsePdfName: input.responsePdf?.name || '', venue: input.venue || 'HCI系の国際会議', strictness: input.strictness, model: output.model || model, requestedModel: model, reasoningEffort: input.reasoningEffort, responseText: input.responseText, customPrompt: input.customPrompt, result: output.result, checked: {}, chat: [], paper: input.paper, responsePdf: input.responsePdf, usage: output.usage };
      const saved = await saveRecord(record);
      renderRecord(record);
      const warnings = output.cleanupWarnings || [];
      notice([saved ? '査読が完了し、このブラウザに保存しました。' : '査読が完了しました。保存できないため、閉じる前にJSONを書き出してください。', ...warnings].join('\n'), !saved || warnings.length > 0);
    } catch (error) {
      notice([errorMessage(error), ...(error.cleanupWarnings || [])].join('\n'), error.name !== 'AbortError');
      $('notice').scrollIntoView({ block: 'start', behavior: 'auto' });
    } finally {
      clearInterval(timer);
      state.controller = null;
      setBusy(false);
    }
  }
  function renderHistory() {
    $('history-count').textContent = state.records.length;
    $('history-list').innerHTML = state.records.length ? state.records.map(record => {
      const todos = ReviewView.extractChecklist(record.result);
      const done = todos.filter(item => record.checked?.[item.key]).length;
      return `<article class="history-card"><div class="history-card-content"><button type="button" class="history-title" data-open="${esc(record.id)}">${esc(record.pdfName || 'インポートした査読')}</button><p class="history-meta">${esc(dateLabel(record.createdAt))} · ${esc(record.venue)} · ${esc(record.model)} · 思考量：${esc(ReviewModels.formatEffort(record.reasoningEffort))} · 修正 ${done}/${todos.length}</p></div><span class="history-decision">${esc(record.result.review.decision)}</span><button type="button" class="text-button" data-delete="${esc(record.id)}" aria-label="${esc(record.pdfName)}の履歴を削除">削除</button></article>`;
    }).join('') : '<div class="empty-state"><h2>最初の査読を、ここから。</h2><p>完了した査読はここに保存されます。書き出したJSONの読み込みもできます。</p><button type="button" class="button primary" data-nav="new">＋ 新しい査読</button></div>';
  }
  function renderRecord(record) {
    state.current = record;
    $('result-title').textContent = record.pdfName || '査読結果';
    $('result-meta').textContent = `${dateLabel(record.createdAt)} · ${record.venue} · ${record.strictness} · ${record.model} · 思考量：${ReviewModels.formatEffort(record.reasoningEffort)}`;
    $('open-paper').hidden = !(record.paper instanceof Blob);
    $('open-response').hidden = !(record.responsePdf instanceof Blob);
    $('report-panel').innerHTML = ReviewView.renderResult(record);
    renderChecklist();
    renderChat();
    selectTab('report');
    showView('result');
  }
  function renderChecklist() {
    const record = state.current;
    if (!record) return;
    $('checklist-panel').innerHTML = ReviewView.renderChecklist(record);
    const items = ReviewView.extractChecklist(record.result);
    $('todo-count').textContent = `${items.filter(item => record.checked?.[item.key]).length}/${items.length}`;
  }
  function selectTab(tab) {
    ['report', 'checklist', 'chat'].forEach(name => {
      $(`${name}-panel`).hidden = name !== tab;
      const button = $(`tab-${name}`);
      button.setAttribute('aria-selected', String(tab === name));
      button.tabIndex = tab === name ? 0 : -1;
    });
  }
  function renderChat() {
    $('chat-log').innerHTML = (state.current?.chat || []).map(message => `<div class="chat-message ${message.role === 'user' ? 'user' : 'assistant'}"><strong>${message.role === 'user' ? 'あなた' : 'AI REVIEWER'}</strong>${esc(message.content)}</div>`).join('');
  }
  async function sendChat(event) {
    event.preventDefault();
    if (state.chatBusy || !state.current) return;
    const apiKey = $('api-key').value.trim();
    if (!apiKey) { notice('APIキーを入力するには「新しい査読」を開いてください。その後「査読履歴」からこの結果に戻れます。', true); $('notice').scrollIntoView({ block: 'start' }); return; }
    const content = $('chat-input').value.trim();
    if (!content) return;
    const record = state.current;
    const messages = [...(record.chat || []), { role: 'user', content }];
    state.chatBusy = true;
    state.chatController = new AbortController();
    $('send-chat').disabled = true;
    $('send-chat').textContent = '回答を作成中…';
    $('chat-input').disabled = true;
    $('cancel-chat').hidden = false;
    notice('');
    try {
      const output = await ReviewAPI.chat({ apiKey, model: record.requestedModel || record.model || selectedModel(), reasoningEffort: record.reasoningEffort || '', result: record.result, messages, signal: state.chatController.signal });
      record.chat = [...messages, { role: 'assistant', content: output.text }];
      const saved = await saveRecord(record);
      if (!saved) notice('会話をブラウザに保存できませんでした。必要な場合はJSONを書き出してください。', true);
      $('chat-input').value = '';
      renderChat();
    } catch (error) { notice(errorMessage(error), error.name !== 'AbortError'); }
    finally { state.chatBusy = false; state.chatController = null; $('send-chat').disabled = false; $('send-chat').textContent = '質問する ↗'; $('chat-input').disabled = false; $('cancel-chat').hidden = true; $('chat-input').focus(); }
  }
  function exportable(record) {
    // Explicit allowlist: no credentials, provider file IDs, or PDF binary in JSON exports.
    return { format: 'paper-review-standalone', version: 1, record: { createdAt: record.createdAt, pdfName: record.pdfName, responsePdfName: record.responsePdfName, venue: record.venue, strictness: record.strictness, model: record.model, requestedModel: record.requestedModel, reasoningEffort: record.reasoningEffort || '', responseText: record.responseText, customPrompt: record.customPrompt, result: record.result, checked: record.checked, chat: record.chat, usage: record.usage } };
  }
  function download(content, extension, type) {
    if (!state.current) return;
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(state.current.pdfName || 'paper').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}-review.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function openPdf(key) {
    const blob = state.current?.[key];
    if (!(blob instanceof Blob)) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    // Keep the object alive until this page unloads; revoking early can break PDF viewers.
  }
  async function importResult(file) {
    if (!file) return;
    await state.ready;
    if (state.busy || state.chatBusy) { notice('処理が完了してから読み込んでください。', true); return; }
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('結果JSONは5 MB以下にしてください。');
      const parsed = JSON.parse(await file.text());
      if (parsed.format && (parsed.format !== 'paper-review-standalone' || parsed.version !== 1)) throw new Error('対応していない結果ファイルの形式です。');
      const data = parsed.record || parsed;
      const result = data.result || data;
      ReviewAPI.validateResult(result, false);
      const str = (value, limit = 30000) => typeof value === 'string' ? value.slice(0, limit) : '';
      const validKeys = new Set(ReviewView.extractChecklist(result).map(item => item.key));
      const checked = Object.fromEntries(Object.entries(data.checked || {}).filter(([key, value]) => validKeys.has(key) && value === true));
      const chat = Array.isArray(data.chat) ? data.chat.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map(item => ({ role: item.role, content: item.content.slice(0, 60000) })).slice(-100) : [];
      const record = { id: uid(), createdAt: Number.isNaN(Date.parse(data.createdAt)) ? new Date().toISOString() : new Date(data.createdAt).toISOString(), pdfName: str(data.pdfName, 300) || file.name.replace(/\.json$/i, ''), responsePdfName: str(data.responsePdfName, 300), venue: str(data.venue, 200) || '指定なし', strictness: ['緩め', 'やや厳しめ', '厳しめ'].includes(data.strictness) ? data.strictness : 'やや厳しめ', model: str(data.model, 100) || 'gpt-5', requestedModel: str(data.requestedModel, 100), responseText: str(data.responseText, 20000), customPrompt: str(data.customPrompt), result, checked, chat, paper: null, responsePdf: null };
      record.reasoningEffort = str(data.reasoningEffort, 20);
      if (!ReviewModels.isSupportedEffort(record.requestedModel || record.model, record.reasoningEffort)) throw new Error('結果ファイルのモデルと思考量の組み合わせに対応していません。');
      const saved = await saveRecord(record);
      renderRecord(record);
      notice(saved ? '結果を読み込みました。JSONには元PDFは含まれていません。' : '結果を読み込みました。ブラウザには保存できないため、この画面内で利用します。', !saved);
    } catch (error) { notice(error instanceof SyntaxError ? 'JSONの形式を読み取れませんでした。書き出した結果ファイルを選択してください。' : errorMessage(error), true); }
    finally { $('import-file').value = ''; }
  }
  async function deleteRecord(id) {
    if (state.busy || state.chatBusy) return;
    const record = state.records.find(item => item.id === id);
    if (!record || !confirm(`「${record.pdfName}」の結果・PDF・会話をこのブラウザから削除しますか？`)) return;
    try {
      if (state.db && !state.memoryOnly) await databaseOperation('readwrite', store => store.delete(id));
      state.records = state.records.filter(item => item.id !== id);
      if (state.current?.id === id) state.current = null;
      renderHistory();
      notice('履歴を削除しました。');
    } catch { notice('履歴を削除できませんでした。', true); }
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) navigate(nav.dataset.nav);
    const open = event.target.closest('[data-open]');
    if (open && !state.busy && !state.chatBusy) { const record = state.records.find(item => item.id === open.dataset.open); if (record) { notice(''); renderRecord(record); } }
    const remove = event.target.closest('[data-delete]');
    if (remove) deleteRecord(remove.dataset.delete);
    const tab = event.target.closest('[data-tab]');
    if (tab) selectTab(tab.dataset.tab);
  });
  document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); navigate('new'); });
  document.querySelector('.result-tabs').addEventListener('keydown', event => {
    const tabs = ['report', 'checklist', 'chat'];
    const current = tabs.indexOf(event.target.dataset.tab);
    if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (current + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    selectTab(tabs[next]); $(`tab-${tabs[next]}`).focus();
  });
  $('checklist-panel').addEventListener('change', async event => {
    const input = event.target.closest('[data-check-key]');
    if (!input || !state.current) return;
    const record = state.current;
    const key = input.dataset.checkKey;
    record.checked ||= {};
    record.checked[key] = input.checked;
    renderChecklist();
    [...$('checklist-panel').querySelectorAll('[data-check-key]')].find(el => el.dataset.checkKey === key)?.focus();
    if (!await saveRecord(record)) notice('チェックの状態を保存できませんでした。JSONを書き出して残せます。', true);
  });
  $('api-key').addEventListener('input', updateKey);
  $('toggle-key').addEventListener('click', () => { const visible = $('api-key').type === 'password'; $('api-key').type = visible ? 'text' : 'password'; $('toggle-key').textContent = visible ? '隠す' : '表示'; $('toggle-key').setAttribute('aria-label', visible ? 'APIキーを隠す' : 'APIキーを表示'); $('toggle-key').setAttribute('aria-pressed', String(visible)); });
  $('clear-key').addEventListener('click', () => { $('api-key').value = ''; $('api-key').type = 'password'; $('toggle-key').textContent = '表示'; $('toggle-key').setAttribute('aria-pressed', 'false'); $('toggle-key').setAttribute('aria-label', 'APIキーを表示'); updateKey(); });
  $('model').addEventListener('change', () => updateModel());
  $('custom-model').addEventListener('input', () => updateModel());
  $('reasoning-effort').addEventListener('change', () => updateEffortHelp());
  $('paper-file').addEventListener('change', event => selectPdf(event.target.files[0]));
  $('response-file').addEventListener('change', event => selectPdf(event.target.files[0], true));
  $('clear-paper').addEventListener('click', () => { $('paper-file').value = ''; selectPdf(null); });
  $('clear-response').addEventListener('click', () => { $('response-file').value = ''; selectPdf(null, true); });
  ['dragenter', 'dragover'].forEach(type => $('paper-drop').addEventListener(type, event => { event.preventDefault(); if (!state.busy) $('paper-drop').classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(type => $('paper-drop').addEventListener(type, event => { event.preventDefault(); $('paper-drop').classList.remove('dragover'); }));
  $('paper-drop').addEventListener('drop', event => { if (!state.busy) { $('paper-file').value = ''; selectPdf(event.dataTransfer.files[0]); } });
  $('save-settings').addEventListener('click', () => saveSettings());
  $('show-default').addEventListener('click', () => { $('custom-prompt').value = ReviewPrompts.DEFAULT_PROMPT; });
  $('reset-prompt').addEventListener('click', () => { $('custom-prompt').value = ''; saveSettings(false); notice('査読プロンプトを既定に戻しました。'); });
  $('review-form').addEventListener('submit', startReview);
  $('cancel-review').addEventListener('click', () => { state.controller?.abort(); $('cancel-review').disabled = true; $('progress-message').textContent = '中止し、アップロード済みファイルを片付けています。'; });
  $('chat-form').addEventListener('submit', sendChat);
  $('cancel-chat').addEventListener('click', () => state.chatController?.abort());
  $('open-paper').addEventListener('click', () => openPdf('paper'));
  $('open-response').addEventListener('click', () => openPdf('responsePdf'));
  $('export-json').addEventListener('click', () => { if (state.current) download(JSON.stringify(exportable(state.current), null, 2), 'json', 'application/json;charset=utf-8'); });
  $('export-markdown').addEventListener('click', () => { if (state.current) download(ReviewView.toMarkdown(state.current), 'md', 'text/markdown;charset=utf-8'); });
  $('copy-result').addEventListener('click', async () => {
    if (!state.current) return;
    const text = ReviewView.toMarkdown(state.current);
    try { await navigator.clipboard.writeText(text); notice('査読結果をコピーしました。'); }
    catch { notice('この環境ではコピーできません。Markdownボタンから保存してください。', true); }
  });
  const printDetails = new Map();
  function preparePrint() { document.querySelectorAll('#report-panel details,#checklist-panel details').forEach(el => { if (!printDetails.has(el)) printDetails.set(el, el.open); el.open = true; }); }
  function restorePrint() { printDetails.forEach((open, el) => { el.open = open; }); printDetails.clear(); }
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', restorePrint);
  $('print-result').addEventListener('click', () => { preparePrint(); window.print(); });
  $('import-file').addEventListener('change', event => importResult(event.target.files[0]));
  window.addEventListener('beforeunload', event => { if (state.busy || state.chatBusy) { event.preventDefault(); event.returnValue = ''; } });

  async function init() {
    $('model').innerHTML = ReviewModels.MODELS.map(model => `<option value="${esc(model.id)}">${esc(model.label)}</option>`).join('') + '<option value="custom">モデル名を指定</option>';
    $('model').value = 'gpt-5';
    loadSettings(); updateKey();
    try {
      state.db = await openDatabase();
      state.records = (await databaseOperation('readonly', store => store.getAll()) || []).filter(record => record?.result?.review && Array.isArray(record?.result?.sections));
      state.records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch { state.memoryOnly = true; notice('この環境では履歴の保存が使えません。査読は利用できますが、結果はJSONで書き出してください。', true); }
    $('history-count').textContent = state.records.length;
  }
  state.ready = init();
})();
