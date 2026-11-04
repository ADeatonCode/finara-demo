# Finara Demo

A standalone sandbox of Finara you can run locally or host (for example on Render) and link from a portfolio.

This is a **demo of the real product only. Data is kept for 7 days.**

- Sign **up** and Sign **in** stay. Each visitor creates their own account and only sees their own household.
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

## Host on Render

1. Web Service from this folder.
2. Build: `npm install`
3. Start: `npm start`
4. Render sets `PORT`. The server binds `0.0.0.0`.
5. No environment variables required. Do **not** add Plaid secrets.

The file `finara-demo.db` is created on first boot and is gitignored.

## Per-user data

Sign up with a username and password (8+ characters). That signup gets its own household. Other visitors cannot see it.

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

## 7-day retention

**Rule:** each signup and its accounts, budgets, and transactions are **deleted 7 days after signup** (`created_at`).

The sweep runs when the server starts and about once an hour. It only touches `finara-demo.db` in this folder — never the real Finara `finara.db`.
