import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../server/seed.js';
import {
  monthSummary, simulateDebts, bracketTax, annualTax, computeShifts, payPeriod, paychecks,
  differentialHours, projectSaving, autoCategorize, suggestPlan, billOccurrences, emergencyFund, netWorth,
} from '../public/js/calc.js';
import { splitByCategory } from '../public/js/receipt-math.js';
import { parseAnyDate, parseTime, parseScheduleText, parseReceiptText, parseICS } from '../public/js/parse.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('monthly summary buckets actuals by type (fixes the workbook off-by-one)', () => {
  const s = createSeed();
  s.sinkingFunds = []; s.debts = []; s.investing.accounts = []; // no linked lines in this test
  s.budgets['2026-10'] = { income: { salary: 4000 }, planned: { housing: 1200, dining: 200, retirement: 300 }, notes: {} };
  s.transactions = [
    { id: '1', type: 'expense', date: '2026-10-02', amount: 1200, categoryId: 'housing' },
    { id: '2', type: 'expense', date: '2026-10-05', amount: 250, categoryId: 'dining' },
    { id: '3', type: 'expense', date: '2026-10-06', amount: 300, categoryId: 'retirement' },
    { id: '4', type: 'income', date: '2026-10-15', amount: 4000, sourceId: 'salary' },
    { id: '5', type: 'transfer', date: '2026-10-15', amount: 999 },
    { id: '6', type: 'expense', date: '2026-11-01', amount: 50, categoryId: 'dining' },
  ];
  const m = monthSummary(s, '2026-10');
  assert.equal(m.byType.need.actual, 1200);
  assert.equal(m.byType.want.actual, 250);
  assert.equal(m.byType.savings.actual, 300);
  assert.equal(m.actualExpense, 1750);
  assert.equal(m.remainingToAssign, 4000 - 1700);
  assert.equal(m.surplus, 2250);
  close(m.savingsRate, 0.075);
  assert.equal(m.allocation.find((a) => a.id === 'want').status, 'Under'); // 6.25% vs 30% target
});

test('budget lines link to sinking funds, debts, investments and bills; typed values override', () => {
  const s = createSeed();
  s.investing.accounts[0].monthly = 250; // 401(k)
  s.bills = [{ id: 'b', name: 'Rent', amount: 1450, categoryId: 'housing', frequency: 'monthly', nextDue: '2026-10-01' }];
  s.budgets['2026-10'] = { income: {}, planned: { min_debt: 600 }, notes: {} };
  const m = monthSummary(s, '2026-10');
  const row = (id) => m.rows.find((r) => r.id === id);
  assert.equal(row('sinking_funds').planned, 1225);
  assert.ok(row('sinking_funds').auto);
  assert.equal(row('min_debt').planned, 600); // typed value wins
  assert.equal(row('min_debt').auto, null);
  assert.equal(row('extra_debt').planned, 200);
  assert.equal(row('retirement').planned, 250);
  assert.equal(row('housing').planned, 1450);
});

test('emergency fund months use liquid assets like the workbook formula', () => {
  const s = createSeed();
  const ef = emergencyFund(s);
  close(ef.months, (2500 + 3000 + 2500) / 3500);
  assert.equal(netWorth(s).debtTotal, 3500 + 1200 + 18000 + 9500);
});

test('debt avalanche beats snowball on interest and rolls minimums over', () => {
  const debts = [
    { id: 'a', name: 'Card', balance: 3500, apr: 0.229, minPayment: 90 },
    { id: 'b', name: 'Small', balance: 1200, apr: 0.189, minPayment: 40 },
    { id: 'c', name: 'Car', balance: 9500, apr: 0.065, minPayment: 275 },
  ];
  const av = simulateDebts(debts, { method: 'avalanche', extra: 200 });
  const sb = simulateDebts(debts, { method: 'snowball', extra: 200 });
  const min = simulateDebts(debts, { method: 'minimum' });
  assert.ok(av.paidOff && sb.paidOff);
  assert.ok(av.totalInterest <= sb.totalInterest);
  assert.ok(av.totalInterest < min.totalInterest);
  assert.ok(av.months < min.months);
  assert.equal(sb.payoffs[0].id, 'b');
  assert.equal(av.payoffs[0].id, 'a');
});

