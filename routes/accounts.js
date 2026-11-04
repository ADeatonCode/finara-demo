/**
 * FINARA — routes/accounts.js
 *
 * What this file does:
 * - API for asset and liability accounts (what you own and what you owe).
 * - List, add, edit, and delete accounts.
 * - Validates bank fields for checking/savings and special rules for real estate and vehicles.
 *
 * Read FILES.md for a simple guide to every file.
 */
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { syncAccountOpeningBalance, applyRealEstateValueUpdate, applyOpeningBalanceUpdate, applyAccountBalanceTarget, getHomePortfolioId } = require('../database');
const { attachPlaidPublicFields, disconnectAccount } = require('../services/plaidSync');

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function parseAssetDetails(body, type) {
  const details = {
    routing_number: null,
    account_number: null,
    debit_card_number: null,
    debit_card_exp: null,
    debit_card_cvv: null,
  };
  if (!type) return details;

  if (['Checking', 'Savings', 'Money Market', 'CD'].includes(type)) {
    details.routing_number = digitsOnly(body.routing_number) || null;
    details.account_number = String(body.account_number ?? '').trim() || null;
  } else if (type === 'Brokerage') {
    details.account_number = String(body.account_number ?? '').trim() || null;
  }

  if (type === 'Checking') {
    details.debit_card_number = digitsOnly(body.debit_card_number) || null;
    details.debit_card_exp = String(body.debit_card_exp ?? '').trim() || null;
    details.debit_card_cvv = digitsOnly(body.debit_card_cvv) || null;
  }

  return details;
}

function validateAssetDetails(kind, type, details, opts = {}) {
  if (kind !== 'asset') return null;
  if (type === 'Real Estate' || type === 'Transportation') return null;

  const { isEdit = false, existing = null, parsed = null } = opts;
  const hasStoredDetails = existing && (
    existing.routing_number || existing.account_number ||
    existing.debit_card_number || existing.debit_card_exp || existing.debit_card_cvv
  );
  const hasProvidedDetails = parsed && (
    parsed.routing_number || parsed.account_number ||
    parsed.debit_card_number || parsed.debit_card_exp || parsed.debit_card_cvv
  );

  if (isEdit && !hasStoredDetails && !hasProvidedDetails) return null;

  const bankTypes = ['Checking', 'Savings', 'Money Market', 'CD'];
  if (bankTypes.includes(type)) {
    if (!details.routing_number || details.routing_number.length !== 9) {
      return 'Routing number must be 9 digits.';
    }
    if (!details.account_number) return 'Account number is required.';
  }

  if (type === 'Brokerage' && !details.account_number) {
    return 'Account number is required.';
  }

  if (type === 'Checking') {
    const hasStoredDebit = existing && (
      existing.debit_card_number || existing.debit_card_exp || existing.debit_card_cvv
    );
    const hasProvidedDebit = parsed && (
      parsed.debit_card_number || parsed.debit_card_exp || parsed.debit_card_cvv
    );
    // Only validate debit when user entered card fields (or account already has them).
    const requireDebit = hasStoredDebit || hasProvidedDebit;

    if (requireDebit) {
      const cardLen = (details.debit_card_number || '').length;
      if (cardLen < 13 || cardLen > 19) {
        return 'Debit card number must be 13–19 digits.';
      }
      if (!/^\d{2}\/\d{2}$/.test(details.debit_card_exp || '')) {
        return 'Debit card expiration must be MM/YY.';
      }
      const cvvLen = (details.debit_card_cvv || '').length;
      if (cvvLen < 3 || cvvLen > 4) {
        return 'CVV must be 3 or 4 digits.';
      }
    }
  }

  return null;
}

function keepDetailValue(parsedVal, existingVal) {
  return parsedVal != null && parsedVal !== '' ? parsedVal : (existingVal ?? null);
}

