/**
 * FINARA DEMO — 7-day retention.
 *
 * Rule: a signup and all of that visitor's demo data are deleted 7 days after
 * the account was created (created_at). Runs on server start and every hour.
 * Only touches this demo database (finara-demo.db), never the real Finara folder.
 */
const db = require('../database');

const RETENTION_DAYS = 7;
const RETENTION_NOTICE = 'This is a demo of the real product only. Data is kept for 7 days.';

function listExpiredUserIds() {
  return db.prepare(`
    SELECT id FROM users
    WHERE datetime(created_at) <= datetime('now', ?)
  `).all(`-${RETENTION_DAYS} days`).map(r => r.id);
}

function deleteUserSandbox(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return;

  const portfolios = db.prepare(
    'SELECT portfolio_id AS id FROM user_portfolios WHERE user_id = ?'
  ).all(id).map(r => r.id);

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM user_txn_tab_order WHERE user_id = ?').run(id);

    for (const pid of portfolios) {
      const accounts = db.prepare('SELECT id FROM accounts WHERE portfolio_id = ?').all(pid);
      for (const acct of accounts) {
        db.prepare('DELETE FROM plaid_items WHERE account_id = ?').run(acct.id);
        db.prepare('DELETE FROM user_txn_tab_order WHERE account_id = ?').run(acct.id);
        db.prepare('DELETE FROM transactions WHERE account_id = ?').run(acct.id);
      }
      db.prepare('DELETE FROM accounts WHERE portfolio_id = ?').run(pid);
      db.prepare('DELETE FROM budget_categories WHERE portfolio_id = ?').run(pid);
    }

    db.prepare('DELETE FROM user_portfolios WHERE user_id = ?').run(id);

    for (const pid of portfolios) {
      const stillUsed = db.prepare(
        'SELECT 1 FROM user_portfolios WHERE portfolio_id = ? LIMIT 1'
      ).get(pid);
      if (!stillUsed) {
        db.prepare('DELETE FROM portfolios WHERE id = ?').run(pid);
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

function purgeExpiredDemoUsers() {
  const ids = listExpiredUserIds();
  let removed = 0;
  for (const id of ids) {
    try {
      deleteUserSandbox(id);
      removed++;
    } catch (e) {
      console.error(`Demo retention: could not purge user ${id}:`, e.message);
    }
  }
  if (removed) {
    console.log(`Demo retention: removed ${removed} signup(s) older than ${RETENTION_DAYS} days.`);
  }
  return { removed, retention_days: RETENTION_DAYS };
}

function startRetentionSweep() {
  purgeExpiredDemoUsers();
  const hour = 60 * 60 * 1000;
  const timer = setInterval(() => {
    try { purgeExpiredDemoUsers(); } catch (e) {
      console.error('Demo retention sweep failed:', e.message);
    }
  }, hour);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  RETENTION_DAYS,
  RETENTION_NOTICE,
  deleteUserSandbox,
  purgeExpiredDemoUsers,
  startRetentionSweep,
};
