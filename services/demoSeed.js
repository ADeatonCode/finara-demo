/**
 * FINARA DEMO — optional sample household for one visitor's portfolio.
 * Fake banks and merchants only. Never touches the real Finara database.
 */
const db = require('../database');
const { syncAccountOpeningBalance, formatDisplayDate } = require('../database');

function daysAgoIso(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoDisplay(n) {
  return formatDisplayDate(daysAgoIso(n));
}

function seedSampleHousehold(portfolioId) {
  const pid = Number(portfolioId);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('portfolio_id is required');
  }

  const existing = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE portfolio_id = ?').get(pid).n;
  if (existing > 0) {
    return { loaded: false, reason: 'This demo already has accounts. Add your own, or start over first.' };
  }

  const opening = daysAgoIso(21);
  const insAcct = db.prepare(`
    INSERT INTO accounts (
      kind, name, inst, last4, type, balance, opening_balance, basis, lim, rate, minpay,
      synced, opening_date, portfolio_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insAcct.run('asset', 'Chime Checking', 'Chime', '1842', 'Checking', 2847.32, 2847.32, null, null, null, null, 'Just now', opening, pid);
  insAcct.run('asset', 'Ascend FCU Savings', 'Ascend FCU', '9033', 'Savings', 8420.15, 8420.15, null, null, null, null, 'Just now', opening, pid);
  // Credit card: opening 0 so charges put the register in the red (you owe).
  // Amounts stay Finara convention: positive = credit, negative = debit.
  insAcct.run('liability', 'Harbor Card', 'Demo National', '7712', 'Credit', 0, 0, null, 4000, 18.99, 35, 'Just now', opening, pid);

  const acct = (name) => db.prepare(
    'SELECT id FROM accounts WHERE name = ? AND portfolio_id = ?'
  ).get(name, pid)?.id;

  const checking = acct('Chime Checking');
  const savings = acct('Ascend FCU Savings');
  const card = acct('Harbor Card');

  const insBudget = db.prepare(`
    INSERT OR IGNORE INTO budget_categories (category, kind, timeframe, budgeted, actual, portfolio_id)
    VALUES (?, ?, 'Monthly', ?, 0, ?)
  `);
  [
    ['Income', 'income', 3700],
    ['Rent', 'expense', 1450],
    ['Groceries', 'expense', 400],
    ['Dining Out', 'expense', 160],
    ['Transportation', 'expense', 150],
    ['Utilities', 'expense', 180],
    ['Entertainment', 'expense', 80],
    ['Healthcare', 'expense', 60],
    ['Shopping', 'expense', 120],
  ].forEach(([category, kind, budgeted]) => insBudget.run(category, kind, budgeted, pid));

  const insTxn = db.prepare(`
    INSERT INTO transactions (date, time, name, desc, cat, amt, bal, status, account_id)
    VALUES (?, '12:00', ?, ?, ?, ?, 0, 'synced', ?)
  `);
  const rows = [
    [daysAgoDisplay(13), 'Northline Payroll', 'Direct deposit', 'Income', 1850.00, checking],
    [daysAgoDisplay(12), 'Willow Court Rent', 'Monthly rent', 'Rent', -1450.00, checking],
    [daysAgoDisplay(10), 'Harbor Market', 'Weekly groceries', 'Groceries', -64.22, checking],
    [daysAgoDisplay(8), 'Bluebird Fuel', 'Fill-up', 'Transportation', -41.80, checking],
    [daysAgoDisplay(6), 'Lumen Electric', 'Electric bill', 'Utilities', -98.40, checking],
    [daysAgoDisplay(4), 'Copper Kettle Cafe', 'Morning coffee', 'Dining Out', -6.45, checking],
    [daysAgoDisplay(1), 'Northline Payroll', 'Direct deposit', 'Income', 1850.00, checking],
    [daysAgoDisplay(7), 'Ascend FCU Interest', 'Savings interest', 'Income', 3.12, savings],
    [daysAgoDisplay(11), 'Harbor Market', 'Checkout 6', 'Groceries', -38.90, card],
    [daysAgoDisplay(9), 'Copper Kettle Cafe', 'Iced latte', 'Dining Out', -6.45, card],
    [daysAgoDisplay(5), 'Streamly', 'Monthly streaming', 'Entertainment', -12.99, card],
    [daysAgoDisplay(3), 'Pine & Post Pharmacy', 'Pharmacy', 'Healthcare', -18.20, card],
    [daysAgoDisplay(2), 'Bluebird Fuel', 'Pump 1', 'Transportation', -32.10, card],
  ];
  for (const row of rows) {
    if (row[5] == null) continue;
    insTxn.run(...row);
  }

  for (const id of [checking, savings, card]) {
    if (id) syncAccountOpeningBalance(id);
  }

  return {
    loaded: true,
    accounts: ['Chime Checking', 'Ascend FCU Savings', 'Harbor Card'],
  };
}

module.exports = { seedSampleHousehold, daysAgoDisplay, daysAgoIso };
