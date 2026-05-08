'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');

const { buildPrintHtml }  = require('./printHtml');
const { buildPrintDocx }  = require('./printDocx');

// Minimal 1×1 white PNG (valid image file, small footprint)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';

function makeTmpUploads() {
  const dir     = fs.mkdtempSync(path.join(os.tmpdir(), 'print-test-'));
  const imgName = 'question-img.png';
  fs.writeFileSync(path.join(dir, imgName), Buffer.from(TINY_PNG_B64, 'base64'));
  return { dir, imgUrl: `/uploads/${imgName}` };
}

function makePayload(promptImage = null) {
  return {
    test: { id: 1, title: 'Sample Test', title_image: null, time_limit_minutes: 60 },
    questions: [
      {
        id: 1,
        type: 'multiple_choice',
        prompt: 'What is 2 + 2?',
        prompt_image: promptImage,
        points: 1,
        options: [
          { text: '3', image: null, is_correct: false, order_index: 0 },
          { text: '4', image: null, is_correct: true,  order_index: 1 },
          { text: '5', image: null, is_correct: false, order_index: 2 },
        ],
        config: null,
        drag_drop_items: [],
      },
    ],
    version_number: 1,
    version_name: 'Sample Test - 001',
    generated_at: new Date().toISOString(),
  };
}

// ── Print Test (mode=test) ────────────────────────────────────────────────────

test('Print Test embeds question image as data URI when uploadsDir provided', () => {
  const { dir, imgUrl } = makeTmpUploads();
  try {
    const html = buildPrintHtml(makePayload(imgUrl), 'test', 'http://localhost:3000', dir);
    assert.ok(html.includes('data:image/png;base64,'), 'image embedded as data URI');
    assert.ok(html.includes('class="q-img"'),          'q-img element present');
    assert.ok(!html.includes('localhost:3000/uploads'), 'no bare URL reference to image');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('Print Test image appears between prompt and answer choices', () => {
  const { dir, imgUrl } = makeTmpUploads();
  try {
    const html = buildPrintHtml(makePayload(imgUrl), 'test', 'http://localhost:3000', dir);
    const promptPos = html.indexOf('class="q-prompt"');
    const imgPos    = html.indexOf('class="q-img"');
    const optPos    = html.indexOf('class="mc-options"');
    assert.ok(promptPos < imgPos,  'image comes after prompt text');
    assert.ok(imgPos    < optPos,  'image comes before answer choices');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── Print Test + Answers (mode=key) ──────────────────────────────────────────

test('Print Test + Answers embeds image and marks correct answer', () => {
  const { dir, imgUrl } = makeTmpUploads();
  try {
    const html = buildPrintHtml(makePayload(imgUrl), 'key', 'http://localhost:3000', dir);
    assert.ok(html.includes('data:image/png;base64,'), 'image embedded as data URI');
    assert.ok(html.includes('mc-correct'),             'correct answer marked');
    assert.ok(html.includes('TEST + ANSWERS'),         'answer mode label present');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('Question without image renders no q-img element', () => {
  const { dir } = makeTmpUploads();
  try {
    const html = buildPrintHtml(makePayload(null), 'test', 'http://localhost:3000', dir);
    assert.ok(!html.includes('class="q-img"'), 'no q-img when prompt_image is null');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('Falls back to absolute URL (PUBLIC_URL + path) when uploadsDir is not provided', () => {
  const html = buildPrintHtml(
    makePayload('/uploads/missing.png'),
    'test',
    'http://localhost:3000',
    // no uploadsDir
  );
  assert.ok(
    html.includes('http://localhost:3000/uploads/missing.png'),
    'fallback uses PUBLIC_URL + image path',
  );
});

test('Falls back to absolute URL (PUBLIC_URL + path) when image file is missing from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-test-'));
  try {
    const html = buildPrintHtml(
      makePayload('/uploads/nonexistent.png'),
      'test',
      'http://localhost:3000',
      dir, // dir exists but the file does not
    );
    assert.ok(
      html.includes('http://localhost:3000/uploads/nonexistent.png'),
      'fallback uses PUBLIC_URL + image path',
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── Word export unchanged ─────────────────────────────────────────────────────

test('buildPrintDocx still produces a valid DOCX buffer', async () => {
  const { dir, imgUrl } = makeTmpUploads();
  try {
    const buffer = await buildPrintDocx(makePayload(imgUrl), 'test', dir);
    assert.ok(Buffer.isBuffer(buffer), 'returns a Buffer');
    assert.ok(buffer.length > 0,      'buffer is non-empty');
    // DOCX is a ZIP; ZIP magic bytes are 0x50 0x4B
    assert.equal(buffer[0], 0x50, 'DOCX starts with PK (ZIP magic byte 0)');
    assert.equal(buffer[1], 0x4B, 'DOCX starts with PK (ZIP magic byte 1)');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildPrintDocx key mode still marks correct answer', async () => {
  const { dir, imgUrl } = makeTmpUploads();
  try {
    const buffer = await buildPrintDocx(makePayload(imgUrl), 'key', dir);
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0, 'returns non-empty DOCX buffer');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
