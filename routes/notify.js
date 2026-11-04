/**
 * FINARA DEMO — one-time launch notify from the in-app banner.
 * Visitor email is mailed to Alan and not stored.
 */
const express = require('express');
const router = express.Router();
const { assertNotifyPayload, sendLaunchNotify } = require('../services/notify');

router.post('/', async (req, res) => {
  try {
    const notifyEmail = assertNotifyPayload({
      email: req.body?.email,
      notifyWhenAvailable: true,
    });
    let notify_sent = false;
    try {
      const result = await sendLaunchNotify({
        email: notifyEmail,
        username: req.user?.username,
      });
      notify_sent = !!result.sent;
    } catch (err) {
      console.error('Launch notify failed.');
      notify_sent = false;
    }
    res.json({
      notify_requested: true,
      notify_sent,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
