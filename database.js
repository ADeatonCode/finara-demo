/**
 * FINARA — database.js
 *
 * What this file does:
 * - Opens and sets up the SQLite database file (finara.db).
 * - Creates tables for accounts, transactions, budgets, users, and more.
 * - Saves demo data on first install (if the database is empty).
 * - Provides helper functions: balance math, transfers, opening balances, etc.
 *
 * Read FILES.md for a simple guide to every file.
 */
// Uses Node 22's built-in SQLite (no npm install required)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.FINARA_DB_PATH || path.join(__dirname, 'finara-demo.db');
const db = new DatabaseSync(DB_PATH);

// Performance pragmas
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

/* ══════════════════════════════════════════════════════
   SCHEMA — tables that hold your saved data
══════════════════════════════════════════════════════ */
db.exec(`
  CREATE TABLE IF NOT EXISTS portfolios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_portfolios (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('admin','member')),
    PRIMARY KEY (user_id, portfolio_id)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK(kind IN ('asset','liability')),
    name       TEXT NOT NULL,
    inst       TEXT NOT NULL DEFAULT '',
    last4      TEXT NOT NULL DEFAULT '',
    type       TEXT NOT NULL,
    balance    REAL NOT NULL DEFAULT 0,
    opening_balance REAL,
    basis      REAL,
    lim        REAL,
    rate       REAL,
    minpay     REAL,
    synced     TEXT NOT NULL DEFAULT 'Just now',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    opening_date TEXT,
    portfolio_id INTEGER REFERENCES portfolios(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id),
    date       TEXT NOT NULL,
    time       TEXT NOT NULL DEFAULT '12:00',
    name       TEXT NOT NULL,
    desc       TEXT NOT NULL DEFAULT '',
    cat        TEXT NOT NULL DEFAULT '',
    amt        REAL NOT NULL DEFAULT 0,
    bal        REAL NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'synced' CHECK(status IN ('synced','pending')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS budget_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'expense' CHECK(kind IN ('income','expense')),
    timeframe  TEXT NOT NULL DEFAULT 'Monthly',
    budgeted   REAL NOT NULL DEFAULT 0,
    actual     REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    portfolio_id INTEGER REFERENCES portfolios(id),
    UNIQUE(portfolio_id, category)
  );

  CREATE TABLE IF NOT EXISTS credit_bureaus (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bureau          TEXT NOT NULL UNIQUE CHECK(bureau IN ('experian','equifax','transunion')),
    auto_sync       INTEGER NOT NULL DEFAULT 0,
    score           INTEGER,
    utilization_pct REAL,
    on_time_pay_pct REAL,
    inquiries       INTEGER,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','sync')),
    updated_at      TEXT,
    last_sync_at    TEXT,
    sync_status     TEXT NOT NULL DEFAULT 'idle'
      CHECK(sync_status IN ('idle','syncing','connected','error','needs_credentials')),
    sync_error      TEXT
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS account_types (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK(kind IN ('asset','liability')),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(kind, name)
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    perm_read           INTEGER NOT NULL DEFAULT 1,
    perm_write          INTEGER NOT NULL DEFAULT 0,
    perm_delete         INTEGER NOT NULL DEFAULT 0,
    perm_manage_users   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_txn_tab_order (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    PRIMARY KEY (user_id, account_id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_txn_tab_order_user
    ON user_txn_tab_order(user_id, position);
`);

// Migrate existing DBs: ensure portfolios and portfolio links exist and assign existing data
const acctColsPost = db.prepare('PRAGMA table_info(accounts)').all();
if (!acctColsPost.some(c => c.name === 'portfolio_id')) {
  db.exec('ALTER TABLE accounts ADD COLUMN portfolio_id INTEGER');
}
const budgetColsPost = db.prepare('PRAGMA table_info(budget_categories)').all();
if (!budgetColsPost.some(c => c.name === 'portfolio_id')) {
  db.exec('ALTER TABLE budget_categories ADD COLUMN portfolio_id INTEGER');
}

// Shared Default portfolio only for any leftover rows with no owner. New signups get their own household.
let defaultPortfolio = db.prepare("SELECT id FROM portfolios WHERE name = ?").get('Default');
if (!defaultPortfolio) {
  const res = db.prepare('INSERT INTO portfolios (name) VALUES (?)').run('Default');
  defaultPortfolio = { id: res.lastInsertRowid };
}
const defaultPid = defaultPortfolio.id;
db.prepare('UPDATE accounts SET portfolio_id = ? WHERE portfolio_id IS NULL').run(defaultPid);
db.prepare('UPDATE budget_categories SET portfolio_id = ? WHERE portfolio_id IS NULL').run(defaultPid);

/* ── Migrate existing DBs: add account_id if missing ── */
const txnCols = db.prepare('PRAGMA table_info(transactions)').all();
if (!txnCols.some(c => c.name === 'account_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)');
  const defaultAcct = db.prepare(
    "SELECT id FROM accounts WHERE name = 'Chase Sapphire Credit' LIMIT 1"
  ).get();
  if (defaultAcct) {
    db.prepare('UPDATE transactions SET account_id = ? WHERE account_id IS NULL')
      .run(defaultAcct.id);
  }
}
if (!txnCols.some(c => c.name === 'is_opening_balance')) {
  db.exec('ALTER TABLE transactions ADD COLUMN is_opening_balance INTEGER NOT NULL DEFAULT 0');
}
if (!txnCols.some(c => c.name === 'time')) {
  db.exec("ALTER TABLE transactions ADD COLUMN time TEXT NOT NULL DEFAULT '12:00'");
}
if (!txnCols.some(c => c.name === 'transfer_group_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN transfer_group_id INTEGER');
}
if (!txnCols.some(c => c.name === 'plaid_transaction_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN plaid_transaction_id TEXT');
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_plaid_id
    ON transactions(plaid_transaction_id)
    WHERE plaid_transaction_id IS NOT NULL AND plaid_transaction_id != '';
  CREATE TABLE IF NOT EXISTS plaid_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    item_id TEXT NOT NULL,
    plaid_account_id TEXT,
    plaid_institution_name TEXT,
    plaid_account_name TEXT,
    plaid_account_mask TEXT,
    pending_accounts TEXT,
    sync_cursor TEXT,
    last_synced_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/* ══════════════════════════════════════════════════════
   SEED DATA — sample data on first install only
══════════════════════════════════════════════════════ */
const getMeta = db.prepare('SELECT value FROM app_meta WHERE key = ?');
const setMeta = db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)');

