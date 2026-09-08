/* Public API capabilities checked against official OpenAI model pages, 2026-09-08.
 * https://developers.openai.com/api/docs/models/gpt-6-astra
 * https://developers.openai.com/api/docs/models/gpt-5.6-sol
 * https://developers.openai.com/api/docs/models/gpt-5.6-terra
 * https://developers.openai.com/api/docs/models/gpt-5.6-luna
 * These are API effort values, not Codex application effort presets. */
(function (root) {
  'use strict';
  const EFFORT_LABELS = Object.freeze({
    '': 'モデルの既定', none: 'なし（none）', minimal: '最小（minimal）',
    low: '低（low）', medium: '標準（medium）', high: '高（high）',
    xhigh: '非常に高（xhigh）', max: '最大（max）'
  });
  const ALL_EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  const MODELS = Object.freeze([
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], extendedBudget: true },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], aliases: ['gpt-5.6'], extendedBudget: true },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], extendedBudget: true },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], extendedBudget: true },
    { id: 'gpt-5', label: 'GPT-5（元の既定モデル）', efforts: ['minimal', 'low', 'medium', 'high'] },
    { id: 'o1', label: 'o1（既存互換）', efforts: ['low', 'medium', 'high'] }
  ].map(model => Object.freeze({ ...model, efforts: Object.freeze(model.efforts), aliases: Object.freeze(model.aliases || []) })));

  function getModel(model) {
    if (typeof model !== 'string') return null;
    const value = model.trim();
    return MODELS.find(item => [item.id, ...item.aliases].some(id => value === id ||
      (value.startsWith(id + '-') && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(id.length + 1))))) || null;
  }
  function getEfforts(model) {
    const known = getModel(model);
    if (known) return known.efforts;
    if (/^(gpt-4|chatgpt-4)/.test(String(model))) return [];
    // Custom model support cannot be inferred from a name. The UI explains that
    // these are candidate API values; API-specific compatibility is user-supplied.
    return ALL_EFFORTS;
  }
  function isSupportedEffort(model, effort) {
    if (effort === '' || effort === undefined || effort === null) return true;
    return typeof effort === 'string' && getEfforts(model).includes(effort);
  }
  function formatEffort(effort) {
    return Object.hasOwn(EFFORT_LABELS, effort || '') ? EFFORT_LABELS[effort || ''] : String(effort);
  }
  function completionLimit(model, effort, base) {
    if (!getModel(model)?.extendedBudget) return base;
    // This is an application budget, not a claimed API requirement. Reasoning
    // consumes the same limit as the visible answer, so leave room for both.
    const budget = { high: 48000, xhigh: 96000, max: 128000 }[effort] || base;
    return Math.max(base, budget);
  }
  const api = Object.freeze({ MODELS, ALL_EFFORTS, EFFORT_LABELS, getModel, getEfforts, isSupportedEffort, formatEffort, completionLimit });
  root.ReviewModels = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
