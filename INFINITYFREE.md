# Deploy Finara Demo to InfinityFree + Render

Same split as Project TODO: **static page on Lagoon**, **Express API on Render**. InfinityFree cannot run Node, SQLite, or `npm start`. Do **not** upload `server.js` or `node_modules` to Lagoon.

Do **not** replace the Lagoon root `htdocs/index.html` — that is the portfolio. Extract only into the project folder.

## 1. Render (backend)

Create a **Web Service** from GitHub, the same click-path as TODO:

1. Open [https://dashboard.render.com](https://dashboard.render.com)
2. **New +** → **Web Service** (not a Static Site)
3. Connect **GitHub** (not GitLab / Bitbucket / Cursor Origin)
4. Repo: **`ADeatonCode/finara-demo`** (private — authorize Render if it does not appear)
5. Leave **Root Directory** blank (this repo is Express at the root, not a `backend/` folder)
6. Type the same commands you used for TODO:

   | Field | Value |
   | --- | --- |
   | Build command | `npm install` |
   | Start command | `npm start` |

   `npm start` is already `node --experimental-sqlite server.js` in `package.json`. `--experimental-sqlite` is required (Node 22+). Render sets `PORT`; the server binds `0.0.0.0`.
7. **Do not** set `MONGO_URI`. This app is SQLite (`finara-demo.db` on the box). That disk is **ephemeral** — demo data resets on each deploy or when the free instance sleeps and is replaced. That is OK for a 7-day / 50-transaction sandbox.
8. Environment:

   | Key | Value |
   | --- | --- |
   | `FRONTEND_ORIGIN` | `https://acdelgato.infinityfreeapp.com` — InfinityFree **origin only**, no trailing slash, no `/projects/finara-demo/` |
   | `PORT` | leave to Render |
   | `NOTIFY_EMAIL` / `SMTP_*` | optional; only if you want launch-notify mail |

   Example origin: `https://acdelgato.infinityfreeapp.com` (the site itself + `/projects/finara-demo/` is the page URL, not the CORS origin).
9. Create the service. Suggested name: **`finara-demo`** so the URL is `https://finara-demo.onrender.com`. If Render assigns a different name, edit `config.js` in the zip (step 2).
10. First hit after sleep can take 30–60 seconds. Success logs look like `Finara Demo running at http://localhost:…`, not a Vite build.

Blueprint: repo-root `render.yaml` is the same Web Service (no `rootDir`, start `npm start`). If logs say Vite or “static site”, delete it and create a **Web Service** with a blank Root Directory.

## 2. InfinityFree zip (frontend only)

Ready zip: `finara-demo-infinityfree.zip` (files at the zip root).

1. Extract the **contents** of the zip (not a wrapping folder) into:

   **`htdocs/projects/finara-demo/`**

   Public path: `/projects/finara-demo/`
2. Confirm these files are in that folder:

   - `index.html` — demo UI
   - `config.js` — API base URL
   - `.htaccess` — HTTPS + SPA rewrites under `/projects/finara-demo/`
   - `sample-import.csv` — optional CSV example
3. Open `config.js` and set the Render URL if your service name is not `finara-demo`:

   ```js
   window.FINARA_API = 'https://finara-demo.onrender.com';
   ```

   No trailing slash. After you change it, re-upload that one file.
4. Do **not** replace `htdocs/index.html`.

## 3. Check CORS + API

1. Open `https://YOUR-SITE.infinityfreeapp.com/projects/finara-demo/`
2. Sign up, then add an account or load the sample household.
3. If the browser blocks requests, `FRONTEND_ORIGIN` on Render must match the site origin exactly (`https://acdelgato.infinityfreeapp.com`, no path).
4. Visitors get a **7-day** sandbox and a **50-transaction** cap per account. Optional launch-notify email is mailed to you and **not stored**.
5. **`Failed to fetch` / could not fetch:** open `https://finara-demo.onrender.com/api/health`. If the response is `404` with `x-render-routing: no-server`, the Web Service was never created — do step 1. A sleeping free instance wakes in 30–60s; a working API returns `{"ok":true}`.

## 4. Local work

Leave `public/config.js` as `window.FINARA_API = ''` so `npm run dev` on port **3001** talks to the same Express process. Do not use port 3000 if live Finara is already there. Leave `FRONTEND_ORIGIN` unset locally.
