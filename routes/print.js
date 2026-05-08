const router = require('express').Router();
const path   = require('path');
const db     = require('../db');
const { buildPrintHtml } = require('../lib/printHtml');
const { buildPrintDocx } = require('../lib/printDocx');

const VALID_MODES   = ['test', 'key', 'answers_only'];
const VALID_FORMATS = ['print', 'docx'];

// Absolute path to uploads — passed to the DOCX builder so it can read
// image files from disk without an HTTP round-trip.
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// ─── helpers ─────────────────────────────────────────────────────────────────

async function loadVersion(jobId, versionId, userId, userRole) {
  const [jobs] = await db.execute('SELECT * FROM print_jobs WHERE id = ?', [jobId]);
  if (!jobs.length) return { error: 'Print job not found', status: 404 };
  if (jobs[0].teacher_id !== userId && userRole !== 'admin') {
    return { error: 'Forbidden', status: 403 };
  }
  const [versions] = await db.execute(
    'SELECT * FROM print_job_versions WHERE id = ? AND print_job_id = ?',
    [versionId, jobId]
  );
  if (!versions.length) return { error: 'Version not found', status: 404 };
  const payload = typeof versions[0].payload === 'string'
    ? JSON.parse(versions[0].payload)
    : versions[0].payload;
  return { job: jobs[0], version: versions[0], payload };
}

// ─── routes ──────────────────────────────────────────────────────────────────

// GET /api/print-jobs — list all print jobs for the requesting teacher (all for admin)
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const [rows] = await db.execute(
      `SELECT pj.id, pj.test_id, pj.teacher_id, pj.status, pj.number_of_versions,
              pj.error_message, pj.created_at,
              t.title AS test_title,
              (SELECT COUNT(*) FROM print_job_versions WHERE print_job_id = pj.id) AS version_count
       FROM print_jobs pj
       JOIN tests t ON t.id = pj.test_id
       ${isAdmin ? '' : 'WHERE pj.teacher_id = ?'}
       ORDER BY pj.created_at DESC`,
      isAdmin ? [] : [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List print jobs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/print-jobs/:jobId — get job details + version list (no payloads)
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const [jobs] = await db.execute(
      `SELECT pj.*, t.title AS test_title
       FROM print_jobs pj
       JOIN tests t ON t.id = pj.test_id
       WHERE pj.id = ?`,
      [jobId]
    );
    if (!jobs.length) return res.status(404).json({ error: 'Print job not found' });
    if (jobs[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [versions] = await db.execute(
      `SELECT id, version_number, version_name, created_at
       FROM print_job_versions
       WHERE print_job_id = ?
       ORDER BY version_number ASC`,
      [jobId]
    );
    res.json({ ...jobs[0], versions });
  } catch (err) {
    console.error('Get print job error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/print-jobs/:jobId — delete a print job and ALL its versions
// print_job_versions rows are removed automatically via ON DELETE CASCADE.
router.delete('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const [jobs] = await db.execute('SELECT * FROM print_jobs WHERE id = ?', [jobId]);
    if (!jobs.length) return res.status(404).json({ error: 'Print job not found' });
    if (jobs[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.execute('DELETE FROM print_jobs WHERE id = ?', [jobId]);
    res.json({ message: 'Print job deleted successfully' });
  } catch (err) {
    console.error('Delete print job error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/print-jobs/:jobId/versions/:versionId — delete a single version
router.delete('/:jobId/versions/:versionId', async (req, res) => {
  try {
    const { jobId, versionId } = req.params;
    const [jobs] = await db.execute('SELECT * FROM print_jobs WHERE id = ?', [jobId]);
    if (!jobs.length) return res.status(404).json({ error: 'Print job not found' });
    if (jobs[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [versions] = await db.execute(
      'SELECT id FROM print_job_versions WHERE id = ? AND print_job_id = ?',
      [versionId, jobId]
    );
    if (!versions.length) return res.status(404).json({ error: 'Version not found' });
    await db.execute('DELETE FROM print_job_versions WHERE id = ?', [versionId]);
    res.json({ message: 'Version deleted successfully' });
  } catch (err) {
    console.error('Delete print job version error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/print-jobs/:jobId/versions/:versionId/print
//   ?mode=test|key|answers_only
//   &format=print|docx
//
// format=print  → HTML for browser print dialog
// format=docx   → .docx download
router.get('/:jobId/versions/:versionId/print', async (req, res) => {
  try {
    const { jobId, versionId } = req.params;
    const mode   = req.query.mode   || 'test';
    const format = req.query.format || 'print';

    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(', ')}` });
    }
    if (!VALID_FORMATS.includes(format)) {
      return res.status(400).json({ error: `format must be one of: ${VALID_FORMATS.join(', ')}` });
    }

    const result = await loadVersion(jobId, versionId, req.user.id, req.user.role);
    if (result.error) return res.status(result.status).json({ error: result.error });
    const { version, payload } = result;

    if (format === 'docx') {
      const buffer = await buildPrintDocx(payload, mode, UPLOADS_DIR);
      const filename = `${version.version_name}-${mode}.docx`
        .replace(/[^a-zA-Z0-9._\- ]/g, '_');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    // format=print — return HTML
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const html = buildPrintHtml(payload, mode, baseUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Print/docx version error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