test('debt whose minimum is below interest never pays off', () => {
  const r = simulateDebts([{ id: 'x', name: 'x', balance: 10000, apr: 0.3, minPayment: 100 }], { method: 'minimum', maxMonths: 120 });
  assert.equal(r.paidOff, false);
  assert.equal(r.months, null);
});

test('2026 federal brackets', () => {
  close(bracketTax(12400, 'single').tax, 1240);
  close(bracketTax(50400, 'single').tax, 1240 + 38000 * 0.12);
  assert.equal(bracketTax(60000, 'single').marginal, 0.22);
  close(bracketTax(24800, 'mfj').tax, 2480);
});

test('annual tax with FICA, state, and OBBBA overtime/tips deductions', () => {
  const settingsTax = { year: 2026, filingStatus: 'single', stateRate: 0.05, localRate: 0, ficaExempt: false, applyObbbaDeductions: true };
  const base = annualTax({ wages: 50000, settingsTax, obbba: false });
  close(base.taxable, 50000 - 16100);
  close(base.socialSecurity, 3100);
  close(base.medicare, 725);
  close(base.state, 2500);
  const withDed = annualTax({ wages: 50000, tips: 5000, otPremium: 3000, settingsTax });
  close(withDed.otDeduction, 3000);
  close(withDed.tipsDeduction, 5000);
  close(withDed.taxable, 55000 - 16100 - 8000);
  const exempt = annualTax({ wages: 30000, settingsTax: { ...settingsTax, ficaExempt: true } });
  assert.equal(exempt.socialSecurity + exempt.medicare, 0);
  // Social Security stops at the wage base
  close(annualTax({ wages: 300000, settingsTax }).socialSecurity, 184500 * 0.062);
});

test('opt-in automatic overtime: after 40h, overnight shifts, breaks, differentials', () => {
  const s = createSeed();
  s.jobs = [{ id: 'j', name: 'Job', rate: 20, otMultiplier: 1.5, autoOvertime: true, otWeeklyThreshold: 40, payFrequency: 'weekly', periodEndAnchor: '2026-10-24', payLagDays: 6,
    differentials: [{ name: 'Night', amount: 2, start: '22:00', end: '06:00', days: [] }] }];
  // Sun 10/18 .. Sat 10/24, five 9h shifts (8.5 paid after 30m break) = 42.5h
  s.shifts = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((date, i) => ({ id: `s${i}`, jobId: 'j', date, start: '09:00', end: '18:00', breakMin: 30, tips: 0 }));
  s.shifts.push({ id: 'n', jobId: 'j', date: '2026-10-24', start: '22:00', end: '02:00', breakMin: 0, tips: 10 });
  const c = computeShifts(s);
  const total = c.reduce((a, x) => a + x.hours, 0);
  close(total, 42.5 + 4);
  const ot = c.reduce((a, x) => a + x.overtime, 0);
  close(ot, 6.5);
  const night = c.find((x) => x.id === 'n');
  close(night.hours, 4);
  close(night.overtime, 4); // already past 40h that week
  close(night.diffPay, 8);
  close(night.otPay, 4 * 30);
  close(night.otPremium, 4 * 10);
  close(night.gross, 120 + 8 + 10);
});

