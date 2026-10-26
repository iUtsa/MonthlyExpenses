// Pure finance calculations. Every function takes the app state (or plain data)
// and returns numbers — no DOM access — so they can be unit tested in Node.
import {
  sum, round2, addDays, addMonths, parseDate, isoDate, today, daysBetween,
  startOfWeek, daysInMonth, shiftMonth, fmtDate, monthLabel,
} from './util.js';

/* ======================================================================
   Planning periods. Paycheck mode: each period runs from a payday to the day before the
   next payday, so you plan with the money you actually have. Month mode: calendar months.
   Functions below accept a period object or a 'YYYY-MM' month string.
   ====================================================================== */
export const PLAN_FREQUENCIES = [
  { id: 'biweekly', name: 'Every 2 weeks' },
  { id: 'weekly', name: 'Every week' },
  { id: 'semimonthly', name: 'Twice a month (15th & last day)' },
];
const pad2 = (n) => String(n).padStart(2, '0');

// Every range carries `word` ('month' | 'paycheck' | 'plan') and `title` for display.
export function monthRange(month) {
  const days = daysInMonth(month);
  return { kind: 'month', key: month, from: `${month}-01`, to: `${month}-${pad2(days)}`, payday: null, nextPayday: null, paydays: [], halves: [], days, label: monthLabel(month), word: 'month', title: monthLabel(month) };
}

function payRange(from, to) {
  const label = `${fmtDate(from)} – ${fmtDate(to)}`;
  return { kind: 'period', key: `P${from}`, from, to, payday: from, nextPayday: addDays(to, 1), paydays: [from], halves: [{ from, to }], days: daysBetween(from, to) + 1, label, word: 'paycheck', title: `Paycheck · ${label}` };
}

// Two paychecks at a time: about a month, lined up with real paydays. `halves` are the two pay
// periods inside it (bills in each half are covered by that half's paycheck).
function twoPayRange(from, mid, to) {
  const label = `${fmtDate(from)} – ${fmtDate(to)}`;
  return {
    kind: 'period', key: `B${from}`, from, to, payday: from, nextPayday: addDays(to, 1), paydays: [from, mid],
    halves: [{ from, to: addDays(mid, -1) }, { from: mid, to }], days: daysBetween(from, to) + 1, label, word: 'plan', title: `2 paychecks · ${label}`,
  };
}

// A known payday: the one set in Settings, else the next payday of your first job.
export function planAnchor(s) {
  const p = s.settings.planning || {};
  if (p.payday) return p.payday;
  const job = s.jobs?.find((j) => ['biweekly', 'weekly'].includes(j.payFrequency));
  return job ? payPeriod(job, today()).payday : null;
}

export const PLAN_MODES = [
  { id: 'twopay', name: 'Two paychecks at a time (about a month)' },
  { id: 'paycheck', name: 'Each paycheck' },
  { id: 'month', name: 'Calendar month' },
];
// 'twopay' | 'paycheck' | 'month' — falls back to months until a payday is known.
export const planMode = (s) => {
  const p = s.settings.planning || {};
  if (p.mode === 'month') return 'month';
  if (!(p.frequency === 'semimonthly' || planAnchor(s))) return 'month';
  return p.mode === 'paycheck' ? 'paycheck' : 'twopay';
};

// Start of the single pay period containing `date` (used to line up two-paycheck plans).
function singlePeriodStart(s, date) {
  const p = s.settings.planning || {};
  const len = p.frequency === 'weekly' ? 7 : 14;
  const offset = ((daysBetween(planAnchor(s), date) % len) + len) % len;
  return addDays(date, -offset);
}

// Two-paycheck plans start on the payday saved in `planning.blockStart` (set the first time,
// so the current plan covers the paycheck you're on now and the next one).
export function defaultBlockStart(s) {
  if (planMode(s) !== 'twopay' || s.settings.planning?.frequency === 'semimonthly') return null;
  return singlePeriodStart(s, today());
}

export function periodFor(s, date) {
  const p = s.settings.planning || {};
  const mode = planMode(s);
  if (mode === 'month') return monthRange(date.slice(0, 7));
  if (mode === 'twopay') {
    if (p.frequency === 'semimonthly') {
      // Paid on the 15th and the last day: each plan runs 15th → 14th of next month.
      const month = date.slice(0, 7);
      const start = Number(date.slice(8)) >= 15 ? month : shiftMonth(month, -1);
      const next = shiftMonth(start, 1);
      return twoPayRange(`${start}-15`, `${start}-${pad2(daysInMonth(start))}`, `${next}-14`);
    }
    const len = p.frequency === 'weekly' ? 7 : 14;
    const anchor = p.blockStart || singlePeriodStart(s, today());
    const offset = ((daysBetween(anchor, date) % (2 * len)) + 2 * len) % (2 * len);
    const from = addDays(date, -offset);
    return twoPayRange(from, addDays(from, len), addDays(from, 2 * len - 1));
  }
  if (p.frequency === 'semimonthly') {
    const month = date.slice(0, 7);
    const mid = `${month}-15`;
    const last = `${month}-${pad2(daysInMonth(month))}`;
    if (date >= mid && date < last) return payRange(mid, addDays(last, -1));
    if (date >= last) return payRange(last, `${shiftMonth(month, 1)}-14`);
    const prev = shiftMonth(month, -1);
    return payRange(`${prev}-${pad2(daysInMonth(prev))}`, `${month}-14`);
  }
  const len = p.frequency === 'weekly' ? 7 : 14;
  const offset = ((daysBetween(planAnchor(s), date) % len) + len) % len;
  const from = addDays(date, -offset);
  return payRange(from, addDays(from, len - 1));
}

export function shiftRange(s, range, n) {
  let r = range;
  for (let i = 0; i < Math.abs(n); i++) r = r.kind === 'month' ? monthRange(shiftMonth(r.key, n > 0 ? 1 : -1)) : periodFor(s, n > 0 ? addDays(r.to, 1) : addDays(r.from, -1));
  return r;
}
export function rangesBack(s, range, count) {
  const out = [range];
  while (out.length < count) out.unshift(shiftRange(s, out[0], -1));
  return out;
}
export const asRange = (x) => (typeof x === 'string' ? monthRange(x) : x);
const inRange = (date, r) => date >= r.from && date <= r.to;

/* ======================================================================
   Allocation rules (Setup sheet)
   ====================================================================== */
export const RULES = {
  '50/30/20': { need: 0.5, want: 0.3, savings: 0.2 },
  '60/30/10': { need: 0.6, want: 0.3, savings: 0.1 },
  '70/20/10': { need: 0.7, want: 0.2, savings: 0.1 },
  '40/30/20/10': { need: 0.4, want: 0.3, savings: 0.3 }, // last 10% = giving, tracked with savings
};
export const BUCKETS = [
  { id: 'need', label: 'Needs' },
  { id: 'want', label: 'Wants' },
  { id: 'savings', label: 'Savings & Debt' },
];

