/**
 * FINARA DEMO — services/creditSync.js
 *
 * Credit bureau auto-sync is disabled in the demo. No API keys, no outbound calls.
 */
const BUREAUS = ['experian', 'equifax', 'transunion'];

const BUREAU_LABELS = {
  experian: 'Experian',
  equifax: 'Equifax',
  transunion: 'TransUnion',
};

const ENV_KEYS = {
  experian: 'EXPERIAN_API_KEY',
  equifax: 'EQUIFAX_API_KEY',
  transunion: 'TRANSUNION_API_KEY',
};

function bureauLabel(bureau) {
  return BUREAU_LABELS[bureau] || bureau;
}

function isValidBureau(bureau) {
  return BUREAUS.includes(bureau);
}

async function syncBureau(bureau) {
  if (!isValidBureau(bureau)) {
    return { ok: false, status: 'error', error: 'Unknown credit bureau.' };
  }
  return {
    ok: false,
    status: 'error',
    error: 'Credit bureau sync is disabled in this demo of the real product.',
  };
}

module.exports = {
  BUREAUS,
  BUREAU_LABELS,
  ENV_KEYS,
  bureauLabel,
  isValidBureau,
  syncBureau,
};
