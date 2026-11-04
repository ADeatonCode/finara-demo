/**
 * FINARA DEMO — sample household, start-over, retention copy.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { getHomePortfolioId, clearPortfolioData } = require('../database');
const { seedSampleHousehold } = require('../services/demoSeed');
const { RETENTION_DAYS, RETENTION_NOTICE } = require('../services/retention');

function homePortfolio(req) {
  const fromUser = req.user.portfolios?.find(p => p.role === 'admin') || req.user.portfolios?.[0];
  if (fromUser?.id) return Number(fromUser.id);
  return getHomePortfolioId(req.user.id);
}

router.get('/info', (req, res) => {
  res.json({
    demo: true,
    notice: RETENTION_NOTICE,
    retention_days: RETENTION_DAYS,
    retention_rule: 'Each signup and its accounts, budgets, and transactions are deleted 7 days after signup.',
  });
});

router.post('/load-sample', (req, res) => {
  const pid = homePortfolio(req);
  if (!pid) return res.status(400).json({ error: 'No household found for this user.' });
  try {
    const result = seedSampleHousehold(pid);
    if (!result.loaded) return res.status(409).json(result);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/start-over', (req, res) => {
  const pid = homePortfolio(req);
  if (!pid) return res.status(400).json({ error: 'No household found for this user.' });
  try {
    clearPortfolioData(pid, req.user.id);
    res.json({ ok: true, notice: RETENTION_NOTICE });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
