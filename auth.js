/**
 * FINARA — auth.js
 *
 * What this file does:
 * - Handles sign-in, sign-out, and passwords.
 * - Creates and checks login sessions (cookies).
 * - Adds, updates, and removes user accounts in the database.
 * - Scrambles passwords so they are not stored as plain text.
 *
 * Read FILES.md for a simple guide to every file.
 */
const crypto = require('crypto');
const db = require('./database');

const SESSION_COOKIE = 'finara_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

const PERMISSION_KEYS = ['read', 'write', 'delete', 'manage_users'];

const DEFAULT_PERMISSIONS = {
  read: true,
  write: false,
  delete: false,
  manage_users: false,
};

const FULL_PERMISSIONS = {
  read: true,
  write: true,
  delete: true,
  manage_users: true,
};

function permColumn(key) {
  return `perm_${key}`;
}

function normalizePermissions(input, fallback = DEFAULT_PERMISSIONS) {
  const out = {};
  for (const key of PERMISSION_KEYS) {
    if (input && input[key] != null) out[key] = !!input[key];
    else out[key] = !!fallback[key];
  }
  return out;
}

function getPrimaryUserId() {
  return db.prepare('SELECT MIN(id) AS id FROM users').get()?.id ?? null;
}

function isPrimaryUser(id) {
  const primaryId = getPrimaryUserId();
  return primaryId != null && Number(id) === Number(primaryId);
}

function applyPrimaryUserPermissions(id) {
  if (!isPrimaryUser(id)) return;
  db.prepare(`
    UPDATE users SET
      perm_read = 1, perm_write = 1, perm_delete = 1, perm_manage_users = 1
    WHERE id = ?
  `).run(id);
}

function ensurePrimaryUserPermissions() {
  const primaryId = getPrimaryUserId();
  if (primaryId != null) applyPrimaryUserPermissions(primaryId);
}

function mapUserRow(row) {
  if (!row) return null;
  const primary = isPrimaryUser(row.id);
  const portfolios = db.prepare(`
    SELECT p.id, p.name, up.role
    FROM portfolios p
    JOIN user_portfolios up ON up.portfolio_id = p.id
    WHERE up.user_id = ?
  `).all(row.id);

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    created_at: row.created_at,
    is_primary: false,
    permissions: {
      read: true,
      write: true,
      delete: true,
      manage_users: false,
    },
    portfolios: portfolios || [],
  };
}

function userHasPermission(user, key, portfolioId = null) {
  if (!user) return false;
  // Demo visitors are isolated: never grant god-mode across other signups.

  // If no portfolio context, fall back to global user permissions
  if (portfolioId == null) {
    if (user.permissions) return !!user.permissions[key];
    return !!user[permColumn(key)];
  }

  // Check portfolio membership for scoped permissions
  const row = db.prepare('SELECT role FROM user_portfolios WHERE user_id = ? AND portfolio_id = ?').get(user.id, portfolioId);
  if (!row) return false;
  if (row.role === 'admin') return true; // admins have full rights within portfolio
  if (row.role === 'member') {
    // members can read, but cannot write/delete/manage users
    return key === 'read';
  }
  return false;
}

function loadUserWithPermissions(id) {
  const row = db.prepare(`
    SELECT id, username, display_name, created_at,
           perm_read, perm_write, perm_delete, perm_manage_users
    FROM users WHERE id = ?
  `).get(id);
  return mapUserRow(row);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function createSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

function normalizeDisplayName(name) {
  return String(name ?? '').trim();
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function needsSetup() {
  return userCount() === 0;
}

function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(normalizeUsername(username));
}

function findUserById(id) {
  return loadUserWithPermissions(id);
}

function listUsers() {
  const rows = db.prepare(`
    SELECT id, username, display_name, created_at,
           perm_read, perm_write, perm_delete, perm_manage_users
    FROM users
    ORDER BY created_at ASC, id ASC
  `).all();
  return rows.map(mapUserRow);
}

function updateUser(id, { displayName, password, permissions } = {}, opts = {}) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) throw new Error('User not found');

  const nextDisplayName = displayName != null
    ? normalizeDisplayName(displayName) || existing.username
    : existing.display_name;

  let nextPerms = null;
  if (permissions != null && !isPrimaryUser(id)) {
    nextPerms = normalizePermissions(permissions, {
      read: !!existing.perm_read,
      write: !!existing.perm_write,
      delete: !!existing.perm_delete,
      manage_users: !!existing.perm_manage_users,
    });
    if (opts.actingUserId === id && !nextPerms.manage_users) {
      throw new Error('You cannot remove your own Manage Users permission');
    }
  } else if (permissions != null && isPrimaryUser(id)) {
    applyPrimaryUserPermissions(id);
  }

  if (password != null && password !== '') {
    if (String(password).length < 8) throw new Error('Password must be at least 8 characters');
    const salt = createSalt();
    const passwordHash = hashPassword(password, salt);
    if (nextPerms) {
      db.prepare(`
        UPDATE users SET
          display_name = ?, password_hash = ?, password_salt = ?,
          perm_read = ?, perm_write = ?, perm_delete = ?, perm_manage_users = ?
        WHERE id = ?
      `).run(
        nextDisplayName, passwordHash, salt,
        nextPerms.read ? 1 : 0,
        nextPerms.write ? 1 : 0,
        nextPerms.delete ? 1 : 0,
        nextPerms.manage_users ? 1 : 0,
        id,
      );
    } else {
      db.prepare(`
        UPDATE users SET display_name = ?, password_hash = ?, password_salt = ? WHERE id = ?
      `).run(nextDisplayName, passwordHash, salt, id);
    }
  } else if (nextPerms) {
    db.prepare(`
      UPDATE users SET
        display_name = ?,
        perm_read = ?, perm_write = ?, perm_delete = ?, perm_manage_users = ?
      WHERE id = ?
    `).run(
      nextDisplayName,
      nextPerms.read ? 1 : 0,
      nextPerms.write ? 1 : 0,
      nextPerms.delete ? 1 : 0,
      nextPerms.manage_users ? 1 : 0,
      id,
    );
  } else {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(nextDisplayName, id);
  }

  if (isPrimaryUser(id)) applyPrimaryUserPermissions(id);
  return findUserById(id);
}

