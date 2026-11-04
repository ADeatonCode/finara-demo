/**
 * FINARA DEMO — per-account transaction cap.
 *
 * Opening-balance rows are system rows (same as the register) and do not count.
 * Deleting a user transaction frees a slot.
 */
const db = require('../database');
const { RETENTION_NOTICE } = require('./retention');

const TXN_CAP = 50;
const DEMO_TXN_CAP_CODE = 'DEMO_TXN_CAP';
const PURCHASE_EMAIL = 'acdelgato@gmail.com';
const PURCHASE_MESSAGE = 'This is a demo only. If you would like to purchase the full copy, contact Alan at acdelgato@gmail.com.';

function countUserTransactions(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE account_id = ? AND IFNULL(is_opening_balance, 0) = 0
  `).get(id).n;
}

function remainingTxnSlots(accountId) {
  return Math.max(0, TXN_CAP - countUserTransactions(accountId));
}

function demoCapPayload(extra = {}) {
  return {
    error: PURCHASE_MESSAGE,
    code: DEMO_TXN_CAP_CODE,
    demo: true,
    demo_cap_reached: true,
    notice: RETENTION_NOTICE,
    purchase_email: PURCHASE_EMAIL,
    cap: TXN_CAP,
    ...extra,
  };
}

function demoCapNotice(accountId, extra = {}) {
  const payload = demoCapPayload({
    remaining: remainingTxnSlots(accountId),
    used: countUserTransactions(accountId),
    ...extra,
  });
  delete payload.error;
  return payload;
}

function assertCanAddTransactions(accountId, n = 1) {
  const remaining = remainingTxnSlots(accountId);
  const used = countUserTransactions(accountId);
  if (remaining < n) {
    const err = new Error(PURCHASE_MESSAGE);
    err.code = DEMO_TXN_CAP_CODE;
    err.status = 409;
    err.payload = demoCapPayload({
      account_id: Number(accountId) || null,
      used,
      remaining,
    });
    throw err;
  }
}

function assertNewAccountSlots(nextAccountIds, existingAccountIds = []) {
  const existing = new Set(
    (existingAccountIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0)
  );
  const seen = new Set();
  for (const raw of nextAccountIds || []) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || existing.has(id) || seen.has(id)) continue;
    seen.add(id);
    assertCanAddTransactions(id, 1);
  }
}

function isDemoCapError(err) {
  return err?.code === DEMO_TXN_CAP_CODE;
}

module.exports = {
  TXN_CAP,
  DEMO_TXN_CAP_CODE,
  PURCHASE_EMAIL,
  PURCHASE_MESSAGE,
  countUserTransactions,
  remainingTxnSlots,
  demoCapPayload,
  assertCanAddTransactions,
  assertNewAccountSlots,
  isDemoCapError,
  demoCapNotice,
};