function hasInitialSeedDone() {
  return getMeta.get('initial_seed_done')?.value === '1';
}

function markInitialSeedDone() {
  setMeta.run('initial_seed_done', '1');
}

function databaseHasUserData() {
  const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  const txns = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  const budget = db.prepare('SELECT COUNT(*) AS n FROM budget_categories').get().n;
  const bureaus = db.prepare('SELECT COUNT(*) AS n FROM credit_bureaus').get().n;
  return accounts > 0 || txns > 0 || budget > 0 || bureaus > 0;
}

function seedInitialDemoData() {
  // Shared sample household is not auto-loaded. Visitors sign up empty and may opt in.
  return;
  const insAcct = db.prepare(
    'INSERT INTO accounts (kind,name,inst,last4,type,balance,basis,lim,rate,minpay,synced) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  [
    ['asset','Chase Checking',     'JPMorgan Chase',       '4821','Checking',  8420.00,    null,      null,     null,  null,   'Jul 31, 9:42 AM'],
    ['asset','Chase Savings',      'JPMorgan Chase',       '2293','Savings',   24600.00,   null,      null,     null,  null,   'Jul 31, 9:42 AM'],
    ['asset','Ally Savings',       'Ally Bank',            '9912','Savings',   4500.00,    null,      null,     null,  null,   'Jul 31, 9:40 AM'],
    ['asset','Fidelity Brokerage', 'Fidelity Investments', '7760','Brokerage', 142300.00,  108500.00, null,     null,  null,   'Jul 31, 9:41 AM'],
    ['asset','Robinhood',          'Robinhood Markets',    '3310','Brokerage', 18500.00,   15200.00,  null,     null,  null,   'Jul 31, 9:41 AM'],
    ['liability','Chase Sapphire Credit','JPMorgan Chase', '5591','Credit',    3240.50,    null,  15000.00, 21.49, 65.00,  'Jul 31, 9:42 AM'],
    ['liability','Student Loan',         'Navient',        '0088','Loan',      28800.00,   null,  38000.00,  4.50, 310.00, 'Jul 30, 8:15 AM'],
    ['liability','Auto Loan',            'Wells Fargo',    '6631','Loan',      23439.00,   null,  28000.00,  6.15, 420.00, 'Jul 30, 8:12 AM'],
  ].forEach(r => insAcct.run(...r));

  const acct = (name) => db.prepare('SELECT id FROM accounts WHERE name = ?').get(name)?.id;
  const credit = acct('Chase Sapphire Credit');
  const checking = acct('Chase Checking');
  const savings = acct('Chase Savings');

  const insTxn = db.prepare(
    'INSERT INTO transactions (date,name,desc,cat,amt,bal,status,account_id) VALUES (?,?,?,?,?,?,?,?)'
  );
  [
    ['Jul 31, 2025','WHOLEFDS #0512',    'Whole Foods Market',          'Groceries',      -62.18,   3240.50,'pending', credit],
    ['Jul 30, 2025','DELTA AIRLINES',    'Delta Air Lines #0073',        'Travel',         -348.00,  3178.32,'synced' , credit],
    ['Jul 29, 2025','SWEETGREEN',        'Sweetgreen — Bryant Park',     'Dining',         -14.75,   2830.32,'synced' , credit],
    ['Jul 28, 2025','PAYMENT THANK YOU', 'Online Payment — ACH Credit',  'Payment',        1200.00,  2845.07,'synced' , credit],
    ['Jul 26, 2025','AMAZON.COM*RT4X',   'Amazon Marketplace',           'Shopping',       -89.99,   1645.07,'synced' , credit],
    ['Jul 24, 2025','SPOTIFY USA',       'Spotify Premium Subscription', 'Entertainment',  -10.99,   1735.06,'synced' , credit],
    ['Jul 22, 2025','UBER * TRIP',       'Uber Technologies',            'Transportation', -18.40,   1746.05,'synced' , credit],
    ['Jul 20, 2025','CHIPOTLE #2241',    'Chipotle Mexican Grill',       'Dining',         -13.85,   1764.45,'synced' , credit],
    ['Jul 17, 2025','CVS PHARMACY',      'CVS Pharmacy #2801',           'Healthcare',     -24.30,   1778.30,'synced' , credit],
    ['Jul 15, 2025','CON ED NYC',        'Consolidated Edison Bill',     'Utilities',      -104.30,  1802.60,'synced' , credit],
    ['Jul 31, 2025','EMPLOYER PAYROLL',  'Direct Deposit',               'Income',         5500.00,  8420.00,'synced' , checking],
    ['Jul 28, 2025','ATM WITHDRAWAL',    'Chase ATM — Midtown',          'Cash',           -200.00,  2920.00,'synced' , checking],
    ['Jul 25, 2025','ZELLE PAYMENT',     'Rent split — Roommate',        'Transfer',       -1100.00, 3120.00,'synced' , checking],
    ['Jul 15, 2025','INTEREST PAYMENT',  'Monthly Savings Interest',     'Income',           12.40, 24612.40,'synced' , savings],
  ].filter(r => r[8] != null).forEach(r => insTxn.run(...r));

  const insBudget = db.prepare(
    'INSERT INTO budget_categories (category,timeframe,budgeted,actual) VALUES (?,?,?,?)'
  );
  [
    ['Rent',             'Monthly', 2200, 2200  ],
    ['Groceries',        'Monthly',  400, 318.42],
    ['Dining Out',       'Monthly',  200, 187.50],
    ['Transportation',   'Monthly',  150,  98.20],
    ['Utilities',        'Monthly',  120, 104.30],
    ['Entertainment',    'Monthly',  100,  67.80],
    ['Healthcare',       'Monthly',   50,   0   ],
    ['Savings Transfer', 'Monthly',  500, 500   ],
  ].forEach(r => insBudget.run(...r));

  const insBureau = db.prepare(`
    INSERT INTO credit_bureaus
      (bureau, auto_sync, score, utilization_pct, on_time_pay_pct, inquiries, source, updated_at, sync_status)
    VALUES (?, 0, ?, ?, ?, ?, 'manual', datetime('now'), 'idle')
  `);
  [
    ['experian',   748, 21.6, 100, 1],
    ['equifax',    null, null, null, null],
    ['transunion', null, null, null, null],
  ].forEach(r => insBureau.run(...r));
}

