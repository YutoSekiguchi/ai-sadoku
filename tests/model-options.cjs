/* Targeted browser regression for model and reasoning-effort selection.
 * Creates a fresh context, uses a fake key, and intercepts all HTTP requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const appDir = path.resolve(__dirname, '..');
const outDir = path.join(appDir, 'output/playwright');
const fakeKey = 'sk-model-options-not-a-real-api-key';
const result = {
  sections: [{ title: 'Introduction', summary_ja: 'モデルと思考量の検証用要約。' }],
  review: { decision: 'Accept', score: 4, summary_one_line: '設定の保存を確認するための査読結果です。', strengths: ['課題が明確'], weaknesses: ['比較条件を追加'] }
};
const expectedModels = {
  'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-terra': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5': ['minimal', 'low', 'medium', 'high'],
  o1: ['low', 'medium', 'high']
};
const checks = [];
function passed(label) { checks.push(label); console.log('PASS ' + label); }
async function until(predicate, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('Timed out: ' + label);
}
async function download(page, button, name) {
  const event = page.waitForEvent('download');
  await page.locator(button).click();
  const item = await event;
  const dest = path.join(outDir, name);
  await item.saveAs(dest);
  return fs.readFileSync(dest, 'utf8');
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const blockedRequests = [];
  const payloads = [];
  const routes = [];
  let fileNo = 0;
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(10000);
  await context.route(/^https?:\/\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'https://api.openai.com') { blockedRequests.push(request.url()); return route.abort(); }
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    assert.equal(request.headers().authorization, 'Bearer ' + fakeKey);
    routes.push(request.method() + ' ' + url.pathname);
    const reply = body => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/v1/files' && request.method() === 'POST') return reply({ id: 'file-model-' + (++fileNo) });
    if (url.pathname.startsWith('/v1/files/file-model-') && request.method() === 'DELETE') return reply({ deleted: true });
    if (url.pathname === '/v1/chat/completions' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      payloads.push(payload);
      return reply({ model: payload.model, choices: [{ message: { content: payload.response_format ? JSON.stringify(result) : '保存されたモデルと思考量で回答しました。' }, finish_reason: 'stop' }] });
    }
    throw new Error('Unexpected API route ' + request.method() + ' ' + url.pathname);
  });
  try {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    await page.waitForFunction(() => Boolean(window.ReviewModels && window.ReviewAPI && window.ReviewView));
    assert.deepEqual(await page.locator('#model option').evaluateAll(options => options.map(o => o.value)), [...Object.keys(expectedModels), 'custom']);
    for (const [model, efforts] of Object.entries(expectedModels)) {
      await page.locator('#model').selectOption(model);
      assert.deepEqual(await page.evaluate(modelId => [...ReviewModels.getEfforts(modelId)], model), efforts, model + ' catalog');
      assert.deepEqual(await page.locator('#reasoning-effort option').evaluateAll(options => options.map(o => o.value)), ['', ...efforts], model + ' choices');
      for (const effort of ['', ...efforts]) {
        await page.locator('#reasoning-effort').selectOption(effort);
        assert.equal(await page.locator('#reasoning-effort').inputValue(), effort);
      }
    }
    passed('all six named models expose every supported effort exactly, alongside the model default');

    await page.locator('#model').selectOption('gpt-5.6-luna');
    await page.locator('#reasoning-effort').selectOption('none');
    await page.locator('#model').selectOption('gpt-6-astra');
    assert.equal(await page.locator('#reasoning-effort').inputValue(), '');
    assert.ok(!(await page.locator('#reasoning-effort option').evaluateAll(options => options.map(o => o.value))).includes('none'));
    assert.match(await page.locator('#reasoning-help').innerText(), /既定に戻しました/);
    passed('switching GPT-5.6 none to GPT-6 removes unsupported none and resets to model default');

    // Exercise representative low/high/max protocol combinations in the browser
    // without duplicating the complete UI/export flow for every effort value.
    for (const model of ['gpt-6-astra', 'gpt-5.6-luna']) {
      for (const effort of ['low', 'high', 'max']) {
        const count = payloads.length;
        await page.evaluate(async ({ key, model, effort }) => ReviewAPI.runReview({ apiKey: key, model, reasoningEffort: effort, paper: new File(['%PDF-1.7\nfixture'], 'protocol.pdf', { type: 'application/pdf' }) }), { key: fakeKey, model, effort });
        assert.equal(payloads.length, count + 1);
        const payload = payloads.at(-1);
        assert.equal(payload.model, model);
        assert.equal(payload.reasoning_effort, effort);
        assert.equal(payload.store, false);
        assert.ok(!Object.hasOwn(payload, 'temperature'));
        assert.equal(payload.max_completion_tokens, { low: 24000, high: 48000, max: 128000 }[effort]);
      }
    }
    passed('GPT-6 and GPT-5.6 low/high/max send the exact reasoning_effort and expanded token limits');

    const exportedRecords = [];
    let expectedHistory = 0;
    for (const [model, effort] of [['gpt-6-astra', 'max'], ['gpt-5.6-luna', 'none']]) {
      await page.locator('.nav-item[data-nav="new"]').click();
      await page.locator('#model').selectOption(model);
      await page.locator('#reasoning-effort').selectOption(effort);
      await page.locator('#api-key').fill(fakeKey);
      const name = model + '-' + effort + '.pdf';
      await page.locator('#paper-file').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nmodel-options fixture') });
      await until(async () => (await page.locator('#paper-label').innerText()) === name, 'PDF selected');
      const count = payloads.length;
      await page.locator('#start-review').click();
      await page.locator('#result-view').waitFor({ state: 'visible' });
      await until(async () => (await page.locator('#notice').innerText()).includes('保存しました'), 'review saved');
      expectedHistory++;
      assert.equal(payloads.length, count + 1);
      assert.equal(payloads.at(-1).model, model);
      assert.equal(payloads.at(-1).reasoning_effort, effort);
      assert.match(await page.locator('#result-meta').innerText(), new RegExp('思考量：.*' + effort));
      const jsonText = await download(page, '#export-json', model + '-' + effort + '.json');
      const exported = JSON.parse(jsonText);
      assert.equal(exported.record.requestedModel, model);
      assert.equal(exported.record.reasoningEffort, effort);
      assert.ok(!jsonText.includes(fakeKey));
      const markdown = await download(page, '#export-markdown', model + '-' + effort + '.md');
      assert.ok(markdown.includes('- 思考量：' + effort));
      assert.ok(markdown.includes(model));
      exportedRecords.push(exported);
      await page.locator('.nav-item[data-nav="history"]').click();
      const card = page.locator('.history-card').filter({ has: page.locator('.history-title').filter({ hasText: name }) });
      assert.match(await card.locator('.history-meta').innerText(), new RegExp('思考量：.*' + effort));
      await page.reload();
      await until(async () => (await page.locator('#history-count').innerText()) === String(expectedHistory), 'history initialized');
      assert.equal(await page.locator('#model').inputValue(), model);
      assert.equal(await page.locator('#reasoning-effort').inputValue(), effort);
      assert.equal(await page.locator('#api-key').inputValue(), '');
      passed(model + ' / ' + effort + ' flows from UI to request, result/history, JSON/Markdown, and saved settings after reload');

      // Choose unrelated form preferences before import: chat must honor the
      // imported report, not whatever happens to be selected on the new form.
      await page.locator('#api-key').fill(fakeKey);
      await page.locator('#model').selectOption('gpt-5');
      await page.locator('#reasoning-effort').selectOption('minimal');
      const imported = structuredClone(exported);
      imported.record.pdfName = 'imported-' + name;
      await page.locator('.nav-item[data-nav="history"]').click();
      await page.locator('#import-file').setInputFiles({ name: 'imported.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
      expectedHistory++;
      await until(async () => (await page.locator('#history-count').innerText()) === String(expectedHistory), 'import stored');
      assert.match(await page.locator('#result-meta').innerText(), new RegExp('思考量：.*' + effort));
      await page.locator('#tab-chat').click();
      const beforeChat = payloads.length;
      await page.locator('#chat-input').fill('この査読を詳しく説明してください。');
      await page.locator('#send-chat').click();
      await page.waitForFunction(() => document.querySelectorAll('#chat-log .chat-message').length === 2);
      assert.equal(payloads.length, beforeChat + 1);
      assert.equal(payloads.at(-1).model, model);
      assert.equal(payloads.at(-1).reasoning_effort, effort);
      assert.ok(!Object.hasOwn(payloads.at(-1), 'response_format'));
      passed('imported ' + model + ' / ' + effort + ' retains its model and effort for chat despite changed form preferences');
    }

    const legacy = structuredClone(exportedRecords[0]);
    delete legacy.record.reasoningEffort;
    legacy.record.model = 'gpt-5';
    legacy.record.requestedModel = 'gpt-5';
    legacy.record.pdfName = 'legacy-no-effort.pdf';
    await page.locator('.nav-item[data-nav="new"]').click();
    await page.locator('#model').selectOption('gpt-6-astra');
    await page.locator('#reasoning-effort').selectOption('max');
    await page.locator('.nav-item[data-nav="history"]').click();
    await page.locator('#import-file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
    expectedHistory++;
    await until(async () => (await page.locator('#history-count').innerText()) === String(expectedHistory), 'legacy import stored');
    assert.match(await page.locator('#result-meta').innerText(), /思考量：モデルの既定/);
    await page.locator('#tab-chat').click();
    const beforeLegacyChat = payloads.length;
    await page.locator('#chat-input').fill('旧形式の査読について説明してください。');
    await page.locator('#send-chat').click();
    await page.waitForFunction(() => document.querySelectorAll('#chat-log .chat-message').length === 2);
    assert.equal(payloads.length, beforeLegacyChat + 1);
    assert.equal(payloads.at(-1).model, 'gpt-5');
    assert.ok(!Object.hasOwn(payloads.at(-1), 'reasoning_effort'));
    passed('legacy imports without reasoningEffort show model default and omit reasoning_effort from chat requests');

    await page.locator('.nav-item[data-nav="new"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#reasoning-effort').scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, field: document.getElementById('reasoning-effort').getBoundingClientRect().toJSON() }));
    assert.ok(dimensions.document <= dimensions.viewport);
    assert.ok(dimensions.field.left >= 0 && dimensions.field.right <= dimensions.viewport);
    await page.locator('.api-panel').screenshot({ path: path.join(outDir, 'mobile-model-options.png') });
    passed('390px mobile model/effort fields and help text fit without horizontal overflow');

    assert.deepEqual(errors, []);
    assert.deepEqual(blockedRequests, []);
    assert.equal(routes.filter(route => route.startsWith('POST /v1/files')).length, routes.filter(route => route.startsWith('DELETE /v1/files/')).length);
    fs.writeFileSync(path.join(outDir, 'model-options-results.json'), JSON.stringify({ passed: checks.length, checks, catalog: expectedModels, completionRequests: payloads.map(p => ({ model: p.model, reasoningEffort: p.reasoning_effort || '(omitted)', maxCompletionTokens: p.max_completion_tokens, chat: !p.response_format })), apiRequestCount: routes.length, liveRequests: 0, javascriptErrors: errors }, null, 2));
    console.log(checks.length + ' model options checks passed.');
  } catch (error) {
    await page.screenshot({ path: path.join(outDir, 'model-options-failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(outDir, 'model-options-failure.json'), JSON.stringify({ checks, error: String(error), javascriptErrors: errors }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
