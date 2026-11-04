/**
 * FINARA DEMO — services/plaidSync.js
 *
 * Fake Plaid-style Connect / Sync. Never calls Plaid, never needs API keys.
 * Scripted merchants from Chime, Ascend FCU, and Demo National.
 */
const db = require('../database');
const {
  recalcAccountBalance,
  syncAccountOpeningBalance,
  formatDisplayDate,
} = require('../database');
const {
  toImportDisplayDate,
  importFingerprint,
  roundImportAmt,
  resolveImportCategory,
} = require('./txnImport');

const PLAID_ACCOUNT_FIELDS = `
  account_id, item_id, plaid_account_id, plaid_institution_name,
  plaid_account_name, plaid_account_mask, pending_accounts,
  last_synced_at, last_error
`;

const DEMO_INSTITUTIONS = [
  {
    id: 'ins_chime',
    name: 'Chime',
    accounts: [
      { id: 'chime_checking', name: 'Spending Account', mask: '1842', type: 'depository', subtype: 'checking' },
    ],
  },
  {
    id: 'ins_ascend',
    name: 'Ascend FCU',
    accounts: [
      { id: 'ascend_savings', name: 'High-Yield Savings', mask: '9033', type: 'depository', subtype: 'savings' },
    ],
  },
  {
    id: 'ins_demonational',
    name: 'Demo National',
    accounts: [
      { id: 'dn_checking', name: 'Everyday Checking', mask: '4401', type: 'depository', subtype: 'checking' },
      { id: 'dn_credit', name: 'Harbor Card', mask: '7712', type: 'credit', subtype: 'credit card' },
    ],
  },
];

const DEMO_CHECKING_POOL = [
  { id: 'd01', name: 'Streamly', desc: 'Monthly streaming', cat: 'Entertainment', amt: -12.99 },
  { id: 'd02', name: 'Harbor Market', desc: 'Checkout 2', cat: 'Groceries', amt: -29.44 },
  { id: 'd03', name: 'Copper Kettle Cafe', desc: 'Drip coffee', cat: 'Dining Out', amt: -11.20 },
  { id: 'd04', name: 'Bluebird Fuel', desc: 'Fill-up', cat: 'Transportation', amt: -41.80 },
  { id: 'd05', name: 'Pine & Post Pharmacy', desc: 'Pharmacy', cat: 'Healthcare', amt: -18.20 },
  { id: 'd06', name: 'Lumen Electric', desc: 'Energy bill', cat: 'Utilities', amt: -98.40 },
  { id: 'd07', name: 'Paperclip Books', desc: 'Stationery', cat: 'Shopping', amt: -9.50 },
  { id: 'd08', name: 'Northline Payroll', desc: 'Direct deposit', cat: 'Income', amt: 120.00 },
  { id: 'd09', name: 'Oak & Elm Market', desc: 'Deli counter', cat: 'Groceries', amt: -33.12 },
  { id: 'd10', name: 'Copper Kettle Cafe', desc: 'Pastry', cat: 'Dining Out', amt: -5.65 },
];

const DEMO_TXN_POOLS = {
  ins_chime: [
    { id: 'c01', name: 'Harbor Market', desc: 'Groceries — aisle 4', cat: 'Groceries', amt: -52.10 },
    { id: 'c02', name: 'Bluebird Fuel', desc: 'Pump 3', cat: 'Transportation', amt: -36.40 },
    { id: 'c03', name: 'Copper Kettle Cafe', desc: 'Iced latte', cat: 'Dining Out', amt: -8.75 },
    { id: 'c04', name: 'MetroLink Pass', desc: 'Weekly transit', cat: 'Transportation', amt: -24.00 },
    { id: 'c05', name: 'Brightpath Wireless', desc: 'Phone bill', cat: 'Utilities', amt: -55.00 },
    { id: 'c06', name: 'Paperclip Books', desc: 'Paperback', cat: 'Shopping', amt: -16.80 },
    { id: 'c07', name: 'Northline Payroll', desc: 'Direct deposit', cat: 'Income', amt: 1850.00 },
    { id: 'c08', name: 'Oak & Elm Market', desc: 'Produce bag', cat: 'Groceries', amt: -47.33 },
    { id: 'c09', name: 'City Water Works', desc: 'Utilities', cat: 'Utilities', amt: -42.18 },
    { id: 'c10', name: 'Demo ATM', desc: 'Cash withdrawal', cat: 'Uncategorized', amt: -40.00 },
  ],
  ins_ascend: [
    { id: 'a01', name: 'Ascend FCU Interest', desc: 'Monthly dividend', cat: 'Income', amt: 4.21 },
    { id: 'a02', name: 'Ascend FCU Interest', desc: 'Savings interest', cat: 'Income', amt: 3.08 },
    { id: 'a03', name: 'Northline Payroll', desc: 'Savings sweep', cat: 'Income', amt: 200.00 },
    { id: 'a04', name: 'Ascend FCU Interest', desc: 'Bonus dividend', cat: 'Income', amt: 2.10 },
    { id: 'a05', name: 'Willow Court Rent', desc: 'Transfer out for rent', cat: 'Rent', amt: -50.00 },
    { id: 'a06', name: 'Ascend FCU Interest', desc: 'Daily accrual', cat: 'Income', amt: 1.44 },
    { id: 'a07', name: 'Harbor Market', desc: 'Debit from savings', cat: 'Groceries', amt: -22.15 },
    { id: 'a08', name: 'Ascend FCU Interest', desc: 'Quarterly extra', cat: 'Income', amt: 6.90 },
  ],
  ins_demonational: DEMO_CHECKING_POOL,
  dn_checking: DEMO_CHECKING_POOL,
  // Harbor Card: purchases are debits (owe more). A payment is a credit (toward zero).
  dn_credit: [
    { id: 'h01', name: 'Harbor Market', desc: 'Checkout 2', cat: 'Groceries', amt: -29.44 },
    { id: 'h02', name: 'Copper Kettle Cafe', desc: 'Drip coffee', cat: 'Dining Out', amt: -11.20 },
    { id: 'h03', name: 'Bluebird Fuel', desc: 'Fill-up', cat: 'Transportation', amt: -41.80 },
    { id: 'h04', name: 'Streamly', desc: 'Monthly streaming', cat: 'Entertainment', amt: -12.99 },
    { id: 'h05', name: 'Pine & Post Pharmacy', desc: 'Pharmacy', cat: 'Healthcare', amt: -18.20 },
    { id: 'h06', name: 'Oak & Elm Market', desc: 'Deli counter', cat: 'Groceries', amt: -33.12 },
    { id: 'h07', name: 'Paperclip Books', desc: 'Stationery', cat: 'Shopping', amt: -9.50 },
    { id: 'h08', name: 'Copper Kettle Cafe', desc: 'Pastry', cat: 'Dining Out', amt: -5.65 },
    { id: 'h09', name: 'Lumen Electric', desc: 'Energy bill', cat: 'Utilities', amt: -98.40 },
    { id: 'h10', name: 'Demo National', desc: 'Payment received — thank you', cat: 'Uncategorized', amt: 120.00 },
  ],
};

function isPlaidConfigured() {
  return true;
}

function plaidEnvName() {
  return 'demo';
}

function missingKeysMessage() {
  return '';
}

function parsePendingAccounts(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function publicPlaidFields(row) {
  if (!row) {
    return {
      plaid_connected: false,
      plaid_ready: false,
      plaid_needs_selection: false,
      plaid_institution_name: '',
      plaid_account_name: '',
      plaid_account_mask: '',
      plaid_last_synced_at: null,
      plaid_last_error: '',
      plaid_pending_accounts: [],
    };
  }
  const pending = parsePendingAccounts(row.pending_accounts);
  const mapped = Boolean(row.plaid_account_id);
  return {
    plaid_connected: true,
    plaid_ready: mapped,
    plaid_needs_selection: !mapped,
    plaid_institution_name: row.plaid_institution_name || '',
    plaid_account_name: row.plaid_account_name || '',
    plaid_account_mask: row.plaid_account_mask || '',
    plaid_last_synced_at: row.last_synced_at || null,
    plaid_last_error: row.last_error || '',
    plaid_pending_accounts: mapped ? [] : pending,
  };
}

function getPlaidItemRow(accountId) {
  return db.prepare(`
    SELECT ${PLAID_ACCOUNT_FIELDS}, sync_cursor, access_token
    FROM plaid_items WHERE account_id = ?
  `).get(accountId);
}

function getPlaidPublicStatus(accountId) {
  const status = {
    configured: true,
    env: 'demo',
    demo: true,
    missing_keys_message: '',
    institutions: DEMO_INSTITUTIONS,
  };
  if (accountId == null) return status;
  const row = db.prepare(`
    SELECT ${PLAID_ACCOUNT_FIELDS} FROM plaid_items WHERE account_id = ?
  `).get(accountId);
  return { ...status, ...publicPlaidFields(row) };
}

function attachPlaidPublicFields(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) return list;
  const ids = list.map(a => a.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ${PLAID_ACCOUNT_FIELDS} FROM plaid_items WHERE account_id IN (${placeholders})
  `).all(...ids);
  const byId = new Map(rows.map(r => [Number(r.account_id), r]));
  return list.map(acct => {
    const { access_token, plaid_access_token, sync_cursor, ...safe } = acct;
    return { ...safe, ...publicPlaidFields(byId.get(Number(acct.id))) };
  });
}

function formatSyncedLabel(date = new Date()) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function findInstitution(institutionId) {
  return DEMO_INSTITUTIONS.find(i => i.id === institutionId) || null;
}

function upsertPlaidItem(accountId, fields) {
  const existing = db.prepare('SELECT account_id FROM plaid_items WHERE account_id = ?').get(accountId);
  if (existing) {
    db.prepare(`
      UPDATE plaid_items SET
        access_token = ?,
        item_id = ?,
        plaid_account_id = ?,
        plaid_institution_name = ?,
        plaid_account_name = ?,
        plaid_account_mask = ?,
        pending_accounts = ?,
        sync_cursor = ?,
        last_error = NULL
      WHERE account_id = ?
    `).run(
      fields.access_token,
      fields.item_id,
      fields.plaid_account_id,
      fields.plaid_institution_name,
      fields.plaid_account_name,
      fields.plaid_account_mask,
      fields.pending_accounts,
      fields.sync_cursor,
      accountId,
    );
  } else {
    db.prepare(`
      INSERT INTO plaid_items (
        account_id, access_token, item_id, plaid_account_id,
        plaid_institution_name, plaid_account_name, plaid_account_mask,
        pending_accounts, sync_cursor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
      fields.access_token,
      fields.item_id,
      fields.plaid_account_id,
      fields.plaid_institution_name,
      fields.plaid_account_name,
      fields.plaid_account_mask,
      fields.pending_accounts,
      fields.sync_cursor,
    );
  }
}

async function createLinkToken() {
  return 'demo-link-token';
}

function pickMappedAccount(plaidAccounts, requestedId) {
  if (!plaidAccounts.length) return null;
  if (requestedId) {
    const match = plaidAccounts.find(a => a.id === requestedId);
    if (match) return match;
  }
  if (plaidAccounts.length === 1) return plaidAccounts[0];
  return null;
}

async function exchangePublicToken({
  accountId,
  publicToken,
  plaidAccountId,
  institutionName,
  institutionId,
}) {
  const inst = findInstitution(institutionId)
    || DEMO_INSTITUTIONS.find(i => i.name === institutionName)
    || DEMO_INSTITUTIONS.find(i => i.id === String(publicToken || '').replace(/^demo:/, ''));
  if (!inst) {
    const err = new Error('Choose a demo bank to connect.');
    err.code = 'PLAID_ACCOUNT_REQUIRED';
    throw err;
  }
  const mapped = pickMappedAccount(inst.accounts, plaidAccountId);
  upsertPlaidItem(accountId, {
    access_token: `demo:${inst.id}`,
    item_id: `demo-item-${inst.id}-${accountId}`,
    plaid_account_id: mapped?.id || null,
    plaid_institution_name: inst.name,
    plaid_account_name: mapped?.name || '',
    plaid_account_mask: mapped?.mask || '',
    pending_accounts: mapped ? null : JSON.stringify(inst.accounts),
    sync_cursor: null,
  });
  const status = getPlaidPublicStatus(accountId);
  return {
    ...status,
    needs_selection: !mapped,
    accounts: mapped ? [] : inst.accounts,
  };
}

function selectPlaidAccount({ accountId, plaidAccountId }) {
  const row = getPlaidItemRow(accountId);
  if (!row) {
    const err = new Error('This account is not connected to a bank.');
    err.code = 'PLAID_NOT_CONNECTED';
    throw err;
  }
  const pending = parsePendingAccounts(row.pending_accounts);
  const match = pending.find(a => a.id === plaidAccountId);
  if (!match) {
    const err = new Error('Choose one of the demo bank accounts.');
    err.code = 'PLAID_ACCOUNT_REQUIRED';
    throw err;
  }
  db.prepare(`
    UPDATE plaid_items
    SET plaid_account_id = ?,
        plaid_account_name = ?,
        plaid_account_mask = ?,
        pending_accounts = NULL,
        last_error = NULL
    WHERE account_id = ?
  `).run(match.id, match.name || '', match.mask || '', accountId);
  return getPlaidPublicStatus(accountId);
}

function daysAgoDisplay(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return formatDisplayDate(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  );
}

function demoTxnId(accountId, poolId) {
  return `demo-${accountId}-${poolId}`;
}

function loadAccountTxnIndex(accountId) {
  const rows = db.prepare(`
    SELECT id, date, name, amt, plaid_transaction_id
    FROM transactions
    WHERE account_id = ? AND IFNULL(is_opening_balance, 0) = 0
  `).all(accountId);
  const byPlaidId = new Set();
  const byFingerprint = new Set();
  for (const row of rows) {
    if (row.plaid_transaction_id) byPlaidId.add(row.plaid_transaction_id);
    const fp = importFingerprint(row.date, row.amt, row.name);
    if (fp) byFingerprint.add(fp);
  }
  return { byPlaidId, byFingerprint };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncAccount(accountId) {
  const row = getPlaidItemRow(accountId);
  if (!row) {
    const err = new Error('This account is not connected to a bank.');
    err.code = 'PLAID_NOT_CONNECTED';
    throw err;
  }
  if (!row.plaid_account_id) {
    const err = new Error('Choose which bank account maps to this Finara tab.');
    err.code = 'PLAID_ACCOUNT_REQUIRED';
    err.accounts = parsePendingAccounts(row.pending_accounts);
    throw err;
  }

  await sleep(1100);

  const instId = String(row.access_token || '').replace(/^demo:/, '')
    || DEMO_INSTITUTIONS.find(i => i.name === row.plaid_institution_name)?.id;
  const pool = DEMO_TXN_POOLS[row.plaid_account_id]
    || DEMO_TXN_POOLS[instId]
    || DEMO_TXN_POOLS.ins_chime;
  const index = loadAccountTxnIndex(accountId);
  const unused = pool.filter(item => !index.byPlaidId.has(demoTxnId(accountId, item.id)));

  if (!unused.length) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE plaid_items SET last_synced_at = ?, last_error = NULL WHERE account_id = ?
    `).run(now, accountId);
    db.prepare('UPDATE accounts SET synced = ? WHERE id = ?').run(formatSyncedLabel(), accountId);
    return {
      added: 0,
      modified: 0,
      removed: 0,
      skipped: 0,
      ready: true,
      last_synced_at: now,
      message: "You're up to date. No new demo transactions.",
    };
  }

  const take = Math.min(unused.length, 3 + Math.floor(Math.random() * 6));
  const batch = unused.slice(0, take);
  const insert = db.prepare(`
    INSERT INTO transactions
      (date, "time", name, desc, cat, amt, bal, status, account_id, plaid_transaction_id, is_opening_balance)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'synced', ?, ?, 0)
  `);

  let inserted = 0;
  db.exec('BEGIN');
  try {
    batch.forEach((item, i) => {
      const date = toImportDisplayDate(daysAgoDisplay(i)) || daysAgoDisplay(i);
      const amt = roundImportAmt(item.amt);
      const name = item.name;
      const fp = importFingerprint(date, amt, name);
      if (fp && index.byFingerprint.has(fp)) return;
      insert.run(
        date,
        '12:00',
        name,
        item.desc,
        resolveImportCategory(item.cat),
        amt,
        accountId,
        demoTxnId(accountId, item.id),
      );
      inserted++;
    });
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }

  if (inserted > 0) {
    recalcAccountBalance(accountId);
    syncAccountOpeningBalance(accountId);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE plaid_items SET last_synced_at = ?, last_error = NULL WHERE account_id = ?
  `).run(now, accountId);
  db.prepare('UPDATE accounts SET synced = ? WHERE id = ?').run(formatSyncedLabel(), accountId);

  const status = getPlaidPublicStatus(accountId);
  return {
    added: inserted,
    modified: 0,
    removed: 0,
    skipped: take - inserted,
    ready: true,
    last_synced_at: status.plaid_last_synced_at,
    needs_reauth: false,
  };
}

async function disconnectAccount(accountId) {
  db.prepare('DELETE FROM plaid_items WHERE account_id = ?').run(accountId);
  return getPlaidPublicStatus(accountId);
}

function listDemoInstitutions() {
  return DEMO_INSTITUTIONS;
}

module.exports = {
  isPlaidConfigured,
  plaidEnvName,
  missingKeysMessage,
  plaidErrorMessage: (err) => err?.message || 'Demo bank request failed',
  plaidErrorInfo: (err) => ({ code: err?.code || '', message: err?.message || '' }),
  getPlaidPublicStatus,
  attachPlaidPublicFields,
  getPlaidItemRow,
  createLinkToken,
  exchangePublicToken,
  selectPlaidAccount,
  syncAccount,
  disconnectAccount,
  listDemoInstitutions,
};
