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

| Page | What it does |
|---|---|
| **Dashboard** | Workbook KPIs, the allocation snapshot (actual vs target with ±5% status), a 0–100 health score, spending charts, alerts, and the next 14 days of bills and paydays |
| **Transactions** | Add/edit, search and filter, bulk recategorize, bank/card CSV or Excel import (auto-categorized, duplicates skipped), CSV export. Re-categorizing a merchant teaches a rule |
| **Scan receipts** | Upload a photo or PDF, or use the phone camera. The receipt is read into line items, each item gets a budget category, and tax/tip/discounts are shared out proportionally. Saving creates one expense per category, linked to the image |
| **Monthly budget** | Zero-based plan vs actuals per category, dynamic targets, copy last month, auto-fill from targets, fill the sinking-fund and debt lines, use income projected from your schedule |
| **Income & shifts** | Jobs (hourly or salary, overtime rules, night/weekend differentials, pay schedule). Upload a schedule as an image, PDF, XLSX/CSV or `.ics` to get shifts, hours, overtime, gross pay, estimated withholding and take-home per paycheck. Also pay-stub reading and a 2026 tax estimator, including the "no tax on tips/overtime" deductions and a FICA-exempt (F-1/J-1) option |
| **Bills & cash flow** | Recurring bills and subscriptions, a due-date calendar with paydays, "mark paid", a subscription audit, and a 60-day checking-balance forecast |
| **Sinking funds** | Workbook funds plus due dates that compute the monthly amount needed, contributions and withdrawals, and sending the total to the budget |
| **Debt payoff** | Avalanche vs snowball vs minimums-only, simulated month by month with rollover: payoff dates, total interest, interest saved, a balance chart, payment logging |
| **Goals** | Progress, projected finish date, required monthly amount for a target date, and an 8-step financial roadmap that ticks itself off |
| **Net worth** | Assets (with liquid flags), liabilities pulled from Debt payoff, monthly snapshots, a trend chart |
| **Reports** | 3/6/12-month income vs expenses, needs/wants/savings by month, savings rate, top merchants, category trends, Excel export |
| **Monthly review** | The workbook checklist saved per month, with auto-computed overspending, under-spending, changes vs last month, and top-3 actions |
| **Settings** | Profile, allocation rule (incl. Auto-by-income and Custom), categories and keywords, learned rules, JSON backup/restore, import the original planner `.xlsx`, demo data, reset |

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
