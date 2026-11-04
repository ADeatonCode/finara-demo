/**
 * FINARA — routes/transactions.js
 *
 * What this file does:
 * - API for transaction rows (money in and money out).
 * - List, add, edit, and delete transactions.
 * - Handles transfers between two accounts as a pair of rows.
 *
 * Read FILES.md for a simple guide to every file.
 */
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { userHasPermission } = require('../auth');
const {
  recalcAccountBalance,
  syncCategoryFromTransaction,
  getCategoryKind,
  createTransferPair,
  updateTransferPair,
  deleteTransferPair,
  convertTransferToSingle,
  TRANSFER_CATEGORY_NAME,
  syncAccountOpeningBalance,
} = require('../database');
const {
  normalizeTxnTime,
  roundImportAmt,
  toImportDisplayDate,
  importFingerprint,
  resolveImportCategory,
} = require('../services/txnImport');

function loadAccountForUser(req, accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'account_id is required', status: 400 };
  const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!acct) return { error: 'Account not found', status: 404 };
  const membership = db.prepare(
    'SELECT role FROM user_portfolios WHERE user_id = ? AND portfolio_id = ?'
  ).get(req.user.id, acct.portfolio_id);
  if (!membership) return { error: 'Permission denied', status: 403 };
  return { acct };
}

function requireAccountWrite(req, accountId) {
  const loaded = loadAccountForUser(req, accountId);
  if (loaded.error) return loaded;
  if (!userHasPermission(req.user, 'write', loaded.acct.portfolio_id)) {
    return { error: 'Permission denied', status: 403 };
  }
  return loaded;
}

function resolveTransferAccounts(accountId, toAccountId, amt) {
  const currentId = Number(accountId);
  const otherId = Number(toAccountId);
  if (!otherId) return null;
  if (Number(amt) < 0) return { fromAccountId: currentId, toAccountId: otherId };
  return { fromAccountId: otherId, toAccountId: currentId };
}

function resolveTxnKind(body, cat) {
  const fromBody = body?.category_kind ?? body?.kind;
  if (fromBody === 'income' || fromBody === 'expense' || fromBody === 'transfer') {
    return fromBody;
  }
  return getCategoryKind(cat);
}

function isTransferRequest(body, cat, existing = null) {
  const kind = resolveTxnKind(body, cat);
  if (kind !== 'transfer') return false;
  if (existing?.transfer_group_id) return true;
  return !!body?.to_account_id;
}

function transferPayloadFromRequest(body, existing = null) {
  const { date, time, name, desc, cat, amt, status, account_id, to_account_id } = body;
  const endpoints = resolveTransferAccounts(account_id, to_account_id, amt);
  if (!endpoints) return { error: 'to_account_id is required for transfers' };
  return {
    date: date || existing?.date || '',
    time: normalizeTxnTime(time ?? existing?.time),
    name: name ?? existing?.name ?? '',
    desc: desc ?? existing?.desc ?? '',
    cat: TRANSFER_CATEGORY_NAME,
    amount: Math.abs(Number(amt ?? existing?.amt) || 0),
    status: status || existing?.status || 'synced',
    fromAccountId: endpoints.fromAccountId,
    toAccountId: endpoints.toAccountId,
  };
}

/* GET /api/transactions/import-fingerprints?account_id=1 */
router.get('/import-fingerprints', (req, res) => {
  const loaded = loadAccountForUser(req, req.query.account_id);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });

  const rows = db.prepare(`
    SELECT date, name, amt FROM transactions
    WHERE account_id = ? AND IFNULL(is_opening_balance, 0) = 0
  `).all(loaded.acct.id);

  const fingerprints = [];
  const seen = new Set();
  for (const row of rows) {
    const fp = importFingerprint(row.date, row.amt, row.name);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    fingerprints.push(fp);
  }
  res.json({ account_id: loaded.acct.id, fingerprints });
});

/* POST /api/transactions/import */
router.post('/import', (req, res) => {
  const accountId = req.body?.account_id;
  const loaded = requireAccountWrite(req, accountId);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });

  const incoming = Array.isArray(req.body?.transactions) ? req.body.transactions : null;
  if (!incoming) return res.status(400).json({ error: 'transactions array is required' });

  const existingRows = db.prepare(`
    SELECT date, name, amt FROM transactions
    WHERE account_id = ? AND IFNULL(is_opening_balance, 0) = 0
  `).all(loaded.acct.id);
  const seen = new Set(existingRows.map(row => importFingerprint(row.date, row.amt, row.name)).filter(Boolean));

  const insert = db.prepare(`
    INSERT INTO transactions (date, "time", name, desc, cat, amt, bal, status, account_id)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  let inserted = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  db.exec('BEGIN');
  try {
    for (const raw of incoming) {
      const name = String(raw?.name ?? '').trim();
      const date = toImportDisplayDate(raw?.date);
      const amt = roundImportAmt(raw?.amt);
      if (!name || !date || amt == null) {
        skippedInvalid++;
        continue;
      }

      const fp = importFingerprint(date, amt, name);
      if (!fp || seen.has(fp)) {
        skippedDuplicates++;
        continue;
      }
      seen.add(fp);

      const statusRaw = String(raw?.status ?? 'synced').trim().toLowerCase();
      const status = statusRaw === 'pending' ? 'pending' : 'synced';
      insert.run(
        date,
        normalizeTxnTime(raw?.time || '12:00'),
        name,
        String(raw?.desc ?? '').trim(),
        resolveImportCategory(raw?.cat),
        amt,
        status,
        loaded.acct.id,
      );
      inserted++;
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    return res.status(400).json({ error: e.message || 'Import failed' });
  }

  if (inserted > 0) {
    recalcAccountBalance(loaded.acct.id);
    syncAccountOpeningBalance(loaded.acct.id);
  }

  res.json({ inserted, skippedDuplicates, skippedInvalid });
});

/* GET /api/transactions?account_id=1 */
router.get('/', (req, res) => {
  const { account_id } = req.query;
  if (account_id) {
    const loaded = loadAccountForUser(req, account_id);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const rows = db.prepare(
      'SELECT * FROM transactions WHERE account_id = ? ORDER BY is_opening_balance ASC, id DESC'
    ).all(loaded.acct.id);
    return res.json(rows);
  }
  const rows = db.prepare(`
    SELECT t.* FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.portfolio_id IN (SELECT portfolio_id FROM user_portfolios WHERE user_id = ?)
    ORDER BY t.is_opening_balance ASC, t.id DESC
  `).all(req.user.id);
  res.json(rows);
});

/* POST /api/transactions */
router.post('/', (req, res) => {
  const { date, time, name, desc, cat, amt, status, account_id } = req.body;
  const transferReq = isTransferRequest(req.body, cat);
  if (!transferReq && !name) return res.status(400).json({ error: 'name is required' });
  if (!account_id) return res.status(400).json({ error: 'account_id is required' });

  if (transferReq) {
    try {
      const payload = transferPayloadFromRequest(req.body);
      if (payload.error) return res.status(400).json({ error: payload.error });
      const result = createTransferPair(payload);
      return res.status(201).json(result);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  if (resolveTxnKind(req.body, cat) === 'transfer') {
    return res.status(400).json({ error: 'Select the other account for this transfer.' });
  }

  const amount = amt || 0;
  const txnTime = normalizeTxnTime(time);
  const result = db.prepare(`
    INSERT INTO transactions (date,"time",name,desc,cat,amt,bal,status,account_id) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(date||'', txnTime, name, desc||'', cat||'', amount, 0, status||'synced', account_id);

  recalcAccountBalance(account_id);
  res.status(201).json({ id: result.lastInsertRowid });
});

/* PUT /api/transactions/:id */
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const owned = loadAccountForUser(req, existing.account_id);
  if (owned.error) return res.status(owned.status).json({ error: owned.error });
  if (existing.is_opening_balance) {
    return res.status(400).json({ error: 'Opening balance is managed via the account settings' });
  }

  const { date, time, name, desc, cat, amt, status, account_id } = req.body;
  if (!account_id) return res.status(400).json({ error: 'account_id is required' });

  const newCat = String(cat ?? '').trim();
  syncCategoryFromTransaction(existing.cat, newCat);
  const wasTransfer = !!existing.transfer_group_id;

  if (isTransferRequest(req.body, newCat, existing)) {
    try {
      const payload = transferPayloadFromRequest(req.body, existing);
      if (payload.error) return res.status(400).json({ error: payload.error });
      if (wasTransfer) {
        updateTransferPair(existing.id, payload);
        return res.json({ ok: true, transfer_group_id: existing.transfer_group_id });
      }
      db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.id);
      recalcAccountBalance(existing.account_id);
      const result = createTransferPair(payload);
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  if (resolveTxnKind(req.body, newCat) === 'transfer') {
    return res.status(400).json({ error: 'Select the other account for this transfer.' });
  }

  if (wasTransfer) {
    try {
      const result = convertTransferToSingle(existing.id, {
        date: date || '',
        time: normalizeTxnTime(time),
        name,
        desc: desc || '',
        cat: newCat,
        amt: amt || 0,
        status: status || 'synced',
        account_id,
      });
      return res.json({ ok: true, id: result.id });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  const amount = amt || 0;
  const txnTime = normalizeTxnTime(time);
  db.prepare(`
    UPDATE transactions SET date=?,"time"=?,name=?,desc=?,cat=?,amt=?,status=?,account_id=? WHERE id=?
  `).run(date||'', txnTime, name, desc||'', newCat, amount, status||'synced', account_id, req.params.id);

  recalcAccountBalance(existing.account_id);
  if (existing.account_id !== account_id) recalcAccountBalance(account_id);
  res.json({ ok: true });
});

/* DELETE /api/transactions/:id */
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const owned = loadAccountForUser(req, existing.account_id);
  if (owned.error) return res.status(owned.status).json({ error: owned.error });
  if (existing.is_opening_balance) {
    return res.status(400).json({ error: 'Opening balance transaction cannot be deleted' });
  }

  if (existing.transfer_group_id) {
    try {
      deleteTransferPair(existing.id);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  recalcAccountBalance(existing.account_id);
  res.json({ ok: true });
});

module.exports = router;