function deleteUser(id) {
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!existing) throw new Error('User not found');
  if (isPrimaryUser(id)) throw new Error('Cannot delete the primary account');
  if (userCount() <= 1) throw new Error('Cannot delete the last user');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function deleteSessionsForUser(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function verifyPassword(user, password) {
  if (!user) return false;
  const hash = hashPassword(password, user.password_salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.password_hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createUser({ username, displayName, password, permissions, portfolios } = {}) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedDisplayName = normalizeDisplayName(displayName) || normalizedUsername;
  if (!normalizedUsername) throw new Error('Username is required');
  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (findUserByUsername(normalizedUsername)) {
    throw new Error('Username is already taken');
  }

  const perms = normalizePermissions(
    permissions,
    { read: true, write: true, delete: true, manage_users: false },
  );

  const salt = createSalt();
  const passwordHash = hashPassword(password, salt);
  const result = db.prepare(`
    INSERT INTO users (
      username, display_name, password_hash, password_salt,
      perm_read, perm_write, perm_delete, perm_manage_users
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizedUsername, normalizedDisplayName, passwordHash, salt,
    perms.read ? 1 : 0,
    perms.write ? 1 : 0,
    perms.delete ? 1 : 0,
    perms.manage_users ? 1 : 0,
  );
  const newUserId = result.lastInsertRowid;
  db.ensureUserHomePortfolio(newUserId, normalizedUsername);

  // Assign extra portfolios if provided. portfolios can be an array of IDs or objects { portfolio_id, role }
  if (portfolios) {
    const items = Array.isArray(portfolios) ? portfolios : [portfolios];
    for (const p of items) {
      let pid = null;
      let role = 'member';
      if (typeof p === 'number') pid = p;
      else if (p && typeof p === 'object') { pid = p.portfolio_id || p.id; role = p.role || 'member'; }
      if (pid != null) {
        try {
          db.prepare('INSERT OR IGNORE INTO user_portfolios (user_id, portfolio_id, role) VALUES (?, ?, ?)').run(newUserId, pid, role);
        } catch (e) {
          // ignore
        }
      }
    }
  }
  return findUserById(result.lastInsertRowid);
}

ensurePrimaryUserPermissions();

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.created_at,
           u.perm_read, u.perm_write, u.perm_delete, u.perm_manage_users
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return mapUserRow(row);
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(\S+)/i);
  if (bearer) return bearer[1];
  if (req.body && req.body.session_token) return String(req.body.session_token);
  return null;
}

function getUserFromRequest(req) {
  return getSessionUser(getSessionTokenFromRequest(req));
}

function cookieFlags() {
  // Cross-site cookies (InfinityFree page → Render API) need Secure + SameSite=None.
  // Local same-origin keeps Lax so http://localhost:3001 still works.
  if (process.env.FRONTEND_ORIGIN) return 'HttpOnly; Secure; SameSite=None; Path=/';
  return 'HttpOnly; SameSite=Lax; Path=/';
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags()}; Max-Age=${maxAge}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieFlags()}; Max-Age=0`);
}

function initialsForName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

function requirePermission(key) {
  return (req, res, next) => {
    // Determine portfolio context from body, query, or params
    const pid = req.body?.portfolio_id ?? req.query?.portfolio_id ?? req.params?.portfolio_id ?? req.params?.id ?? null;
    const portfolioId = pid != null ? Number(pid) : null;
    if (!userHasPermission(req.user, key, portfolioId)) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    next();
  };
}

function requirePrimaryUser(req, res, next) {
  if (!isPrimaryUser(req.user.id)) {
    return res.status(403).json({ error: 'Only the primary account can manage users' });
  }
  next();
}

function requireDataPermission(req, res, next) {
  const key = req.method === 'GET' ? 'read'
    : req.method === 'DELETE' ? 'delete'
      : 'write';
  return requirePermission(key)(req, res, next);
}

module.exports = {
  SESSION_COOKIE,
  parseCookies,
  needsSetup,
  createUser,
  findUserByUsername,
  findUserById,
  listUsers,
  updateUser,
  deleteUser,
  deleteSessionsForUser,
  // portfolio helpers
  // (keep direct DB access for other code that needs to query membership)
  // getUserPortfolios is available via direct DB query: db.prepare(...).all()
  userCount,
  verifyPassword,
  createSession,
  deleteSession,
  getSessionTokenFromRequest,
  getUserFromRequest,
  setSessionCookie,
  clearSessionCookie,
  initialsForName,
  requireAuth,
  requirePermission,
  requireDataPermission,
  requirePrimaryUser,
  userHasPermission,
  isPrimaryUser,
  getPrimaryUserId,
  ensurePrimaryUserPermissions,
  PERMISSION_KEYS,
  DEFAULT_PERMISSIONS,
};
