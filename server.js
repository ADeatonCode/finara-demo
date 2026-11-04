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

const app = express();

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
  startRetentionSweep();
});
