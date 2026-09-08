const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Prompts = require('../prompts.js');
const API = require('../review-api.js');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function fixture(withResponse = false) {
  const result = {
    sections: [{ title: 'Abstract', summary_ja: '章の要約' }],
    review: {
      decision: 'Weak Accept', score: 4, summary_one_line: '明確な貢献があります。',
      plain_summary_for_student: '良い点と改善点の説明です。', strengths: ['方法が明確'], weaknesses: ['比較条件を補足'], confidence: 4,
      statistical_validity: { score: 4, overall_comment: '概ね妥当', issues: [] },
      citations_check: { total_citations: 2, verified_count: 1, suspicious_citations: [] },
      rewrite_suggestions: []
    }
  };
  if (withResponse) result.review.response_evaluation = {
    overall_assessment: '回答は整合しています。', covered_points: ['方法'], missing_points: [], inconsistencies: [], weak_arguments: [], recommended_revisions_to_response: []
  };
  return result;
}

function pdf(name = 'paper.pdf') { return new File(['%PDF-1.7\nmock paper'], name, { type: 'application/pdf' }); }
function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function completion(result = fixture()) {
  return { model: 'gpt-5-2025-08-07', choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } };
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(url.startsWith('https://api.openai.com/v1/'));
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return calls;
}

function reviewOptions(extra = {}) { return { apiKey: 'sk-unit-test-no-real-key', model: 'gpt-5', paper: pdf(), ...extra }; }

test('default prompt exactly matches the source PHP heredoc and includes all original schema fields', () => {
  // This digest also keeps the tests runnable in the standalone ZIP, without PHP.
  assert.equal(crypto.createHash('sha256').update(Prompts.DEFAULT_PROMPT).digest('hex'), 'b16589dd7b24e65c121a28e9040a53ba22b4603cb5943484891ad8a45eda681a');
  const sourcePath = path.join(__dirname, '../../src/handlers/ai.php');
  if (fs.existsSync(sourcePath)) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const original = source.match(/const PAPER_REVIEW_DEFAULT_PROMPT = <<<PROMPT\n([\s\S]*?)\nPROMPT;/)[1];
    assert.equal(Prompts.DEFAULT_PROMPT, original);
  }
  const basic = Prompts.buildPrompts({ venue: 'CHI', strictness: '厳しめ' });
  assert.ok(basic.system.startsWith(Prompts.DEFAULT_PROMPT));
  assert.ok(basic.system.endsWith('査読の厳しさは 厳しめ で、ターゲット会議は CHI を想定。'));
  for (const field of ['sections', 'decision', 'score', 'summary_one_line', 'plain_summary_for_student', 'contribution_validity', 'author_claimed_contributions', 'reviewer_perceived_contributions', 'contribution_gap_explanation', 'missing_descriptions', 'logical_flow', 'consistency_check', 'hypothesis_vs_results', 'editorial_check', 'statistical_validity', 'citations_check', 'strengths', 'weaknesses', 'strengthening_analyses', 'alternatives_when_no_reexp', 'rewrite_suggestions', 'revision_to_accept', 'comments_to_authors', 'confidence']) {
    assert.ok(basic.user.includes('"' + field + '"'), field);
  }
  assert.ok(!basic.user.includes('"response_evaluation"'));
});

test('custom prompt replaces default, preserving response text and PDF evaluation mode', () => {
  const value = Prompts.buildPrompts({ customPrompt: '  独自の査読指示  ', responseText: '  著者回答\n修正内容  ', hasResponsePdf: true });
  assert.ok(value.system.startsWith('独自の査読指示\n\n'));
  assert.ok(value.system.includes('【回答文評価モード】'));
  assert.ok(value.user.includes('"response_evaluation"'));
  assert.ok(value.user.includes('------ ここから回答文 ------\n著者回答\n修正内容\n------ ここまで ------'));
  assert.ok(value.user.includes('2 つめが回答文 PDF'));
});

test('PDF validation checks content and size rather than a filename extension', async () => {
  await API.validatePdf(pdf('document.bin'));
  await assert.rejects(API.validatePdf(new File(['hello'], 'fake.pdf')), { code: 'validation' });
  await assert.rejects(API.validatePdf(new File(['%PD'], 'short.pdf')), { code: 'validation' });
  await assert.rejects(API.validatePdf({ size: API.MAX_PDF_BYTES + 1, slice() { throw new Error('not reached'); } }), { code: 'validation' });
  await assert.rejects(API.validatePdf(null), { code: 'validation' });
});