export function incomeBracket(annualGross) {
  if (annualGross < 40000) return { id: 'lower', label: 'Lower (<$40k)', needs: '60–70%', savings: '5–10%', housing: '30–40%', focus: 'Emergency fund + high-interest debt', rule: '70/20/10' };
  if (annualGross < 100000) return { id: 'middle', label: 'Middle ($40k–$100k)', needs: '45–55%', savings: '10–20%', housing: '25–30%', focus: 'Balance lifestyle + consistent investing', rule: '50/30/20' };
  return { id: 'higher', label: 'Higher ($100k+)', needs: '30–40%', savings: '20–30%+', housing: '20–25%', focus: 'Aggressive wealth building, avoid lifestyle inflation', rule: '40/30/20/10' };
}

export function targets(settings) {
  if (settings.rule === 'custom') return { ...settings.customTargets, rule: 'Custom' };
  const rule = settings.rule === 'auto' ? incomeBracket(settings.annualGross).rule : settings.rule;
  return { ...(RULES[rule] || RULES['50/30/20']), rule };
}

/* ======================================================================
   Monthly budget (Monthly Budget + Dashboard sheets)
   ====================================================================== */
export const monthTx = (s, x) => { const r = asRange(x); return s.transactions.filter((t) => t.date && inRange(t.date, r)); };

export function budgetFor(s, x) {
  return s.budgets[asRange(x).key] || { income: {}, planned: {}, notes: {} };
}

// Budget lines other pages already know about. A value typed into the budget overrides these;
// clearing it returns the line to its linked value.
// Monthly amounts (sinking funds, debt payments, investing) are split by the period's length;
// bills count on the dates they're actually due.
export function linkedPlan(s, x) {
  const r = asRange(x);
  const share = r.kind === 'month' ? 1 : r.days / (365.25 / 12);
  const per = r.kind === 'month' ? 'per month' : 'this paycheck’s share';
  const income = {};
  const planned = {};
  const e = earningsForMonth(s, r);
  for (const j of e.byJob) {
    if (!j.job.sourceId || !j.paidNet) continue;
    income[j.job.sourceId] ??= { value: 0, from: 'Take-home from your shifts paid in this period' };
    income[j.job.sourceId].value += j.paidNet;
  }
  const set = (id, value, from) => { if (value > 0) planned[id] = { value: round2(value), from }; };
  set('sinking_funds', sum(s.sinkingFunds, (f) => f.monthly) * share, `Sinking-fund contributions (${per})`);
  set('min_debt', sum(s.debts.filter((d) => d.balance > 0), (d) => d.minPayment) * share, `Debt minimum payments (${per})`);
  if (s.debts.some((d) => d.balance > 0)) set('extra_debt', (s.debtStrategy?.extraMonthly || 0) * share, `Extra debt payment (${per})`);
  const inv = investmentSummary(s);
  set('retirement', inv.byBucket.retirement * share, `Retirement contributions (${per})`);
  set('investing', inv.byBucket.investing * share, `Investment contributions (${per})`);
  const byCat = {};
  for (const bill of s.bills || []) {
    if (!bill.categoryId) continue;
    const due = billOccurrences(bill, r.from, r.to).length;
    if (due) byCat[bill.categoryId] = (byCat[bill.categoryId] || 0) + due * (Number(bill.amount) || 0);
  }
  for (const [id, v] of Object.entries(byCat)) if (!planned[id]) set(id, v, 'Bills due in this period');
  for (const v of Object.values(income)) v.value = round2(v.value);
  return { income, planned };
}

export function monthSummary(s, x) {
  const range = asRange(x);
  const month = range.key;
  const b = budgetFor(s, range);
  const linked = linkedPlan(s, range);
  const pick = (manual, link) => (manual !== undefined && manual !== null && manual !== ''
    ? { planned: Number(manual) || 0, auto: null, link: link || null }
    : { planned: link?.value || 0, auto: link || null, link: link || null });
  const tx = monthTx(s, range);
  const expenses = tx.filter((t) => t.type === 'expense');
  const incomes = tx.filter((t) => t.type === 'income');
  const sourceIds = new Set(s.incomeSources.map((x) => x.id));
  const catIds = new Set(s.categories.map((c) => c.id));

  // Income with no typed or shift-based plan is planned as what actually came in.
  const income = s.incomeSources.map((src) => {
    const actual = sum(incomes.filter((t) => (sourceIds.has(t.sourceId) ? t.sourceId : 'other') === src.id), (t) => t.amount);
    const link = linked.income[src.id] || (actual > 0 ? { value: round2(actual), from: 'Money that came in this period' } : null);
    return { ...src, ...pick(b.income[src.id], link), actual };
  });

  const rows = s.categories.map((c) => {
    const items = expenses.filter((t) => t.categoryId === c.id);
    return { ...c, ...pick(b.planned[c.id], linked.planned[c.id]), actual: sum(items, (t) => t.amount), count: items.length };
  });
  const uncategorized = expenses.filter((t) => !catIds.has(t.categoryId));

  const byType = {};
  for (const bucket of BUCKETS) {
    const r = rows.filter((x) => x.type === bucket.id);
    byType[bucket.id] = { planned: sum(r, (x) => x.planned), actual: sum(r, (x) => x.actual) };
  }

  const plannedIncome = sum(income, (x) => x.planned);
  const actualIncome = sum(income, (x) => x.actual);
  const plannedExpense = sum(rows, (x) => x.planned);
  const actualExpense = sum(rows, (x) => x.actual) + sum(uncategorized, (t) => t.amount);
  const tgt = targets(s.settings);

  const allocation = BUCKETS.map((bucket) => {
    const actual = byType[bucket.id].actual;
    const base = actualIncome || plannedIncome;
    const actualPct = base ? actual / base : 0;
    const variance = actualPct - tgt[bucket.id];
    let status = Math.abs(variance) <= 0.05 ? 'On Track' : variance > 0 ? 'Over' : 'Under';
    if (bucket.id === 'savings' && status === 'Over') status = 'On Track'; // saving more than target is good
    return { ...bucket, actual, actualPct, target: tgt[bucket.id], targetAmount: plannedIncome * tgt[bucket.id], variance, status };
  });

  return {
    month, range, income, rows, uncategorized, byType, allocation, targets: tgt,
    plannedIncome, actualIncome, plannedExpense, actualExpense,
    remainingToAssign: round2(plannedIncome - plannedExpense),
    surplus: round2(actualIncome - actualExpense),
    savingsRate: actualIncome ? byType.savings.actual / actualIncome : 0,
    plannedSavingsRate: plannedIncome ? byType.savings.planned / plannedIncome : 0,
    hasPlan: plannedIncome > 0 || plannedExpense > 0,
    txCount: tx.length,
  };
}

// "Auto-fill from targets": spread each bucket's target across its categories using
// the suggested-% midpoints from the workbook, scaled so each bucket sums to its target.
export function suggestPlan(s, plannedIncome) {
  const tgt = targets(s.settings);
  const plan = {};
  for (const bucket of BUCKETS) {
    const cats = s.categories.filter((c) => c.type === bucket.id);
    const mids = sum(cats, (c) => c.mid);
    for (const c of cats) {
      plan[c.id] = mids ? round2((plannedIncome * tgt[bucket.id] * (c.mid || 0)) / mids) : 0;
    }
  }
  return plan;
}

/* ======================================================================
   Net worth & emergency fund
   ====================================================================== */
export function netWorth(s) {
  const investments = sum(s.investing?.accounts || [], (a) => a.balance);
  const assets = sum(s.netWorth.assets, (a) => a.value) + investments;
  const debtTotal = sum(s.debts, (d) => d.balance);
  const other = sum(s.netWorth.otherLiabilities, (l) => l.value);
  const liquid = sum(s.netWorth.assets.filter((a) => a.liquid), (a) => a.value);
  return { assets, investments, liabilities: debtTotal + other, debtTotal, otherLiabilities: other, net: assets - debtTotal - other, liquid };
}

export function emergencyFund(s) {
  const { liquid } = netWorth(s);
  const months = s.settings.monthlyEssentials ? liquid / s.settings.monthlyEssentials : 0;
  const status = months >= 6 ? 'Strong' : months >= 3 ? 'Building' : 'Priority';
  return { liquid, months, status, target: s.settings.monthlyEssentials * s.settings.efTargetMonths };
}

export const highInterestDebt = (s) => sum(s.debts.filter((d) => d.apr >= s.settings.highInterestApr), (d) => d.balance);

/* ======================================================================
   Debt payoff simulator (Debt Tracker sheet, projected to payoff)
   ====================================================================== */
export function orderDebts(debts, method) {
  const list = [...debts];
  if (method === 'snowball') list.sort((a, b) => a.balance - b.balance || b.apr - a.apr);
  else list.sort((a, b) => b.apr - a.apr || a.balance - b.balance);
  return list;
}

// method: 'avalanche' | 'snowball' | 'minimum'. The total monthly payment stays constant:
// when a debt is paid off its minimum "rolls over" to the next target.
export function simulateDebts(debts, { method = 'avalanche', extra = 0, maxMonths = 600 } = {}) {
  const active = debts.filter((d) => d.balance > 0.005);
  const list = orderDebts(active, method).map((d) => ({ id: d.id, name: d.name, apr: d.apr, min: Number(d.minPayment) || 0, bal: Number(d.balance), interest: 0, month: null }));
  const budget = sum(list, (d) => d.min) + (method === 'minimum' ? 0 : Number(extra) || 0);
  const timeline = [sum(list, (d) => d.bal)];
  let totalInterest = 0;
  let month = 0;

  while (list.some((d) => d.bal > 0.005) && month < maxMonths) {
    month++;
    for (const d of list) {
      if (d.bal <= 0.005) continue;
      const i = (d.bal * d.apr) / 12;
      d.bal += i; d.interest += i; totalInterest += i;
    }
    let available = budget;
    for (const d of list) {
      if (d.bal <= 0.005) continue;
      const pay = Math.min(d.min, d.bal, Math.max(0, available));
      d.bal -= pay; available -= pay;
    }
    if (method !== 'minimum') {
      for (const d of list) {
        if (available <= 0.005) break;
        if (d.bal <= 0.005) continue;
        const pay = Math.min(available, d.bal);
        d.bal -= pay; available -= pay;
      }
    }
    for (const d of list) if (d.bal <= 0.005 && d.month === null) { d.bal = 0; d.month = month; }
    timeline.push(sum(list, (d) => d.bal));
  }

  const paidOff = list.every((d) => d.month !== null);
  return {
    method, months: paidOff ? month : null, totalInterest: round2(totalInterest), timeline, paidOff,
    monthlyPayment: budget,
    payoffs: list.map((d) => ({ id: d.id, name: d.name, month: d.month, interest: round2(d.interest), date: d.month ? addMonths(today(), d.month) : null })),
  };
}

/* ======================================================================
   Goals & sinking funds
   ====================================================================== */
export function monthsUntil(dateStr, from = today()) {
  if (!dateStr) return null;
  return Math.max(0, daysBetween(from, dateStr) / 30.437);
}

export function projectSaving({ target, current, monthly, targetDate }) {
  const remaining = Math.max(0, (Number(target) || 0) - (Number(current) || 0));
  const progress = target > 0 ? Math.min(1, current / target) : 0;
  const monthsToGoal = remaining === 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null;
  const projectedDate = monthsToGoal === null ? null : addMonths(today(), monthsToGoal);
  const left = monthsUntil(targetDate);
  const requiredMonthly = targetDate && remaining > 0 ? remaining / Math.max(1, Math.ceil(left)) : 0;
  let status = 'No date';
  if (remaining === 0) status = 'Funded';
  else if (targetDate) status = monthly + 0.005 >= requiredMonthly ? 'On track' : 'Behind';
  else if (!monthly) status = 'Not funded';
  return { remaining, progress, monthsToGoal, projectedDate, requiredMonthly, status };
}

/* ======================================================================
   US federal / FICA / state tax estimate (2026 figures, IRS Rev. Proc. 2025-32)
   ====================================================================== */
export const TAX_TABLES = {
  2026: {
    standard: { single: 16100, mfj: 32200, hoh: 24150 },
    brackets: {
      single: [[12400, 0.1], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
      mfj: [[24800, 0.1], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]],
      hoh: [[17700, 0.1], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [Infinity, 0.37]],
    },
    ssRate: 0.062,
    ssWageBase: 184500,
    medicareRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { single: 200000, mfj: 250000, hoh: 200000 },
    // One Big Beautiful Bill Act deductions (tax years 2025–2028)
    overtimeCap: { single: 12500, mfj: 25000, hoh: 12500 },
    tipsCap: 25000,
    obbbaPhaseoutStart: { single: 150000, mfj: 300000, hoh: 150000 },
  },
};
export const FILING_STATUSES = [
  { id: 'single', name: 'Single' },
  { id: 'mfj', name: 'Married filing jointly' },
  { id: 'hoh', name: 'Head of household' },
];

export function bracketTax(taxable, status, year = 2026) {
  const brackets = (TAX_TABLES[year] || TAX_TABLES[2026]).brackets[status] || TAX_TABLES[2026].brackets.single;
  let tax = 0; let lower = 0; let marginal = brackets[0][1];
  for (const [upper, rate] of brackets) {
    if (taxable > lower) { tax += (Math.min(taxable, upper) - lower) * rate; marginal = rate; }
    lower = upper;
  }
  return { tax, marginal };
}

// Phase-out: deduction shrinks by $100 per $1,000 of MAGI above the threshold.
function phaseOut(amount, magi, start) {
  return Math.max(0, amount - Math.max(0, Math.ceil((magi - start) / 1000)) * 100);
}

export function annualTax({ wages = 0, tips = 0, otPremium = 0, preTax = 0, settingsTax, obbba = true }) {
  const t = TAX_TABLES[settingsTax.year] || TAX_TABLES[2026];
  const status = settingsTax.filingStatus || 'single';
  const gross = wages + tips;
  const agi = Math.max(0, gross - preTax);
  let otDeduction = 0; let tipsDeduction = 0;
  if (obbba && settingsTax.applyObbbaDeductions) {
    otDeduction = phaseOut(Math.min(otPremium, t.overtimeCap[status]), agi, t.obbbaPhaseoutStart[status]);
    tipsDeduction = phaseOut(Math.min(tips, t.tipsCap), agi, t.obbbaPhaseoutStart[status]);
  }
  const taxable = Math.max(0, agi - t.standard[status] - otDeduction - tipsDeduction);
  const { tax: federal, marginal } = bracketTax(taxable, status, settingsTax.year);
  const socialSecurity = settingsTax.ficaExempt ? 0 : t.ssRate * Math.min(gross, t.ssWageBase);
  const medicare = settingsTax.ficaExempt ? 0 : t.medicareRate * gross + t.addlMedicareRate * Math.max(0, gross - t.addlMedicareThreshold[status]);
  const state = (settingsTax.stateRate || 0) * agi;
  const local = (settingsTax.localRate || 0) * agi;
  const total = federal + socialSecurity + medicare + state + local;
  return {
    gross, preTax, agi, standardDeduction: t.standard[status], otDeduction, tipsDeduction, taxable,
    federal, socialSecurity, medicare, state, local, total, marginal,
    net: gross - preTax - total,
    effectiveRate: gross ? total / gross : 0,
  };
}

/* ======================================================================
   Shifts -> earnings (schedule upload feature)
   ====================================================================== */
export const PAY_FREQUENCIES = [
  { id: 'weekly', name: 'Weekly', perYear: 52 },
  { id: 'biweekly', name: 'Every 2 weeks', perYear: 26 },
  { id: 'semimonthly', name: 'Twice a month (15th & last day)', perYear: 24 },
  { id: 'monthly', name: 'Monthly', perYear: 12 },
];
export const periodsPerYear = (freq) => PAY_FREQUENCIES.find((f) => f.id === freq)?.perYear || 26;

const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export function shiftSpan(shift) {
  const start = toMin(shift.start);
  let end = toMin(shift.end);
  if (end <= start) end += 24 * 60; // overnight
  return { start, end, minutes: end - start };
}

export function shiftHours(shift) {
  const { minutes } = shiftSpan(shift);
  return Math.max(0, (minutes - (Number(shift.breakMin) || 0)) / 60);
}

// Hours of a shift that fall inside a differential window (e.g. nights 22:00–06:00, weekends).
// Sampled in 5-minute steps, scaled by worked/scheduled so unpaid breaks are excluded.
export function differentialHours(shift, diff) {
  const { start, end, minutes } = shiftSpan(shift);
  if (!minutes) return 0;
  const baseDay = parseDate(shift.date).getDay();
  const ws = toMin(diff.start || '00:00');
  let we = toMin(diff.end || '00:00');
  const allDay = ws === we;
  let inside = 0;
  for (let t = start; t < end; t += 5) {
    const day = (baseDay + Math.floor(t / 1440)) % 7;
    const tod = t % 1440;
    if (diff.days?.length && !diff.days.includes(day)) continue;
    const hit = allDay || (ws < we ? tod >= ws && tod < we : tod >= ws || tod < we);
    if (hit) inside += 5;
  }
  return (inside / 60) * (shiftHours(shift) / (minutes / 60));
}

// Earnings for each shift. Overtime is manual: the hours you enter on a shift (`otHours`) are paid
// at the job's overtime multiplier. Only if a job opts in (`autoOvertime`) are hours past its weekly
// (or daily) threshold counted automatically — and a shift's own OT entry still wins.
export function computeShifts(s, shifts = s.shifts) {
  const weekStartsOn = s.settings.weekStartsOn || 0;
  const sorted = [...shifts].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const weekly = new Map();
  return sorted.map((shift) => {
    const job = s.jobs.find((j) => j.id === shift.jobId);
    const rate = Number(shift.rate) || Number(job?.rate) || 0;
    const mult = Number(job?.otMultiplier) || 1.5;
    const hours = shiftHours(shift);
    let autoOt = 0;
    if (job?.autoOvertime) {
      const weeklyThr = Number(job.otWeeklyThreshold) || 0;
      const dailyThr = Number(job.dailyOtThreshold) || 0;
      const dailyOt = dailyThr ? Math.max(0, hours - dailyThr) : 0;
      const candidate = hours - dailyOt;
      const key = `${shift.jobId}|${startOfWeek(shift.date, weekStartsOn)}`;
      const before = weekly.get(key) || 0;
      weekly.set(key, before + candidate);
      autoOt = dailyOt + (weeklyThr > 0 ? Math.max(0, Math.min(candidate, before + candidate - weeklyThr)) : 0);
    }
    const manual = shift.otHours !== undefined && shift.otHours !== null && shift.otHours !== '';
    const overtime = Math.min(hours, manual ? Math.max(0, Number(shift.otHours) || 0) : autoOt);
    const regular = hours - overtime;
    const diffs = (job?.differentials || []).map((d) => {
      const h = differentialHours(shift, d);
      return { name: d.name, hours: h, pay: h * (Number(d.amount) || 0) };
    }).filter((d) => d.hours > 0);
    const diffPay = sum(diffs, (d) => d.pay);
    const tips = Number(shift.tips) || 0;
    const regularPay = regular * rate;
    const otPay = overtime * rate * mult;
    return {
      ...shift, job, rate, hours, regular, overtime, diffs, diffPay, tips, regularPay, otPay,
      otPremium: overtime * rate * (mult - 1), // used only by the optional tax calculator
      wages: regularPay + otPay + diffPay,
      gross: regularPay + otPay + diffPay + tips,
      week: startOfWeek(shift.date, weekStartsOn),
    };
  });
}

// Pay period containing `date` for a job, and the payday that settles it.
export function payPeriod(job, date) {
  const freq = job?.payFrequency || 'biweekly';
  const lag = Number(job?.payLagDays ?? 5);
  if (freq === 'semimonthly' || freq === 'monthly') {
    const month = date.slice(0, 7);
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    let start = `${month}-01`; let end = last;
    if (freq === 'semimonthly') {
      if (Number(date.slice(8)) <= 15) end = `${month}-15`; else start = `${month}-16`;
    }
    return { start, end, payday: addDays(end, lag) };
  }
  const len = freq === 'weekly' ? 7 : 14;
  // Anchor = the last day of any known pay period (defaults to a Saturday).
  const anchor = job?.periodEndAnchor || '2026-01-03';
  const offset = ((daysBetween(anchor, date) % len) + len) % len;
  const end = offset === 0 ? date : addDays(date, len - offset);
  return { start: addDays(end, -len + 1), end, payday: addDays(end, lag) };
}

// Taxes on a paycheck are whatever you set on the job — never estimated automatically.
export const TAX_MODES = [
  { id: 'none', name: 'No tax taken out (0%)' },
  { id: 'percent', name: 'My own percentages' },
  { id: 'flat', name: 'Fixed amount per paycheck' },
];
export const TAX_LINES = [
  { id: 'federal', name: 'Federal income tax' }, { id: 'state', name: 'State income tax' }, { id: 'local', name: 'Local tax' },
  { id: 'socialSecurity', name: 'Social Security' }, { id: 'medicare', name: 'Medicare' }, { id: 'other', name: 'Other' },
];

export function paycheckTaxes(s, job, { wages, tips }) {
  const gross = wages + tips;
  const preTax = gross * (Number(job?.preTaxPercent) || 0);
  const tax = job?.tax || { mode: 'none' };
  const taxes = Object.fromEntries(TAX_LINES.map((l) => [l.id, 0]));
  if (tax.mode === 'percent') {
    for (const l of TAX_LINES) taxes[l.id] = gross * (Number(tax.rates?.[l.id]) || 0);
  } else if (tax.mode === 'flat' && gross > 0) {
    taxes.other = Math.min(Math.max(0, gross - preTax), Number(tax.flat) || 0);
  }
  const total = sum(Object.values(taxes));
  return { ...taxes, preTax, gross, total, net: gross - preTax - total, source: tax.mode };
}

// Group computed shifts into paychecks. Salaried jobs produce paychecks without shifts.
export function paychecks(s, { from, to }) {
  const computed = computeShifts(s);
  const map = new Map();
  for (const c of computed) {
    if (!c.job) continue;
    const p = payPeriod(c.job, c.date);
    const key = `${c.job.id}|${p.payday}`;
    if (!map.has(key)) map.set(key, { job: c.job, ...p, shifts: [] });
    map.get(key).shifts.push(c);
  }
  for (const job of s.jobs.filter((j) => j.payType === 'salary')) {
    const periods = periodsPerYear(job.payFrequency);
    let d = addDays(from, -31);
    while (d <= addDays(to, 31)) {
      const p = payPeriod(job, d);
      const key = `${job.id}|${p.payday}`;
      if (!map.has(key)) map.set(key, { job, ...p, shifts: [], salary: (Number(job.salaryAnnual) || 0) / periods });
      d = addDays(p.end, 1);
    }
  }
  const list = [];
  for (const pc of map.values()) {
    if (pc.payday < from || pc.payday > to) continue;
    const hours = sum(pc.shifts, (x) => x.hours);
    const overtime = sum(pc.shifts, (x) => x.overtime);
    const wages = (pc.salary || 0) + sum(pc.shifts, (x) => x.wages);
    const tips = sum(pc.shifts, (x) => x.tips);
    const otPremium = sum(pc.shifts, (x) => x.otPremium);
    const taxes = paycheckTaxes(s, pc.job, { wages, tips });
    list.push({ ...pc, hours, overtime, wages, tips, otPremium, ...taxes, gross: wages + tips });
  }
  return list.sort((a, b) => a.payday.localeCompare(b.payday));
}

export function earningsForMonth(s, x) {
  const { from, to } = asRange(x);
  const shifts = computeShifts(s).filter((c) => c.date >= from && c.date <= to);
  const checks = paychecks(s, { from, to });
  const byJob = s.jobs.map((job) => {
    const js = shifts.filter((c) => c.jobId === job.id);
    const jc = checks.filter((c) => c.job.id === job.id);
    return {
      job,
      shifts: js.length,
      hours: sum(js, (c) => c.hours),
      overtime: sum(js, (c) => c.overtime),
      earned: sum(js, (c) => c.gross),
      tips: sum(js, (c) => c.tips),
      paidGross: sum(jc, (c) => c.gross),
      paidNet: sum(jc, (c) => c.net),
      paychecks: jc,
    };
  });
  return {
    shifts, paychecks: checks, byJob,
    hours: sum(shifts, (c) => c.hours),
    overtime: sum(shifts, (c) => c.overtime),
    earned: sum(shifts, (c) => c.gross),
    paidGross: sum(checks, (c) => c.gross),
    paidNet: sum(checks, (c) => c.net),
  };
}

// Projected annual tax position from all shifts/salary in a calendar year.
export function yearTaxProjection(s, year) {
  const computed = computeShifts(s).filter((c) => c.date.startsWith(String(year)));
  const salary = sum(s.jobs.filter((j) => j.payType === 'salary'), (j) => j.salaryAnnual);
  const wages = salary + sum(computed, (c) => c.wages);
  const tips = sum(computed, (c) => c.tips);
  const otPremium = sum(computed, (c) => c.otPremium);
  const preTax = s.jobs.length ? (wages + tips) * (Number(s.settings.tax.preTaxPercent) || 0) : 0;
  const withObbba = annualTax({ wages, tips, otPremium, preTax, settingsTax: s.settings.tax, obbba: true });
  const without = annualTax({ wages, tips, otPremium, preTax, settingsTax: s.settings.tax, obbba: false });
  return { wages, tips, otPremium, ...withObbba, obbbaSavings: without.total - withObbba.total };
}

/* ======================================================================
   Bills, subscriptions, cash-flow forecast
   ====================================================================== */
export const BILL_FREQUENCIES = [
  { id: 'weekly', name: 'Weekly', perMonth: 52 / 12, step: (d) => addDays(d, 7) },
  { id: 'biweekly', name: 'Every 2 weeks', perMonth: 26 / 12, step: (d) => addDays(d, 14) },
  { id: 'monthly', name: 'Monthly', perMonth: 1, step: (d) => addMonths(d, 1) },
  { id: 'quarterly', name: 'Quarterly', perMonth: 1 / 3, step: (d) => addMonths(d, 3) },
  { id: 'semiannual', name: 'Every 6 months', perMonth: 1 / 6, step: (d) => addMonths(d, 6) },
  { id: 'yearly', name: 'Yearly', perMonth: 1 / 12, step: (d) => addMonths(d, 12) },
];
const freqOf = (id) => BILL_FREQUENCIES.find((f) => f.id === id) || BILL_FREQUENCIES[2];
export const monthlyEquivalent = (bill) => (Number(bill.amount) || 0) * freqOf(bill.frequency).perMonth;

export function billOccurrences(bill, from, to) {
  const out = [];
  if (!bill.nextDue) return out;
  const f = freqOf(bill.frequency);
  let d = bill.nextDue;
  let guard = 0;
  while (d < from && guard++ < 1000) d = f.step(d);
  while (d <= to && guard++ < 2000) { out.push(d); d = f.step(d); }
  return out;
}

export function cashFlowForecast(s, days = 60) {
  const start = today();
  const end = addDays(start, days);
  const checking = s.netWorth.assets.find((a) => a.id === 'checking')?.value || 0;
  const events = [];
  for (const bill of s.bills) {
    for (const d of billOccurrences(bill, start, end)) events.push({ date: d, amount: -bill.amount, label: bill.name, kind: 'bill' });
  }
  for (const pc of paychecks(s, { from: start, to: end })) {
    events.push({ date: pc.payday, amount: pc.net, label: `${pc.job.name} pay`, kind: 'pay' });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  const series = [];
  let bal = checking; let i = 0; let low = { date: start, balance: checking };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    while (i < events.length && events[i].date === d) bal += events[i++].amount;
    series.push({ date: d, balance: bal });
    if (bal < low.balance) low = { date: d, balance: bal };
  }
  return { series, events, low, start: checking };
}

/* ======================================================================
   Financial health score & roadmap
   ====================================================================== */
export function healthScore(s, month) {
  const m = monthSummary(s, month);
  const ef = emergencyFund(s);
  const monthlyGross = (s.settings.annualGross || 0) / 12;
  const minPayments = sum(s.debts.filter((d) => d.balance > 0), (d) => d.minPayment);
  const dti = monthlyGross ? minPayments / monthlyGross : 0;
  const hi = highInterestDebt(s);
  const savingsRate = m.actualIncome ? m.savingsRate : m.plannedSavingsRate;
  const plannedRows = m.rows.filter((r) => r.planned > 0);
  const adherence = plannedRows.length ? plannedRows.filter((r) => r.actual <= r.planned * 1.05).length / plannedRows.length : 0;

  const parts = [
    { id: 'savings', label: 'Savings rate', max: 25, score: 25 * Math.min(1, savingsRate / 0.2), detail: `${(savingsRate * 100).toFixed(0)}% of income (goal 20%)` },
    { id: 'ef', label: 'Emergency fund', max: 25, score: 25 * Math.min(1, ef.months / (s.settings.efTargetMonths || 6)), detail: `${ef.months.toFixed(1)} of ${s.settings.efTargetMonths} months` },
    { id: 'dti', label: 'Debt payments vs income', max: 20, score: 20 * Math.min(1, Math.max(0, (0.4 - dti) / 0.3)), detail: `${(dti * 100).toFixed(0)}% of gross (≤10% ideal)` },
    { id: 'hi', label: 'High-interest debt', max: 15, score: 15 * (1 - Math.min(1, hi / Math.max(1, (s.settings.annualGross || 1) * 0.15))), detail: hi ? `${Math.round(hi).toLocaleString()} owed at ≥${(s.settings.highInterestApr * 100).toFixed(0)}% APR` : 'None' },
    { id: 'budget', label: 'Budget discipline', max: 15, score: 15 * adherence, detail: plannedRows.length ? `${Math.round(adherence * 100)}% of planned categories on budget` : 'No plan for this month yet' },
  ];
  const total = Math.round(sum(parts, (p) => p.score));
  const grade = total >= 80 ? 'Excellent' : total >= 60 ? 'Good' : total >= 40 ? 'Fair' : 'Needs attention';
  return { total, grade, parts };
}

export function roadmap(s, month) {
  const m = monthSummary(s, month);
  const ef = emergencyFund(s);
  const inv = investmentSummary(s);
  const savingsAsset = sum(s.netWorth.assets.filter((a) => a.liquid && a.id !== 'checking'), (a) => a.value);
  const hi = highInterestDebt(s);
  const retirement = sum(m.rows.filter((r) => r.id === 'retirement' || r.id === 'investing'), (r) => r.planned);
  const funds = s.sinkingFunds.filter((f) => f.target > 0);
  const steps = [
    { title: 'Give every dollar a job', detail: 'Plan income and expenses until Remaining to Assign is $0.', done: m.plannedIncome > 0 && Math.abs(m.remainingToAssign) < 1 },
    { title: 'Starter emergency fund of $1,000', detail: 'A small cash cushion stops surprises from becoming debt.', done: savingsAsset >= 1000 },
    { title: 'Capture the full employer 401(k) match', detail: 'An instant 50–100% return. Set the match on your 401(k) in Investments.', done: Boolean(s.settings.employerMatch) || (inv.accounts.some((a) => a.match.needed > 0) && inv.missedMatch < 1) },
    { title: 'Pay off high-interest debt', detail: `All debts at ${(s.settings.highInterestApr * 100).toFixed(0)}%+ APR.`, done: hi <= 0 },
    { title: `Full emergency fund (${s.settings.efTargetMonths} months)`, detail: 'Of essential expenses, in liquid savings.', done: ef.months >= s.settings.efTargetMonths },
    { title: 'Fund sinking funds for known costs', detail: 'Every irregular expense has a monthly contribution.', done: funds.length > 0 && funds.every((f) => f.balance >= f.target || f.monthly > 0) },
    { title: 'Invest 15%+ for retirement', detail: 'Retirement + investing lines (plus employer match) ≥ 15% of planned income.', done: m.plannedIncome > 0 && (retirement + inv.monthlyMatch) / m.plannedIncome >= 0.15 },
    { title: 'Pay off remaining debt & build wealth', detail: 'Low-interest loans, mortgage, then taxable investing.', done: s.debts.every((d) => d.balance <= 0) },
  ];
  const current = steps.findIndex((x) => !x.done);
  return { steps, current: current === -1 ? steps.length : current };
}

/* ======================================================================
   Month-end insights (Monthly Review sheet)
   ====================================================================== */
export function insights(s, x) {
  const r = asRange(x);
  const m = monthSummary(s, r);
  const prev = monthSummary(s, shiftRange(s, r, -1));
  const over = m.rows.filter((r) => r.actual > r.planned + 0.5).map((r) => ({ ...r, by: r.actual - r.planned })).sort((a, b) => b.by - a.by);
  const under = m.rows.filter((r) => r.planned > 0 && r.actual < r.planned - 0.5).map((r) => ({ ...r, by: r.planned - r.actual })).sort((a, b) => b.by - a.by);
  const subs = s.bills.filter((b) => b.subscription);
  const changes = m.rows.map((r) => {
    const p = prev.rows.find((x) => x.id === r.id)?.actual || 0;
    return { ...r, prev: p, delta: r.actual - p };
  }).filter((r) => Math.abs(r.delta) >= 50).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    summary: m, over, under, changes,
    uncategorized: m.uncategorized.length,
    subscriptionsMonthly: sum(subs, monthlyEquivalent),
    subscriptionCount: subs.length,
    incomeGap: m.plannedIncome - m.actualIncome,
  };
}

/* ======================================================================
   Keyword auto-categorization (used by imports and on-device OCR)
   ====================================================================== */
export function autoCategorize(s, text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  for (const rule of s.rules || []) {
    if (rule.match && t.includes(rule.match.toLowerCase())) return rule.categoryId;
  }
  let best = null; let bestLen = 0;
  for (const c of s.categories) {
    for (const kw of c.keywords || []) {
      const k = kw.toLowerCase();
      if (k.length > bestLen && new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) { best = c.id; bestLen = k.length; }
    }
  }
  return best;
}

export { isoDate };

/* ======================================================================
   Investments
   ====================================================================== */
export const INVESTMENT_TYPES = [
  { id: '401k', name: '401(k) / 403(b)', limit: 'k401', bucket: 'retirement', match: true },
  { id: 'roth_401k', name: 'Roth 401(k)', limit: 'k401', bucket: 'retirement', match: true },
  { id: 'trad_ira', name: 'Traditional IRA', limit: 'ira', bucket: 'retirement' },
  { id: 'roth_ira', name: 'Roth IRA', limit: 'ira', bucket: 'retirement' },
  { id: 'hsa', name: 'HSA (invested)', limit: 'hsa', bucket: 'retirement' },
  { id: 'brokerage', name: 'Brokerage (taxable)', bucket: 'investing' },
  { id: 'crypto', name: 'Crypto', bucket: 'investing' },
  { id: '529', name: '529 education', bucket: 'investing' },
  { id: 'other', name: 'Other investment', bucket: 'investing' },
];
export const ASSET_CLASSES = [
  { id: 'us_stock', name: 'US stocks' }, { id: 'intl_stock', name: 'International stocks' },
  { id: 'bonds', name: 'Bonds' }, { id: 'cash', name: 'Cash / money market' }, { id: 'other', name: 'Crypto / other' },
];
// 2026 IRS limits (employee contributions)
export const CONTRIBUTION_LIMITS = {
  2026: { k401: 24500, k401CatchUp: 8000, ira: 7500, iraCatchUp: 1100, hsaSelf: 4400, hsaFamily: 8750, hsaCatchUp: 1000 },
};
export const investmentType = (id) => INVESTMENT_TYPES.find((t) => t.id === id) || INVESTMENT_TYPES.at(-1);

export function contributionLimit(type, settings, year = 2026) {
  const L = CONTRIBUTION_LIMITS[year] || CONTRIBUTION_LIMITS[2026];
  const t = investmentType(type);
  if (t.limit === 'k401') return L.k401 + (settings.age50Plus ? L.k401CatchUp : 0);
  if (t.limit === 'ira') return L.ira + (settings.age50Plus ? L.iraCatchUp : 0);
  if (t.limit === 'hsa') return (settings.hsaCoverage === 'family' ? L.hsaFamily : L.hsaSelf) + (settings.age50Plus ? L.hsaCatchUp : 0);
  return null;
}

// Employer match: `employerMatchRate` (e.g. 0.5 = 50¢ per $1) on contributions up to
// `employerMatchUpTo` of salary (e.g. 0.06). Returns monthly figures.
export function employerMatch(account, annualSalary) {
  if (!investmentType(account.type).match || !account.employerMatchRate || !account.employerMatchUpTo) return { monthly: 0, missed: 0, needed: 0 };
  const cap = (annualSalary * account.employerMatchUpTo) / 12;
  const contrib = Number(account.monthly) || 0;
  return {
    monthly: Math.min(contrib, cap) * account.employerMatchRate,
    missed: Math.max(0, cap - contrib) * account.employerMatchRate,
    needed: cap,
  };
}

// Contributions logged this calendar year (transactions tagged with the account).
export const ytdContributions = (s, accountId, year) => sum(
  s.transactions.filter((t) => t.investmentAccountId === accountId && t.date?.startsWith(String(year)) && t.type === 'expense'), (t) => t.amount,
);

export function investmentSummary(s) {
  const accounts = s.investing?.accounts || [];
  const salary = s.settings.annualGross || 0;
  const total = sum(accounts, (a) => a.balance);
  const rows = accounts.map((a) => ({ ...a, typeInfo: investmentType(a.type), match: employerMatch(a, salary) }));
  const monthlyYou = sum(accounts, (a) => a.monthly);
  const monthlyMatch = sum(rows, (r) => r.match.monthly);
  const missedMatch = sum(rows, (r) => r.match.missed);
  const allocation = ASSET_CLASSES.map((c) => ({ ...c, value: sum(accounts, (a) => (a.balance || 0) * (a.allocation?.[c.id] || 0)) }));
  const byBucket = {
    retirement: sum(accounts.filter((a) => investmentType(a.type).bucket === 'retirement'), (a) => a.monthly),
    investing: sum(accounts.filter((a) => investmentType(a.type).bucket === 'investing'), (a) => a.monthly),
  };
  return { accounts: rows, total, monthlyYou, monthlyMatch, missedMatch, allocation, byBucket };
}

// Future value in today's dollars (real return), compounded monthly. Returns yearly points.
export function projectGrowth({ start, monthly, annualReturn, inflation = 0, years }) {
  const r = (1 + annualReturn) / (1 + inflation) - 1;
  const m = (1 + r) ** (1 / 12) - 1;
  const points = [start];
  let bal = start;
  for (let y = 1; y <= years; y++) {
    for (let k = 0; k < 12; k++) bal = bal * (1 + m) + monthly;
    points.push(bal);
  }
  return points;
}

export function retirementPlan(s) {
  const inv = investmentSummary(s);
  const st = s.investing?.settings || {};
  const years = Math.max(0, (st.retireAge || 65) - (st.currentAge || 25));
  const spending = st.retirementSpending || (s.settings.monthlyEssentials || 0) * 12 * 1.25;
  const fiNumber = spending / (st.withdrawalRate || 0.04);
  const monthly = inv.monthlyYou + inv.monthlyMatch;
  const scenarios = [0.05, st.expectedReturn || 0.07, 0.09].map((ret) => ({
    ret, points: projectGrowth({ start: inv.total, monthly, annualReturn: ret, inflation: st.inflation ?? 0.03, years }),
  }));
  const base = scenarios[1].points;
  const yearsToFI = base.findIndex((v) => v >= fiNumber);
  // Monthly amount that reaches the FI number by retirement age at the expected return.
  const r = (1 + (st.expectedReturn || 0.07)) / (1 + (st.inflation ?? 0.03)) - 1;
  const m = (1 + r) ** (1 / 12) - 1;
  const n = years * 12;
  const fvStart = inv.total * (1 + m) ** n;
  const neededMonthly = n ? Math.max(0, ((fiNumber - fvStart) * m) / ((1 + m) ** n - 1)) : 0;
  return { inv, years, spending, fiNumber, monthly, scenarios, atRetirement: base.at(-1), yearsToFI: yearsToFI < 0 ? null : yearsToFI, neededMonthly, progress: fiNumber ? inv.total / fiNumber : 0 };
}

/* ======================================================================
   Goals linked to accounts
   ====================================================================== */
// Goal links: 'asset:<id>' (Net worth row), 'sinking:<id>', 'invest:<id>', 'debts:<kind>' or 'debt:<id>'.
export function goalLinkOptions(s) {
  const kinds = [...new Set(s.debts.map((d) => d.kind))];
  return [
    { id: '', name: 'Track manually' },
    ...s.netWorth.assets.filter((a) => a.liquid).map((a) => ({ id: `asset:${a.id}`, name: `Balance: ${a.name}` })),
    ...s.sinkingFunds.map((f) => ({ id: `sinking:${f.id}`, name: `Sinking fund: ${f.name}` })),
    ...(s.investing?.accounts || []).map((a) => ({ id: `invest:${a.id}`, name: `Investment: ${a.name}` })),
    ...kinds.map((k) => ({ id: `debts:${k}`, name: `Pay off all ${k.replace(/_/g, ' ')}s` })),
    ...s.debts.map((d) => ({ id: `debt:${d.id}`, name: `Pay off ${d.name}` })),
  ];
}

export function goalCurrent(s, g) {
  const [kind, ref] = String(g.link || '').split(':');
  if (kind === 'asset') return s.netWorth.assets.find((a) => a.id === ref)?.value ?? g.current;
  if (kind === 'sinking') return s.sinkingFunds.find((f) => f.id === ref)?.balance ?? g.current;
  if (kind === 'invest') return s.investing?.accounts.find((a) => a.id === ref)?.balance ?? g.current;
  if (kind === 'debts' || kind === 'debt') {
    const owed = sum(s.debts.filter((d) => (kind === 'debt' ? d.id === ref : d.kind === ref)), (d) => d.balance);
    return Math.max(0, (g.startBalance ?? g.target) - owed);
  }
  return g.current;
}

export const goalProgress = (s, g) => projectSaving({ ...g, current: goalCurrent(s, g) });

/* ======================================================================
   This paycheck at a glance
   ====================================================================== */
const billPaid = (s, bill, date, r) => s.transactions.some((t) => t.billId === bill.id && t.date >= addDays(date, -5) && t.date <= r.to);

// "Safe to spend until next payday" = money in this period, minus what's already spent,
// minus bills still due before the next payday, minus planned savings & debt not yet made.
export function safeToSpend(s, x, asOf = today()) {
  const r = asRange(x);
  const m = monthSummary(s, r);
  const income = Math.max(m.plannedIncome, m.actualIncome);
  // Bills already paid this period (their due date has moved on) plus those still coming up.
  const paidTx = s.transactions.filter((t) => t.billId && inRange(t.date, r));
  const upcoming = (s.bills || []).flatMap((bill) => billOccurrences(bill, r.from, r.to).map((date) => ({ bill, date, amount: Number(bill.amount) || 0, paid: billPaid(s, bill, date, r) })));
  const paid = paidTx.filter((t) => !upcoming.some((u) => u.paid && u.bill.id === t.billId))
    .map((t) => ({ bill: s.bills.find((b) => b.id === t.billId) || { id: t.billId, name: t.merchant }, date: t.date, amount: t.amount, paid: true }));
  const bills = [...paid, ...upcoming].sort((a, b) => a.date.localeCompare(b.date));
  const billsLeft = sum(bills.filter((b) => !b.paid), (b) => b.amount);
  const commitments = m.rows.filter((row) => row.type === 'savings' || row.id === 'min_debt')
    .map((row) => ({ id: row.id, name: row.name, left: Math.max(0, row.planned - row.actual) })).filter((c) => c.left > 0.005);
  const committedLeft = sum(commitments, (c) => c.left);
  const safe = income - m.actualExpense - billsLeft - committedLeft;
  const start = asOf < r.from ? r.from : asOf;
  const daysLeft = asOf > r.to ? 0 : daysBetween(start, r.to) + 1;
  return {
    range: r, summary: m, income, spent: m.actualExpense, bills, billsLeft, commitments, committedLeft,
    safe: round2(safe), daysLeft, perDay: daysLeft ? round2(Math.max(0, safe) / daysLeft) : 0,
    nextPayday: r.nextPayday || addDays(r.to, 1),
  };
}

// Where money came from and where it went in a period.
export function moneyFlow(s, x) {
  const r = asRange(x);
  const tx = monthTx(s, r);
  const sourceName = (id) => s.incomeSources.find((src) => src.id === id)?.name || 'Other income';
  const group = (list, keyFn, nameFn) => {
    const map = new Map();
    for (const t of list) {
      const k = keyFn(t);
      if (!map.has(k)) map.set(k, { id: k, name: nameFn(t), total: 0, items: [] });
      const g = map.get(k);
      g.total += t.amount; g.items.push(t);
    }
    return [...map.values()].map((g) => ({ ...g, total: round2(g.total), items: g.items.sort((a, b) => b.date.localeCompare(a.date)) })).sort((a, b) => b.total - a.total);
  };
  const incoming = group(tx.filter((t) => t.type === 'income'), (t) => t.merchant || sourceName(t.sourceId), (t) => t.merchant || sourceName(t.sourceId));
  const outgoing = group(tx.filter((t) => t.type === 'expense'), (t) => t.categoryId || '__none', (t) => s.categories.find((c) => c.id === t.categoryId)?.name || 'Uncategorized');
  return { range: r, incoming, outgoing, totalIn: round2(sum(incoming, (g) => g.total)), totalOut: round2(sum(outgoing, (g) => g.total)) };
}
