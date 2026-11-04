/**
 * FINARA DEMO — sign in, sign up, status. Visitors always create their own account.
 */
const express = require('express');
const router = express.Router();
const {
  needsSetup,
  createUser,
  findUserByUsername,
  findUserById,
  verifyPassword,
  createSession,
  deleteSession,
  getUserFromRequest,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE,
  getPrimaryUserId,
} = require('../auth');
const { RETENTION_DAYS, RETENTION_NOTICE } = require('../services/retention');

const DEMO_META = {
  demo: true,
  notice: RETENTION_NOTICE,
  retention_days: RETENTION_DAYS,
};

router.get('/status', (req, res) => {
  const user = getUserFromRequest(req);
  res.json({
    authenticated: !!user,
    needsSetup: needsSetup(),
    user: user || null,
    primary_user_id: getPrimaryUserId(),
    ...DEMO_META,
  });
});

router.post('/register', (req, res) => {
  const { username, display_name, password } = req.body;
  try {
    const user = createUser({
      username,
      displayName: display_name,
      password,
    });
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user, primary_user_id: getPrimaryUserId(), ...DEMO_META });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/setup', (req, res) => {
  const { username, display_name, password } = req.body;
  try {
    const user = createUser({
      username,
      displayName: display_name,
      password,
    });
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user, primary_user_id: getPrimaryUserId(), ...DEMO_META });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: findUserById(user.id), primary_user_id: getPrimaryUserId(), ...DEMO_META });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  deleteSession(cookies[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user, primary_user_id: getPrimaryUserId(), ...DEMO_META });
});

module.exports = router;