test('daily overtime (California style) is not double counted', () => {
  const s = createSeed();
  s.jobs = [{ id: 'j', name: 'Job', rate: 10, otMultiplier: 1.5, autoOvertime: true, otWeeklyThreshold: 40, dailyOtThreshold: 8, payFrequency: 'weekly' }];
  s.shifts = [{ id: 'a', jobId: 'j', date: '2026-10-19', start: '08:00', end: '20:00', breakMin: 0 }];
  const [x] = computeShifts(s);
  close(x.hours, 12); close(x.overtime, 4); close(x.regular, 8);
});

test('differential windows respect weekdays', () => {
  const sat = { date: '2026-10-24', start: '10:00', end: '14:00', breakMin: 0 };
  const mon = { date: '2026-10-19', start: '10:00', end: '14:00', breakMin: 0 };
  const weekend = { start: '00:00', end: '00:00', days: [0, 6] };
  close(differentialHours(sat, weekend), 4);
  close(differentialHours(mon, weekend), 0);
});

test('pay periods: biweekly anchor and semimonthly', () => {
  const job = { payFrequency: 'biweekly', periodEndAnchor: '2026-10-10', payLagDays: 6 };
  assert.deepEqual(payPeriod(job, '2026-10-10'), { start: '2026-09-27', end: '2026-10-10', payday: '2026-10-16' });
  assert.deepEqual(payPeriod(job, '2026-10-11'), { start: '2026-10-11', end: '2026-10-24', payday: '2026-10-30' });
  const semi = { payFrequency: 'semimonthly', payLagDays: 0 };
  assert.equal(payPeriod(semi, '2026-10-20').end, '2026-10-31');
  assert.equal(payPeriod(semi, '2026-10-02').end, '2026-10-15');
});

test('paychecks group shifts and apply the job\'s own tax percentages', () => {
  const s = createSeed();
  s.jobs = [{ id: 'j', name: 'Job', sourceId: 'side', rate: 20, payFrequency: 'weekly', periodEndAnchor: '2026-10-24', payLagDays: 6, otMultiplier: 1.5, tax: { mode: 'percent', rates: { federal: 0.1, socialSecurity: 0.062 } } }];
  s.shifts = [{ id: 'a', jobId: 'j', date: '2026-10-20', start: '09:00', end: '17:00', breakMin: 0 }];
  const [pc] = paychecks(s, { from: '2026-10-01', to: '2026-11-30' });
  assert.equal(pc.payday, '2026-10-30');
  close(pc.gross, 160);
  close(pc.socialSecurity, 160 * 0.062);
  close(pc.federal, 16);
  close(pc.net, 160 - 16 - 9.92);
});

