'use strict';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absUrl(url, baseUrl) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return baseUrl + url;
}

// Returns the correct-answer text for a question (used by answers_only mode).
function getAnswerText(q) {
  if (q.type === 'multiple_choice') {
    const opts = (q.options || []).slice();
    const letters = opts
      .map((o, i) => (o.is_correct ? (LETTERS[i] || String(i + 1)) : null))
      .filter(Boolean);
    return letters.length ? letters.join(', ') : '—';
  }
  if (q.type === 'true_false') {
    const cfg = q.config
      ? (typeof q.config === 'string' ? JSON.parse(q.config) : q.config)
      : {};
    return Boolean(cfg.correct_answer) ? 'True' : 'False';
  }
  if (q.type === 'free_text') {
    const cfg = q.config
      ? (typeof q.config === 'string' ? JSON.parse(q.config) : q.config)
      : {};
    return cfg.sample_answer || '—';
  }
  if (q.type === 'drag_drop') {
    const items = (q.drag_drop_items || []).slice()
      .sort((a, b) => a.correct_position - b.correct_position);
    return items.map(i => i.item_text || '?').join(', ');
  }
  return '—';
}

function renderQuestion(q, num, showCorrect, baseUrl) {
  const promptImg = q.prompt_image
    ? `<img src="${esc(absUrl(q.prompt_image, baseUrl))}" class="q-img" alt="">`
    : '';

  let bodyHtml = '';

  if (q.type === 'multiple_choice') {
    const opts = (q.options || []).slice();
    bodyHtml = `<div class="mc-options">${opts.map((opt, i) => {
      const correct = showCorrect && opt.is_correct;
      const letter = LETTERS[i] || String(i + 1);
      const img = opt.image
        ? `<img src="${esc(absUrl(opt.image, baseUrl))}" class="opt-img" alt="">`
        : '';
      return `<div class="mc-option${correct ? ' mc-correct' : ''}">
        <span class="mc-circle${correct ? ' filled' : ''}">${correct ? '&#10003;' : ''}</span>
        <span class="opt-letter">${letter}.</span>
        ${esc(opt.text || '')}${img}
      </div>`;
    }).join('')}</div>`;

  } else if (q.type === 'true_false') {
    const cfg = q.config
      ? (typeof q.config === 'string' ? JSON.parse(q.config) : q.config)
      : {};
    const correctIsTrue = Boolean(cfg.correct_answer);
    const mk = (label, isCorrect) =>
      `<div class="mc-option${isCorrect ? ' mc-correct' : ''}">
        <span class="mc-circle${isCorrect ? ' filled' : ''}">${isCorrect ? '&#10003;' : ''}</span>
        ${label}
      </div>`;
    bodyHtml = `<div class="tf-options">
      ${mk('True',  showCorrect && correctIsTrue)}
      ${mk('False', showCorrect && !correctIsTrue)}
    </div>`;

  } else if (q.type === 'free_text') {
    if (showCorrect) {
      const cfg = q.config
        ? (typeof q.config === 'string' ? JSON.parse(q.config) : q.config)
        : {};
      const sample = cfg.sample_answer || '';
      const keywords = (cfg.keywords || []).join(', ');
      bodyHtml = `<div class="answer-key-note">
        ${sample ? `<div><strong>Sample answer:</strong> ${esc(sample)}</div>` : ''}
        ${keywords ? `<div><strong>Keywords:</strong> ${esc(keywords)}</div>` : ''}
        ${!sample && !keywords ? '<div><em>No sample answer provided</em></div>' : ''}
      </div>`;
    } else {
      bodyHtml = `<div class="free-text-lines">
        <div class="answer-line"></div>
        <div class="answer-line"></div>
        <div class="answer-line"></div>
      </div>`;
    }

  } else if (q.type === 'drag_drop') {
    const items = (q.drag_drop_items || []).slice();
    if (showCorrect) {
      items.sort((a, b) => a.correct_position - b.correct_position);
    } else {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    }
    bodyHtml = `<div class="dd-items">${items.map((item, idx) => {
      const img = item.item_image
        ? `<img src="${esc(absUrl(item.item_image, baseUrl))}" class="opt-img" alt="">`
        : '';
      return `<div class="dd-item">
        <span class="dd-label">${showCorrect ? `${idx + 1}.` : '&#9744;'}</span>
        ${esc(item.item_text || '')}${img}
      </div>`;
    }).join('')}</div>`;
  }

  return `
<div class="question">
  <div class="q-header">
    <span class="q-num">${num}.</span>
    <div class="q-body">
      <div class="q-prompt">${esc(q.prompt)}${promptImg ? ` ${promptImg}` : ''}</div>
      ${bodyHtml}
    </div>
  </div>
</div>`;
}

// ─── Shared CSS ───────────────────────────────────────────────────────────────

