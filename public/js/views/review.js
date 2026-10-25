import { state, update } from '../store.js';
import { esc, money, on, monthLabel, shiftMonth, today, toast, fmtDate } from '../util.js';
import { insights } from '../calc.js';

const CHECKLIST = [
  ['1. Accounts & Transactions (5–8 min)', [
    ['Update all account balances', '#/networth'],
    ['Categorize uncategorized transactions', '#/transactions'],
    ['Hunt for errors, duplicates, or unused subscriptions', '#/bills'],
    ['Cancel or renegotiate at least one recurring cost if possible', '#/bills'],
  ]],
  ['2. Income & Cash Flow (3 min)', [
    ['Confirm all expected income arrived', '#/income'],
    ['Decide the job of any unexpected income', '#/budget'],
    ['Update next month Planned Income if changes are known', '#/budget'],
  ]],
  ['3. Budget vs Actual (8–12 min)', [
    ['Review every category variance on Monthly Budget', '#/budget'],
    ['Identify top 2 overspending categories and root causes', ''],
    ['Identify under-spending that can be redirected to goals', ''],
    ['Update Sinking Funds and Goals progress', '#/sinking'],
  ]],
  ['4. Debt, Savings & Net Worth (5 min)', [
    ['Update Debt Tracker and note interest paid this month', '#/debts'],
    ['Update Net Worth snapshot', '#/networth'],
    ['Confirm automated transfers ran', ''],
    ['Celebrate any milestone (debt paid, EF month gained, etc.)', ''],
  ]],
  ['5. Next Month Actions (max 3)', [
    ['Write 1–3 specific, measurable actions', ''],
    ['Adjust next month Planned numbers', '#/budget'],
    ['Set calendar reminder for next review', ''],
    ['Start next month\'s budget (copy this month)', ''],
  ]],
];
const TOTAL = CHECKLIST.reduce((a, [, items]) => a + items.length, 0);

function review(month) {
  return state.reviews[month] || { checked: {}, actions: ['', '', ''], causes: {}, reviewDate: '', notes: '' };
}
function save(month, fn) {
  update('reviews', (r) => { r[month] ||= review(month); fn(r[month]); }, { silent: true });
}