test('salaried job produces paychecks without shifts', () => {
  const s = createSeed();
  s.jobs = [{ id: 'j', name: 'Salary', payType: 'salary', salaryAnnual: 52000, payFrequency: 'semimonthly', payLagDays: 0 }];
  const list = paychecks(s, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(list.length, 2);
  close(list[0].gross, 52000 / 24);
});

test('goal projection and required monthly', () => {
  const p = projectSaving({ target: 1200, current: 200, monthly: 100, targetDate: '' });
  assert.equal(p.monthsToGoal, 10);
  assert.equal(projectSaving({ target: 100, current: 100, monthly: 0 }).status, 'Funded');
});

test('suggested plan sums to each bucket target', () => {
  const s = createSeed();
  const plan = suggestPlan(s, 4000);
  const byType = (t) => s.categories.filter((c) => c.type === t).reduce((a, c) => a + plan[c.id], 0);
  close(byType('need'), 2000, 0.1); close(byType('want'), 1200, 0.1); close(byType('savings'), 800, 0.1);
});

test('auto-categorize uses learned rules before keywords', () => {
  const s = createSeed();
  assert.equal(autoCategorize(s, 'STARBUCKS #1234'), 'dining');
  assert.equal(autoCategorize(s, 'Shell Oil 5543'), 'transportation');
  assert.equal(autoCategorize(s, 'TRADER JOE\'S #552'), 'groceries');
  s.rules = [{ match: 'starbucks', categoryId: 'discretionary' }];
  assert.equal(autoCategorize(s, 'STARBUCKS #1234'), 'discretionary');
  assert.equal(autoCategorize(s, 'zzzz'), null);
});

test('receipt split spreads tax/tip proportionally and sums to the cent', () => {
  const r = { items: [{ amount: 30, category_id: 'groceries' }, { amount: 10, category_id: 'shopping' }, { amount: 0.33, category_id: 'groceries' }], tax: 2.77, tip: 0, fees: 0, discount: 1 };
  const split = splitByCategory(r);
  close(split.reduce((a, g) => a + g.amount, 0), 40.33 + 1.77, 0.001);
  const shopping = split.find((g) => g.categoryId === 'shopping');
  close(shopping.amount, 10 + (10 / 40.33) * 1.77);
});

test('bill occurrences step through months', () => {
  const list = billOccurrences({ nextDue: '2026-01-31', frequency: 'monthly' }, '2026-02-01', '2026-04-30');
  assert.deepEqual(list, ['2026-02-28', '2026-03-28', '2026-04-28']);
});

test('date and time parsing', () => {
  assert.equal(parseAnyDate('10/25/2026'), '2026-10-25');
  assert.equal(parseAnyDate('2026-03-04'), '2026-03-04');
  assert.equal(parseAnyDate('Oct 27, 2026'), '2026-10-27');
  assert.equal(parseAnyDate('27 October 2026'), '2026-10-27');
  assert.equal(parseTime('9:30pm'), '21:30');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('17:05'), '17:05');
});

test('schedule text parsing handles am/pm shorthand', () => {
  const r = parseScheduleText('Mon 10/26 4-10pm Cashier\nTue 10/27 9:00 AM - 5:30 PM\nWed 10/28 22:00-06:00 Stock', '2026-10-25');
  assert.equal(r.shifts.length, 3);
  assert.deepEqual([r.shifts[0].start, r.shifts[0].end], ['16:00', '22:00']);
  assert.deepEqual([r.shifts[1].start, r.shifts[1].end], ['09:00', '17:30']);
  assert.deepEqual([r.shifts[2].date, r.shifts[2].start, r.shifts[2].end], ['2026-10-28', '22:00', '06:00']);
});

test('receipt OCR text parsing', () => {
  const text = `TRADER JOE'S #552\n123 Main St\n10/24/2026 14:31\nBANANAS 1.29\nORGANIC MILK 4.99\nCOFFEE BEANS 8.99\nSUBTOTAL 15.27\nTAX 0.42\nTOTAL $15.69\nVISA **** 1234 15.69`;
  const r = parseReceiptText(text, () => 'groceries');
  assert.equal(r.merchant, "TRADER JOE'S 552");
  assert.equal(r.date, '2026-10-24');
  assert.equal(r.items.length, 3);
  close(r.subtotal, 15.27); close(r.tax, 0.42); close(r.total, 15.69);
});

test('ICS parsing', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261026T160000\r\nDTEND:20261026T220000\r\nSUMMARY:Shift - Cashier\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const r = parseICS(ics);
  assert.equal(r.shifts.length, 1);
  assert.deepEqual([r.shifts[0].date, r.shifts[0].start, r.shifts[0].end], ['2026-10-26', '16:00', '22:00']);
});

test('NVIDIA replies are parsed and coerced to the schema', async () => {
  const { conform, parseJsonReply, receiptRequest } = await import('../public/js/ai-core.js');
  const { schema } = receiptRequest({ blocks: [], categories: [{ id: 'groceries', name: 'G', type: 'need' }], today: '2026-10-25' });
  const raw = parseJsonReply('<think>hmm</think>Here you go:\n```json\n{"merchant":"TJ","items":[{"description":"Milk","amount":"$4.99","category_id":"groceries"},{"description":"X","amount":1,"category_id":"bogus"}],"total":"19.47"}\n```');
  const r = conform(schema, raw);
  assert.equal(r.merchant, 'TJ');
  assert.equal(r.items[0].amount, 4.99);
  assert.equal(r.items[0].quantity, 0);
  assert.equal(r.items[1].category_id, '');
  assert.equal(r.total, 19.47);
  assert.equal(r.tax, 0);
  assert.deepEqual(Object.keys(r).sort(), Object.keys(schema.properties).sort());
  assert.throws(() => parseJsonReply('no json here'));
});

