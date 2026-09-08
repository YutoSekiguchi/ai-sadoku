/* Focused regression: delayed IndexedDB initialization must not lose history
 * navigation or overwrite a JSON import. No API requests or keys are needed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const appDir = path.resolve(__dirname, '..');
const outDir = path.join(appDir, 'output/playwright');
const fixture = name => ({
  format: 'paper-review-standalone', version: 1,
  record: {
    pdfName: name, createdAt: '2026-09-08T00:00:00.000Z', venue: 'CHI', model: 'gpt-5', strictness: 'やや厳しめ',
    result: { sections: [{ title: 'Introduction', summary_ja: '起動時競合の回帰テスト。' }], review: { decision: 'Accept', score: 4, summary_one_line: '保存済みの結果です。', strengths: ['説明が明確'], weaknesses: ['詳細を補足'] } },
    checked: {}, chat: []
  }
});
const upload = name => ({ name: name + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(name))) });

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  const blockedRequests = [];
  const errors = [];
  const checks = [];
  await context.route(/^https?:\/\//, route => { blockedRequests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(pathToFileURL(path.join(appDir, 'index.html')).href);
    await page.locator('#import-file').setInputFiles(upload('existing-review.pdf'));
    await page.waitForFunction(() => document.getElementById('history-count').textContent === '1');
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('結果を読み込みました。JSON'));

    // Install only after seeding the existing record. Each reload delays only
    // its first database open callback, leaving native IndexedDB behavior intact.
    await page.addInitScript(() => {
      const originalOpen = indexedDB.open.bind(indexedDB);
      let intercepted = false;
      window.__startupDbDelivered = false;
      window.__startupDbPending = false;
      indexedDB.open = function (...args) {
        const request = originalOpen(...args);
        if (intercepted || args[0] !== 'paper-review-standalone') return request;
        intercepted = true;
        return new Proxy(request, {
          get(target, property) {
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
          set(target, property, value) {
            if (property === 'onsuccess' && typeof value === 'function') {
              target.onsuccess = event => {
                window.__startupDbPending = true;
                setTimeout(() => {
                  window.__startupDbDelivered = true;
                  window.__startupDbPending = false;
                  value.call(target, event);
                }, 1200);
              };
              return true;
            }
            return Reflect.set(target, property, value, target);
          }
        });
      };
    });

    await page.reload();
    await page.waitForFunction(() => window.__startupDbPending);
    await page.locator('.nav-item[data-nav="history"]').click();
    assert.equal(await page.evaluate(() => window.__startupDbDelivered), false, 'History clicked before DB initialization completed');
    await page.locator('#history-view').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('.history-title').length === 1);
    assert.equal(await page.locator('.history-title').innerText(), 'existing-review.pdf');
    checks.push('history clicked during delayed DB initialization shows saved records after initialization');
    console.log('PASS ' + checks.at(-1));

    await page.reload();
    await page.waitForFunction(() => window.__startupDbPending);
    await page.locator('.nav-item[data-nav="history"]').click();
    await page.locator('#import-file').setInputFiles(upload('new-import.pdf'));
    assert.equal(await page.evaluate(() => window.__startupDbDelivered), false, 'JSON import triggered before DB initialization completed');
    await page.waitForFunction(() => document.getElementById('history-count').textContent === '2');
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('結果を読み込みました。JSON'));
    assert.equal(await page.locator('#result-title').innerText(), 'new-import.pdf');
    await page.locator('.nav-item[data-nav="history"]').click();
    assert.deepEqual((await page.locator('.history-title').allInnerTexts()).sort(), ['existing-review.pdf', 'new-import.pdf']);

    // Verify both records survive another page lifecycle, not just UI memory.
    await page.reload();
    await page.locator('.nav-item[data-nav="history"]').click();
    await page.locator('#history-view').waitFor({ state: 'visible' });
    assert.deepEqual((await page.locator('.history-title').allInnerTexts()).sort(), ['existing-review.pdf', 'new-import.pdf']);
    checks.push('JSON import during delayed DB initialization preserves both existing and imported records across reload');
    console.log('PASS ' + checks.at(-1));

    assert.deepEqual(errors, []);
    assert.deepEqual(blockedRequests, []);
    fs.writeFileSync(path.join(outDir, 'startup-race-results.json'), JSON.stringify({ passed: checks.length, checks, databaseCallbackDelayMs: 1200, liveRequests: 0, javascriptErrors: errors }, null, 2));
    console.log('2 startup race regressions passed.');
  } catch (error) {
    fs.writeFileSync(path.join(outDir, 'startup-race-failure.json'), JSON.stringify({ checks, error: String(error), javascriptErrors: errors }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