test('both PDFs upload with expiration, review receives original options, then both files are deleted', async () => {
  let uploads = 0;
  const calls = mockFetch((url, options) => {
    if (url.endsWith('/files') && options.method === 'POST') return response({ id: 'file-' + (++uploads) });
    if (options.method === 'DELETE') return response({ deleted: true });
    return response(completion(fixture(true)));
  });
  const progress = [];
  const output = await API.runReview(reviewOptions({ responsePdf: pdf('response.pdf'), responseText: '著者回答', onProgress: status => progress.push(status.stage) }));
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer sk-unit-test-no-real-key');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
  }
  for (const call of calls.slice(0, 2)) {
    assert.equal(call.options.body.get('purpose'), 'user_data');
    assert.equal(call.options.body.get('expires_after[anchor]'), 'created_at');
    assert.equal(call.options.body.get('expires_after[seconds]'), '3600');
  }
  const payload = JSON.parse(calls[2].options.body);
  assert.equal(payload.max_completion_tokens, 24000);
  assert.equal(payload.store, false);
  assert.equal(payload.temperature, undefined);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.deepEqual(payload.messages[1].content.slice(0, 2), [{ type: 'file', file: { file_id: 'file-1' } }, { type: 'file', file: { file_id: 'file-2' } }]);
  assert.ok(payload.messages[1].content[2].text.includes('著者回答'));
  assert.equal(output.result.review.decision, 'Weak Accept');
  assert.equal(output.usage.total_tokens, 50);
  assert.deepEqual(output.cleanupWarnings, []);
  assert.deepEqual(progress, ['validating', 'uploading-paper', 'uploading-response', 'reviewing', 'cleaning']);
});

test('response PDF upload failure ends the review and cleans up the already uploaded paper', async () => {
  let uploads = 0;
  const calls = mockFetch((url, options) => {
    if (options.method === 'DELETE') return response({ deleted: true });
    if (++uploads === 1) return response({ id: 'file-paper' });
    return response({ error: { message: 'secret raw server response', code: 'server_error' } }, 500);
  });
  await assert.rejects(API.runReview(reviewOptions({ responsePdf: pdf('response.pdf') })), error => {
    assert.equal(error.code, 'server');
    assert.ok(!error.message.includes('secret'));
    assert.deepEqual(error.cleanupWarnings, []);
    return true;
  });
  assert.equal(calls.length, 3);
  assert.ok(!calls.some(call => call.url.endsWith('/chat/completions')));
  assert.equal(calls[2].options.method, 'DELETE');
});

test('invalid JSON, missing schema, truncated output, and refusal are not retried and always clean up', async () => {
  const cases = [
    ['invalid_response', { choices: [{ message: { content: 'not JSON' }, finish_reason: 'stop' }] }],
    ['invalid_response', completion({ sections: [], review: {} })],
    ['truncated', { choices: [{ message: { content: '{' }, finish_reason: 'length' }] }],
    ['refusal', { choices: [{ message: { content: null, refusal: 'refused' }, finish_reason: 'stop' }] }],
    ['refusal', { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }]
  ];
  for (const [code, answer] of cases) {
    const calls = mockFetch((url, options) => {
      if (options.method === 'DELETE') return response({ deleted: true });
      return response(url.endsWith('/files') ? { id: 'file-paper' } : answer);
    });
    await assert.rejects(API.runReview(reviewOptions()), { code });
    assert.equal(calls.filter(call => call.url.endsWith('/chat/completions')).length, 1);
    assert.equal(calls.at(-1).options.method, 'DELETE');
  }
});

test('cancellation during review still deletes both files with separate, live signals', async () => {
  const controller = new AbortController();
  let uploads = 0;
  const calls = mockFetch(async (url, options) => {
    if (url.endsWith('/files')) return response({ id: 'file-' + (++uploads) });
    if (options.method === 'DELETE') {
      assert.notEqual(options.signal, controller.signal);
      assert.equal(options.signal.aborted, false);
      return response({ deleted: true });
    }
    controller.abort();
    throw new DOMException('aborted', 'AbortError');
  });
  await assert.rejects(API.runReview(reviewOptions({ responsePdf: pdf('response.pdf'), signal: controller.signal })), error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.code, 'cancelled');
    assert.deepEqual(error.cleanupWarnings, []);
    return true;
  });
  assert.equal(calls.filter(call => call.options.method === 'DELETE').length, 2);
});