test('shift times follow schedule conventions and names never confuse look-alikes', async () => {
  const { resolveShiftTimes, personMatches } = await import('../public/js/parse.js');
  const t = (x) => { const r = resolveShiftTimes(x); return `${r.start}-${r.end}`; };
  assert.equal(t('1-5'), '13:00-17:00');
  assert.equal(t('9-1'), '09:00-13:00');
  assert.equal(t('3-11'), '15:00-23:00');
  assert.equal(t('4-12'), '16:00-00:00');
  assert.equal(t('11p-7a'), '23:00-07:00');
  assert.equal(t('4-10pm'), '16:00-22:00');
  assert.equal(t('5:00 PM – 1:00 AM'), '17:00-01:00');
  assert.equal(resolveShiftTimes('OFF'), null);
  const me = ['Arnab', 'Arnab Das'];
  assert.ok(personMatches('A. Das (Arnab)', me));
  assert.ok(personMatches('ARNAB D.', me));
  assert.ok(personMatches('A. Das', me));
  assert.ok(!personMatches('Arnav Patel', me));
  assert.ok(!personMatches('Barnab', me));
});

test('schedule readings merge with votes and normalized times/dates', async () => {
  const { mergeScheduleReads } = await import('../public/js/ai-core.js');
  const a = { people: ['Arnab Das', 'Sam'], shifts: [
    { person: 'Arnab Das', date: '2026-11-02', time_text: '1-5', start: '01:00', end: '05:00' },
    { person: 'Sam', date: '2026-11-02', time_text: '9-1', start: '09:00', end: '13:00' },
  ] };
  const b = { people: ['A. Das (Arnab)'], shifts: [
    { person: 'A. Das (Arnab)', date: '11/2/2026', time_text: '1:00-5:00', start: '13:00', end: '17:00' },
    { person: 'A. Das (Arnab)', date: '2026-11-04', time_text: '9-1', start: '09:00', end: '13:00' },
  ] };
  const m = mergeScheduleReads([a, b]);
  assert.equal(m.readers, 2);
  const mine = m.shifts.filter((x) => /das/i.test(x.person));
  assert.equal(mine.length, 2);
  const nov2 = mine.find((x) => x.date === '2026-11-02');
  assert.deepEqual([nov2.start, nov2.end, nov2.votes], ['13:00', '17:00', 2]);
  assert.equal(mine.find((x) => x.date === '2026-11-04').votes, 1);
  // Column slip: with three readings, a lone shift next to a confirmed identical one is flagged.
  const slip = { people: ['Arnab Das'], shifts: [{ person: 'Arnab Das', date: '2026-11-03', time_text: '1-5' }] };
  const m3 = mergeScheduleReads([a, b, slip]);
  assert.equal(m3.shifts.find((x) => x.date === '2026-11-03').suspect, true);
  assert.equal(m3.shifts.find((x) => x.date === '2026-11-04').suspect, false);
});

