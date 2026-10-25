# Finance Manager

A personal finance website built from `Monthly_Financial_Planner_Dynamic.xlsx`. It keeps every sheet of that workbook (Dashboard, Setup, Monthly Budget, Sinking Funds, Net Worth, Debt Tracker, Goals, Monthly Review, Research Notes) and adds receipt scanning, schedule-based earnings, transactions, bills, cash-flow forecasting, reports, and tax estimates.

There are two ways to use it:

- **Hosted (GitHub Pages):** https://iutsa.github.io/MonthlyExpenses/. Nothing to install. Your data stays in that browser (IndexedDB), and nothing is sent to GitHub. Use **Settings → Backup** to move data between devices. Receipts and schedules are read with on-device OCR, or with Claude if you paste an Anthropic key in Settings. NVIDIA keys don't work here, because NVIDIA's API blocks calls made directly from web pages.
- **Local (full version):** runs on your computer with `npm start`. Data is saved to `data/db.json`, and uploaded photos go to `data/uploads/`. AI reading works with an NVIDIA or an Anthropic key.

## Start (local)

```bash
npm install        # first time only
npm start          # then open http://localhost:3000
```

Optional, for accurate AI reading of receipts, schedules and pay stubs:

```bash
cp .env.example .env    # then set NVIDIA_API_KEY=nvapi-...  (free at build.nvidia.com)
npm start               #   or ANTHROPIC_API_KEY=sk-ant-...
```

- **NVIDIA** (used first when its key is set): `nvidia/nemotron-3.5-super-vl-120b-a12b`, falling back to `meta/llama-3.2-11b-vision-instruct` if the first is busy. Multi-page receipts and PDFs are stitched into one image first, because these models read one image per request.
- **Anthropic:** `claude-opus-5-5`, with schema-enforced output and native PDF support.
- **No key:** on-device OCR (Tesseract) plus keyword rules. Works on clear photos.

Never commit `.env`; it is git-ignored.

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

## Development

```bash
npm run dev      # restart on server changes
npm test         # unit tests for budget, debt, tax, shift, receipt and parser math
npm run build    # static GitHub Pages build into dist/
npm run preview  # build and serve dist/ at http://localhost:4173
```

Every push to `main` runs the tests, builds `dist/`, and deploys it to GitHub Pages (`.github/workflows/pages.yml`). The front end detects whether a server is present. If not, it uses `public/js/local-backend.js`, which keeps data in IndexedDB and calls the Anthropic API directly.

The front end is plain ES modules in `public/js` (one file per page in `views/`) with no build step. `calc.js` holds all the financial math. The server (`server/`) is Express with a JSON-file store. Document reading (`public/js/ai-core.js`) is shared by the server and the static build.

To open the app from your phone on the same Wi-Fi, set `HOST=0.0.0.0` in `.env`. There is no login, so only do this on a network you trust.

Tax figures are 2026 federal estimates (IRS Rev. Proc. 2025-32) with a flat state rate. They are not tax advice.
