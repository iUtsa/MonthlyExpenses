# Finance Manager

A personal finance website built from `Monthly_Financial_Planner_Dynamic.xlsx`. It keeps every sheet of that workbook (Dashboard, Setup, Monthly Budget, Sinking Funds, Net Worth, Debt Tracker, Goals, Monthly Review, Research Notes) and adds receipt scanning, schedule-based earnings, transactions, bills, cash-flow forecasting, reports, and tax estimates.

Anyone can create an account. Each person's budgets, transactions, shifts and uploaded photos are private to their account.

## Use it online

**https://monthly-expenses-maqc.onrender.com** runs on Render, with the database on Neon (free Postgres). The old GitHub Pages address redirects there. See **Deploying** below.

## Run it on your computer

```bash
npm install        # first time only
npm start          # then open http://localhost:3000 and create your account
```

Locally the data lives in an embedded Postgres under `data/pglite`, so there's nothing to install. The first account created on a fresh install becomes the site owner, and it imports any data from the earlier single-user version (`data/db.json`).

For AI reading of receipts, schedules and pay stubs, put a key in `.env` (copy `.env.example`):

- `NVIDIA_API_KEY=nvapi-…`, free at build.nvidia.com. The models are Nemotron 3.5 VL, falling back to Llama 3.2 Vision. Multi-page uploads are stitched into one image.
- Or `ANTHROPIC_API_KEY=sk-ant-…` for Claude.

Without a key, on-device OCR (Tesseract) is used. Never commit `.env`; git ignores it.

### Accounts and limits

- Passwords are stored as scrypt hashes. Sessions are random tokens in HttpOnly, SameSite cookies, and only a hash of each token is stored. Sign-in attempts are rate-limited, and requests from other sites are rejected.
- Everyone shares the site's AI key, with a cap of `AI_DAILY_LIMIT` reads per person per day (default 25). The site owner (`ADMIN_EMAIL`, or the first account) is unlimited. Once the cap is hit, reading falls back to on-device OCR.
- Each account gets `USER_STORAGE_MB` (default 100) for uploaded photos.
- Forgotten password: there's no email service, so the site owner resets it:
  `DATABASE_URL=… npm run reset-password -- someone@example.com "new password"`
- Anyone can delete their own account from Settings, which erases all their data.

### Taxes and overtime are yours to set

Nothing is estimated behind your back:

- **Taxes:** each job's paycheck tax is "No tax (0%)" by default. You can switch it to your own percentages (federal, state, local, Social Security, Medicare, other) or a fixed amount per paycheck. A pay stub can fill in the percentages, but only when you click to use them.
- **Overtime:** you enter overtime hours per shift. Automatic "after X hours per week" overtime is an opt-in setting on the job.
- The Tax calculator tab is a planning tool only; it never changes paychecks.

## Planned paycheck by paycheck

Paid every two weeks? Everything runs on pay periods. Each period goes from a payday to the day before the next one, so you plan with the money you actually have.

- **‹ Paycheck · Oct 16 – Oct 29 ›** at the top steps from paycheck to paycheck, and **Today** jumps back.
- **Home** answers the everyday questions:
  - how much is safe to spend until the next payday (and per day)
  - this paycheck's pay
  - bills due before the next payday (paid or still owed)
  - planned vs. spent
  - **where money came from** and **where it went**, with each line expanding to its transactions
- **Bills** count in the paycheck they're actually due in. Monthly amounts (sinking funds, debt payments, investing) are split by the paycheck's length.
- Budget, transactions, income, reports and review all follow the selected paycheck.
- Settings → **Plan my money by** switches to weekly, twice-a-month (15th and last day), or calendar months.

## What's inside

The sidebar has eight sections. Related pages sit as tabs at the top of each one, and **+ Add** (top right) scans a receipt, uploads a schedule, or adds a transaction from any page.

