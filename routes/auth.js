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
  getSessionTokenFromRequest,
  setSessionCookie,
  clearSessionCookie,
  getPrimaryUserId,
} = require('../auth');
const { RETENTION_DAYS, RETENTION_NOTICE, PRIVACY_NOTICE } = require('../services/retention');
const { assertNotifyPayload, sendLaunchNotify } = require('../services/notify');

const DEMO_META = {
  demo: true,
  notice: RETENTION_NOTICE,
  privacy_notice: PRIVACY_NOTICE,
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

async function registerDemoUser(req, res) {
  const { username, display_name, password, email, notify_when_available } = req.body;
  try {
    const notifyEmail = assertNotifyPayload({
      email,
      notifyWhenAvailable: notify_when_available,
    });
    const user = createUser({
      username,
      displayName: display_name,
      password,
    });
    let notify_requested = false;
    let notify_sent = false;
    if (notifyEmail) {
      notify_requested = true;
      try {
        const result = await sendLaunchNotify({
          email: notifyEmail,
          username: user.username,
        });
        notify_sent = !!result.sent;
      } catch (err) {
        console.error('Launch notify failed.');
        notify_sent = false;
      }
    }
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({
      user,
      session_token: token,
      primary_user_id: getPrimaryUserId(),
      notify_requested,
      notify_sent,
      ...DEMO_META,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

router.post('/register', registerDemoUser);

router.post('/setup', registerDemoUser);

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({
    user: findUserById(user.id),
    session_token: token,
    primary_user_id: getPrimaryUserId(),
    ...DEMO_META,
  });
});

router.post('/logout', (req, res) => {
  deleteSession(getSessionTokenFromRequest(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user, primary_user_id: getPrimaryUserId(), ...DEMO_META });
});

module.exports = router;