export async function render(el, ctx) {
  const month = ctx.month;
  const r = review(month);
  const ins = insights(state, month);
  const done = Object.values(r.checked).filter(Boolean).length;
  const next = shiftMonth(month, 1);

  el.innerHTML = `
    <div class="alert info"><span class="alert-icon">i</span><div>A consistent monthly review is the strongest predictor of long-term budgeting success. Budget 20–40 minutes; the app has already done the arithmetic below.</div></div>
    <div class="grid cols-3" style="margin-top:16px">
      <div class="stack span-2">
        <div class="card">
          <div class="card-head"><div><h2>${monthLabel(month)} review</h2><p>${done} of ${TOTAL} steps done${r.reviewDate ? ` · last opened ${fmtDate(r.reviewDate)}` : ''}</p></div>
            <div class="meter ${done === TOTAL ? 'good' : ''}" style="width:160px"><span style="width:${(done / TOTAL) * 100}%"></span></div></div>
          ${CHECKLIST.map(([section, items], si) => `<h3 style="margin:14px 0 6px">${esc(section)}</h3>
            ${items.map(([label, link], i) => {
    const key = `${si}.${i}`;
    return `<div class="list-item" style="padding:6px 0"><label class="check grow"><input type="checkbox" data-check="${key}" ${r.checked[key] ? 'checked' : ''}> <span class="${r.checked[key] ? 'muted' : ''}">${esc(label)}</span></label>${link ? `<a class="btn small ghost" href="${link}">Open →</a>` : ''}${si === 4 && i === 3 ? `<button class="btn small" data-action="start-next">Copy to ${monthLabel(next, 'short')}</button>` : ''}</div>`;
  }).join('')}`).join('')}
        </div>
        <div class="card">
          <h2>Top 3 actions for next month</h2>
          ${[0, 1, 2].map((i) => `<div class="row" style="margin-top:8px"><strong>${i + 1}.</strong><input style="flex:1" data-action-i="${i}" data-key="act-${i}" value="${esc(r.actions[i] || '')}" placeholder="${['e.g. Cap dining out at $150', 'e.g. Cancel unused streaming service', 'e.g. Move $200 extra to Credit Card 1'][i]}"></div>`).join('')}
          <label class="field" style="margin-top:12px">Notes<textarea rows="3" data-notes data-key="rev-notes">${esc(r.notes || '')}</textarea></label>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <h2>Overspending</h2>
          ${ins.over.length ? ins.over.slice(0, 4).map((o, i) => `<div style="margin-top:10px"><div class="row between"><strong class="small">${esc(o.name)}</strong><span class="badge bad">+${money(o.by, { cents: false })}</span></div>
            ${i < 2 ? `<input class="small" style="width:100%;margin-top:4px" data-cause="${o.id}" value="${esc(r.causes?.[o.id] || '')}" placeholder="Root cause?">` : ''}</div>`).join('') : '<p class="small muted" style="margin-top:8px">No category went over plan. 🎉</p>'}
        </div>
        <div class="card">
          <h2>Redirect under-spending</h2>
          ${ins.under.length ? `<div class="list">${ins.under.slice(0, 5).map((u) => `<div class="list-item"><span class="grow small">${esc(u.name)}</span><span class="badge good">${money(u.by, { cents: false })} left</span></div>`).join('')}</div>
            <p class="small muted">Total ${money(ins.under.reduce((a, u) => a + u.by, 0), { cents: false })} could go to your emergency fund, a goal, or extra debt payments.</p>` : '<p class="small muted" style="margin-top:8px">Nothing unspent yet.</p>'}
        </div>
        <div class="card">
          <h2>Biggest changes vs ${monthLabel(shiftMonth(month, -1), 'short')}</h2>
          ${ins.changes.length ? `<div class="list">${ins.changes.slice(0, 5).map((c) => `<div class="list-item"><span class="grow small">${esc(c.name)}</span><span class="num small ${c.delta > 0 ? 'neg' : 'pos'}">${c.delta > 0 ? '▲' : '▼'} ${money(Math.abs(c.delta), { cents: false })}</span></div>`).join('')}</div>` : '<p class="small muted" style="margin-top:8px">No change over $50.</p>'}
        </div>
        <div class="card"><div class="kv small">
          <span>Uncategorized transactions</span><span class="${ins.uncategorized ? 'neg' : ''}">${ins.uncategorized}</span>
          <span>Income vs plan</span><span class="${ins.incomeGap > 0 ? 'neg' : ''}">${ins.incomeGap > 0 ? `${money(ins.incomeGap, { cents: false })} short` : 'on/above plan'}</span>
          <span>Subscriptions</span><span>${ins.subscriptionCount} · ${money(ins.subscriptionsMonthly, { cents: false })}/mo</span>
          <span>Surplus</span><span class="${ins.summary.surplus < 0 ? 'neg' : 'pos'}">${money(ins.summary.surplus, { cents: false })}</span>
        </div></div>
      </div>
    </div>`;

  if (!r.reviewDate || r.reviewDate !== today()) save(month, (x) => { x.reviewDate = today(); });

  on(el, 'change', '[data-check]', (e, c) => { save(month, (x) => { x.checked[c.dataset.check] = c.checked; }); ctx.refresh(); });
  on(el, 'change', '[data-action-i]', (e, inp) => save(month, (x) => { x.actions[+inp.dataset.actionI] = inp.value; }));
  on(el, 'change', '[data-notes]', (e, t) => save(month, (x) => { x.notes = t.value; }));
  on(el, 'change', '[data-cause]', (e, inp) => save(month, (x) => { x.causes ||= {}; x.causes[inp.dataset.cause] = inp.value; }));
  on(el, 'click', '[data-action=start-next]', () => {
    const src = state.budgets[month];
    if (!src) return toast('No plan this month to copy', 'bad');
    update('budgets', (b) => { b[next] = { income: { ...src.income }, planned: { ...src.planned }, notes: {} }; });
    save(month, (x) => { x.checked['4.3'] = true; });
    toast(`${monthLabel(next)} budget started from ${monthLabel(month)}`);
    ctx.refresh();
  });
}
