/**
 * FINARA — routes/creditScore.js
 *
 * What this file does:
 * - API for credit scores (Experian, Equifax, TransUnion).
 * - Save scores by hand or try to sync from outside services.
 * - Powers the Credit Score card on the Balance Sheet.
 *
 * Read FILES.md for a simple guide to every file.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const {
  BUREAUS,
  BUREAU_LABELS,
  ENV_KEYS,
  bureauLabel,
  isValidBureau,
  syncBureau,
} = require('../services/creditSync');

const selectBureau = db.prepare('SELECT * FROM credit_bureaus WHERE bureau = ?');
const selectAllBureaus = db.prepare('SELECT * FROM credit_bureaus ORDER BY id');

const updateBureauManual = db.prepare(`
  UPDATE credit_bureaus
  SET auto_sync = ?,
      score = ?,
      utilization_pct = ?,
      on_time_pay_pct = ?,
      inquiries = ?,
      source = 'manual',
      updated_at = datetime('now'),
      sync_error = NULL
  WHERE bureau = ?
`);

const updateBureauSyncResult = db.prepare(`
  UPDATE credit_bureaus
  SET score = ?,
      utilization_pct = ?,
      on_time_pay_pct = ?,
      inquiries = ?,
      source = ?,
      updated_at = datetime('now'),
      last_sync_at = ?,
      sync_status = ?,
      sync_error = ?
  WHERE bureau = ?
`);

const setBureauSyncStatus = db.prepare(`
  UPDATE credit_bureaus
  SET sync_status = ?, sync_error = ? WHERE bureau = ?
`);

function rowToClient(row) {
  return {
    bureau: row.bureau,
    label: bureauLabel(row.bureau),
    auto_sync: row.auto_sync === 1,
    score: row.score,
    utilization_pct: row.utilization_pct,
    on_time_pay_pct: row.on_time_pay_pct,
    inquiries: row.inquiries,
    source: row.source,
    updated_at: row.updated_at,
    last_sync_at: row.last_sync_at,
    sync_status: row.sync_status,
    sync_error: row.sync_error,
    credentials_configured: false,
  };
}

function scoreRating(score) {
  if (score == null) return { label: 'Not set', color: '#6b7280' };
  if (score >= 800) return { label: 'Excellent', color: '#2563eb' };
  if (score >= 740) return { label: 'Very Good', color: '#16a34a' };
  if (score >= 670) return { label: 'Good', color: '#16a34a' };
  if (score >= 580) return { label: 'Fair', color: '#d97706' };
  return { label: 'Poor', color: '#dc2626' };
}

function avg(nums) {
  const valid = nums.filter(n => n != null && !Number.isNaN(n));
  if (!valid.length) return null;
  return valid.reduce((s, n) => s + n, 0) / valid.length;
}

function buildSummary(bureaus) {
  const scores = bureaus.map(b => b.score).filter(s => s != null);
  const score = scores.length
    ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
    : null;
  const rating = scoreRating(score);

  const utilization = avg(bureaus.map(b => b.utilization_pct));
  const onTimePay = avg(bureaus.map(b => b.on_time_pay_pct));
  const inquiries = bureaus.some(b => b.inquiries != null)
    ? Math.max(...bureaus.map(b => b.inquiries ?? 0))
    : null;

  const timestamps = bureaus
    .flatMap(b => [b.updated_at, b.last_sync_at])
    .filter(Boolean)
    .sort();
  const updated_at = timestamps.length ? timestamps[timestamps.length - 1] : null;

  const autoSyncEnabled = bureaus.some(b => b.auto_sync);
  const anySynced = bureaus.some(b => b.source === 'sync');
  const syncIssues = bureaus.filter(b => b.auto_sync && b.sync_status !== 'connected');

  return {
    score,
    rating_label: rating.label,
    rating_color: rating.color,
    utilization_pct: utilization,
    on_time_pay_pct: onTimePay,
    inquiries,
    updated_at,
    source: anySynced ? 'sync' : 'manual',
    auto_sync_enabled: autoSyncEnabled,
    bureaus_reporting: scores.length,
    sync_issues: syncIssues.map(b => ({
      bureau: b.bureau,
      label: b.label,
      sync_status: b.sync_status,
      sync_error: b.sync_error,
    })),
  };
}

function parseOptionalInt(value) {
  if (value === '' || value == null) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalFloat(value) {
  if (value === '' || value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function validateScore(score) {
  if (score == null) return null;
  if (!Number.isInteger(score) || score < 300 || score > 850) {
    return 'Score must be an integer between 300 and 850.';
  }
  return null;
}

/* GET /api/credit-score */
router.get('/', (req, res) => {
  const bureaus = selectAllBureaus.all().map(rowToClient);
  res.json({ bureaus, summary: buildSummary(bureaus) });
});

