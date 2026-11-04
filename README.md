# Finara Demo

A standalone sandbox of Finara you can run locally or host (for example on Render) and link from a portfolio.

This is a **demo of the real product only. Data is kept for 7 days.**

- Sign **up** and Sign **in** stay (username + password). Each visitor creates their own account and only sees their own household.
- Optional email on sign-up if they want to know when they can buy Finara for their own computer. Email is not required, and it is **not stored** on this server.
- Add real-looking accounts (your own bank names, balances, transactions) the same way as Finara.
- Optional sample household (fake banks and merchants) if you want a filled-in demo.
- Fake Plaid-style **Connect / Sync** — looks like bank linking, never calls Plaid, never needs API keys.
- **Node 22+** (built-in SQLite). Default port **3001** so a live Finara app on 3000 can keep running.

## Run locally

```bash
cd FinaraDemo
npm install
npm run dev
```

Open **http://localhost:3001**

| Script | What it does |
| --- | --- |
| `npm run dev` | Watch mode on port 3001 |
| `npm start` | Same server without watch (good for Render) |

`PORT` defaults to 3001. Do not use 3000 if real Finara is already running there.

## Host on Render + InfinityFree

Same split as Project TODO: Express on Render, static page on Lagoon. InfinityFree cannot run this Node server.

See **`INFINITYFREE.md`** for the click-path (New Web Service → GitHub → `ADeatonCode/finara-demo` → `npm install` / `npm start`) and the zip extract folder `htdocs/projects/finara-demo/`.

1. Web Service from this repo root (not a `backend/` folder).
2. Build: `npm install`
3. Start: `npm start` (`node --experimental-sqlite server.js`)
4. Render sets `PORT`. The server binds `0.0.0.0`.
5. Set `FRONTEND_ORIGIN` to your InfinityFree site origin (no path). Do **not** add Plaid secrets or `MONGO_URI`.
6. Optional: set `SMTP_*` and `NOTIFY_EMAIL` (see below) if you want opt-in notices mailed to you.

SQLite (`finara-demo.db`) is created on first boot, is gitignored, and is **ephemeral** on Render — demo data resets on deploy. That is OK for a 7-day sandbox.

## Per-user data

Sign up with a username and password (8+ characters). Email is optional and is never saved on the demo server. That signup gets its own household. Other visitors cannot see it.

You can:

- Add checking, savings, credit, and other accounts with whatever names you like
- Record transactions on an open account tab
- Import a CSV (`public/sample-import.csv` is a tiny example)

## Optional sample household

After sign-up (or from **Load sample household** in the sidebar) you can load fake data:

**Accounts:** Chime Checking, Ascend FCU Savings, Harbor Card (Demo National)

Harbor Card is a **credit card**. Purchases (Harbor Market, Copper Kettle, and so on) are debits: you owe Demo National, and the running balance goes **negative / red**. A card payment is a credit and moves the balance toward zero. Chime Checking and Ascend FCU Savings keep normal bank signs.

**Merchants:** Harbor Market, Bluebird Fuel, Copper Kettle Cafe, Northline Payroll, Willow Court Rent, Lumen Electric, Streamly, Pine & Post Pharmacy, Ascend FCU Interest

**Start over** clears only *your* demo data. Other visitors are left alone.

If you already clicked **Load sample household** before the Harbor Card credit-card fix, use **Start over**, then **Load sample household** again so the corrected seed replaces the old rows.

## Fake bank sync

On an account: **Edit → Bank Connection**

1. **Connect Bank** opens a fake picker: Chime, Ascend FCU, Demo National — not Plaid Link.
2. **Sync now** waits briefly, then inserts 3–8 new posted rows from that bank’s canned list. Dates are recent. Credits are positive, debits are negative. Harbor Card syncs purchases (debits that increase what you owe) plus an optional payment toward zero.
3. Repeat Sync only uses leftover canned ids (no flood).
4. **Disconnect** drops the fake link and **keeps** existing rows.

## Transaction cap

This demo allows **50 transactions per account** (opening-balance rows do not count). Each account tab has its own 50. Delete a row to free a slot. If you hit the limit, the app asks you to contact Alan at acdelgato@gmail.com for the full copy.

## 7-day retention

**Rule:** each signup and its accounts, budgets, and transactions are **deleted 7 days after signup** (`created_at`). Username, password, and household data still go away.

Visitor emails are **not** stored, so there is nothing extra for the sweep to keep.

The sweep runs when the server starts and about once an hour. It only touches `finara-demo.db` in this folder — never the real Finara `finara.db`.

## Launch notify email

Sign-up can take an optional email if the visitor checks **Email me when I can buy Finara for my own computer.** The checkbox starts unchecked. If they type an email but leave the box off, it is ignored.

When they opt in with a plausible address, the demo sends **one message to Alan** (`NOTIFY_EMAIL`, default `acdelgato@gmail.com`) with that address, username, and time — then forgets it. Nothing is written to the database or a file.

The app does **not** keep a list of emails and has no admin screen for them. If mail is not configured, or sending fails, the demo account is still created. The visitor sees a note that the notice did not send and they can email Alan themselves if they still want to know when Finara is for sale.

Put secrets in `FinaraDemo/.env` (gitignored) or in the host’s env vars. Example for a Gmail app password:

```
NOTIFY_EMAIL=acdelgato@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=acdelgato@gmail.com
SMTP_PASS=your-16-char-app-password
```

On Gmail: Google Account → Security → 2-Step Verification → App passwords. Do not commit `.env`.
