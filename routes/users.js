/**
 * FINARA — routes/users.js
 *
 * What this file does:
 * - API for user accounts (people who can sign in).
 * - List, add, edit, and delete users from the Users page.
 * - You cannot delete yourself or the last remaining user.
 *
 * Read FILES.md for a simple guide to every file.
 */
const express = require('express');
const router = express.Router();
const {
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  deleteSessionsForUser,
  userCount,
  findUserById,
} = require('../auth');
const db = require('../database');

/* GET /api/users */
router.get('/', (req, res) => {
  // Demo isolation: never list every visitor on the server.
  if (req.user.is_primary) return res.json(listUsers().filter(u => Number(u.id) === Number(req.user.id)));

  // Otherwise list users that share a portfolio with the acting user
  const rows = db.prepare(`
    SELECT DISTINCT u.id, u.username, u.display_name, u.created_at,
           u.perm_read, u.perm_write, u.perm_delete, u.perm_manage_users
    FROM users u
    JOIN user_portfolios up ON up.user_id = u.id
    WHERE up.portfolio_id IN (
      SELECT portfolio_id FROM user_portfolios WHERE user_id = ?
    )
    ORDER BY u.created_at ASC, u.id ASC
  `).all(req.user.id);
  res.json(rows.map(r => ({
    id: r.id,
    username: r.username,
    display_name: r.display_name,
    created_at: r.created_at,
    permissions: {
      read: !!r.perm_read,
      write: !!r.perm_write,
      delete: !!r.perm_delete,
      manage_users: !!r.perm_manage_users,
    }
  })));
});

/* POST /api/users */
router.post('/', (req, res) => {
  const { username, display_name, password, permissions, portfolio_id, role } = req.body;
  // portfolio_id required unless root
  if (!portfolio_id && !req.user.is_primary) return res.status(400).json({ error: 'portfolio_id is required' });

  // Check acting user is allowed to create users for this portfolio
  if (!req.user.is_primary) {
    const membership = db.prepare('SELECT role FROM user_portfolios WHERE user_id = ? AND portfolio_id = ?').get(req.user.id, portfolio_id);
    if (!membership || membership.role !== 'admin') return res.status(403).json({ error: 'Permission denied' });
  }

  try {
    const user = createUser({
      username,
      displayName: display_name,
      password,
      permissions,
      portfolios: { portfolio_id: portfolio_id, role: role || 'member' },
    });
    res.status(201).json(user);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* PUT /api/users/:id */
router.put('/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const { display_name, password, permissions } = req.body;
  // Ensure acting user shares a portfolio with the target user unless root
  if (!req.user.is_primary) {
    const shared = db.prepare(`
      SELECT 1 FROM user_portfolios up1
      JOIN user_portfolios up2 ON up1.portfolio_id = up2.portfolio_id
      WHERE up1.user_id = ? AND up2.user_id = ? LIMIT 1
    `).get(req.user.id, userId);
    if (!shared) return res.status(403).json({ error: 'Permission denied' });
  }

  try {
    const user = updateUser(userId, {
      displayName: display_name,
      password,
      permissions,
    }, { actingUserId: req.user.id });
    res.json(user);
  } catch (e) {
    const status = e.message === 'User not found' ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

/* DELETE /api/users/:id */
router.delete('/:id', (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

  if (req.user.id === userId) {
    return res.status(400).json({ error: 'You cannot delete your own account while signed in' });
  }
  if (userCount() <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last user' });
  }
  // Ensure acting user shares a portfolio with the target user unless root
  if (!req.user.is_primary) {
    const shared = db.prepare(`
      SELECT 1 FROM user_portfolios up1
      JOIN user_portfolios up2 ON up1.portfolio_id = up2.portfolio_id
      WHERE up1.user_id = ? AND up2.user_id = ? LIMIT 1
    `).get(req.user.id, userId);
    if (!shared) return res.status(403).json({ error: 'Permission denied' });
  }

  try {
    deleteSessionsForUser(userId);
    deleteUser(userId);
    res.json({ ok: true });
  } catch (e) {
    const status = e.message === 'User not found' ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;
