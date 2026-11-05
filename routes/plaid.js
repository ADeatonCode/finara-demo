/**
 * FINARA DEMO — fake bank connection routes.
 * Same Connect / Sync / Disconnect UX as Finara, without a real SimpleFIN token.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { userHasPermission } = require('../auth');
const {
  getPlaidPublicStatus,
  createLinkToken,
  exchangePublicToken,
  selectPlaidAccount,
  syncAccount,
  disconnectAccount,
  listDemoInstitutions,
} = require('../services/plaidSync');

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

function sendPlaidError(res, err) {
  const code = err?.code || '';
  const status = 400;
  const body = {
    error: err?.message || 'Demo bank request failed',
    needs_reauth: false,
    demo: true,
  };
  if (Array.isArray(err?.accounts)) body.accounts = err.accounts;
  if (code) body.code = code;
  return res.status(status).json(body);
}

router.get('/status', (req, res) => {
  const accountId = req.query.account_id;
  if (accountId == null || accountId === '') {
    return res.json(getPlaidPublicStatus(null));
  }
  const loaded = loadAccountForUser(req, accountId);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
  res.json(getPlaidPublicStatus(loaded.acct.id));
});

router.get('/institutions', (req, res) => {
  res.json({ institutions: listDemoInstitutions(), demo: true });
});

router.post('/link-token', async (req, res) => {
  const loaded = requireAccountWrite(req, req.body?.account_id);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
  const link_token = await createLinkToken();
  res.json({
    link_token,
    env: 'demo',
    demo: true,
    institutions: listDemoInstitutions(),
  });
});

router.post('/exchange', async (req, res) => {
  const loaded = requireAccountWrite(req, req.body?.account_id);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
  try {
    const result = await exchangePublicToken({
      accountId: loaded.acct.id,
      publicToken: req.body?.public_token || '',
      plaidAccountId: req.body?.plaid_account_id || null,
      institutionName: req.body?.institution_name || '',
      institutionId: req.body?.institution_id || '',
    });
    res.json({ ...result, sync: null });
  } catch (err) {
    sendPlaidError(res, err);
  }
});

router.post('/select-account', async (req, res) => {
  const loaded = requireAccountWrite(req, req.body?.account_id);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
  const plaidAccountId = String(req.body?.plaid_account_id || '').trim();
  if (!plaidAccountId) return res.status(400).json({ error: 'plaid_account_id is required' });
  try {
    const status = selectPlaidAccount({
      accountId: loaded.acct.id,
      plaidAccountId,
    });
    res.json({ ...status, sync: null });
  } catch (err) {
    sendPlaidError(res, err);
  }
});

router.post('/sync', async (req, res) => {
  const loaded = requireAccountWrite(req, req.body?.account_id);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
  try {
    const result = await syncAccount(loaded.acct.id);
    res.json({ ...getPlaidPublicStatus(loaded.acct.id), ...result });
  } catch (err) {
    sendPlaidError(res, err);
  }
});

router.post('/disconnect', async (req, res) => {
  const loaded = requireAccountWrite(req, req.body?.account_id);
  if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
  try {
    const status = await disconnectAccount(loaded.acct.id);
    res.json(status);
  } catch (err) {
    sendPlaidError(res, err);
  }
});

module.exports = router;