| Section | What it does |
|---|---|
| **Home** | Drop a receipt or work schedule straight onto the page; upcoming shifts and next payday; workbook KPIs, allocation vs target, 0–100 health score, alerts |
| **Spending** | Transactions (search, bulk edit, bank CSV/Excel import, learned merchant rules) and receipt scanning: each item is categorized, and tax/tip are split proportionally into one expense per category |
| **Income & shifts** | Upload a schedule (screenshot, photo, PDF, XLSX/CSV, .ics). It finds **your** shifts by name, works out hours, overtime, differentials and tips, then shows each paycheck's taxes and take-home. Also pay stubs and a 2026 tax estimator |
| **Budget & bills** | Zero-based monthly budget and recurring bills, with a 60-day cash-flow forecast |
| **Save & invest** | Investments (401(k)/IRA/HSA/brokerage, employer match, 2026 limits, growth projection, FI number, allocation), goals, sinking funds, net worth |
| **Debt** | Avalanche vs snowball vs minimums, simulated to payoff |
| **Insights** | Reports, monthly review checklist, research notes |

### How it's linked

- **Shifts → paychecks → income → budget.** Each payday is added to income automatically as an estimate. Confirming it, uploading the pay stub, or importing the bank deposit replaces the estimate. Planned income for the month follows your schedule.
- **Budget lines fill themselves** from the page that owns the number: bills, sinking-fund contributions, debt minimums and extra payment, and retirement/investing contributions. Typing a value overrides a line; ↺ links it again.
- **Goals track real balances.** The emergency fund follows your savings, "Pay off credit cards" follows your card balances, and the vacation goal follows its sinking fund.
- **Net worth** pulls loans from Debt and investments from Save & invest. This month's snapshot updates itself.

### Reading your work schedule

The app transcribes everyone on the roster, then picks out your rows in code by name ("Arnab", "Arnab Das", "A. Das"). Names that only look alike, like "Arnav", never match. Steps:

1. On-device OCR text is passed to the model as a cross-check.
2. The model (NVIDIA Nemotron 3.5 VL) reads the schedule three times independently (one reasoning pass and two fast ones). The readings are merged, and each shift shows how many readings agreed.
3. Times like "1-5" or "3-11" are converted with fixed shift-schedule rules, not guessed.
4. Shifts only one reading saw are marked **check**. Likely column slips are marked **misread?** and start unchecked.
5. Your picture sits next to a day-by-day strip of your week, so a miss is easy to spot. **+ Add a shift it missed** covers anything left over.
6. Re-uploading a changed week replaces that week's shifts instead of duplicating them.

Tested on five realistic schedules: a 6-person weekly grid with a look-alike name, a dense 2-week grid, a dark phone screenshot, a day-column roster, and a tilted, blurred paper photo. Over 20 uploads, all 112 of Arnab's shifts were found. In the final configuration, every upload came out exactly right with no extra shifts. Each single reading made occasional mistakes (about 96% accurate); combining three is what makes it reliable. Expect 20–120 seconds per schedule on NVIDIA's free tier.

## Fixed from the workbook

- The "Totals by type" actual column was shifted by one row: Wants summed Needs, and Savings summed Wants.
- The Dashboard referenced a Transactions sheet that didn't exist.
- Net Worth liabilities disagreed with the Debt Tracker. Loans now live in one place.
- The Debt Tracker only projected one month ahead.

## Deploying (Render + Neon)

1. **Database:** create a free project at neon.tech and copy its connection string (`postgresql://…?sslmode=require`).
2. **App:** open https://render.com/deploy?repo=https://github.com/iUtsa/MonthlyExpenses and sign in with GitHub. Render reads `render.yaml` and asks for:
   - `DATABASE_URL`: the Neon connection string
   - `NVIDIA_API_KEY`: the shared AI key
   - `ADMIN_EMAIL`: the site owner's email (unlimited AI reads)
3. Click **Apply**. Every push to `main` redeploys, and a deploy only goes out if the tests pass.

Render's free plan sleeps after 15 minutes idle, so the first visit afterwards takes about 30–50 seconds to wake up.

## Development

```bash
npm run dev      # restart on server changes
npm test         # unit tests (money math, parsers) + server tests (accounts, isolation, limits)
npm run build    # optional browser-only build into dist/ (no accounts; data stays in the browser)
```

The front end is plain ES modules in `public/js` (one file per page in `views/`) with no build step. `calc.js` holds the financial math. The server is in `server/`: `app.js` (routes), `auth.js` (accounts), `store.js` (Postgres/PGlite) and `ai.js` (document reading, sharing `public/js/ai-core.js` with the browser build).
