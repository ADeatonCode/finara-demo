/**
 * FINARA — routes/budget.js
 *
 * What this file does:
 * - API for budget categories (income and expense groups).
 * - List, add, edit, and delete categories on the Budget page.
 * - Store per-period budgeted amounts so each history column can differ.
 *
 * Read FILES.md for a simple guide to every file.
 */
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { syncCategoryFromBudget, getHomePortfolioId } = require('../database');

function normalizeKind(kind) {
  if (kind === 'income') return 'income';
  return 'expense';
}

function isReservedCategoryName(name) {
  return String(name ?? '').trim().toLowerCase() === 'transfer';
}

function resolvePortfolioId(req, explicitId) {
  if (explicitId) return Number(explicitId);
  const fromUser = req.user.portfolios?.find(p => p.role === 'admin') || req.user.portfolios?.[0];
  if (fromUser?.id) return Number(fromUser.id);
  return getHomePortfolioId(req.user.id);
}

function assertPortfolioAccess(req, portfolioId) {
  return db.prepare(
    'SELECT role FROM user_portfolios WHERE user_id = ? AND portfolio_id = ?'
  ).get(req.user.id, portfolioId) || null;
}

function attachPeriodAmounts(rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const amounts = db.prepare(
    `SELECT category_id, period_key, budgeted FROM budget_period_amounts WHERE category_id IN (${placeholders})`
  ).all(...ids);
  const byCat = Object.create(null);
  for (const a of amounts) {
    if (!byCat[a.category_id]) byCat[a.category_id] = {};
    byCat[a.category_id][a.period_key] = a.budgeted;
  }
  return rows.map(r => ({ ...r, period_amounts: byCat[r.id] || {} }));
}

function upsertPeriodAmounts(categoryId, periodAmounts) {
  if (!periodAmounts || typeof periodAmounts !== 'object' || Array.isArray(periodAmounts)) return;
  const stmt = db.prepare(`
    INSERT INTO budget_period_amounts (category_id, period_key, budgeted)
    VALUES (?, ?, ?)
    ON CONFLICT(category_id, period_key) DO UPDATE SET budgeted = excluded.budgeted
  `);
  for (const [key, value] of Object.entries(periodAmounts)) {
    const periodKey = String(key || '').trim().slice(0, 80);
    if (!periodKey) continue;
    stmt.run(categoryId, periodKey, Number(value) || 0);
  }
}

/* GET /api/budget */
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM budget_categories WHERE portfolio_id IN (SELECT portfolio_id FROM user_portfolios WHERE user_id = ?) ORDER BY kind, id').all(req.user.id);
  res.json(attachPeriodAmounts(rows));
});

/* POST /api/budget */
router.post('/', (req, res) => {
  const { category, timeframe, budgeted, kind, portfolio_id, period_amounts } = req.body;
  if (!category) return res.status(400).json({ error: 'category is required' });
  const pid = resolvePortfolioId(req, portfolio_id);
  if (!pid) return res.status(400).json({ error: 'portfolio_id is required' });
  if (isReservedCategoryName(category)) {
    return res.status(400).json({ error: 'Transfer is reserved for account transfers and is not a budget category' });
  }
  const membership = assertPortfolioAccess(req, pid);
  if (!membership || membership.role !== 'admin') return res.status(403).json({ error: 'Permission denied' });
  try {
    const result = db.prepare(`
      INSERT INTO budget_categories (category, kind, timeframe, budgeted, actual, portfolio_id) VALUES (?,?,?,?,0, ?)
    `).run(category, normalizeKind(kind), timeframe || 'Monthly', budgeted || 0, pid);
    upsertPeriodAmounts(result.lastInsertRowid, period_amounts);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Category name already exists' });
    throw e;
  }
});

/* PUT /api/budget/:id */
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM budget_categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!assertPortfolioAccess(req, existing.portfolio_id)) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  const { category, timeframe, budgeted, kind, period_amounts } = req.body;
  const newCategory = String(category ?? '').trim();
  if (!newCategory) return res.status(400).json({ error: 'category is required' });
  if (isReservedCategoryName(newCategory)) {
    return res.status(400).json({ error: 'Transfer is reserved for account transfers and is not a budget category' });
  }

  if (newCategory.toLowerCase() !== String(existing.category ?? '').trim().toLowerCase()) {
    const sync = syncCategoryFromBudget(existing.category, newCategory, existing.portfolio_id);
    if (sync.conflict) {
      return res.status(409).json({ error: 'Category name already exists' });
    }
  }

  try {
    db.prepare(`
      UPDATE budget_categories SET category=?, kind=?, timeframe=?, budgeted=? WHERE id=?
    `).run(newCategory, normalizeKind(kind), timeframe || 'Monthly', budgeted || 0, req.params.id);
    upsertPeriodAmounts(existing.id, period_amounts);
    res.json({ ok: true });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Category name already exists' });
    throw e;
  }
});

/* DELETE /api/budget/:id */
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM budget_categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!assertPortfolioAccess(req, existing.portfolio_id)) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  db.prepare('DELETE FROM budget_period_amounts WHERE category_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM budget_categories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
