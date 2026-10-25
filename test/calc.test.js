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

test('shifts: weekly overtime after 40h, overnight shifts, breaks, differentials', () => {
  const s = createSeed();
  s.jobs = [{ id: 'j', name: 'Job', rate: 20, otMultiplier: 1.5, otWeeklyThreshold: 40, payFrequency: 'weekly', periodEndAnchor: '2026-10-24', payLagDays: 6,
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
  s.jobs = [{ id: 'j', name: 'Job', rate: 10, otMultiplier: 1.5, otWeeklyThreshold: 40, dailyOtThreshold: 8, payFrequency: 'weekly' }];
  s.shifts = [{ id: 'a', jobId: 'j', date: '2026-10-19', start: '08:00', end: '20:00', breakMin: 0 }];
  const [x] = computeShifts(s);
  close(x.hours, 12); close(x.overtime, 4); close(x.regular, 8); close(x.otPremium, 0);
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

test('paychecks group shifts and estimate withholding', () => {
  const s = createSeed();
  s.jobs = [{ id: 'j', name: 'Job', sourceId: 'side', rate: 20, payFrequency: 'weekly', periodEndAnchor: '2026-10-24', payLagDays: 6, otWeeklyThreshold: 40, otMultiplier: 1.5 }];
  s.shifts = [{ id: 'a', jobId: 'j', date: '2026-10-20', start: '09:00', end: '17:00', breakMin: 0 }];
  const [pc] = paychecks(s, { from: '2026-10-01', to: '2026-11-30' });
  assert.equal(pc.payday, '2026-10-30');
  close(pc.gross, 160);
  assert.ok(pc.net < pc.gross && pc.net > 100);
  close(pc.socialSecurity, 160 * 0.062);
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
