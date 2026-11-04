/**
 * FINARA DEMO — one-time launch notify email to Alan.
 *
 * Visitor emails are not stored. If they opt in with a plausible address,
 * we send a message to NOTIFY_EMAIL and forget it. No waitlist table, no
 * user.email column, no file on disk.
 */
const nodemailer = require('nodemailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_NOTIFY_EMAIL = 'acdelgato@gmail.com';
const SEND_TIMEOUT_MS = 10000;

function isTruthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isPlausibleEmail(value) {
  const email = normalizeEmail(value);
  return email.length > 3 && email.length <= 254 && EMAIL_RE.test(email);
}

function notifyRecipient() {
  const raw = String(process.env.NOTIFY_EMAIL || '').trim();
  return isPlausibleEmail(raw) ? normalizeEmail(raw) : DEFAULT_NOTIFY_EMAIL;
}

function mailConfigured() {
  return Boolean(
    String(process.env.SMTP_HOST || '').trim()
    && String(process.env.SMTP_USER || '').trim()
    && String(process.env.SMTP_PASS || '').trim()
  );
}

/**
 * If opted in, return a normalized email or throw. If not opted in, return
 * null and ignore whatever was typed in the email field.
 */
function assertNotifyPayload({ email, notifyWhenAvailable } = {}) {
  if (!isTruthy(notifyWhenAvailable)) return null;
  if (!isPlausibleEmail(email)) {
    throw new Error('Enter a valid email address to be notified.');
  }
  return normalizeEmail(email);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Mail timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function sendLaunchNotify({ email, username } = {}) {
  if (!mailConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: String(process.env.SMTP_HOST).trim(),
    port,
    secure: port === 465,
    auth: {
      user: String(process.env.SMTP_USER).trim(),
      pass: String(process.env.SMTP_PASS),
    },
  });

  const visitor = normalizeEmail(email);
  const name = String(username || '').trim() || '(none)';
  const when = new Date().toISOString();

  await withTimeout(transporter.sendMail({
    from: String(process.env.SMTP_USER).trim(),
    to: notifyRecipient(),
    subject: 'Finara Demo — someone wants to buy Finara for their own computer',
    text: [
      'Someone opted in on the Finara demo to hear when they can buy Finara for their own computer.',
      '',
      `Visitor email: ${visitor}`,
      `Username: ${name}`,
      `Time (UTC): ${when}`,
      '',
      'This address was not saved on the demo server.',
    ].join('\n'),
  }), SEND_TIMEOUT_MS);

  return { sent: true };
}

function logNotifyConfig() {
  if (mailConfigured()) {
    console.log(`Launch notify email is enabled (to ${notifyRecipient()}).`);
  } else {
    console.log('Launch notify email is off until SMTP_HOST, SMTP_USER, and SMTP_PASS are set.');
  }
}

module.exports = {
  assertNotifyPayload,
  sendLaunchNotify,
  mailConfigured,
  logNotifyConfig,
};