function mergeAssetDetailsForUpdate(existing, parsed, type) {
  const merged = {
    routing_number: keepDetailValue(parsed.routing_number, existing.routing_number),
    account_number: keepDetailValue(parsed.account_number, existing.account_number),
    debit_card_number: keepDetailValue(parsed.debit_card_number, existing.debit_card_number),
    debit_card_exp: keepDetailValue(parsed.debit_card_exp, existing.debit_card_exp),
    debit_card_cvv: keepDetailValue(parsed.debit_card_cvv, existing.debit_card_cvv),
  };

  if (type === 'Brokerage') {
    merged.routing_number = null;
    merged.debit_card_number = null;
    merged.debit_card_exp = null;
    merged.debit_card_cvv = null;
  } else if (type === 'Real Estate' || type === 'Transportation') {
    merged.routing_number = null;
    merged.account_number = null;
    merged.debit_card_number = null;
    merged.debit_card_exp = null;
    merged.debit_card_cvv = null;
  } else if (type !== 'Checking') {
    merged.debit_card_number = null;
    merged.debit_card_exp = null;
    merged.debit_card_cvv = null;
  }

  if (!['Checking', 'Savings', 'Money Market', 'CD', 'Brokerage'].includes(type)) {
    merged.routing_number = null;
    merged.account_number = null;
  }

  return merged;
}

function assetUsesBasis(type) {
  return type === 'Real Estate' || type === 'Transportation';
}

function isValuedAssetType(type) {
  return type === 'Real Estate' || type === 'Transportation';
}

function deriveLast4(last4, accountNumber) {
  const acctDigits = digitsOnly(accountNumber);
  if (acctDigits.length >= 4) return acctDigits.slice(-4);
  return String(last4 ?? '').trim();
}

