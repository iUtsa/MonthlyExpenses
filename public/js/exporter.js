// Excel round-trip: export the app to a workbook laid out like the original
// Monthly_Financial_Planner_Dynamic.xlsx, and import that workbook's values back.
import { state, update, categoryName } from './store.js';
import { loadScript, today, monthLabel, round2, uid, toast, sum } from './util.js';
import {
  monthSummary, netWorth, emergencyFund, highInterestDebt, simulateDebts, projectSaving, computeShifts, monthlyEquivalent, incomeBracket,
  goalProgress, goalCurrent, investmentSummary, retirementPlan, ytdContributions,
} from './calc.js';

async function xlsx() {
  await loadScript('vendor/xlsx.full.min.js');
  return window.XLSX;
}

function sheet(X, rows, widths) {
  const ws = X.utils.aoa_to_sheet(rows);
  if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

export async function exportWorkbook(month) {
  const X = await xlsx();
  const wb = X.utils.book_new();
  const m = monthSummary(state, month);
  const nw = netWorth(state);
  const ef = emergencyFund(state);
  const s = state.settings;

  X.utils.book_append_sheet(wb, sheet(X, [
    ['DYNAMIC MONTHLY FINANCIAL PLANNER — DASHBOARD'],
    [`Exported from Finance Manager on ${today()} · ${monthLabel(month)}`],
    [],
    ['KEY PERFORMANCE INDICATORS'],
    ['Planned Income', m.plannedIncome, 'Actual Income', m.actualIncome, 'Planned Expenses', m.plannedExpense, 'Actual Expenses', m.actualExpense],
    ['Remaining to Assign', m.remainingToAssign, 'Actual Surplus/(Deficit)', m.surplus, 'Savings Rate (Actual)', round2(m.savingsRate * 100) / 100, 'Net Worth', nw.net],
    [],
    ['ALLOCATION SNAPSHOT (Actual vs Target)'],
    ['Bucket', 'Actual $', 'Actual %', 'Target %', 'Variance', 'Status'],
    ...m.allocation.map((a) => [a.label, a.actual, round2(a.actualPct * 100) / 100, a.target, round2(a.variance * 100) / 100, a.status]),
    [],
    ['QUICK HEALTH CHECK'],
    ['Emergency Fund Months Covered', round2(ef.months), ef.status],
    ['High-Interest Debt Remaining', highInterestDebt(state)],
  ], [32, 14, 24, 14, 20, 14, 16, 14]), 'Dashboard');

  X.utils.book_append_sheet(wb, sheet(X, [
    ['SETUP & ASSUMPTIONS'], [],
    ['Your Name / Household', s.name], ['Primary Location', s.location], ['Approx. Annual Gross Household Income', s.annualGross],
    ['Income Bracket (auto)', incomeBracket(s.annualGross).label], ['Monthly Essential Expenses (for EF calc)', s.monthlyEssentials], [],
    ['Choose Rule', s.rule], ['Needs Target %', m.targets.need], ['Wants Target %', m.targets.want], ['Savings & Debt Target %', m.targets.savings], [],
    ['Target Months of Essentials', s.efTargetMonths],
  ], [40, 24]), 'Setup');

  X.utils.book_append_sheet(wb, sheet(X, [
    ['MONTHLY BUDGET — Zero-Based + Adaptive Targets'],
    ['Month:', monthLabel(month)], [],
    ['INCOME (Net / Take-Home)'], ['Source', 'Planned', 'Actual'],
    ...m.income.map((i) => [i.name, i.planned, i.actual]),
    ['TOTAL INCOME', m.plannedIncome, m.actualIncome], [],
    ['EXPENSES — Every dollar has a job'], ['Category', 'Type', 'Suggested % of Income', 'Planned', 'Actual', 'Difference'],
    ...m.rows.map((r) => [r.name, { need: 'Need', want: 'Want', savings: 'Savings' }[r.type], r.suggested, r.planned, r.actual, round2(r.planned - r.actual)]),
    [],
    ['TOTALS BY TYPE', 'Planned', 'Actual', 'Difference'],
    ['Needs Total', m.byType.need.planned, m.byType.need.actual, round2(m.byType.need.planned - m.byType.need.actual)],
    ['Wants Total', m.byType.want.planned, m.byType.want.actual, round2(m.byType.want.planned - m.byType.want.actual)],
    ['Savings & Debt Total', m.byType.savings.planned, m.byType.savings.actual, round2(m.byType.savings.planned - m.byType.savings.actual)],
    ['GRAND TOTAL EXPENSES', m.plannedExpense, m.actualExpense, round2(m.plannedExpense - m.actualExpense)], [],
    ['REMAINING TO ASSIGN (Goal = $0)', m.remainingToAssign], ['ACTUAL SURPLUS / (DEFICIT)', m.surplus],
  ], [48, 12, 22, 12, 12, 12]), 'Monthly Budget');

  X.utils.book_append_sheet(wb, sheet(X, [
    ['Date', 'Type', 'Merchant', 'Category', 'Income source', 'Amount', 'Account', 'Note', 'Source'],
    ...[...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t.type, t.merchant, t.type === 'expense' ? categoryName(t.categoryId) : '', state.incomeSources.find((x) => x.id === t.sourceId)?.name || '', t.amount, t.account || '', t.note || '', t.source || 'manual']),
  ], [11, 9, 28, 40, 20, 11, 14, 36, 9]), 'Transactions');

  X.utils.book_append_sheet(wb, sheet(X, [
    ['Date', 'Merchant', 'Item', 'Qty', 'Category', 'Amount'],
    ...state.receipts.flatMap((r) => r.items.map((i) => [r.date, r.merchant, i.description, i.quantity, categoryName(i.category_id), i.amount])),
  ], [11, 24, 36, 6, 40, 11]), 'Receipt Items');

  X.utils.book_append_sheet(wb, sheet(X, [
    ['Fund Name', 'Target $', 'Current Balance', 'Monthly Contribution', 'Remaining', 'Months to Goal', 'Priority', 'Due Date', 'Notes'],
    ...state.sinkingFunds.map((f) => { const p = projectSaving({ target: f.target, current: f.balance, monthly: f.monthly, targetDate: f.dueDate }); return [f.name, f.target, f.balance, f.monthly, p.remaining, p.monthsToGoal ?? '—', f.priority, f.dueDate || '', f.notes || '']; }),
    ['TOTAL MONTHLY COMMITMENT', '', '', sum(state.sinkingFunds, (f) => f.monthly)],
  ], [40, 10, 14, 18, 11, 14, 9, 11, 20]), 'Sinking Funds');

  X.utils.book_append_sheet(wb, sheet(X, [
    ['NET WORTH SNAPSHOT', '', today()], [], ['ASSETS', 'Value', 'Liquid'],
    ...state.netWorth.assets.map((a) => [a.name, a.value, a.liquid ? 'Yes' : '']),
    ['TOTAL ASSETS', nw.assets], [], ['LIABILITIES', 'Balance'],
    ...state.debts.map((d) => [d.name, d.balance]), ...state.netWorth.otherLiabilities.map((l) => [l.name, l.value]),
    ['TOTAL LIABILITIES', nw.liabilities], [], ['NET WORTH', nw.net], [], ['HISTORY', 'Assets', 'Liabilities', 'Net worth'],
    ...state.netWorth.history.map((h) => [h.month, h.assets, h.liabilities, h.net]),
  ], [32, 14, 14, 14]), 'Net Worth');

  const sim = simulateDebts(state.debts, { method: state.debtStrategy.method, extra: state.debtStrategy.extraMonthly });
  X.utils.book_append_sheet(wb, sheet(X, [
    ['Debt Name', 'Balance', 'APR', 'Min Payment', 'Monthly Interest', 'Payoff Order', 'Projected Payoff', 'Interest Until Payoff'],
    ...state.debts.map((d) => { const i = sim.payoffs.findIndex((p) => p.id === d.id); const p = sim.payoffs[i]; return [d.name, d.balance, d.apr, d.minPayment, round2((d.balance * d.apr) / 12), i >= 0 ? i + 1 : '', p?.date || '', p?.interest ?? '']; }),
    [], ['Strategy', state.debtStrategy.method], ['Extra monthly payment', state.debtStrategy.extraMonthly], ['Months to debt-free', sim.months ?? 'Never'], ['Total interest', sim.totalInterest],
  ], [20, 11, 7, 12, 16, 13, 16, 20]), 'Debt Tracker');

  X.utils.book_append_sheet(wb, sheet(X, [
    ['Goal', 'Target $', 'Current', 'Monthly $', 'Target Date', 'Progress %', 'Projected Date', 'Required Monthly', 'Status / Next Action'],
    ...state.goals.map((g) => { const p = goalProgress(state, g); return [g.name, g.target, round2(goalCurrent(state, g)), g.monthly, g.targetDate || '', round2(p.progress * 100) / 100, p.projectedDate || '', round2(p.requiredMonthly), g.notes || p.status]; }),
  ], [36, 10, 10, 10, 12, 11, 14, 16, 30]), 'Goals');

  const inv = investmentSummary(state);
  const plan = retirementPlan(state);
  const year = Number(today().slice(0, 4));
  X.utils.book_append_sheet(wb, sheet(X, [
    ['Account', 'Type', 'Balance', 'You / month', 'Employer match / month', `${year} contributions`, 'US stocks %', 'Intl stocks %', 'Bonds %', 'Cash %', 'Other %'],
    ...inv.accounts.map((a) => [a.name, a.typeInfo.name, a.balance, a.monthly, round2(a.match.monthly), ytdContributions(state, a.id, year), ...['us_stock', 'intl_stock', 'bonds', 'cash', 'other'].map((k) => round2((a.allocation?.[k] || 0) * 100))]),
    ['TOTAL', '', inv.total, inv.monthlyYou, round2(inv.monthlyMatch)],
    [],
    ['Financial independence number', round2(plan.fiNumber)], ['Projected at retirement (today\'s $)', round2(plan.atRetirement)], ['Monthly needed to reach FI by retirement', round2(plan.neededMonthly)],
  ], [28, 20, 12, 12, 20, 18, 11, 12, 9, 8, 9]), 'Investments');

  const shifts = computeShifts(state);
  if (shifts.length) {
    X.utils.book_append_sheet(wb, sheet(X, [
      ['Date', 'Job', 'Start', 'End', 'Break (min)', 'Hours', 'Overtime hrs', 'Rate', 'Regular pay', 'OT pay', 'Differentials', 'Tips', 'Gross'],
      ...shifts.map((x) => [x.date, x.job?.name || '', x.start, x.end, x.breakMin || 0, round2(x.hours), round2(x.overtime), x.rate, round2(x.regularPay), round2(x.otPay), round2(x.diffPay), x.tips, round2(x.gross)]),
    ], [11, 20, 7, 7, 10, 7, 12, 7, 11, 9, 12, 8, 10]), 'Shifts');
  }
  if (state.bills.length) {
    X.utils.book_append_sheet(wb, sheet(X, [
      ['Bill', 'Amount', 'Frequency', 'Next Due', 'Per Month', 'Category', 'Autopay', 'Subscription'],
      ...state.bills.map((b) => [b.name, b.amount, b.frequency, b.nextDue, round2(monthlyEquivalent(b)), categoryName(b.categoryId), b.autopay ? 'Yes' : '', b.subscription ? 'Yes' : '']),
    ], [24, 10, 12, 11, 10, 36, 8, 12]), 'Bills');
  }

  X.writeFile(wb, `Financial_Planner_${month}.xlsx`);
}

// Import values from the original planner workbook (same sheet names and cell positions).
export async function importPlannerWorkbook(file, month) {
  const X = await xlsx();
  const wb = X.read(await file.arrayBuffer());
  const v = (sheetName, ref) => wb.Sheets[sheetName]?.[ref]?.v;
  const n = (sheetName, ref) => Number(v(sheetName, ref)) || 0;
  const found = [];

  if (wb.Sheets.Setup) {
    update('settings', (s) => {
      s.name = v('Setup', 'B4') || s.name;
      s.location = v('Setup', 'B5') || s.location;
      s.annualGross = n('Setup', 'B6') || s.annualGross;
      s.monthlyEssentials = n('Setup', 'B8') || s.monthlyEssentials;
      if (v('Setup', 'B11')) s.rule = String(v('Setup', 'B11'));
      s.efTargetMonths = n('Setup', 'B25') || s.efTargetMonths;
    });
    found.push('Setup');
  }
  const mb = 'Monthly Budget';
  if (wb.Sheets[mb]) {
    const byName = new Map(state.categories.map((c) => [c.name.toLowerCase(), c.id]));
    const srcByName = new Map(state.incomeSources.map((x) => [x.name.toLowerCase(), x.id]));
    const plan = { income: {}, planned: {}, notes: {} };
    const actuals = [];
    for (let r = 6; r <= 10; r++) {
      const id = srcByName.get(String(v(mb, `A${r}`) || '').toLowerCase());
      if (!id) continue;
      plan.income[id] = n(mb, `B${r}`);
      if (n(mb, `C${r}`)) actuals.push({ type: 'income', sourceId: id, amount: n(mb, `C${r}`), merchant: v(mb, `A${r}`) });
    }
    for (let r = 15; r <= 36; r++) {
      const id = byName.get(String(v(mb, `A${r}`) || '').toLowerCase());
      if (!id) continue;
      plan.planned[id] = n(mb, `D${r}`);
      if (n(mb, `E${r}`)) actuals.push({ type: 'expense', categoryId: id, amount: n(mb, `E${r}`), merchant: 'Imported actual (workbook)' });
    }
    update('budgets', (b) => { b[month] = plan; });
    if (actuals.length) {
      update('transactions', (l) => l.push(...actuals.map((a) => ({ id: uid('tx'), date: `${month}-01`, note: 'Imported from planner workbook', source: 'import', categoryId: '', sourceId: '', createdAt: new Date().toISOString(), ...a }))));
    }
    found.push(`Monthly Budget → ${monthLabel(month)}`);
  }
  if (wb.Sheets['Sinking Funds']) {
    const funds = [];
    for (let r = 5; r <= 30; r++) {
      const name = v('Sinking Funds', `A${r}`);
      if (!name || /^TOTAL/i.test(name) || /^Tip/i.test(name)) continue;
      funds.push({ id: uid('sf'), name, target: n('Sinking Funds', `B${r}`), balance: n('Sinking Funds', `C${r}`), monthly: n('Sinking Funds', `D${r}`), priority: v('Sinking Funds', `G${r}`) || 'Medium', notes: v('Sinking Funds', `H${r}`) || '', dueDate: '' });
    }
    if (funds.length) { update('sinkingFunds', () => funds); found.push('Sinking Funds'); }
  }
  if (wb.Sheets['Debt Tracker']) {
    const debts = [];
    for (let r = 5; r <= 11; r++) {
      const name = v('Debt Tracker', `A${r}`);
      if (!name || /^TOTAL/i.test(name)) continue;
      const balance = n('Debt Tracker', `B${r}`);
      if (!balance) continue;
      debts.push({ id: uid('debt'), name, kind: /card/i.test(name) ? 'credit_card' : /student/i.test(name) ? 'student_loan' : /car|auto/i.test(name) ? 'auto_loan' : 'other', balance, apr: n('Debt Tracker', `C${r}`), minPayment: n('Debt Tracker', `D${r}`), extraPayment: n('Debt Tracker', `E${r}`), notes: v('Debt Tracker', `I${r}`) || '' });
    }
    update('debts', () => debts);
    update('debtStrategy', (st) => { st.extraMonthly = sum(debts, (d) => d.extraPayment) || st.extraMonthly; });
    found.push('Debt Tracker');
  }
  if (wb.Sheets['Net Worth']) {
    const map = { 6: 'checking', 7: 'savings', 8: 'sinking', 9: 'investments', 10: 'retirement', 11: 'home_equity', 12: 'vehicles', 13: 'other_assets' };
    update('netWorth', (nwState) => {
      for (const [row, id] of Object.entries(map)) {
        const a = nwState.assets.find((x) => x.id === id);
        if (a) a.value = n('Net Worth', `B${row}`);
      }
      const mort = nwState.otherLiabilities.find((x) => x.id === 'mortgage');
      if (mort) mort.value = n('Net Worth', 'B22');
    });
    found.push('Net Worth (assets & mortgage; loans come from Debt Tracker)');
  }
  if (wb.Sheets.Goals) {
    const goals = [];
    for (let r = 4; r <= 10; r++) {
      const name = v('Goals', `A${r}`);
      if (!name) continue;
      const rawDate = String(v('Goals', `E${r}`) || '');
      const targetDate = /^\d{4}-\d{2}$/.test(rawDate) ? `${rawDate}-28` : rawDate;
      goals.push({ id: uid('goal'), name, target: n('Goals', `B${r}`), current: n('Goals', `C${r}`), monthly: n('Goals', `D${r}`), targetDate, notes: v('Goals', `G${r}`) || '' });
    }
    if (goals.length) { update('goals', () => goals); found.push('Goals'); }
  }
  toast(found.length ? `Imported: ${found.join(', ')}` : 'No planner sheets found in that file', found.length ? '' : 'bad');
  return found.length > 0;
}