test('investments: match, projection, FI number, net worth and budget links', async () => {
  const { employerMatch, projectGrowth, retirementPlan, investmentSummary } = await import('../public/js/calc.js');
  const acct = { type: '401k', monthly: 200, employerMatchRate: 0.5, employerMatchUpTo: 0.06 };
  const m = employerMatch(acct, 60000); // cap = 300/mo
  close(m.monthly, 100); close(m.missed, 50); close(m.needed, 300);
  const g = projectGrowth({ start: 1000, monthly: 100, annualReturn: 0, inflation: 0, years: 2 });
  close(g.at(-1), 1000 + 2400);
  const s = createSeed();
  s.investing.accounts[0].monthly = 300;
  s.investing.settings = { ...s.investing.settings, currentAge: 30, retireAge: 60, retirementSpending: 40000, withdrawalRate: 0.04 };
  const plan = retirementPlan(s);
  assert.equal(plan.fiNumber, 1000000);
  assert.ok(plan.atRetirement > 33000);
  assert.equal(investmentSummary(s).total, 33000);
  assert.equal(netWorth(s).investments, 33000);
});

test('goals follow linked balances', async () => {
  const { goalCurrent } = await import('../public/js/calc.js');
  const s = createSeed();
  const cards = s.goals.find((g) => g.link === 'debts:credit_card');
  assert.equal(goalCurrent(s, cards), 0);
  s.debts.find((d) => d.name === 'Credit Card 2').balance = 200; // paid 1,000 off
  assert.equal(goalCurrent(s, cards), 1000);
  const ef = s.goals.find((g) => g.link === 'asset:savings');
  s.netWorth.assets.find((a) => a.id === 'savings').value = 5000;
  assert.equal(goalCurrent(s, ef), 5000);
});

test('migration moves v1 investment rows into accounts without double counting', async () => {
  const { migrate } = await import('../public/js/seed.js');
  const v1 = createSeed();
  delete v1.investing;
  v1.netWorth.assets.push({ id: 'retirement', name: 'Retirement Accounts (401k/IRA)', value: 25000, liquid: false }, { id: 'investments', name: 'Investment / Brokerage', value: 8000, liquid: false });
  const before = v1.netWorth.assets.reduce((a, x) => a + x.value, 0);
  migrate(v1);
  assert.equal(v1.investing.accounts.length, 2);
  assert.equal(netWorth(v1).assets, before);
  migrate(v1); // idempotent
  assert.equal(v1.investing.accounts.length, 2);
});

test('overtime and taxes are manual by default', () => {
  const s = createSeed();
  s.jobs = [{ id: 'j', name: 'Job', sourceId: 'side', rate: 20, otMultiplier: 1.5, payFrequency: 'weekly', periodEndAnchor: '2026-10-24', payLagDays: 6 }];
  // 50 hours in one week: nothing becomes overtime unless entered on a shift.
  s.shifts = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((date, i) => ({ id: `s${i}`, jobId: 'j', date, start: '08:00', end: '18:00', breakMin: 0 }));
  let c = computeShifts(s);
  assert.equal(c.reduce((a, x) => a + x.overtime, 0), 0);
  s.shifts[4].otHours = 2;
  c = computeShifts(s);
  close(c.find((x) => x.id === 's4').overtime, 2);
  close(c.find((x) => x.id === 's4').gross, 8 * 20 + 2 * 30);
  const [pc] = paychecks(s, { from: '2026-10-01', to: '2026-11-30' });
  assert.equal(pc.total, 0); // no tax taken out unless the job says so
  close(pc.net, pc.gross);
  s.jobs[0].tax = { mode: 'flat', flat: 50 };
  close(paychecks(s, { from: '2026-10-01', to: '2026-11-30' })[0].net, pc.gross - 50);
});