/* PUT /api/credit-score/:bureau — manual update + auto-sync toggle */
router.put('/:bureau', (req, res) => {
  const bureau = req.params.bureau;
  if (!isValidBureau(bureau)) return res.status(400).json({ error: 'Invalid bureau.' });

  const existing = selectBureau.get(bureau);
  if (!existing) return res.status(404).json({ error: 'Bureau not found.' });

  const {
    auto_sync,
    score,
    utilization_pct,
    on_time_pay_pct,
    inquiries,
  } = req.body;

  const parsedScore = parseOptionalInt(score);
  const scoreErr = validateScore(parsedScore);
  if (scoreErr) return res.status(400).json({ error: scoreErr });

  const parsedUtil = parseOptionalFloat(utilization_pct);
  if (parsedUtil != null && (parsedUtil < 0 || parsedUtil > 100)) {
    return res.status(400).json({ error: 'Utilization must be between 0 and 100.' });
  }

  const parsedOnTime = parseOptionalFloat(on_time_pay_pct);
  if (parsedOnTime != null && (parsedOnTime < 0 || parsedOnTime > 100)) {
    return res.status(400).json({ error: 'On-time pay must be between 0 and 100.' });
  }

  const parsedInquiries = parseOptionalInt(inquiries);
  if (parsedInquiries != null && parsedInquiries < 0) {
    return res.status(400).json({ error: 'Inquiries cannot be negative.' });
  }

  updateBureauManual.run(
    auto_sync ? 1 : 0,
    parsedScore,
    parsedUtil,
    parsedOnTime,
    parsedInquiries,
    bureau,
  );

  const updated = rowToClient(selectBureau.get(bureau));
  const bureaus = selectAllBureaus.all().map(rowToClient);
  res.json({ bureau: updated, summary: buildSummary(bureaus) });
});

/* POST /api/credit-score/sync — sync enabled bureaus (optional ?bureau=) */
router.post('/sync', async (req, res) => {
  const target = req.query.bureau || req.body?.bureau;
  const rows = selectAllBureaus.all();
  const toSync = rows.filter(r => {
    if (target) return r.bureau === target;
    return r.auto_sync === 1;
  });

  if (target && !isValidBureau(target)) {
    return res.status(400).json({ error: 'Invalid bureau.' });
  }
  if (!toSync.length) {
    return res.status(400).json({
      error: target
        ? `${bureauLabel(target)} is not configured for automatic sync.`
        : 'Enable automatic sync for at least one bureau first.',
    });
  }

  const results = [];

  for (const row of toSync) {
    setBureauSyncStatus.run('syncing', null, row.bureau);

    try {
      const result = await syncBureau(row.bureau);

      if (result.ok) {
        updateBureauSyncResult.run(
          result.score,
          result.utilization_pct,
          result.on_time_pay_pct,
          result.inquiries,
          'sync',
          new Date().toISOString(),
          'connected',
          null,
          row.bureau,
        );
        results.push({ bureau: row.bureau, ok: true, status: 'connected' });
      } else {
        updateBureauSyncResult.run(
          row.score,
          row.utilization_pct,
          row.on_time_pay_pct,
          row.inquiries,
          row.source,
          row.last_sync_at,
          result.status || 'error',
          result.error || 'Sync failed.',
          row.bureau,
        );
        results.push({
          bureau: row.bureau,
          ok: false,
          status: result.status || 'error',
          error: result.error,
        });
      }
    } catch (e) {
      setBureauSyncStatus.run('error', String(e.message || e), row.bureau);
      results.push({ bureau: row.bureau, ok: false, status: 'error', error: String(e.message || e) });
    }
  }

  const bureaus = selectAllBureaus.all().map(rowToClient);
  res.json({ results, bureaus, summary: buildSummary(bureaus) });
});

/* GET /api/credit-score/bureaus — list bureau metadata */
router.get('/bureaus', (req, res) => {
  res.json({
    bureaus: BUREAUS.map(b => ({
      id: b,
      label: BUREAU_LABELS[b],
      env_key: '',
      credentials_configured: false,
    })),
  });
});

module.exports = router;
