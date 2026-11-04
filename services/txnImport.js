/**
 * FINARA — services/txnImport.js
 *
 * Shared CSV / Plaid import helpers: display dates, fingerprints,
 * and matching incoming categories to existing Budget names.
 */
const db = require('../database');
const { formatDisplayDate } = require('../database');

function normalizeTxnTime(value) {
  const parts = String(value ?? '').trim().split(':');
  if (!parts[0]) return '12:00';
  const hh = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
  const mm = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeImportName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function roundImportAmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function toImportDisplayDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatDisplayDate(raw);
  const mdy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (mdy) {
    let year = parseInt(mdy[3], 10);
    if (mdy[3].length === 2) year += year >= 70 ? 1900 : 2000;
    const month = parseInt(mdy[1], 10);
    const day = parseInt(mdy[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return formatDisplayDate(iso);
    }
  }
  const d = raw.includes(',') ? new Date(raw) : new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function importDateKey(value) {
  const display = toImportDisplayDate(value) || String(value ?? '').trim();
  if (!display) return '';
  const d = display.includes(',') ? new Date(display) : new Date(`${display}T12:00:00`);
  if (Number.isNaN(d.getTime())) return display.toLowerCase();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function importFingerprint(date, amt, name) {
  const amount = roundImportAmt(amt);
  if (amount == null) return '';
  return `${importDateKey(date)}|${amount.toFixed(2)}|${normalizeImportName(name)}`;
}

function resolveImportCategory(cat) {
  const n = String(cat ?? '').trim();
  if (!n || n.toLowerCase() === 'uncategorized' || n.toLowerCase() === 'transfer') {
    return 'Uncategorized';
  }
  const row = db.prepare(`
    SELECT category FROM budget_categories
    WHERE LOWER(TRIM(category)) = LOWER(?)
    LIMIT 1
  `).get(n);
  return row?.category || 'Uncategorized';
}

function listBudgetCategoryNames() {
  return db.prepare(`
    SELECT category FROM budget_categories
    ORDER BY category COLLATE NOCASE
  `).all().map(row => row.category);
}

module.exports = {
  normalizeTxnTime,
  normalizeImportName,
  roundImportAmt,
  toImportDisplayDate,
  importDateKey,
  importFingerprint,
  resolveImportCategory,
  listBudgetCategoryNames,
};