test('biweekly paycheck periods run payday to the day before the next payday', async () => {
  const { periodFor, shiftRange, monthRange } = await import('../public/js/calc.js');
  const s = createSeed();
  s.settings.planning = { mode: 'paycheck', frequency: 'biweekly', payday: '2026-10-16' };
  const p = periodFor(s, '2026-10-25');
  assert.deepEqual([p.from, p.to, p.nextPayday, p.days, p.key], ['2026-10-16', '2026-10-29', '2026-10-30', 14, 'P2026-10-16']);
  assert.equal(periodFor(s, '2026-10-30').from, '2026-10-30');
  assert.equal(periodFor(s, '2026-10-15').from, '2026-10-02');
  assert.equal(shiftRange(s, p, 1).from, '2026-10-30');
  assert.equal(shiftRange(s, p, -2).from, '2026-09-18');
  s.settings.planning = { mode: 'paycheck', frequency: 'semimonthly' };
  assert.deepEqual([periodFor(s, '2026-10-20').from, periodFor(s, '2026-10-20').to], ['2026-10-15', '2026-10-30']);
  assert.deepEqual([periodFor(s, '2026-11-03').from, periodFor(s, '2026-11-03').to], ['2026-10-31', '2026-11-14']);
  s.settings.planning = { mode: 'month' };
  assert.deepEqual(periodFor(s, '2026-10-25'), monthRange('2026-10'));
  // No payday known and no job: falls back to months until one is set.
  s.settings.planning = { mode: 'paycheck', frequency: 'biweekly', payday: '' };
  assert.equal(periodFor(s, '2026-10-25').kind, 'month');
});

test('paycheck budget: bills on their due dates, monthly amounts split, safe to spend', async () => {
  const { periodFor, safeToSpend, moneyFlow, monthSummary } = await import('../public/js/calc.js');
  const s = createSeed();
  s.sinkingFunds = []; s.debts = []; s.investing.accounts = [];
  s.settings.planning = { mode: 'paycheck', frequency: 'biweekly', payday: '2026-10-16' };
  s.sinkingFunds = [{ id: 'sf', name: 'Car', target: 1000, balance: 0, monthly: 304.375 }];
  s.bills = [
    { id: 'rent', name: 'Rent', amount: 1200, categoryId: 'housing', frequency: 'monthly', nextDue: '2026-11-01' },
    { id: 'phone', name: 'Phone', amount: 50, categoryId: 'internet_phone', frequency: 'monthly', nextDue: '2026-10-20' },
  ];
  s.transactions = [
    { id: 'pay', type: 'income', date: '2026-10-16', amount: 1500, merchant: 'Campus Café', sourceId: 'side' },
    { id: 'g', type: 'expense', date: '2026-10-18', amount: 80, categoryId: 'groceries', merchant: 'Kroger' },
    { id: 'ph', type: 'expense', date: '2026-10-20', amount: 50, categoryId: 'internet_phone', merchant: 'Phone', billId: 'phone' },
  ];
  s.bills[1].nextDue = '2026-11-20'; // phone already marked paid
  const oct = periodFor(s, '2026-10-25'); // Oct 16 – Oct 29: rent (Nov 1) is NOT in this paycheck
  const m = monthSummary(s, oct);
  assert.equal(m.rows.find((r) => r.id === 'housing').planned, 0);
  assert.equal(Math.round(m.rows.find((r) => r.id === 'sinking_funds').planned), 140); // 304.375 × 14/30.44
  const st = safeToSpend(s, oct, '2026-10-25');
  assert.equal(st.income, 1500);
  assert.equal(st.spent, 130);
  assert.equal(st.billsLeft, 0);
  assert.ok(st.bills.some((b) => b.bill.id === 'phone' && b.paid));
  assert.equal(st.daysLeft, 5);
  assert.equal(Math.round(st.safe), 1500 - 130 - 140);
  const nov = periodFor(s, '2026-10-30'); // Oct 30 – Nov 12 includes rent on Nov 1
  assert.equal(monthSummary(s, nov).rows.find((r) => r.id === 'housing').planned, 1200);
  assert.equal(safeToSpend(s, nov, '2026-10-30').billsLeft, 1200);
  const flow = moneyFlow(s, oct);
  assert.equal(flow.totalIn, 1500);
  assert.deepEqual(flow.outgoing.map((g) => [g.name.split(' ')[0], g.total]), [['Groceries', 80], ['Internet', 50]]);
});