function ensureCreditBureauRows() {
  const ins = db.prepare(`
    INSERT OR IGNORE INTO credit_bureaus (bureau, auto_sync, source, sync_status)
    VALUES (?, 0, 'manual', 'idle')
  `);
  ['experian', 'equifax', 'transunion'].forEach(b => ins.run(b));
}

if (!hasInitialSeedDone()) {
  // Visitors create their own accounts. Optional sample data is loaded per signup.
  markInitialSeedDone();
}

ensureCreditBureauRows();

const DEFAULT_ACCOUNT_TYPES = {
  asset: ['Checking', 'Savings', 'Brokerage', 'Real Estate', 'Transportation', 'CD', 'Money Market'],
  liability: ['Credit', 'Loan', 'Mortgage', 'Line of Credit'],
};

function ensureAccountTypes() {
  const ins = db.prepare('INSERT OR IGNORE INTO account_types (kind, name) VALUES (?, ?)');
  for (const [kind, names] of Object.entries(DEFAULT_ACCOUNT_TYPES)) {
    for (const name of names) ins.run(kind, name);
  }
  const fromAccounts = db.prepare(`
    SELECT DISTINCT kind, type AS name FROM accounts WHERE type IS NOT NULL AND TRIM(type) != ''
  `).all();
  for (const row of fromAccounts) {
    ins.run(row.kind, String(row.name).trim());
  }
}

ensureAccountTypes();

/* ── Migrate: user permissions ── */
const userCols = db.prepare('PRAGMA table_info(users)').all();
let addedUserPermCols = false;
for (const col of [
  'perm_read INTEGER NOT NULL DEFAULT 1',
  'perm_write INTEGER NOT NULL DEFAULT 0',
  'perm_delete INTEGER NOT NULL DEFAULT 0',
  'perm_manage_users INTEGER NOT NULL DEFAULT 0',
]) {
  const name = col.split(' ')[0];
  if (!userCols.some(c => c.name === name)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    addedUserPermCols = true;
  }
}
if (addedUserPermCols) {
  db.exec(`
    UPDATE users SET
      perm_read = 1,
      perm_write = 1,
      perm_delete = 1,
      perm_manage_users = 1
  `);
}
const primaryUserId = db.prepare('SELECT MIN(id) AS id FROM users').get()?.id;
if (primaryUserId != null) {
  db.prepare(`
    UPDATE users SET
      perm_read = 1, perm_write = 1, perm_delete = 1, perm_manage_users = 1
    WHERE id = ?
  `).run(primaryUserId);
}

/* ── Migrate: opening_balance + opening balance transactions ── */
const acctCols = db.prepare('PRAGMA table_info(accounts)').all();
if (!acctCols.some(c => c.name === 'opening_balance')) {
  db.exec('ALTER TABLE accounts ADD COLUMN opening_balance REAL');
}
for (const col of [
  'routing_number TEXT',
  'account_number TEXT',
  'debit_card_number TEXT',
  'debit_card_exp TEXT',
  'debit_card_cvv TEXT',
]) {
  const name = col.split(' ')[0];
  if (!acctCols.some(c => c.name === name)) {
    db.exec(`ALTER TABLE accounts ADD COLUMN ${col}`);
  }
}
if (!acctCols.some(c => c.name === 'opening_date')) {
  db.exec('ALTER TABLE accounts ADD COLUMN opening_date TEXT');
  db.exec("UPDATE accounts SET opening_date = date(created_at) WHERE opening_date IS NULL OR opening_date = ''");
}

const budgetCols = db.prepare('PRAGMA table_info(budget_categories)').all();
if (!budgetCols.some(c => c.name === 'kind')) {
  db.exec("ALTER TABLE budget_categories ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense'");
  const inferKind = db.prepare(`
    SELECT
      SUM(CASE WHEN amt > 0 THEN 1 ELSE 0 END) AS income_cnt,
      SUM(CASE WHEN amt < 0 THEN 1 ELSE 0 END) AS expense_cnt
    FROM transactions
    WHERE cat = ? AND is_opening_balance = 0
  `);
  const updKind = db.prepare('UPDATE budget_categories SET kind = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id, category FROM budget_categories').all()) {
    const counts = inferKind.get(row.category);
    const kind = counts?.income_cnt > 0 && !counts?.expense_cnt ? 'income' : 'expense';
    updKind.run(kind, row.id);
  }
}

