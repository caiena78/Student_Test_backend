'use strict';

const fs   = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Header,
  AlignmentType, BorderStyle, ImageRun,
} = require('docx');

const { getAnswerText } = require('./printHtml');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Half-points: 14pt=28, 12pt=24, 11pt=22, 10pt=20
const SZ_TITLE = 28;
const SZ_BODY  = 24;
const SZ_OPT   = 22;
const SZ_SMALL = 20;

// Twips (1pt = 20 twips)
const SP_AFTER_SECTION = 400;
const SP_AFTER_Q       = 200;
const SP_AFTER_OPT     = 80;
const SP_AFTER_LINE    = 200;

// Maximum rendered dimensions for question images in DOCX (pixels)
const DOCX_IMG_MAX_W = 400;
const DOCX_IMG_MAX_H = 300;

// Extension → docx ImageRun type.  webp is absent: not supported by the library.
const EXT_TYPE_MAP = {
  '.jpg':  'jpg',
  '.jpeg': 'jpg',
  '.png':  'png',
  '.gif':  'gif',
  '.bmp':  'bmp',
  '.svg':  'svg',
};

// ─── Image helpers ────────────────────────────────────────────────────────────

/**
 * Load an image buffer from the uploads directory on disk.
 * imgUrl: "/uploads/abc.png"  or  "uploads/abc.png"
 * Returns { data: Buffer, type: string } or null on any failure.
 */
