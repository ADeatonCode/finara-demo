/**
 * FINARA — routes/preferences.js
 *
 * What this file does:
 * - API for per-user UI preferences (not financial data).
 * - Stores transaction account tab order per signed-in user.
 *
 * Read FILES.md for a simple guide to every file.
 */
const express = require('express');
const router = express.Router();
const { getTxnTabOrder, setTxnTabOrder } = require('../database');

/* GET /api/preferences/txn-tab-order */
router.get('/txn-tab-order', (req, res) => {
  res.json({ order: getTxnTabOrder(req.user.id) });
});

/* PUT /api/preferences/txn-tab-order */
router.put('/txn-tab-order', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order must be an array of account ids' });
  }
  const saved = setTxnTabOrder(req.user.id, order);
  res.json({ order: saved });
});

module.exports = router;
