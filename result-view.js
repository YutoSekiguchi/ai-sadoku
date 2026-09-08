(function (root) {
  'use strict';

  const CITATION_NOTE = 'AI知識に基づく整合性評価。外部DBでの実在確認は未実施。';
  const STAT_TYPES = {
    wrong_test: '検定選択の誤り', assumption_violated: '仮定の検証・違反',
    no_effect_size: '効果量の不足', no_correction: '多重比較補正の不足',
    wrong_model: 'モデル選択の問題', inconsistent_reporting: '報告の内的不整合',
    misinterpretation: '統計の解釈', p_hacking: 'p-hacking の疑い',
    harking: 'HARKing の疑い', small_n: 'サンプルサイズ',
    lickert_mean: 'リッカート尺度の平均化', likert_mean: 'リッカート尺度の平均化',
    no_ci: '信頼区間の不足', other: 'その他'
  };
  const CITATION_TYPES = {
    author_error: '著者名の問題', title_not_found: 'タイトルの実在性に疑問',
    bibinfo_error: '書誌情報の問題', venue_year_mismatch: '会議と年の不整合',
    body_mismatch: '本文引用との不一致', format_inconsistent: '書式の不統一',
    possibly_hallucinated: '実在しない引用の可能性', other: 'その他'
  };
  const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' };
  const CONSISTENCY_FIELDS = [
    ['background_to_method', '背景 → 手法'], ['method_to_experiment', '手法 → 実験'],
    ['experiment_to_result', '実験 → 結果'], ['result_to_discussion', '結果 → 議論 → 結論']
  ];
  const EDITORIAL_FIELDS = [
    ['terminology_consistency', '用語の一貫性'], ['jargon_explanation', '専門用語の説明'],
    ['figure_table_references', '図表の参照・説明'], ['references_validity', '参考文献の全体所感']
  ];
  const RESPONSE_FIELDS = [
    ['covered_points', '対応できている指摘'], ['missing_points', '対応が不足している論点'],
    ['inconsistencies', '論文本文との矛盾'], ['weak_arguments', '弱い・曖昧な主張'],
    ['recommended_revisions_to_response', '回答文の書き換え提案']
  ];

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function list(value) { return Array.isArray(value) ? value : []; }

  function text(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return ''; }
    }
    return String(value);
  }

  function escape(value) {
    return text(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function md(value) {
    return text(value).replace(/\r\n?/g, '\n').replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_\[\]#|]/g, '\\$&');
  }

  function present(value) { return text(value).trim() !== ''; }

  function paragraph(value, className) {
    return present(value) ? '<p class="rv-text' + (className ? ' ' + className : '') + '">' + escape(value) + '</p>' : '';
  }

  function field(label, value, className) {
    return present(value) ? '<div class="rv-field' + (className ? ' ' + className : '') + '"><h4>' + escape(label) + '</h4>' + paragraph(value) + '</div>' : '';
  }

  function bulletList(values, ordered) {
    const items = list(values).filter(present);
    if (!items.length) return '';
    const tag = ordered ? 'ol' : 'ul';
    return '<' + tag + ' class="rv-list">' + items.map(item => '<li>' + escape(item) + '</li>').join('') + '</' + tag + '>';
  }

  function listField(label, values, ordered) {
    const content = bulletList(values, ordered);
    return content ? '<div class="rv-field"><h4>' + escape(label) + '</h4>' + content + '</div>' : '';
  }

  function details(title, content, open, count) {
    if (!content) return '';
    return '<details class="rv-section"' + (open ? ' open' : '') + '><summary><span>' + escape(title) + '</span>' +
      (Number.isFinite(count) ? '<span class="rv-count">' + count + '</span>' : '') +
      '</summary><div class="rv-section-body">' + content + '</div></details>';
  }

  function mappedFields(value, fields) {
    const data = object(value);
    return fields.map(([key, label]) => field(label, data[key])).join('');
  }

  function tone(decision) {
    if (/accept/i.test(text(decision))) return 'rv-positive';
    if (/reject/i.test(text(decision))) return 'rv-critical';
    return 'rv-neutral';
  }

  function renderStatistics(value) {
    const statistics = object(value);
    const issues = list(statistics.issues);
    const score = present(statistics.score) ? '<p class="rv-metric-inline">統計の評価 <strong>' + escape(statistics.score) + ' / 5</strong></p>' : '';
    return score + paragraph(statistics.overall_comment) + (issues.length ? '<div class="rv-issue-list">' + issues.map(item => {
      const issue = object(item);
      return '<article class="rv-issue"><h4>' + escape(STAT_TYPES[issue.issue_type] || issue.issue_type || '統計上の指摘') + '</h4>' +
        field('該当箇所', issue.location, 'rv-quotation') + field('問題点', issue.explanation) + field('改善案', issue.suggestion, 'rv-suggestion') + '</article>';
    }).join('') + '</div>' : '<p class="rv-empty">個別の統計上の指摘はありません。</p>');
  }

  function renderCitations(value) {
    const citations = object(value);
    const issues = list(citations.suspicious_citations);
    const total = present(citations.total_citations) ? escape(citations.total_citations) : '不明';
    const checked = present(citations.verified_count) ? escape(citations.verified_count) : '不明';
    return '<p class="rv-citation-note">' + CITATION_NOTE + '</p><p class="rv-text">引用総数：' + total +
      ' 件 ／ AI が整合的と判断：' + checked + ' 件 ／ 要確認：' + issues.length + ' 件</p>' +
      (issues.length ? '<div class="rv-issue-list">' + issues.map(item => {
        const issue = object(item);
        return '<article class="rv-issue"><div class="rv-issue-heading"><h4>' +
          escape(CITATION_TYPES[issue.issue_type] || issue.issue_type || '引用の確認事項') + '</h4>' +
          (present(issue.confidence) ? '<span class="rv-tag">疑いの確度：' + escape(CONFIDENCE_LABELS[issue.confidence] || issue.confidence) + '</span>' : '') + '</div>' +
          field('参考文献の原文', issue.original_citation, 'rv-quotation') + field('本文での引用', issue.cited_as) +
          field('確認が必要な理由', issue.explanation) + field('修正候補', issue.suggested_fix, 'rv-suggestion') + '</article>';
      }).join('') + '</div>' : '<p class="rv-empty">AI が挙げた要確認の引用はありません。文献の実在を保証するものではありません。</p>');
  }

  function renderRewrites(values) {
    return list(values).map((item, index) => {
      const rewrite = object(item);
      return '<article class="rv-issue"><h4>書き換え案 ' + (index + 1) + '</h4>' +
        field('原文', rewrite.original, 'rv-quotation') + field('原文の日本語訳', rewrite.original_ja) +
        field('書き換える理由', rewrite.reason) + field('書き換え案（原文の言語）', rewrite.suggested_rewrite_en || rewrite.suggested_rewrite, 'rv-suggestion') +
        field('書き換え案の日本語訳', rewrite.suggested_rewrite_ja, 'rv-suggestion') + '</article>';
    }).join('');
  }

  function renderResult(record) {
    record = object(record);
    const result = object(record.result);
    const review = object(result.review);
    if (!Object.keys(review).length && !list(result.sections).length) {
      return '<div class="rv-empty">表示できる査読結果がありません。</div>';
    }
    let html = '<div class="rv-report"><section class="rv-overview"><div class="rv-overview-top"><h2>査読の総合評価</h2>' +
      (present(review.decision) ? '<span class="rv-decision ' + tone(review.decision) + '">' + escape(review.decision) + '</span>' : '') + '</div>' +
      '<div class="rv-metrics">' + (present(review.score) ? '<span>評価 <strong>' + escape(review.score) + ' / 5</strong></span>' : '') +
      (present(review.confidence) ? '<span>査読者の自信 <strong>' + escape(review.confidence) + ' / 5</strong></span>' : '') + '</div>' +
      paragraph(review.summary_one_line, 'rv-summary-line') + '</section>';
    if (present(review.plain_summary_for_student)) {
      html += '<section class="rv-student"><p class="rv-kicker">まずはここから</p><h3>学生向けの平易なまとめ</h3>' + paragraph(review.plain_summary_for_student) + '</section>';
    }
    html += details('採録に向けて優先する修正', bulletList(review.revision_to_accept, true), true, list(review.revision_to_accept).length);
    const sections = list(result.sections);
    html += details('章別の日本語要約', sections.map((item, index) => {
      const section = object(item);
      return '<article class="rv-chapter"><h3>' + escape(section.title || '章 ' + (index + 1)) + '</h3>' + paragraph(section.summary_ja) + '</article>';
    }).join(''), false, sections.length);
    html += details('貢献の妥当性と独立した解釈', field('貢献の妥当性', review.contribution_validity) +
      '<div class="rv-comparison">' + listField('著者が主張する貢献', review.author_claimed_contributions) +
      listField('AI が読み取った実質的な貢献', review.reviewer_perceived_contributions) + '</div>' +
      field('両者の一致・ギャップ', review.contribution_gap_explanation));
    html += details('実験の記述・論理・章間の整合性', listField('不足している記述', review.missing_descriptions) +
      field('論理のつながり', review.logical_flow) + mappedFields(review.consistency_check, CONSISTENCY_FIELDS) +
      field('仮説・問いと結果の対応', review.hypothesis_vs_results));
    html += details('用語・図表・編集面', mappedFields(review.editorial_check, EDITORIAL_FIELDS));
    if (review.statistical_validity && typeof review.statistical_validity === 'object') {
      html += details('統計手法・報告・解釈の妥当性', renderStatistics(review.statistical_validity), false, list(review.statistical_validity.issues).length);
    }
    if (review.citations_check && typeof review.citations_check === 'object') {
      html += details('参考文献の確認事項', renderCitations(review.citations_check), false, list(review.citations_check.suspicious_citations).length);
    }
    html += details('強みと弱み・改稿案', '<div class="rv-comparison">' + listField('強み', review.strengths) + listField('弱みと具体的な改稿案', review.weaknesses) + '</div>');
    html += details('文章のリライト提案', renderRewrites(review.rewrite_suggestions), false, list(review.rewrite_suggestions).length);
    html += details('論文を強くする分析・追加実験ができない場合', listField('追加分析の提案', review.strengthening_analyses) +
      listField('追加実験ができない場合の代替案', review.alternatives_when_no_reexp));
    html += details('著者への総合コメント', paragraph(review.comments_to_authors), true);
    const response = object(review.response_evaluation);
    if (Object.keys(response).length) {
      html += details('回答文・リバトルの妥当性評価', field('回答全体の評価', response.overall_assessment) +
        RESPONSE_FIELDS.map(([key, label]) => listField(label, response[key])).join(''), true);
    }
    if (present(record.responseText) || present(record.responsePdfName)) {
      html += details('提出した回答文・リバトル', field('回答 PDF', record.responsePdfName) + paragraph(record.responseText));
    }
    return html + '</div>';
  }

  function extractChecklist(result) {
    const data = object(result);
    const review = object(data.review || data);
    const output = [];
    const push = (key, value) => {
      const content = text(value).trim();
      if (content) output.push({ key: key.slice(0, 80), text: content.slice(0, 500) });
    };
    list(review.weaknesses).forEach((item, index) => push('weakness:' + index, item));
    list(review.rewrite_suggestions).forEach((item, index) => {
      const rewrite = object(item);
      push('rewrite:' + index, rewrite.original ? '[書き換え] ' + text(rewrite.original) + ' → ' + text(rewrite.suggested_rewrite_en || rewrite.suggested_rewrite || '') : rewrite.reason);
    });
    list(review.revision_to_accept).forEach((item, index) => push('revision:' + index, item));
    list(review.strengthening_analyses).forEach((item, index) => push('strengthening:' + index, item));
    list(review.alternatives_when_no_reexp).forEach((item, index) => push('alternative:' + index, item));
    list(object(review.statistical_validity).issues).forEach((item, index) => {
      const issue = object(item);
      push('stat_issue:' + index, '[統計 ' + text(issue.location || '?') + '] ' + text(issue.explanation) + ' → ' + text(issue.suggestion));
    });
    list(object(review.citations_check).suspicious_citations).forEach((item, index) => {
      const issue = object(item);
      push('citation:' + index, '[引用] ' + text(issue.original_citation) + ' — ' + text(issue.explanation));
    });
    const response = object(review.response_evaluation);
    list(response.missing_points).forEach((item, index) => push('resp_missing:' + index, '[回答漏れ] ' + text(item)));
    list(response.recommended_revisions_to_response).forEach((item, index) => push('resp_rewrite:' + index, '[回答書き換え] ' + text(item)));
    list(response.inconsistencies).forEach((item, index) => push('resp_inconsistency:' + index, '[回答矛盾] ' + text(item)));
    return output;
  }

  function renderChecklist(record) {
    record = object(record);
    const items = extractChecklist(record.result);
    const checked = object(record.checked);
    const done = items.filter(item => checked[item.key] === true).length;
    return '<div class="rv-checklist"><div class="rv-checklist-header"><h2>修正チェックリスト</h2><span class="rv-progress-text">' + done + ' / ' + items.length +
      ' 完了</span></div><progress class="rv-progress" value="' + done + '" max="' + Math.max(items.length, 1) + '" aria-label="修正の進捗"></progress>' +
      (items.length ? '<div class="rv-checklist-items">' + items.map(item => {
        const complete = checked[item.key] === true;
        return '<label class="rv-check-item' + (complete ? ' rv-complete' : '') + '"><input type="checkbox" data-check-key="' + escape(item.key) + '"' +
          (complete ? ' checked' : '') + '><span>' + escape(item.text) + '</span></label>';
      }).join('') + '</div>' : '<p class="rv-empty">この結果には修正候補がありません。</p>') + '</div>';
  }

  function toMarkdown(record) {
    record = object(record);
    const result = object(record.result);
    const review = object(result.review);
    const lines = ['# 論文査読：' + md(record.pdfName || '論文'), ''];
    const add = (title, value, level) => {
      if (!present(value)) return;
      lines.push('#'.repeat(level || 2) + ' ' + title, '', md(value), '');
    };
    const addList = (title, values, ordered, level) => {
      const items = list(values).filter(present);
      if (!items.length) return;
      lines.push('#'.repeat(level || 2) + ' ' + title, '');
      items.forEach((item, index) => lines.push((ordered ? (index + 1) + '. ' : '- ') + md(item).replace(/\n/g, '\n  ')));
      lines.push('');
    };
    [['日時', record.createdAt], ['対象会議', record.venue], ['厳しさ', record.strictness], ['モデル', record.model], ['思考量', record.reasoningEffort || 'モデルの既定'], ['回答 PDF', record.responsePdfName]]
      .filter(([, value]) => present(value)).forEach(([label, value]) => lines.push('- ' + label + '：' + md(value)));
    lines.push('');
    add('総合判定', review.decision);
    if (present(review.score)) lines.push('- 評価：' + md(review.score) + ' / 5');
    if (present(review.confidence)) lines.push('- 査読者の自信：' + md(review.confidence) + ' / 5');
    lines.push('');
    add('査読の1行要約', review.summary_one_line);
    add('学生向けの平易なまとめ', review.plain_summary_for_student);
    addList('採録に向けて優先する修正', review.revision_to_accept, true);
    if (list(result.sections).length) {
      lines.push('## 章別の日本語要約', '');
      list(result.sections).forEach((item, index) => {
        const section = object(item);
        lines.push('### ' + md(section.title || '章 ' + (index + 1)), '', md(section.summary_ja), '');
      });
    }
    add('貢献の妥当性', review.contribution_validity);
    addList('著者が主張する貢献', review.author_claimed_contributions);
    addList('AI が読み取った実質的な貢献', review.reviewer_perceived_contributions);
    add('貢献の一致・ギャップ', review.contribution_gap_explanation);
    addList('不足している記述', review.missing_descriptions);
    add('論理のつながり', review.logical_flow);
    CONSISTENCY_FIELDS.forEach(([key, label]) => add(label, object(review.consistency_check)[key]));
    add('仮説・問いと結果の対応', review.hypothesis_vs_results);
    EDITORIAL_FIELDS.forEach(([key, label]) => add(label, object(review.editorial_check)[key]));
    if (review.statistical_validity) {
      const statistics = object(review.statistical_validity);
      lines.push('## 統計手法・報告・解釈の妥当性', '');
      if (present(statistics.score)) lines.push('評価：' + md(statistics.score) + ' / 5', '');
      if (present(statistics.overall_comment)) lines.push(md(statistics.overall_comment), '');
      list(statistics.issues).forEach((item, index) => {
        const issue = object(item);
        lines.push('### 統計の指摘 ' + (index + 1) + '：' + md(STAT_TYPES[issue.issue_type] || issue.issue_type || 'その他'), '');
        [['該当箇所', issue.location], ['問題点', issue.explanation], ['改善案', issue.suggestion]].forEach(([label, value]) => add(label, value, 4));
      });
    }
    if (review.citations_check) {
      const citations = object(review.citations_check);
      lines.push('## 参考文献の確認事項', '', CITATION_NOTE, '',
        '引用総数：' + md(citations.total_citations ?? '不明') + ' 件 ／ AI が整合的と判断：' + md(citations.verified_count ?? '不明') +
        ' 件 ／ 要確認：' + list(citations.suspicious_citations).length + ' 件', '');
      list(citations.suspicious_citations).forEach((item, index) => {
        const issue = object(item);
        lines.push('### 引用の確認事項 ' + (index + 1) + '：' + md(CITATION_TYPES[issue.issue_type] || issue.issue_type || 'その他'), '');
        [['参考文献の原文', issue.original_citation], ['本文での引用', issue.cited_as], ['確認が必要な理由', issue.explanation],
          ['疑いの確度', CONFIDENCE_LABELS[issue.confidence] || issue.confidence], ['修正候補', issue.suggested_fix]]
          .forEach(([label, value]) => add(label, value, 4));
      });
    }
    addList('強み', review.strengths);
    addList('弱みと具体的な改稿案', review.weaknesses);
    if (list(review.rewrite_suggestions).length) {
      lines.push('## 文章のリライト提案', '');
      list(review.rewrite_suggestions).forEach((item, index) => {
        const rewrite = object(item);
        lines.push('### 書き換え案 ' + (index + 1), '');
        [['原文', rewrite.original], ['原文の日本語訳', rewrite.original_ja], ['書き換える理由', rewrite.reason],
          ['書き換え案（原文の言語）', rewrite.suggested_rewrite_en || rewrite.suggested_rewrite], ['書き換え案の日本語訳', rewrite.suggested_rewrite_ja]]
          .forEach(([label, value]) => add(label, value, 4));
      });
    }
    addList('追加分析の提案', review.strengthening_analyses);
    addList('追加実験ができない場合の代替案', review.alternatives_when_no_reexp);
    add('著者への総合コメント', review.comments_to_authors);
    const response = object(review.response_evaluation);
    if (Object.keys(response).length) {
      lines.push('## 回答文・リバトルの妥当性評価', '');
      add('回答全体の評価', response.overall_assessment, 3);
      RESPONSE_FIELDS.forEach(([key, label]) => addList(label, response[key], false, 3));
    }
    add('提出した回答文・リバトル', record.responseText);
    const items = extractChecklist(result);
    if (items.length) {
      const checked = object(record.checked);
      lines.push('## 修正チェックリスト', '');
      items.forEach(item => lines.push('- [' + (checked[item.key] === true ? 'x' : ' ') + '] ' + md(item.text).replace(/\n/g, '\n  ')));
      lines.push('');
    }
    return lines.join('\n').trim() + '\n';
  }

  const api = { renderResult, extractChecklist, renderChecklist, toMarkdown };
  root.ReviewView = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