function loadImageForDocx(imgUrl, uploadsDir) {
  if (!imgUrl || !uploadsDir) return null;
  try {
    const relative = imgUrl.replace(/^\/+uploads\//, '');
    const filePath = path.join(uploadsDir, relative);
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    const type = EXT_TYPE_MAP[ext];
    if (!type) return null; // unsupported format (e.g. webp)
    return { data, type };
  } catch {
    return null;
  }
}

/**
 * Calculate display dimensions that fit within the max box while preserving
 * the original aspect ratio.  Uses image-size when installed; falls back to
 * the max box dimensions (images will still appear, just uncropped).
 */
function calcDocxImageDimensions(data) {
  try {
    // image-size is in package.json; this will succeed after npm install
    const { imageSize } = require('image-size');
    const dims = imageSize(data);
    if (dims && dims.width && dims.height) {
      const ratio = Math.min(
        DOCX_IMG_MAX_W / dims.width,
        DOCX_IMG_MAX_H / dims.height,
        1, // never upscale
      );
      return {
        width:  Math.round(dims.width  * ratio),
        height: Math.round(dims.height * ratio),
      };
    }
  } catch {
    // image-size unavailable or failed — fall through to safe defaults
  }
  return { width: DOCX_IMG_MAX_W, height: DOCX_IMG_MAX_H };
}

/**
 * Build a Paragraph containing the question image.
 * Returns null if the image cannot be loaded (missing file, bad type, etc.).
 */
function makeImageParagraph(imgUrl, uploadsDir) {
  const img = loadImageForDocx(imgUrl, uploadsDir);
  if (!img) return null;

  const { width, height } = calcDocxImageDimensions(img.data);

  return new Paragraph({
    spacing: { before: 120, after: 200 },
    children: [
      new ImageRun({
        data:           img.data,
        transformation: { width, height },
        type:           img.type,
      }),
    ],
  });
}

// ─── Question renderer ────────────────────────────────────────────────────────

function cfg(q) {
  if (!q.config) return {};
  return typeof q.config === 'string' ? JSON.parse(q.config) : q.config;
}

/**
 * Returns an array of docx Paragraphs for one question.
 * Order: prompt → image (if any) → answer choices / blank lines.
 *
 * @param {object} q           Question object from the snapshot payload.
 * @param {number} num         1-based question number.
 * @param {boolean} showCorrect
 * @param {string|undefined} uploadsDir  Absolute path to the uploads folder.
 */
function questionParagraphs(q, num, showCorrect, uploadsDir) {
  const paras = [];

  // ── 1. Question prompt text ───────────────────────────────────────────────
  paras.push(new Paragraph({
    spacing: { before: SP_AFTER_Q, after: 100 },
    children: [
      new TextRun({ text: `${num}.  `, bold: true, size: SZ_BODY }),
      new TextRun({ text: q.prompt || '', size: SZ_BODY }),
    ],
  }));

  // ── 2. Question image — BELOW prompt, ABOVE answer choices ───────────────
  if (q.prompt_image) {
    const imgPara = makeImageParagraph(q.prompt_image, uploadsDir);
    if (imgPara) paras.push(imgPara);
  }

  // ── 3. Answer choices / blank writing area ────────────────────────────────
  if (q.type === 'multiple_choice') {
    const opts = (q.options || []).slice().sort((a, b) => a.order_index - b.order_index);
    opts.forEach((opt, i) => {
      const letter    = LETTERS[i] || String(i + 1);
      const isCorrect = showCorrect && opt.is_correct;
      paras.push(new Paragraph({
        spacing: { after: SP_AFTER_OPT },
        children: [new TextRun({
          text:  `     ${letter}.  ${opt.text || ''}`,
          size:  SZ_OPT,
          bold:  isCorrect,
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
          text:  `     ${isCorrect ? '✓' : '○'}  ${label}`,
          size:  SZ_OPT,
          bold:  isCorrect,
          color: isCorrect ? '16a34a' : undefined,
        })],
      }));
    });

  } else if (q.type === 'free_text') {
    if (showCorrect) {
      const c   = cfg(q);
      const kws = (c.keywords || []).join(', ');
      paras.push(new Paragraph({
        spacing: { after: SP_AFTER_OPT },
        children: [new TextRun({
          text:    `     Sample answer: ${c.sample_answer || '(none)'}${kws ? `  |  Keywords: ${kws}` : ''}`,
          size:    SZ_OPT,
          italics: true,
          color:   '6b4800',
        })],
      }));
    } else {
      for (let i = 0; i < 3; i++) {
        paras.push(new Paragraph({
          spacing: { after: SP_AFTER_LINE },
          border:  { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'aaaaaa' } },
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

/**
 * @param {object} payload       Stored print_job_versions.payload.
 * @param {string} mode          'test' | 'key' | 'answers_only'
 * @param {string} [uploadsDir]  Absolute path to the uploads directory on disk.
 *                               Required for images to appear; omit to skip.
 * @returns {Promise<Buffer>}
 */
async function buildPrintDocx(payload, mode, uploadsDir) {
  if (!['test', 'key', 'answers_only'].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}`);
  }

  const { test, questions, version_number, version_name } = payload;
  const headerTitle = `${test.title}-${String(version_number).padStart(3, '0')}`;

  const modeLabel =
    mode === 'key'          ? 'TEST + ANSWERS' :
    mode === 'answers_only' ? 'ANSWERS ONLY'   : '';

  const pageHeader = new Header({
    children: [new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({ text: headerTitle,                          bold: true, size: SZ_SMALL }),
        new TextRun({ text: modeLabel ? `  —  ${modeLabel}` : '', size: SZ_SMALL, color: '555555' }),
      ],
    })],
  });

  const children = [];

  if (mode === 'answers_only') {
    // Compact answer list — images are intentionally omitted in this mode
    children.push(new Paragraph({
      spacing: { after: SP_AFTER_Q },
      children: [new TextRun({ text: headerTitle, bold: true, size: SZ_TITLE })],
    }));
    children.push(new Paragraph({
      spacing: { after: SP_AFTER_SECTION },
      children: [new TextRun({ text: 'ANSWERS ONLY', bold: true, size: SZ_SMALL, color: '1d4ed8' })],
    }));
    (questions || []).forEach((q, i) => {
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: `${i + 1}. ${getAnswerText(q)}`, size: SZ_BODY })],
      }));
    });

  } else {
    const showCorrect = mode === 'key';

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
      children.push(new Paragraph({
        spacing: { after: SP_AFTER_SECTION },
        children: [
          new TextRun({ text: 'Name: ________________________________   ', size: SZ_OPT }),
          new TextRun({ text: 'Date: _______________', size: SZ_OPT }),
        ],
      }));
    }

    // Each question: prompt → image → choices
    (questions || []).forEach((q, i) => {
      questionParagraphs(q, i + 1, showCorrect, uploadsDir)
        .forEach(p => children.push(p));
    });
  }

  const doc = new Document({
    sections: [{ headers: { default: pageHeader }, children }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildPrintDocx };
