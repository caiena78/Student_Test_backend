'use strict';

const {
  Document, Packer, Paragraph, TextRun, Header,
  AlignmentType, BorderStyle, PageBreak,
} = require('docx');

const { getAnswerText } = require('./printHtml');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Half-points (docx size unit): 12pt = 24, 11pt = 22, 10pt = 20, 9pt = 18
const SZ_TITLE  = 28; // 14pt
const SZ_BODY   = 24; // 12pt
const SZ_OPT    = 22; // 11pt
const SZ_SMALL  = 20; // 10pt

// Twips (docx spacing unit): 1pt = 20 twips
const SP_AFTER_SECTION = 400;
const SP_AFTER_Q       = 200;
const SP_AFTER_OPT     = 80;
const SP_AFTER_LINE    = 200; // blank answer lines

function cfg(q) {
  if (!q.config) return {};
  return typeof q.config === 'string' ? JSON.parse(q.config) : q.config;
}

// ─── Question renderers ───────────────────────────────────────────────────────

function questionParagraphs(q, num, showCorrect) {
  const paras = [];

  // Prompt
  paras.push(new Paragraph({
    spacing: { before: SP_AFTER_Q, after: 100 },
    children: [
      new TextRun({ text: `Q${num}.  `, bold: true, size: SZ_BODY }),
      new TextRun({ text: q.prompt || '', size: SZ_BODY }),
    ],
  }));

  if (q.type === 'multiple_choice') {
    const opts = (q.options || []).slice().sort((a, b) => a.order_index - b.order_index);
    opts.forEach((opt, i) => {
      const letter = LETTERS[i] || String(i + 1);
      const isCorrect = showCorrect && opt.is_correct;
      paras.push(new Paragraph({
        spacing: { after: SP_AFTER_OPT },
        children: [new TextRun({
          text: `     ${letter}.  ${opt.text || ''}`,
          size: SZ_OPT,
          bold: isCorrect,
          color: isCorrect ? '16a34a' : undefined,
        })],
      }));
    });

  } else if (q.type === 'true_false') {
    const correctIsTrue = Boolean(cfg(q).correct_answer);
    ['True', 'False'].forEach(label => {
      const isCorrect = showCorrect && (label === 'True' ? correctIsTrue : !correctIsTrue);
      paras.push(new Paragraph({
        spacing: { after: SP_AFTER_OPT },
        children: [new TextRun({
          text: `     ${isCorrect ? '✓' : '○'}  ${label}`,
          size: SZ_OPT,
          bold: isCorrect,
          color: isCorrect ? '16a34a' : undefined,
        })],
      }));
    });

  } else if (q.type === 'free_text') {
    if (showCorrect) {
      const c = cfg(q);
      const sample = c.sample_answer || '';
      const keywords = (c.keywords || []).join(', ');
      paras.push(new Paragraph({
        spacing: { after: SP_AFTER_OPT },
        children: [new TextRun({
          text: `     Sample answer: ${sample || '(none)'}${keywords ? `  |  Keywords: ${keywords}` : ''}`,
          size: SZ_OPT,
          italics: true,
          color: '6b4800',
        })],
      }));
    } else {
      // Three blank answer lines using paragraph bottom borders
      for (let i = 0; i < 3; i++) {
        paras.push(new Paragraph({
          spacing: { after: SP_AFTER_LINE },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'aaaaaa' },
          },
          children: [new TextRun({ text: ' ', size: SZ_OPT })],
        }));
      }
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
    items.forEach((item, idx) => {
      paras.push(new Paragraph({
        spacing: { after: SP_AFTER_OPT },
        children: [new TextRun({
          text: `     ${showCorrect ? `${idx + 1}.` : '□'}  ${item.item_text || ''}`,
          size: SZ_OPT,
        })],
      }));
    });
  }

  return paras;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

async function buildPrintDocx(payload, mode) {
  if (!['test', 'key', 'answers_only'].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}`);
  }

  const { test, questions, version_number, version_name } = payload;
  const headerTitle = `${test.title}-${String(version_number).padStart(3, '0')}`;

  const modeLabel =
    mode === 'key' ? 'TEST + ANSWERS' :
    mode === 'answers_only' ? 'ANSWERS ONLY' : '';

  const headerRight = modeLabel ? `  —  ${modeLabel}` : '';

  // Word page header (repeats on every page)
  const pageHeader = new Header({
    children: [new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({ text: headerTitle, bold: true, size: SZ_SMALL }),
        new TextRun({ text: headerRight, size: SZ_SMALL, color: '555555' }),
      ],
    })],
  });

  const children = [];

  if (mode === 'answers_only') {
    // Title line
    children.push(new Paragraph({
      spacing: { after: SP_AFTER_Q },
      children: [new TextRun({ text: headerTitle, bold: true, size: SZ_TITLE })],
    }));
    children.push(new Paragraph({
      spacing: { after: SP_AFTER_SECTION },
      children: [new TextRun({ text: 'ANSWERS ONLY', bold: true, size: SZ_SMALL, color: '1d4ed8' })],
    }));

    // One line per question: "1. A"
    (questions || []).forEach((q, i) => {
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({
          text: `${i + 1}. ${getAnswerText(q)}`,
          size: SZ_BODY,
        })],
      }));
    });

  } else {
    const showCorrect = mode === 'key';

    // Test title
    children.push(new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: test.title, bold: true, size: SZ_TITLE })],
    }));
    children.push(new Paragraph({
      spacing: { after: showCorrect ? 120 : SP_AFTER_SECTION },
      children: [new TextRun({ text: headerTitle, size: SZ_SMALL, color: '555555' })],
    }));

    if (showCorrect) {
      children.push(new Paragraph({
        spacing: { after: SP_AFTER_SECTION },
        children: [new TextRun({ text: 'TEST + ANSWERS', bold: true, size: SZ_SMALL, color: 'dc2626' })],
      }));
    } else {
      // Name / Date line for student copies
      children.push(new Paragraph({
        spacing: { after: SP_AFTER_SECTION },
        children: [
          new TextRun({ text: 'Name: ________________________________   ', size: SZ_OPT }),
          new TextRun({ text: 'Date: _______________', size: SZ_OPT }),
        ],
      }));
    }

    // Questions
    (questions || []).forEach((q, i) => {
      questionParagraphs(q, i + 1, showCorrect).forEach(p => children.push(p));
    });
  }

  const doc = new Document({
    sections: [{
      headers: { default: pageHeader },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildPrintDocx };
