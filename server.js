/**
 * FINARA DEMO — server.js
 *
 * Express + SQLite demo of Finara. Port 3001 by default so live Finara on 3000 stays up.
 * No real Plaid. No production database.
 */
const express = require('express');
const path    = require('path');
const { loadEnv } = require('./services/env');
loadEnv();

const { requireAuth, requireDataPermission } = require('./auth');
require('./database');
const { startRetentionSweep, RETENTION_NOTICE } = require('./services/retention');
const { logNotifyConfig } = require('./services/notify');

const app = express();

function hostOf(value) {
  try { return new URL(value).hostname; } catch (_) { return ''; }
}

function isInfinityFreeOrigin(origin) {
  const host = hostOf(origin);
  return (
    host.endsWith('infinityfreeapp.com') ||
    host.endsWith('infinityfree.com') ||
    host.endsWith('epizy.com')
  );
}

function isLocalOrigin(origin) {
  const host = hostOf(origin);
  return host === 'localhost' || host === '127.0.0.1';
}

// Same split as Project TODO: InfinityFree hosts the static page, Render hosts Express.
// FRONTEND_ORIGIN = the Lagoon site origin (no trailing slash). If unset, CORS stays open.
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin || '';
  const configured = String(process.env.FRONTEND_ORIGIN || '').replace(/\/+$/, '');

  let allowOrigin = '';
  if (!configured) {
    allowOrigin = requestOrigin || '*';
  } else if (!requestOrigin) {
    allowOrigin = configured;
  } else if (
    requestOrigin === configured ||
    isInfinityFreeOrigin(requestOrigin) ||
    isLocalOrigin(requestOrigin)
  ) {
    allowOrigin = requestOrigin;
  }

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    if (allowOrigin !== '*') {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/accounts', requireAuth, requireDataPermission, require('./routes/accounts'));
app.use('/api/account-types', requireAuth, requireDataPermission, require('./routes/accountTypes'));
app.use('/api/transactions', requireAuth, requireDataPermission, require('./routes/transactions'));
app.use('/api/budget', requireAuth, requireDataPermission, require('./routes/budget'));
app.use('/api/credit-score', requireAuth, requireDataPermission, require('./routes/creditScore'));
app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/preferences', requireAuth, require('./routes/preferences'));
app.use('/api/plaid', requireAuth, requireDataPermission, require('./routes/plaid'));
app.use('/api/demo', requireAuth, require('./routes/demo'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Finara Demo running at http://localhost:${PORT}`);
  console.log(RETENTION_NOTICE);
  logNotifyConfig();
  startRetentionSweep();
});