const transferCatRow = db.prepare(`
  SELECT id FROM budget_categories WHERE kind = 'transfer' OR LOWER(TRIM(category)) = 'transfer'
`).all();
for (const row of transferCatRow) {
  db.prepare('DELETE FROM budget_categories WHERE id = ?').run(row.id);
}

function parseTxnDate(dateStr) {
  return parseTxnDateTime(dateStr, '12:00');
}

function parseTxnDateTime(dateStr, timeStr) {
  const raw = String(dateStr ?? '');
  const time = timeStr || '12:00';
  const [hh, mm] = time.split(':').map(Number);
  const d = raw.includes(',')
    ? new Date(raw)
    : new Date(raw + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return 0;
  d.setHours(Number.isNaN(hh) ? 12 : hh, Number.isNaN(mm) ? 0 : mm, 0, 0);
  return d.getTime();
}

function getOpeningBalanceDate(accountId, acct) {
  if (acct?.opening_date) return formatDisplayDate(acct.opening_date);

  const txns = db.prepare(`
    SELECT date FROM transactions WHERE account_id = ? AND is_opening_balance = 0
  `).all(accountId);
  if (txns.length === 0) return formatDisplayDate(acct.created_at);

  let minTime = Infinity;
  let minDate = formatDisplayDate(acct.created_at);
  for (const t of txns) {
    const time = parseTxnDate(t.date);
    if (time < minTime) {
      minTime = time;
      minDate = t.date;
    }
  }
  return minDate;
}

function sortTxnsForBalance(txns) {
  return txns.slice().sort((a, b) => {
    const diff = parseTxnDateTime(a.date, a.time) - parseTxnDateTime(b.date, b.time);
    if (diff !== 0) return diff;
    if (a.is_opening_balance !== b.is_opening_balance) {
      return b.is_opening_balance - a.is_opening_balance;
    }
    return a.id - b.id;
  });
}
function formatDisplayDate(value) {
  const raw = String(value ?? '');
  const d = raw.includes('T') || raw.includes(' ')
    ? new Date(raw.replace(' ', 'T'))
    : new Date(raw + 'T12:00:00');
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function txnRowDelta(amt, kind) {
  const credit = amt > 0 ? amt : 0;
  const debit = amt < 0 ? Math.abs(amt) : 0;
  return kind === 'liability' ? debit - credit : credit - debit;
}

function openingTxnAmt(balance, kind) {
  const amount = Math.abs(balance || 0);
  return kind === 'liability' ? -amount : amount;
}

function sumNonOpeningDelta(accountId, kind) {
  const txns = db.prepare(`
    SELECT amt FROM transactions WHERE account_id = ? AND is_opening_balance = 0
  `).all(accountId);
  return txns.reduce((s, t) => s + txnRowDelta(t.amt, kind), 0);
}

function computeOpeningTxnAmt(targetBalance, kind, accountId) {
  const openingDelta = (targetBalance || 0) - sumNonOpeningDelta(accountId, kind);
  return openingTxnAmt(openingDelta, kind);
}

function txnDateToIso(dateStr) {
  const raw = String(dateStr ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = raw.includes(',') ? new Date(raw) : new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function reconcileOpeningDateWithTransactions(accountId) {
  const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acct) return null;

  const earliest = db.prepare(`
    SELECT date FROM transactions
    WHERE account_id = ? AND is_opening_balance = 0
    ORDER BY date ASC, id ASC
    LIMIT 1
  `).get(accountId);
  if (!earliest?.date) return acct;

  const openingIso = acct.opening_date || txnDateToIso(formatDisplayDate(acct.created_at));
  if (!openingIso) return acct;

  const earliestTs = parseTxnDate(earliest.date);
  const openingTs = parseTxnDate(formatDisplayDate(openingIso));
  if (!earliestTs || !openingTs || openingTs <= earliestTs) return acct;

  const earliestIso = txnDateToIso(earliest.date);
  if (!earliestIso) return acct;

  db.prepare('UPDATE accounts SET opening_date = ? WHERE id = ?').run(earliestIso, accountId);
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
}

function syncAccountOpeningBalance(accountId) {
  const acct = reconcileOpeningDateWithTransactions(accountId);
  if (!acct) return;

  const openingDate = acct.opening_date
    ? formatDisplayDate(acct.opening_date)
    : getOpeningBalanceDate(accountId, acct);
  const hasOpening = db.prepare(
    'SELECT id, amt FROM transactions WHERE account_id = ? AND is_opening_balance = 1'
  ).get(accountId);

  const openingAmt = hasOpening
    ? (acct.kind === 'liability' && hasOpening.amt > 0 ? -Math.abs(hasOpening.amt) : hasOpening.amt)
    : (acct.opening_balance != null
      ? openingTxnAmt(acct.opening_balance, acct.kind)
      : computeOpeningTxnAmt(acct.balance, acct.kind, accountId));

  ensureOpeningBalanceTxn(accountId, openingAmt, openingDate);
  recalcAccountBalance(accountId);
}

function ensureOpeningBalanceTxn(accountId, amount, dateStr) {
  const acct = db.prepare('SELECT created_at, kind, opening_date FROM accounts WHERE id = ?').get(accountId);
  if (!acct) return;

  const openingDate = dateStr
    || (acct.opening_date ? formatDisplayDate(acct.opening_date) : null)
    || formatDisplayDate(acct.created_at);
  const storedAmt = acct.kind === 'liability' && amount > 0 ? -amount : amount;
  const existing = db.prepare(
    'SELECT id FROM transactions WHERE account_id = ? AND is_opening_balance = 1'
  ).get(accountId);

  if (existing) {
    db.prepare(`
      UPDATE transactions
      SET date = ?, name = 'Opening Balance', desc = 'Initial account balance',
          cat = 'Opening Balance', amt = ?, status = 'synced'
      WHERE id = ?
    `).run(openingDate, storedAmt || 0, existing.id);
  } else {
    db.prepare(`
      INSERT INTO transactions (account_id, date, time, name, desc, cat, amt, bal, status, is_opening_balance)
      VALUES (?, ?, '00:00', 'Opening Balance', 'Initial account balance', 'Opening Balance', ?, 0, 'synced', 1)
    `).run(accountId, openingDate, storedAmt || 0);
  }
}

function recalcAccountBalance(accountId) {
  const acct = db.prepare('SELECT id, kind FROM accounts WHERE id = ?').get(accountId);
  if (!acct) return;

  const txns = sortTxnsForBalance(db.prepare(`
    SELECT id, amt, date, time, is_opening_balance FROM transactions
    WHERE account_id = ?
  `).all(accountId));

  let running = 0;
  const updateBal = db.prepare('UPDATE transactions SET bal = ? WHERE id = ?');
  for (const t of txns) {
    running += txnRowDelta(t.amt, acct.kind);
    updateBal.run(running, t.id);
  }

  const openingAmt = db.prepare(
    'SELECT amt FROM transactions WHERE account_id = ? AND is_opening_balance = 1 LIMIT 1'
  ).get(accountId)?.amt ?? 0;

  db.prepare(`
    UPDATE accounts SET balance = ?, opening_balance = ? WHERE id = ?
  `).run(running, Math.abs(openingAmt), accountId);
}

function isValuedAssetType(type) {
  return type === 'Real Estate' || type === 'Transportation';
}

function applyOpeningBalanceUpdate(accountId, openingBalance) {
  const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acct || acct.kind !== 'asset' || isValuedAssetType(acct.type)) return;

  const amount = Number(openingBalance);
  if (!Number.isFinite(amount)) return;

  db.prepare('UPDATE accounts SET opening_balance = ? WHERE id = ?').run(Math.abs(amount), accountId);

  const openingDate = acct.opening_date
    ? formatDisplayDate(acct.opening_date)
    : getOpeningBalanceDate(accountId, acct);
  ensureOpeningBalanceTxn(accountId, openingTxnAmt(amount, acct.kind), openingDate);
  recalcAccountBalance(accountId);
}

function applyAccountBalanceTarget(accountId, targetBalance) {
  const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acct || acct.kind !== 'liability') return;

  const target = Number(targetBalance);
  if (!Number.isFinite(target)) return;

  const openingDate = acct.opening_date
    ? formatDisplayDate(acct.opening_date)
    : getOpeningBalanceDate(accountId, acct);
  ensureOpeningBalanceTxn(accountId, computeOpeningTxnAmt(target, acct.kind, accountId), openingDate);
  recalcAccountBalance(accountId);
}

function applyRealEstateValueUpdate(accountId, targetBalance) {
  const acct = db.prepare('SELECT id, kind, type FROM accounts WHERE id = ?').get(accountId);
  if (!acct || acct.kind !== 'asset' || !isValuedAssetType(acct.type)) return;

  const target = Number(targetBalance);
  if (!Number.isFinite(target)) return;

  recalcAccountBalance(accountId);
  const current = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(accountId)?.balance ?? 0;
  const delta = target - current;
  if (Math.abs(delta) < 0.005) return;

  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateStr = formatDisplayDate(iso);
  const desc = acct.type === 'Transportation'
    ? 'Manual vehicle value adjustment'
    : 'Manual property value adjustment';
  db.prepare(`
    INSERT INTO transactions (account_id, date, time, name, desc, cat, amt, bal, status, is_opening_balance)
    VALUES (?, ?, '12:00', 'Value Update', ?, ?, ?, 0, 'synced', 0)
  `).run(accountId, dateStr, desc, acct.type, delta);
  recalcAccountBalance(accountId);
}

for (const acct of db.prepare('SELECT * FROM accounts').all()) {
  syncAccountOpeningBalance(acct.id);
}

function normalizeCategoryName(name) {
  return String(name ?? '').trim();
}

function findBudgetCategoryByName(name, portfolioId) {
  const n = normalizeCategoryName(name);
  if (!n) return null;
  if (portfolioId != null) {
    return db.prepare(`
      SELECT * FROM budget_categories
      WHERE LOWER(TRIM(category)) = LOWER(?) AND portfolio_id = ?
    `).get(n, portfolioId);
  }
  return db.prepare(`
    SELECT * FROM budget_categories
    WHERE LOWER(TRIM(category)) = LOWER(?)
  `).get(n);
}

function renameCategoryGlobally(oldName, newName, portfolioId) {
  const oldN = normalizeCategoryName(oldName);
  const newN = normalizeCategoryName(newName);
  if (!oldN || !newN || oldN.toLowerCase() === newN.toLowerCase()) {
    return { renamed: false };
  }

  const conflict = findBudgetCategoryByName(newN, portfolioId);
  if (conflict && conflict.category.toLowerCase() !== oldN.toLowerCase()) {
    return { renamed: false, conflict: true };
  }

  if (portfolioId != null) {
    db.prepare(`
      UPDATE transactions SET cat = ?
      WHERE LOWER(TRIM(cat)) = LOWER(?)
        AND is_opening_balance = 0
        AND account_id IN (SELECT id FROM accounts WHERE portfolio_id = ?)
    `).run(newN, oldN, portfolioId);
    db.prepare(`
      UPDATE budget_categories SET category = ?
      WHERE LOWER(TRIM(category)) = LOWER(?) AND portfolio_id = ?
    `).run(newN, oldN, portfolioId);
  } else {
    db.prepare(`
      UPDATE transactions SET cat = ?
      WHERE LOWER(TRIM(cat)) = LOWER(?)
        AND is_opening_balance = 0
    `).run(newN, oldN);
    db.prepare(`
      UPDATE budget_categories SET category = ?
      WHERE LOWER(TRIM(category)) = LOWER(?)
    `).run(newN, oldN);
  }

  return { renamed: true };
}

function syncCategoryFromBudget(oldName, newName, portfolioId) {
  return renameCategoryGlobally(oldName, newName, portfolioId);
}

function syncCategoryFromTransaction(oldCat, newCat) {
  const oldN = normalizeCategoryName(oldCat);
  const newN = normalizeCategoryName(newCat);
  if (!oldN || !newN || oldN.toLowerCase() === newN.toLowerCase()) {
    return { synced: false };
  }

  const budgetRow = findBudgetCategoryByName(oldN);
  if (!budgetRow) return { synced: false };

  const existingNew = findBudgetCategoryByName(newN);
  if (existingNew && existingNew.id !== budgetRow.id) {
    return { synced: false, switched: true };
  }

  return renameCategoryGlobally(oldN, newN);
}

function normalizeCategoryKind(kind) {
  if (kind === 'income') return 'income';
  if (kind === 'transfer') return 'transfer';
  return 'expense';
}

const TRANSFER_CATEGORY_NAME = 'Transfer';

function isTransferCategoryName(catName) {
  return normalizeCategoryName(catName).toLowerCase() === TRANSFER_CATEGORY_NAME.toLowerCase();
}

function getCategoryKind(catName) {
  if (isTransferCategoryName(catName)) return 'transfer';
  const row = findBudgetCategoryByName(catName);
  return normalizeCategoryKind(row?.kind);
}

function getTransferLegs(transferGroupId) {
  if (!transferGroupId) return [];
  return db.prepare(`
    SELECT * FROM transactions
    WHERE transfer_group_id = ? AND is_opening_balance = 0
    ORDER BY id
  `).all(transferGroupId);
}

function getTransferCounterpart(txnId) {
  const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId);
  if (!txn?.transfer_group_id) return null;
  return db.prepare(`
    SELECT * FROM transactions
    WHERE transfer_group_id = ? AND id != ? AND is_opening_balance = 0
    LIMIT 1
  `).get(txn.transfer_group_id, txnId);
}

function normalizeTxnTimeValue(value) {
  const parts = String(value ?? '').trim().split(':');
  if (!parts[0]) return '12:00';
  const hh = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
  const mm = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function resolveTransferEndpoints(fromAccountId, toAccountId) {
  const fromId = Number(fromAccountId);
  const toId = Number(toAccountId);
  if (!fromId || !toId) throw new Error('Both accounts are required for a transfer');
  if (fromId === toId) throw new Error('Cannot transfer to the same account');
  const fromAcct = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(fromId);
  const toAcct = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(toId);
  if (!fromAcct || !toAcct) throw new Error('Invalid account selected for transfer');
  return { fromAcct, toAcct };
}

function transferLegLabels(fromAcct, toAcct, desc = '') {
  const trimmedDesc = String(desc ?? '').trim();
  return {
    outName: `Transfer to ${toAcct.name}`,
    inName: `Transfer from ${fromAcct.name}`,
    outDesc: trimmedDesc || `Transfer to ${toAcct.name}`,
    inDesc: trimmedDesc || `Transfer from ${fromAcct.name}`,
  };
}

function createTransferPair({
  date,
  time,
  name,
  desc,
  cat,
  amount,
  status,
  fromAccountId,
  toAccountId,
}) {
  const { fromAcct, toAcct } = resolveTransferEndpoints(fromAccountId, toAccountId);
  const absAmount = Math.abs(Number(amount) || 0);
  if (absAmount <= 0) throw new Error('Transfer amount must be greater than zero');

  const txnTime = normalizeTxnTimeValue(time);
  const trimmedDesc = String(desc ?? '').trim();
  const { outName, inName, outDesc, inDesc } = transferLegLabels(fromAcct, toAcct, trimmedDesc);
  const txnStatus = status || 'synced';
  const category = String(cat ?? '').trim();

  const insert = db.prepare(`
    INSERT INTO transactions (date, "time", name, desc, cat, amt, bal, status, account_id)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    const outResult = insert.run(
      date || '', txnTime, outName, outDesc, category, -absAmount, txnStatus, fromAcct.id
    );
    const groupId = Number(outResult.lastInsertRowid);
    const inResult = insert.run(
      date || '', txnTime, inName, inDesc, category, absAmount, txnStatus, toAcct.id
    );
    const inId = Number(inResult.lastInsertRowid);
    db.prepare('UPDATE transactions SET transfer_group_id = ? WHERE id IN (?, ?)')
      .run(groupId, groupId, inId);
    db.exec('COMMIT');
    recalcAccountBalance(fromAcct.id);
    recalcAccountBalance(toAcct.id);
    return { id: groupId, linked_id: inId, transfer_group_id: groupId };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function updateTransferPair(existingId, {
  date,
  time,
  name,
  desc,
  cat,
  amount,
  status,
  fromAccountId,
  toAccountId,
}) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(existingId);
  if (!existing?.transfer_group_id) throw new Error('Transfer not found');

  const legs = getTransferLegs(existing.transfer_group_id);
  if (legs.length !== 2) throw new Error('Transfer is missing a linked transaction');

  const { fromAcct, toAcct } = resolveTransferEndpoints(fromAccountId, toAccountId);
  const absAmount = Math.abs(Number(amount) || 0);
  if (absAmount <= 0) throw new Error('Transfer amount must be greater than zero');

  const txnTime = normalizeTxnTimeValue(time);
  const trimmedDesc = String(desc ?? '').trim();
  const { outName, inName, outDesc, inDesc } = transferLegLabels(fromAcct, toAcct, trimmedDesc);
  const txnStatus = status || 'synced';
  const category = String(cat ?? '').trim();
  const oldAccountIds = new Set(legs.map(l => l.account_id));

  const outLeg = legs.find(l => l.amt < 0) || legs[0];
  const inLeg = legs.find(l => l.amt > 0) || legs[1];

  const update = db.prepare(`
    UPDATE transactions
    SET date = ?, "time" = ?, name = ?, desc = ?, cat = ?, amt = ?, status = ?, account_id = ?
    WHERE id = ?
  `);

  db.exec('BEGIN');
  try {
    update.run(
      date || '', txnTime, outName, outDesc, category, -absAmount, txnStatus, fromAcct.id, outLeg.id
    );
    update.run(
      date || '', txnTime, inName, inDesc, category, absAmount, txnStatus, toAcct.id, inLeg.id
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  oldAccountIds.add(fromAcct.id);
  oldAccountIds.add(toAcct.id);
  for (const accountId of oldAccountIds) recalcAccountBalance(accountId);
  return { ok: true, transfer_group_id: existing.transfer_group_id };
}

function deleteTransferPair(existingId) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(existingId);
  if (!existing?.transfer_group_id) return null;

  const legs = getTransferLegs(existing.transfer_group_id);
  const accountIds = [...new Set(legs.map(l => l.account_id))];
  db.prepare('DELETE FROM transactions WHERE transfer_group_id = ?').run(existing.transfer_group_id);
  for (const accountId of accountIds) recalcAccountBalance(accountId);
  return { ok: true };
}

function convertTransferToSingle(existingId, fields) {
  const deleted = deleteTransferPair(existingId);
  if (!deleted) return null;

  const {
    date, time, name, desc, cat, amt, status, account_id,
  } = fields;
  const txnTime = normalizeTxnTimeValue(time);
  const result = db.prepare(`
    INSERT INTO transactions (date, "time", name, desc, cat, amt, bal, status, account_id)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    date || '', txnTime, name, desc || '', cat || '', amt || 0, status || 'synced', account_id
  );
  recalcAccountBalance(account_id);
  return { id: result.lastInsertRowid };
}

function inferOtherAccountFromTransferName(name, excludeAccountId) {
  const m = String(name ?? '').trim().match(/^Transfer (?:to|from) (.+)$/i);
  if (!m) return null;
  const label = m[1].trim();
  const acct = db.prepare(`
    SELECT id FROM accounts
    WHERE TRIM(name) = ? AND id != ?
    LIMIT 1
  `).get(label, excludeAccountId);
  return acct?.id ?? null;
}

function repairOrphanTransferTransactions() {
  const orphans = db.prepare(`
    SELECT * FROM transactions
    WHERE transfer_group_id IS NULL
      AND is_opening_balance = 0
      AND LOWER(TRIM(cat)) = 'transfer'
    ORDER BY id
  `).all();

  for (const txn of orphans) {
    const otherAccountId = inferOtherAccountFromTransferName(txn.name, txn.account_id);
    if (!otherAccountId) continue;

    const absAmount = Math.abs(Number(txn.amt) || 0);
    if (absAmount <= 0) continue;

    const isOutbound = Number(txn.amt) < 0;
    const fromAccountId = isOutbound ? txn.account_id : otherAccountId;
    const toAccountId = isOutbound ? otherAccountId : txn.account_id;

    db.prepare('DELETE FROM transactions WHERE id = ?').run(txn.id);
    try {
      createTransferPair({
        date: txn.date,
        time: txn.time,
        name: '',
        desc: txn.desc,
        cat: TRANSFER_CATEGORY_NAME,
        amount: absAmount,
        status: txn.status,
        fromAccountId,
        toAccountId,
      });
    } catch (e) {
      console.error(`Failed to repair orphan transfer ${txn.id}:`, e.message);
    }
  }
}

function repairTransferLegNames() {
  const groups = db.prepare(`
    SELECT DISTINCT transfer_group_id AS id FROM transactions
    WHERE transfer_group_id IS NOT NULL AND is_opening_balance = 0
  `).all();

  const updateName = db.prepare('UPDATE transactions SET name = ? WHERE id = ?');

  for (const { id: groupId } of groups) {
    const legs = getTransferLegs(groupId);
    if (legs.length !== 2) continue;
    const outLeg = legs.find(l => Number(l.amt) < 0);
    const inLeg = legs.find(l => Number(l.amt) > 0);
    if (!outLeg || !inLeg) continue;

    const fromAcct = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(outLeg.account_id);
    const toAcct = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(inLeg.account_id);
    if (!fromAcct || !toAcct) continue;

    const { outName, inName } = transferLegLabels(fromAcct, toAcct);
    if (outLeg.name !== outName) updateName.run(outName, outLeg.id);
    if (inLeg.name !== inName) updateName.run(inName, inLeg.id);
  }
}

repairOrphanTransferTransactions();
repairTransferLegNames();

function getTxnTabOrder(userId) {
  const rows = db.prepare(`
    SELECT account_id FROM user_txn_tab_order
    WHERE user_id = ?
    ORDER BY position ASC, account_id ASC
  `).all(userId);
  return rows.map(r => r.account_id);
}

function setTxnTabOrder(userId, accountIds) {
  const ids = [...new Set(
    (accountIds || [])
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && id > 0),
  )];
  const existingList = db.prepare(`
    SELECT a.id FROM accounts a
    WHERE a.portfolio_id IN (SELECT portfolio_id FROM user_portfolios WHERE user_id = ?)
    ORDER BY a.kind, a.id
  `).all(userId).map(r => r.id);
  const existing = new Set(existingList);
  const filtered = ids.filter(id => existing.has(id));
  for (const id of existingList) {
    if (!filtered.includes(id)) filtered.push(id);
  }

  db.prepare('DELETE FROM user_txn_tab_order WHERE user_id = ?').run(userId);
  const insert = db.prepare(`
    INSERT INTO user_txn_tab_order (user_id, account_id, position) VALUES (?, ?, ?)
  `);
  filtered.forEach((accountId, index) => {
    insert.run(userId, accountId, index);
  });
  return filtered;
}

module.exports = db;
module.exports.recalcAccountBalance = recalcAccountBalance;
module.exports.ensureOpeningBalanceTxn = ensureOpeningBalanceTxn;
module.exports.formatDisplayDate = formatDisplayDate;
module.exports.getOpeningBalanceDate = getOpeningBalanceDate;
module.exports.txnRowDelta = txnRowDelta;
module.exports.openingTxnAmt = openingTxnAmt;
module.exports.computeOpeningTxnAmt = computeOpeningTxnAmt;
module.exports.syncCategoryFromBudget = syncCategoryFromBudget;
module.exports.syncCategoryFromTransaction = syncCategoryFromTransaction;
module.exports.syncAccountOpeningBalance = syncAccountOpeningBalance;
module.exports.applyOpeningBalanceUpdate = applyOpeningBalanceUpdate;
module.exports.applyAccountBalanceTarget = applyAccountBalanceTarget;
module.exports.applyRealEstateValueUpdate = applyRealEstateValueUpdate;
module.exports.reconcileOpeningDateWithTransactions = reconcileOpeningDateWithTransactions;
module.exports.getCategoryKind = getCategoryKind;
module.exports.normalizeCategoryKind = normalizeCategoryKind;
module.exports.TRANSFER_CATEGORY_NAME = TRANSFER_CATEGORY_NAME;
module.exports.isTransferCategoryName = isTransferCategoryName;
module.exports.getTransferLegs = getTransferLegs;
module.exports.getTransferCounterpart = getTransferCounterpart;
module.exports.createTransferPair = createTransferPair;
module.exports.updateTransferPair = updateTransferPair;
module.exports.deleteTransferPair = deleteTransferPair;
module.exports.convertTransferToSingle = convertTransferToSingle;
function getHomePortfolioId(userId) {
  const row = db.prepare(`
    SELECT portfolio_id AS id FROM user_portfolios
    WHERE user_id = ?
    ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, portfolio_id
    LIMIT 1
  `).get(userId);
  return row?.id ?? null;
}