function normalizeOpeningDate(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (!raw) return null;
  const d = new Date(raw.includes(',') ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultOpeningDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function resolvePortfolioId(req, explicitId) {
  if (explicitId) return Number(explicitId);
  const fromUser = req.user.portfolios?.find(p => p.role === 'admin') || req.user.portfolios?.[0];
  if (fromUser?.id) return Number(fromUser.id);
  return getHomePortfolioId(req.user.id);
}

function assertPortfolioAccess(req, portfolioId) {
  const membership = db.prepare(
    'SELECT role FROM user_portfolios WHERE user_id = ? AND portfolio_id = ?'
  ).get(req.user.id, portfolioId);
  return membership || null;
}

/* GET /api/accounts?kind=asset|liability */
router.get('/', (req, res) => {
  const { kind } = req.query;
  const rows = kind
    ? db.prepare(`SELECT * FROM accounts WHERE kind = ? AND portfolio_id IN (SELECT portfolio_id FROM user_portfolios WHERE user_id = ?) ORDER BY id`).all(kind, req.user.id)
    : db.prepare(`SELECT * FROM accounts WHERE portfolio_id IN (SELECT portfolio_id FROM user_portfolios WHERE user_id = ?) ORDER BY id`).all(req.user.id);
  res.json(attachPlaidPublicFields(rows));
});

/* POST /api/accounts */
router.post('/', (req, res) => {
  const {
    kind, name, inst, last4, type, balance, basis, lim, rate, minpay, opening_date,
    routing_number, account_number, debit_card_number, debit_card_exp, debit_card_cvv,
  } = req.body;
  if (!kind || !name || !type) {
    return res.status(400).json({ error: 'kind, name, and type are required' });
  }

  const portfolio_id = resolvePortfolioId(req, req.body.portfolio_id);
  if (!portfolio_id) return res.status(400).json({ error: 'portfolio_id is required' });
  const membership = assertPortfolioAccess(req, portfolio_id);
  if (!membership || membership.role !== 'admin') return res.status(403).json({ error: 'Permission denied' });

  const assetDetails = parseAssetDetails(req.body, type);
  const assetErr = validateAssetDetails(kind, type, assetDetails, { isEdit: false });
  if (assetErr) return res.status(400).json({ error: assetErr });

  const storedLast4 = kind === 'asset'
    ? deriveLast4(last4, assetDetails.account_number)
    : String(last4 ?? '').trim();

  const storedBasis = kind === 'asset' && assetUsesBasis(type) ? (basis ?? null) : null;
  const openingBalance = balance || 0;
  const storedOpeningDate = normalizeOpeningDate(opening_date) || defaultOpeningDate();
  const result = db.prepare(`
    INSERT INTO accounts (
      kind,name,inst,last4,type,balance,opening_balance,basis,lim,rate,minpay,synced,opening_date,
      routing_number,account_number,debit_card_number,debit_card_exp,debit_card_cvv,portfolio_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    kind, name, inst || '', storedLast4, type, openingBalance, openingBalance,
    storedBasis, lim ?? null, rate ?? null, minpay ?? null, 'Just now', storedOpeningDate,
    assetDetails.routing_number, assetDetails.account_number,
    assetDetails.debit_card_number, assetDetails.debit_card_exp, assetDetails.debit_card_cvv,
    portfolio_id,
  );

  const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid);
  syncAccountOpeningBalance(result.lastInsertRowid);
  const saved = db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(attachPlaidPublicFields([saved])[0]);
});

/* PUT /api/accounts/:id */
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // Ensure acting user has access to this account
  if (!assertPortfolioAccess(req, existing.portfolio_id)) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  const { name, inst, last4, type, balance, basis, lim, rate, minpay, opening_date } = req.body;
  const parsed = parseAssetDetails(req.body, type);
  const details = existing.kind === 'asset'
    ? mergeAssetDetailsForUpdate(existing, parsed, type)
    : {
      routing_number: null,
      account_number: null,
      debit_card_number: null,
      debit_card_exp: null,
      debit_card_cvv: null,
    };
  const assetErr = existing.kind === 'asset'
    ? validateAssetDetails(existing.kind, type, details, { isEdit: true, existing, parsed })
    : null;
  if (assetErr) return res.status(400).json({ error: assetErr });

  const storedLast4 = existing.kind === 'asset'
    ? deriveLast4(last4, details.account_number)
    : String(last4 ?? '').trim();

  const storedBasis = existing.kind === 'asset' && assetUsesBasis(type) ? (basis ?? null) : null;
  const storedOpeningDate = normalizeOpeningDate(opening_date)
    || existing.opening_date
    || defaultOpeningDate();

  db.prepare(`
    UPDATE accounts SET
      name=?, inst=?, last4=?, type=?, basis=?, lim=?, rate=?, minpay=?, opening_date=?,
      routing_number=?, account_number=?, debit_card_number=?, debit_card_exp=?, debit_card_cvv=?
    WHERE id=?
  `).run(
    name, inst || '', storedLast4, type,
    storedBasis, lim ?? null, rate ?? null, minpay ?? null, storedOpeningDate,
    details.routing_number, details.account_number,
    details.debit_card_number, details.debit_card_exp, details.debit_card_cvv,
    req.params.id,
  );

  if (balance != null && balance !== '') {
    if (existing.kind === 'asset' && isValuedAssetType(type)) {
      applyRealEstateValueUpdate(req.params.id, balance);
    } else if (existing.kind === 'liability') {
      applyAccountBalanceTarget(req.params.id, balance);
    } else if (existing.kind === 'asset') {
      applyOpeningBalanceUpdate(req.params.id, balance);
    }
  } else {
    syncAccountOpeningBalance(req.params.id);
  }
  const saved = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  res.json(attachPlaidPublicFields([saved])[0]);
});

/* DELETE /api/accounts/:id */
router.delete('/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!assertPortfolioAccess(req, existing.portfolio_id)) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  try { await disconnectAccount(existing.id); } catch (_) {}
  db.prepare('DELETE FROM transactions WHERE account_id = ?').run(req.params.id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* POST /api/accounts/:id/sync-opening-balance */
router.post('/:id/sync-opening-balance', (req, res) => {
  const existing = db.prepare('SELECT id FROM accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  syncAccountOpeningBalance(req.params.id);
  const saved = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  res.json(attachPlaidPublicFields([saved])[0]);
});

module.exports = router;
