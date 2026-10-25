// Background bookkeeping that keeps pages linked without manual steps. Runs before every
// render and only writes when something actually changed.
import { update } from './store.js';
import { today, addDays, thisMonth, uid, round2, num, sum } from './util.js';
import { paychecks, netWorth } from './calc.js';

const paycheckKey = (pc) => `${pc.job.id}|${pc.payday}`;

// Paydays that have arrived become income transactions (marked estimated) so the budget's
// actual income follows your schedule. A pay stub or bank import later replaces the estimate;
// deleting one dismisses it for good.
function recordPaychecks(s) {
  if (!s.jobs?.length) return;
  const recorded = new Set(s.transactions.filter((t) => t.paycheckKey).map((t) => t.paycheckKey));
  const dismissed = new Set(s.settings.dismissedPaychecks || []);
  const add = [];
  for (const pc of paychecks(s, { from: addDays(today(), -45), to: today() })) {
    const key = paycheckKey(pc);
    if (pc.job.autoRecord === false || recorded.has(key) || dismissed.has(key) || pc.net <= 0) continue;
    add.push({
      id: uid('tx'), type: 'income', date: pc.payday, amount: round2(pc.net), merchant: pc.job.name,
      sourceId: pc.job.sourceId || 'salary', categoryId: '', source: 'paycheck', paycheckKey: key, estimated: true,
      note: `Estimated from ${num(pc.hours, 1)} scheduled hours — replace with your pay stub for the exact amount`,
      createdAt: new Date().toISOString(),
    });
  }
  if (add.length) update('transactions', (l) => l.push(...add), { silent: true });
}

function snapshots(s) {
  const month = thisMonth();
  const nw = netWorth(s);
  const entry = { month, assets: round2(nw.assets), liabilities: round2(nw.liabilities), net: round2(nw.net) };
  const cur = s.netWorth.history.find((h) => h.month === month);
  if (!cur || cur.assets !== entry.assets || cur.liabilities !== entry.liabilities) {
    update('netWorth', (n) => { n.history = n.history.filter((h) => h.month !== month).concat(entry); }, { silent: true });
  }
  const total = round2(sum(s.investing?.accounts || [], (a) => a.balance));
  const inv = s.investing?.history.find((h) => h.month === month);
  if (s.investing && (!inv || inv.total !== total)) {
    update('investing', (i) => { i.history = i.history.filter((h) => h.month !== month).concat({ month, total }); }, { silent: true });
  }
}

export function runAutomations(s) {
  if (!s?.settings) return;
  recordPaychecks(s);
  snapshots(s);
}

// Called when the user deletes an auto-recorded paycheck so it isn't re-created.
export function dismissPaycheck(tx) {
  if (!tx?.paycheckKey) return;
  update('settings', (st) => { st.dismissedPaychecks = [...new Set([...(st.dismissedPaychecks || []), tx.paycheckKey])]; }, { silent: true });
}

// A real deposit (pay stub or bank import) replaces the matching estimate: same job's
// payday within 4 days and an amount within 25%.
export function replaceEstimate(s, { date, amount, jobName }) {
  const near = s.transactions.find((t) => t.estimated && t.type === 'income' && Math.abs(new Date(t.date) - new Date(date)) <= 4 * 86400000
    && ((jobName && t.merchant?.toLowerCase() === jobName.toLowerCase()) || Math.abs(t.amount - amount) <= t.amount * 0.25));
  return near || null;
}