function ensureUserHomePortfolio(userId, username) {
  const existing = getHomePortfolioId(userId);
  if (existing) return existing;
  const base = `Household · ${String(username || 'demo').trim() || 'demo'}`;
  let name = `${base} · ${userId}`;
  let pid;
  try {
    pid = db.prepare('INSERT INTO portfolios (name) VALUES (?)').run(name).lastInsertRowid;
  } catch {
    pid = db.prepare('INSERT INTO portfolios (name) VALUES (?)').run(`${name} · ${Date.now()}`).lastInsertRowid;
  }
  db.prepare(
    'INSERT OR IGNORE INTO user_portfolios (user_id, portfolio_id, role) VALUES (?, ?, ?)'
  ).run(userId, pid, 'admin');
  return pid;
}

function clearPortfolioData(portfolioId, userId) {
  const pid = Number(portfolioId);
  if (!Number.isInteger(pid) || pid <= 0) return;
  const accounts = db.prepare('SELECT id FROM accounts WHERE portfolio_id = ?').all(pid);
  db.exec('BEGIN');
  try {
    for (const acct of accounts) {
      db.prepare('DELETE FROM plaid_items WHERE account_id = ?').run(acct.id);
      db.prepare('DELETE FROM user_txn_tab_order WHERE account_id = ?').run(acct.id);
      db.prepare('DELETE FROM transactions WHERE account_id = ?').run(acct.id);
    }
    db.prepare('DELETE FROM accounts WHERE portfolio_id = ?').run(pid);
    db.prepare('DELETE FROM budget_categories WHERE portfolio_id = ?').run(pid);
    if (userId) db.prepare('DELETE FROM user_txn_tab_order WHERE user_id = ?').run(userId);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

module.exports.getTxnTabOrder = getTxnTabOrder;
module.exports.setTxnTabOrder = setTxnTabOrder;
module.exports.getHomePortfolioId = getHomePortfolioId;
module.exports.ensureUserHomePortfolio = ensureUserHomePortfolio;
module.exports.clearPortfolioData = clearPortfolioData;
module.exports.findBudgetCategoryByName = findBudgetCategoryByName;
