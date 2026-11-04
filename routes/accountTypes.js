/**
 * FINARA — routes/accountTypes.js
 *
 * What this file does:
 * - API for account type names (Checking, Credit, Loan, etc.).
 * - List types, add a new type, delete a type (if no account uses it).
 *
 * Read FILES.md for a simple guide to every file.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');

function normalizeKind(kind) {
  return kind === 'liability' ? 'liability' : 'asset';
}

function normalizeName(name) {
  return String(name ?? '').trim();
}

/* GET /api/account-types?kind=asset|liability */
router.get('/', (req, res) => {
  const kind = req.query.kind;
  const rows = kind
    ? db.prepare('SELECT * FROM account_types WHERE kind = ? ORDER BY name COLLATE NOCASE').all(normalizeKind(kind))
    : db.prepare('SELECT * FROM account_types ORDER BY kind, name COLLATE NOCASE').all();
  res.json(rows);
});

/* POST /api/account-types */
router.post('/', (req, res) => {
  const kind = normalizeKind(req.body.kind);
  const name = normalizeName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Type name is required' });
  if (name.length > 64) return res.status(400).json({ error: 'Type name must be 64 characters or fewer' });

  const existing = db.prepare(
    'SELECT id FROM account_types WHERE kind = ? AND LOWER(name) = LOWER(?)'
  ).get(kind, name);
  if (existing) return res.status(409).json({ error: 'That type already exists' });

  const result = db.prepare('INSERT INTO account_types (kind, name) VALUES (?, ?)').run(kind, name);
  const row = db.prepare('SELECT * FROM account_types WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

/* DELETE /api/account-types/:id */
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM account_types WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const inUse = db.prepare(
    'SELECT COUNT(*) AS n FROM accounts WHERE kind = ? AND type = ?'
  ).get(row.kind, row.name)?.n ?? 0;
  if (inUse > 0) {
    const noun = inUse === 1 ? 'account uses' : 'accounts use';
    return res.status(409).json({ error: `Cannot delete — ${inUse} ${noun} this type` });
  }

  db.prepare('DELETE FROM account_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