test('pre-cancellation and invalid combined size/response text make no network calls', async () => {
  const calls = mockFetch(() => { throw new Error('must not call'); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(API.runReview(reviewOptions({ signal: controller.signal })), { name: 'AbortError' });
  const large = () => ({ name: 'large.pdf', size: 25000000, slice: () => new Blob(['%PDF-']) });
  await assert.rejects(API.runReview(reviewOptions({ paper: large(), responsePdf: large() })), { code: 'validation' });
  await assert.rejects(API.runReview(reviewOptions({ responseText: 'あ'.repeat(20001) })), { code: 'validation' });
  assert.equal(calls.length, 0);
});

test('cleanup failure preserves a successful result with a Japanese warning', async () => {
  mockFetch((url, options) => {
    if (options.method === 'DELETE') return response({ error: { code: 'server_error' } }, 500);
    return response(url.endsWith('/files') ? { id: 'file-paper' } : completion());
  });
  const output = await API.runReview(reviewOptions());
  assert.equal(output.result.review.score, 4);
  assert.equal(output.cleanupWarnings.length, 1);
  assert.match(output.cleanupWarnings[0], /1 時間後/);
});

test('HTTP errors map to helpful categories without echoing credentials or raw bodies', async () => {
  for (const [status, apiCode, expected] of [[401, 'invalid_api_key', 'auth'], [403, 'forbidden', 'permission'], [429, 'insufficient_quota', 'quota'], [429, 'rate_limit_exceeded', 'rate_limit'], [413, 'too_large', 'payload_too_large'], [503, 'server_error', 'server'], [400, 'invalid', 'unsupported_request']]) {
    const calls = mockFetch(() => response({ error: { code: apiCode, message: 'sk-unit-test-no-real-key PRIVATE' } }, status));
    await assert.rejects(API.runReview(reviewOptions()), error => {
      assert.equal(error.code, expected);
      assert.ok(!error.message.includes('sk-'));
      assert.ok(!error.message.includes('PRIVATE'));
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test('a fetch failure is reported safely without an automatic retry', async () => {
  const calls = mockFetch(() => { throw new TypeError('network request with sk-private-key failed'); });
  await assert.rejects(API.runReview(reviewOptions()), error => {
    assert.equal(error.code, 'network');
    assert.ok(!error.message.includes('sk-private'));
    return true;
  });
  assert.equal(calls.length, 1);
});

test('chat uses full result and conversation context, without pretending to reread the PDF', async () => {
  const calls = mockFetch(() => response({ choices: [{ message: { content: '説明します。' }, finish_reason: 'stop' }], usage: { total_tokens: 9 } }));
  const messages = [{ role: 'user', content: '最優先の改善は？' }, { role: 'assistant', content: '比較条件です。' }, { role: 'user', content: '詳しく教えて' }];
  const output = await API.chat({ apiKey: 'sk-unit-test-no-real-key', model: 'o1', result: fixture(), messages });
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, 'o1');
  assert.equal(payload.temperature, undefined);
  assert.equal(payload.store, false);
  assert.ok(payload.messages[0].content.includes(JSON.stringify(fixture())));
  assert.ok(payload.messages[0].content.includes('元の PDF は添付されていません'));
  assert.deepEqual(payload.messages.slice(1), messages);
  assert.equal(output.text, '説明します。');
  assert.equal(output.usage.total_tokens, 9);
});

test('non-reasoning models retain the original temperature option', async () => {
  const calls = mockFetch(() => response({ choices: [{ message: { content: '回答' }, finish_reason: 'stop' }] }));
  await API.chat({ apiKey: 'sk-unit-test-no-real-key', model: 'gpt-4.1', result: fixture(), messages: [{ role: 'user', content: '質問' }] });
  assert.equal(JSON.parse(calls[0].options.body).temperature, 0.3);
});

const supportedModelEfforts = [
  ['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-5.6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-5.6-terra', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-5.6-luna', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-5.6', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-5', ['minimal', 'low', 'medium', 'high']],
  ['o1', ['low', 'medium', 'high']]
];

for (const [model, efforts] of supportedModelEfforts) {
  for (const reasoningEffort of efforts) {
    test(`review and chat send supported ${model} / ${reasoningEffort} settings without retries`, async () => {
      const calls = mockFetch((url, options) => {
        if (url.endsWith('/files')) return response({ id: 'file-paper' });
        if (options.method === 'DELETE') return response({ deleted: true });
        const payload = JSON.parse(options.body);
        return response(payload.response_format ? completion() : { choices: [{ message: { content: '回答' }, finish_reason: 'stop' }] });
      });
      await API.runReview(reviewOptions({ model, reasoningEffort }));
      await API.chat({ apiKey: 'sk-unit-test-no-real-key', model, reasoningEffort, result: fixture(), messages: [{ role: 'user', content: '質問' }] });
      assert.equal(calls.length, 4);
      const payloads = calls.filter(call => call.url.endsWith('/chat/completions')).map(call => JSON.parse(call.options.body));
      assert.equal(payloads.length, 2);
      for (const [index, payload] of payloads.entries()) {
        const base = index === 0 ? 24000 : 12000;
        const expandedLimit = /^(gpt-6|gpt-5\.6)/.test(model) ? { high: 48000, xhigh: 96000, max: 128000 }[reasoningEffort] : null;
        assert.equal(payload.model, model);
        assert.equal(payload.reasoning_effort, reasoningEffort);
        assert.equal(payload.max_completion_tokens, expandedLimit || base);
        assert.equal(payload.store, false);
        assert.equal(Object.hasOwn(payload, 'temperature'), false);
      }
      assert.deepEqual(payloads[0].response_format, { type: 'json_object' });
      assert.equal(Object.hasOwn(payloads[1], 'response_format'), false);
    });
  }
}

test('provider-default effort is omitted for new and existing models and preserves original token budgets', async () => {
  const calls = mockFetch((url, options) => {
    if (url.endsWith('/files')) return response({ id: 'file-paper' });
    if (options.method === 'DELETE') return response({ deleted: true });
    return response(completion());
  });
  for (const model of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6', 'gpt-5', 'o1']) {
    for (const reasoningEffort of [undefined, null, '', '   ']) {
      await API.runReview(reviewOptions({ model, reasoningEffort }));
      const payload = JSON.parse(calls.at(-2).options.body);
      assert.equal(payload.model, model);
      assert.equal(Object.hasOwn(payload, 'reasoning_effort'), false);
      assert.equal(Object.hasOwn(payload, 'temperature'), false);
      assert.equal(payload.max_completion_tokens, 24000);
      await API.chat({ apiKey: 'sk-unit-test-no-real-key', model, reasoningEffort, result: fixture(), messages: [{ role: 'user', content: '質問' }] });
      const chatPayload = JSON.parse(calls.at(-1).options.body);
      assert.equal(Object.hasOwn(chatPayload, 'reasoning_effort'), false);
      assert.equal(chatPayload.max_completion_tokens, 12000);
    }
  }
});

test('unsupported reasoning combinations fail before file validation, uploading, or chat requests', async () => {
  const calls = mockFetch(() => { throw new Error('must not call'); });
  const invalid = [
    ['gpt-6-astra', 'none'], ['gpt-6-astra', 'minimal'], ['gpt-6-astra', 'ultra'],
    ['gpt-5.6-sol', 'minimal'], ['gpt-5.6-terra', 'ultra'], ['gpt-5.6-luna', 'xmax'],
    ['gpt-5', 'none'], ['gpt-5', 'xhigh'], ['o1', 'minimal'], ['o1', 'max'],
    ['custom-vision-model', 'ultra'], ['gpt-5.6-sol', 3], ['gpt-5.6-sol', {}]
  ];
  for (const [model, reasoningEffort] of invalid) {
    const checkError = error => {
      assert.equal(error.code, 'validation');
      assert.match(error.message, /思考/);
      return true;
    };
    await assert.rejects(API.runReview(reviewOptions({ model, reasoningEffort, paper: null })), checkError);
    await assert.rejects(API.chat({ apiKey: 'sk-unit-test-no-real-key', model, reasoningEffort, result: null, messages: [] }), checkError);
  }
  assert.equal(calls.length, 0);
});

test('reasoning setting is normalized before sending and never copied from an unvalidated value', async () => {
  const calls = mockFetch(() => response({ choices: [{ message: { content: '回答' }, finish_reason: 'stop' }] }));
  await API.chat({ apiKey: 'sk-unit-test-no-real-key', model: '  gpt-6-astra  ', reasoningEffort: ' high ', result: fixture(), messages: [{ role: 'user', content: '質問' }] });
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, 'gpt-6-astra');
  assert.equal(payload.reasoning_effort, 'high');
  assert.equal(payload.max_completion_tokens, 48000);
  assert.equal(Object.hasOwn(payload, 'temperature'), false);
});

test('classic scripts run with no module loader and never access browser storage', () => {
  const browser = {};
  const context = vm.createContext({ window: browser });
  for (const storage of ['localStorage', 'sessionStorage', 'indexedDB']) {
    Object.defineProperty(browser, storage, { get() { assert.fail('credential client must not access ' + storage); } });
  }
  for (const filename of ['prompts.js', 'models.js', 'review-api.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    vm.runInContext(source, context, { filename });
    assert.ok(!/\.setItem\s*\(/.test(source));
  }
  assert.equal(typeof browser.ReviewPrompts.buildPrompts, 'function');
  assert.equal(typeof browser.ReviewAPI.runReview, 'function');
  assert.ok(!Object.keys(browser.ReviewAPI).some(key => /secret|apiKey/i.test(key)));
});