const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 12pt;
    color: #111;
    background: #fff;
    padding: 24px 32px 32px;
  }

  /* ── Screen header ─────── */
  .screen-header {
    border-bottom: 2px solid #111;
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .screen-header h1 { font-size: 18pt; font-weight: bold; }
  .header-meta {
    display: flex; gap: 16px; font-size: 10pt; color: #444;
    margin-top: 4px; align-items: center; flex-wrap: wrap;
  }
  .mode-badge {
    padding: 2px 8px; border-radius: 3px;
    font-weight: bold; font-size: 9pt; letter-spacing: .06em;
  }
  .badge-key      { background: #dc2626; color: #fff; }
  .badge-answers  { background: #1d4ed8; color: #fff; }
  .title-img { max-height: 80px; margin-top: 8px; display: block; }

  /* ── Print repeating header ─────── */
  .print-header { display: none; }

  /* ── Student info ─────── */
  .student-info { margin: 12px 0 22px; font-size: 11pt; line-height: 2; }

  /* ── Questions ─────── */
  .question { margin-bottom: 22px; page-break-inside: avoid; }
  .q-header { display: flex; gap: 8px; align-items: flex-start; }
  .q-num { font-weight: bold; min-width: 34px; flex-shrink: 0; font-size: 11pt; padding-top: 1px; color: #333; }
  .q-body { flex: 1; }
  .q-prompt { font-size: 12pt; line-height: 1.55; margin-bottom: 8px; }
  .q-img { max-width: 260px; max-height: 140px; margin-top: 6px; display: block; }

  .mc-options { display: flex; flex-direction: column; gap: 5px; }
  .mc-option { display: flex; align-items: center; gap: 8px; font-size: 11pt; }
  .mc-option.mc-correct { font-weight: bold; }
  .opt-letter { font-weight: 600; min-width: 18px; }
  .mc-circle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border: 1.5px solid #555; border-radius: 50%;
    font-size: 10pt; flex-shrink: 0;
  }
  .mc-circle.filled { background: #16a34a; border-color: #16a34a; color: #fff; font-weight: bold; }
  .opt-img { max-height: 48px; margin-left: 6px; vertical-align: middle; }

  .tf-options { display: flex; gap: 24px; }

  .free-text-lines { margin-top: 4px; }
  .answer-line { border-bottom: 1px solid #aaa; height: 26px; margin-bottom: 5px; }
  .answer-key-note {
    background: #fefce8; border-left: 3px solid #ca8a04;
    padding: 6px 10px; font-size: 11pt; border-radius: 0 4px 4px 0; line-height: 1.6;
  }

  .dd-items { display: flex; flex-direction: column; gap: 4px; }
  .dd-item { display: flex; align-items: center; gap: 8px; font-size: 11pt; }
  .dd-label { min-width: 22px; font-weight: bold; color: #444; }

  /* ── Answers-only list ─────── */
  .answers-list { font-size: 13pt; line-height: 2; }
  .answer-row { padding: 2px 0; }

  /* ── Print media ─────── */
  @media print {
    body { padding: 0; margin: 28mm 18mm 14mm 18mm; }
    .screen-header { display: none; }
    .no-print { display: none !important; }
    .print-header {
      display: flex;
      position: fixed; top: 0; left: 0; right: 0;
      background: #fff; border-bottom: 1.5px solid #111;
      padding: 4px 18mm; font-size: 10pt;
      justify-content: space-between; align-items: baseline;
    }
    .print-header-title { font-weight: bold; }
    .print-header-right { color: #444; font-size: 9pt; }
    .question { page-break-inside: avoid; }
  }

  @page { size: A4; margin: 28mm 18mm 14mm 18mm; }
`;

// ─── Builders ─────────────────────────────────────────────────────────────────

function buildPrintHtml(payload, mode, baseUrl) {
  if (!['test', 'key', 'answers_only'].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}`);
  }

  const { test, questions, version_number, version_name, generated_at } = payload;
  const base = baseUrl || '';
  const headerTitle = `${test.title}-${String(version_number).padStart(3, '0')}`;
  const generatedDate = new Date(generated_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  if (mode === 'answers_only') {
    const rows = (questions || [])
      .map((q, i) => `<div class="answer-row">${i + 1}. ${esc(getAnswerText(q))}</div>`)
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(headerTitle)} — Answers Only</title>
<style>${BASE_CSS}</style>
</head>
<body>

<div class="print-header" aria-hidden="true">
  <span class="print-header-title">${esc(headerTitle)}</span>
  <span class="print-header-right">ANSWERS ONLY</span>
</div>

<div class="screen-header">
  <h1>${esc(test.title)}</h1>
  <div class="header-meta">
    <span>Version: <strong>${esc(version_name)}</strong></span>
    <span>Generated: ${esc(generatedDate)}</span>
    <span class="mode-badge badge-answers">ANSWERS ONLY</span>
  </div>
</div>

<div class="answers-list">
${rows}
</div>

</body>
</html>`;
  }

  // mode === 'test' or 'key'
  const showCorrect = mode === 'key';
  const titleImg = test.title_image
    ? `<img src="${esc(absUrl(test.title_image, base))}" class="title-img" alt="">`
    : '';
  const questionsHtml = (questions || [])
    .map((q, i) => renderQuestion(q, i + 1, showCorrect, base))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(headerTitle)}${showCorrect ? ' — Test + Answers' : ''}</title>
<style>${BASE_CSS}</style>
</head>
<body>

<div class="print-header" aria-hidden="true">
  <span class="print-header-title">${esc(headerTitle)}</span>
  <span class="print-header-right">${showCorrect ? 'TEST + ANSWERS' : ''}</span>
</div>

<div class="screen-header">
  <h1>${esc(test.title)}</h1>
  ${titleImg}
  <div class="header-meta">
    <span>Version: <strong>${esc(version_name)}</strong></span>
    <span>Generated: ${esc(generatedDate)}</span>
    ${showCorrect ? '<span class="mode-badge badge-key">TEST + ANSWERS</span>' : ''}
  </div>
</div>

${!showCorrect ? `<div class="student-info">
  Name: ________________________________________&nbsp;&nbsp;&nbsp; Date: _______________
</div>` : ''}

<div class="questions">
${questionsHtml}
</div>

</body>
</html>`;
}

module.exports = { buildPrintHtml, getAnswerText };
