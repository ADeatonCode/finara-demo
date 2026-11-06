/**
 * Where the demo page finds its API server.
 * Empty means "same website" (local npm run dev, or the Render URL itself).
 * The InfinityFree zip sets this to the Render API address so the static page
 * can still talk to the Node server. Never put passwords in this file.
 */
/* Empty = same origin (local `npm run dev`, or visiting the Render URL).
   The InfinityFree zip overwrites this with the Render API URL. */
window.FINARA_API = window.FINARA_API || '';
