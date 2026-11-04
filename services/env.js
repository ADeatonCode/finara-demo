/**
 * FINARA DEMO — services/env.js
 *
 * Loads optional .env values from this demo folder only.
 * Never reads the real Finara .env or Plaid secrets from a parent directory.
 */
const fs = require('fs');
const path = require('path');

function parseEnvFile(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] != null && String(process.env[key]) !== '') continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function loadEnv() {
  const candidate = path.resolve(path.join(__dirname, '..', '.env'));
  try {
    parseEnvFile(fs.readFileSync(candidate, 'utf8'));
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      console.error('Could not read demo .env file');
    }
  }
}

module.exports = { loadEnv };
