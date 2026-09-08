/* Run with Node and Playwright installed. All external requests are intercepted;
 * this test never contacts OpenAI and uses only a deliberately fake API key. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const appDir = path.resolve(__dirname, '..');
const outDir = path.join(appDir, 'output/playwright');
const fakeKey = 'sk-browser-smoke-not-a-real-api-key';
const checks = [];
const pdf = { name: 'sample-paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF') };
const result = {
  sections: [{ title: '1. Introduction', summary_ja: '章別要約：共同作業の支援を検討する。' }, { title: '2. Method', summary_ja: '方法要約：二条件を比較した。' }],
  review: {
    decision: 'Weak Accept', score: 4, confidence: 4,
    summary_one_line: '協調作業を支える有望な研究です。',
    plain_summary_for_student: '学生向け要約：比較条件と効果量を説明すると伝わりやすくなります。',
    contribution_validity: '貢献妥当性：対象課題と提案が対応しています。',
    author_claimed_contributions: ['著者貢献：共同作業の新しい手法'],
    reviewer_perceived_contributions: ['査読者貢献：探索的な知見'],
    contribution_gap_explanation: '貢献差分：一般性の主張を限定する必要があります。',
    missing_descriptions: ['記述不足：第2章の参加者属性'],
    logical_flow: '論理構成：関連研究から手法への接続を補う。',
    consistency_check: { background_to_method: '背景対応：良好', method_to_experiment: '手法対応：条件を追記', experiment_to_result: '結果対応：整合', result_to_discussion: '考察対応：限定を追記' },
    hypothesis_vs_results: '仮説対応：RQ2の結果を説明する。',
    editorial_check: { terminology_consistency: '用語確認：共同作業に統一', jargon_explanation: '専門用語：初出で説明', figure_table_references: '図表参照：図2を本文で言及', references_validity: '参考文献：年を照合' },
    statistical_validity: { score: 3, overall_comment: '統計全体：効果量を追加する。', issues: [{ location: '3.2 Results', issue_type: 'no_effect_size', explanation: '統計問題：効果の大きさが不明です。', suggestion: '統計改善：Cohenのdと信頼区間を追記する。' }] },
    citations_check: { total_citations: 24, verified_count: 21, suspicious_citations: [{ original_citation: 'Example et al. 2022. Collaborative Tools.', cited_as: '[7]', issue_type: 'venue_year_mismatch', explanation: '引用問題：年が本文と一致しません。', confidence: 'low', suggested_fix: '引用修正：原資料で発行年を確認する。' }] },
    strengths: ['強み：課題設定が具体的'], weaknesses: ['弱み：比較条件の説明不足'],
    strengthening_analyses: ['追加分析：信頼区間を算出する'],
    alternatives_when_no_reexp: ['代替策：既存データを再分析する'],
    rewrite_suggestions: [{ original: 'Our method always improves collaboration.', original_ja: '原文訳：常に協調作業が改善する。', reason: '書き換え理由：適用範囲が広すぎます。', suggested_rewrite_en: 'Our method improved collaboration in this study.', suggested_rewrite_ja: '修正訳：本研究の条件では協調作業が改善した。' }],
    revision_to_accept: ['優先修正：比較条件を明確にする', '優先修正：効果量を報告する'],
    comments_to_authors: '総合コメント：限界を明示して有用性を伝えてください。',
    response_evaluation: { overall_assessment: '回答全体：指摘に丁寧に対応しています。', covered_points: ['対応済み：方法の説明'], missing_points: ['回答不足：効果量の記載'], inconsistencies: ['回答矛盾：参加者数を統一'], weak_arguments: ['回答論拠：一般化を限定'], recommended_revisions_to_response: ['回答修正：変更箇所の節番号を示す'] }
  }
};
const completion = content => ({ model: 'gpt-5-2025-08-07', choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 125, completion_tokens: 250, total_tokens: 375 } });
const leaves = item => typeof item === 'string' ? [item] : item && typeof item === 'object' ? Object.values(item).flatMap(leaves) : [];

async function until(predicate, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Timed out: ' + label);
}
function passed(label) { checks.push(label); console.log('PASS ' + label); }
async function download(page, id, name) {
  const event = page.waitForEvent('download');
  await page.locator(id).click();
  const item = await event;
  const dest = path.join(outDir, name);
  await item.saveAs(dest);
  return fs.readFileSync(dest, 'utf8');
}
async function allStorage(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('paper-review-standalone', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const records = await new Promise((resolve, reject) => { const r = db.transaction('reviews').objectStore('reviews').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    return { local: { ...localStorage }, session: { ...sessionStorage }, records };
  });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  let page;
  const calls = [];
  const errors = [];
  const external = [];
  let mode = 'success';
  let uploadNo = 0;
  let held = null;
  // No route ever continues an HTTP request. Unexpected origins are blocked.
  await context.route(/^https?:\/\//, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'https://api.openai.com') { external.push(req.url()); return route.abort(); }
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
    const call = { path: url.pathname, method, authorization: req.headers().authorization, body: req.postData() };
    calls.push(call);
    assert.equal(call.authorization, 'Bearer ' + fakeKey);
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (method === 'POST' && url.pathname === '/v1/files') return reply({ id: 'file-browser-' + (++uploadNo) });
    if (method === 'DELETE' && url.pathname.startsWith('/v1/files/file-browser-')) return reply({ deleted: true });
    if (method === 'POST' && url.pathname === '/v1/chat/completions') {
      const payload = JSON.parse(call.body);
      const chat = !payload.response_format;
      if (mode === 'hold') { held = route; return; }
      if (mode === 'failure') return reply({ error: { code: 'invalid_api_key', message: fakeKey + ' must not appear' } }, 401);
      return reply(completion(chat ? '追加回答：比較条件を表で整理し、その根拠を明記してください。' : result));
    }
    throw new Error('Unexpected API route: ' + method + ' ' + url.pathname);
  });
  try {
    page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    page.setDefaultTimeout(10000);
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    await page.waitForFunction(() => Boolean(window.ReviewAPI && window.ReviewView && window.ReviewPrompts));
    await page.locator('#api-key').waitFor();
    assert.equal(await page.title(), 'Paper Review — 論文査読');
    assert.equal(await page.locator('#history-count').innerText(), '0');
    await page.screenshot({ path: path.join(outDir, 'desktop-initial.png'), fullPage: true });
    passed('file:// loads all local scripts, styles, and initial screen');

    await page.locator('#start-review').click();
    assert.match(await page.locator('#notice').innerText(), /APIキーを入力/);
    await page.locator('#paper-file').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a PDF') });
    await until(async () => /PDF ファイルではありません/.test(await page.locator('#notice').innerText()), 'invalid PDF notice');
    assert.equal(await page.locator('#paper-file').inputValue(), '');
    assert.equal(calls.length, 0);
    passed('missing key and fake-PDF header validation prevent network calls');

    await page.locator('#paper-file').setInputFiles(pdf);
    await until(async () => (await page.locator('#paper-label').innerText()) === pdf.name, 'paper selected');
    await page.locator('#response-file').setInputFiles({ ...pdf, name: 'author-response.pdf' });
    await until(async () => (await page.locator('#response-file-label').innerText()).includes('author-response.pdf'), 'response selected');
    await page.locator('#response-text').fill('査読への回答文：比較条件と解析方法を追記しました。');
    await page.locator('#venue').fill('CHI');
    await page.locator('#strictness').selectOption('厳しめ');
    await page.locator('#api-key').fill(fakeKey);
    await page.locator('#start-review').click();
    await page.locator('#result-view').waitFor({ state: 'visible' });
    await until(async () => !(await page.locator('#progress-panel').isVisible()), 'review finished');
    assert.match(await page.locator('#notice').innerText(), /保存しました/);
    assert.equal(calls.filter(c => c.path === '/v1/files').length, 2);
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 2);
    const payload = JSON.parse(calls.find(c => c.path === '/v1/chat/completions').body);
    assert.equal(payload.store, false);
    assert.equal(payload.messages[1].content.filter(c => c.type === 'file').length, 2);
    assert.match(payload.messages[1].content.at(-1).text, /比較条件と解析方法を追記/);
    assert.match(payload.messages[0].content, /厳しめ/);
    assert.match(payload.messages[0].content, /CHI/);
    const report = await page.locator('#report-panel').textContent();
    // Issue types and confidence have localized labels; verify substantive text.
    for (const text of leaves(result).filter(t => !['Weak Accept', 'no_effect_size', 'venue_year_mismatch', 'low'].includes(t))) assert.ok(report.includes(text), 'Report missing: ' + text);
    await page.screenshot({ path: path.join(outDir, 'desktop-results.png'), fullPage: true });
    passed('paper PDF + response PDF + response text review renders every result section and cleans both uploads');
    while (await page.locator('#report-panel details:not([open]) > summary').count()) await page.locator('#report-panel details:not([open]) > summary').first().click();
    const expanded = await page.locator('#report-panel').innerText();
    for (const text of leaves(result).filter(t => !['Weak Accept', 'no_effect_size', 'venue_year_mismatch', 'low'].includes(t))) assert.ok(expanded.includes(text), 'Expanded report missing: ' + text);
    await page.locator('#report-panel details').filter({ has: page.locator('summary').filter({ hasText: '統計手法・報告・解釈の妥当性' }) }).screenshot({ path: path.join(outDir, 'desktop-statistics.png') });
    await page.locator('#report-panel details').filter({ has: page.locator('summary').filter({ hasText: '文章のリライト提案' }) }).screenshot({ path: path.join(outDir, 'desktop-rewrites.png') });
    passed('all report accordions expand interactively and every substantive result is visibly rendered');

    await page.locator('#tab-checklist').click();
    const todoTotal = await page.locator('#checklist-panel [data-check-key]').count();
    assert.ok(todoTotal >= 8, 'Rich result produces actionable TODOs');
    await page.locator('#checklist-panel [data-check-key]').first().check();
    await until(async () => (await page.locator('#todo-count').innerText()).startsWith('1/'), 'TODO count');
    await until(async () => Object.values((await allStorage(page)).records[0].checked).filter(Boolean).length === 1, 'check persisted');
    const stored = await allStorage(page);
    assert.ok(!JSON.stringify(stored).includes(fakeKey));
    assert.equal(stored.records.length, 1);
    passed('TODO changes persist in IndexedDB; key absent from localStorage, sessionStorage, and records');

    const json = await download(page, '#export-json', 'smoke-review.json');
    const exported = JSON.parse(json);
    assert.equal(exported.format, 'paper-review-standalone');
    assert.equal(exported.record.result.review.response_evaluation.overall_assessment, result.review.response_evaluation.overall_assessment);
    assert.ok(!json.includes(fakeKey));
    assert.ok(!json.includes('file-browser-'));
    assert.ok(!Object.hasOwn(exported.record, 'paper'));
    const markdown = await download(page, '#export-markdown', 'smoke-review.md');
    assert.ok(markdown.includes(result.review.rewrite_suggestions[0].suggested_rewrite_en));
    assert.ok(markdown.includes(result.review.response_evaluation.overall_assessment));
    assert.ok(!markdown.includes(fakeKey));
    passed('JSON and Markdown downloads preserve review, response evaluation, and rewrites without API key or provider IDs');

    await page.locator('#tab-chat').click();
    await page.locator('#chat-input').fill('優先度が高い改善を教えてください。');
    await page.locator('#send-chat').click();
    await page.waitForFunction(() => document.querySelectorAll('#chat-log .chat-message').length === 2);
    assert.match(await page.locator('#chat-log').innerText(), /追加回答：比較条件を表で整理/);
    assert.equal(calls.filter(c => c.path === '/v1/files').length, 2);
    const chatPayload = JSON.parse(calls.filter(c => c.path === '/v1/chat/completions').at(-1).body);
    assert.equal(typeof chatPayload.messages[1].content, 'string');
    assert.ok(chatPayload.messages[0].content.includes(JSON.stringify(result)));
    await until(async () => (await allStorage(page)).records[0].chat.length === 2, 'chat persisted');
    passed('follow-up chat renders and persists conversation, using review context without reuploading PDFs');
    mode = 'hold';
    await page.locator('#chat-input').fill('中止する質問です。');
    await page.locator('#send-chat').click();
    await until(() => held !== null, 'held chat request');
    assert.ok(await page.locator('#cancel-chat').isVisible());
    await page.locator('#cancel-chat').click();
    await until(async () => /中止しました/.test(await page.locator('#notice').innerText()), 'chat cancel notice');
    await until(async () => await page.locator('#send-chat').isEnabled(), 'chat cancel recovery');
    assert.equal(await page.locator('#chat-log .chat-message').count(), 2);
    assert.equal(await page.locator('#chat-input').inputValue(), '中止する質問です。');
    await held.abort().catch(() => {}); held = null; mode = 'success';
    passed('chat cancellation restores controls, preserves draft question, and saves no partial conversation');

    await page.reload();
    await until(async () => (await page.locator('#history-count').innerText()) === '1', 'history reload');
    assert.equal(await page.locator('#api-key').inputValue(), '');
    assert.equal(await page.locator('#venue').inputValue(), 'CHI');
    await page.locator('.nav-item[data-nav="history"]').click();
    await page.locator('.history-title').click();
    await page.locator('#tab-checklist').click();
    assert.equal(await page.locator('#checklist-panel input:checked').count(), 1);
    assert.ok(await page.locator('#open-paper').isVisible());
    assert.ok(await page.locator('#open-response').isVisible());
    for (const id of ['#open-paper', '#open-response']) {
      const popupEvent = context.waitForEvent('page');
      await page.locator(id).click();
      const popup = await popupEvent;
      await until(() => popup.url().startsWith('blob:'), 'PDF popup');
      await popup.close();
    }
    passed('reload clears key while preserving history/settings/TODO/chat; stored paper and response PDFs open');

    const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    const imported = JSON.parse(json);
    imported.record.pdfName = xss;
    imported.record.result.review.summary_one_line = xss;
    imported.record.result.sections[0].summary_ja = xss;
    imported.record.chat = [{ role: 'assistant', content: xss }];
    await page.locator('.nav-item[data-nav="history"]').click();
    await page.locator('#import-file').setInputFiles({ name: 'import-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await until(async () => (await page.locator('#history-count').innerText()) === '2', 'import saved');
    assert.equal(await page.locator('#result-title').innerText(), xss);
    assert.ok((await page.locator('#report-panel').textContent()).includes(xss));
    assert.equal(await page.locator('#report-panel img,#report-panel script').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.ok(!(await page.locator('#open-paper').isVisible()));
    await page.locator('#tab-chat').click();
    assert.ok((await page.locator('#chat-log').innerText()).includes(xss));
    assert.equal(await page.locator('#chat-log img,#chat-log script').count(), 0);
    passed('imported JSON renders safely as text, restores conversation/TODO, and correctly omits PDF buttons');

    await page.locator('.nav-item[data-nav="new"]').click();
    await page.locator('#api-key').fill(fakeKey);
    await page.locator('#paper-file').setInputFiles(pdf);
    await until(async () => (await page.locator('#paper-label').innerText()) === pdf.name, 'paper reselected');
    mode = 'failure';
    const uploadsBefore = uploadNo;
    await page.locator('#start-review').click();
    await until(async () => /認証されません/.test(await page.locator('#notice').innerText()), '401 notice');
    await until(async () => await page.locator('#start-review').isEnabled(), 'failure recovery');
    assert.equal(uploadNo, uploadsBefore + 1);
    assert.ok(!((await page.locator('#notice').innerText()).includes(fakeKey)));
    assert.equal(await page.locator('#history-count').innerText(), '2');
    passed('API authentication error is readable, key is redacted, cleanup runs, form re-enables, no false success record');

    mode = 'hold';
    const deletesBefore = calls.filter(c => c.method === 'DELETE').length;
    await page.locator('#start-review').click();
    await until(() => held !== null, 'held completion request');
    assert.ok(await page.locator('#progress-panel').isVisible());
    await page.locator('#cancel-review').click();
    await until(async () => /中止しました/.test(await page.locator('#notice').innerText()), 'cancel notice');
    await until(async () => await page.locator('#start-review').isEnabled(), 'cancel recovery');
    assert.equal(calls.filter(c => c.method === 'DELETE').length, deletesBefore + 1);
    assert.equal(await page.locator('#history-count').innerText(), '2');
    await held.abort().catch(() => {}); held = null;
    passed('in-flight cancellation aborts completion, deletes upload, re-enables form, and saves no partial result');

    mode = 'success';
    await page.locator('#start-review').click();
    await page.locator('#result-view').waitFor({ state: 'visible' });
    await until(async () => (await page.locator('#history-count').innerText()) === '3', 'retry success');
    passed('manual retry succeeds after failure and cancellation');

    await page.setViewportSize({ width: 390, height: 844 });
    const noOverflow = async label => {
      const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(widths.document <= widths.viewport, label + ' overflow: ' + JSON.stringify(widths));
    };
    await noOverflow('Mobile report');
    await page.screenshot({ path: path.join(outDir, 'mobile-results.png'), fullPage: true });
    await page.locator('#tab-checklist').click();
    await noOverflow('Mobile TODO');
    await page.locator('#tab-chat').click();
    await noOverflow('Mobile chat');
    await page.locator('.nav-item[data-nav="history"]').click();
    await noOverflow('Mobile history');
    await page.locator('.nav-item[data-nav="new"]').click();
    await noOverflow('Mobile input');
    await page.screenshot({ path: path.join(outDir, 'mobile-initial.png'), fullPage: true });
    passed('390px mobile input, report, TODO, chat, and history have no horizontal overflow');

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.ok(!JSON.stringify(await allStorage(page)).includes(fakeKey));
    passed('no browser JavaScript exceptions, no unmocked network requests, and no persisted API key');
    fs.writeFileSync(path.join(outDir, 'smoke-results.json'), JSON.stringify({ passed: checks.length, checks, apiRequestCount: calls.length, liveRequests: 0, javascriptErrors: errors, viewport: [1440, 390] }, null, 2));
    console.log('\n' + checks.length + ' browser checks passed; artifacts: ' + outDir);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(outDir, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(outDir, 'smoke-failure.json'), JSON.stringify({ checks, error: String(error), javascriptErrors: errors }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
