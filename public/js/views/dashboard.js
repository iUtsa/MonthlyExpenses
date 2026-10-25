// Home: everything about the current paycheck (or month) on one screen —
// how much is safe to spend, this paycheck, bills due before the next one,
// the spending plan, and where money came from / went.
import { state, update } from '../store.js';
import { esc, money, fmtDate, today, addDays, sum, options, toast, on, $ } from '../util.js';
import {
  safeToSpend, moneyFlow, paychecks, netWorth, emergencyFund, highInterestDebt, healthScore,
  investmentSummary, computeShifts, planMode, planAnchor, PLAN_FREQUENCIES, suggestPlan, BUCKETS,
} from '../calc.js';
import { markBillPaid } from './bills.js';

const day = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });

export async function render(el, ctx) {
  const r = ctx.range;
  const needsPayday = planMode(state) === 'month' && state.settings.planning?.mode !== 'month' && !planAnchor(state);
  const st = safeToSpend(state, r);
  const m = st.summary;
  const flow = moneyFlow(state, r);
  const isPeriod = r.kind === 'period';
  const current = today() >= r.from && today() <= r.to;
  const pcs = paychecks(state, { from: r.from, to: r.to });
  const nextPcs = isPeriod ? paychecks(state, { from: r.nextPayday, to: addDays(r.nextPayday, 13) }) : [];
  const recorded = new Map(state.transactions.filter((t) => t.paycheckKey).map((t) => [t.paycheckKey, t]));
  // Planned lines first (by bucket), then anything spent without a plan.
  const plan = m.rows.filter((row) => row.planned > 0 || row.actual > 0).sort((a, b) => (b.planned > 0) - (a.planned > 0) || BUCKETS.findIndex((x) => x.id === a.type) - BUCKETS.findIndex((x) => x.id === b.type) || b.planned - a.planned);
  const otherIncome = flow.incoming.filter((g) => !pcs.some((p) => p.job.name === g.name));
  const week = computeShifts(state).filter((x) => x.date >= today() && x.date <= addDays(today(), 7));
  const nw = netWorth(state);
  const ef = emergencyFund(state);
  const inv = investmentSummary(state);
  const health = healthScore(state, r);
  const periodWord = isPeriod ? 'paycheck' : 'month';

  el.innerHTML = `
    ${needsPayday ? `<div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>When do you get paid?</h2><p>Set one payday and everything — budget, bills, spending — is planned paycheck by paycheck.</p></div></div>
      <form class="row" id="paydayForm">
        <label class="field">A payday (last or next)<input type="date" name="payday" required value="${today()}"></label>
        <label class="field">How often<select name="frequency">${options(PLAN_FREQUENCIES, 'biweekly')}</select></label>
        <button class="btn primary" type="submit" style="align-self:flex-end">Plan by paycheck</button>
        <button class="btn ghost" type="button" data-action="monthly" style="align-self:flex-end">I'd rather plan by month</button>
      </form></div>` : ''}

    <div class="grid cols-3">
      <div class="card span-2">
        <div class="row between"><span class="tile-label">${current ? `Safe to spend until ${isPeriod ? `payday, ${day(st.nextPayday)}` : 'the end of the month'}` : `Left over ${isPeriod ? 'this paycheck' : 'this month'}`}</span>
          ${current && st.daysLeft ? `<span class="badge info">${st.daysLeft} day${st.daysLeft > 1 ? 's' : ''} left</span>` : ''}</div>
        <div class="hero-value ${st.safe < 0 ? 'neg' : ''}" style="margin:6px 0">${money(st.safe, { cents: false })}</div>
        ${current && st.daysLeft && st.safe > 0 ? `<div class="text-2">That's about <strong>${money(st.perDay, { cents: false })} a day</strong> for groceries, gas, food and everything else.</div>` : ''}
        ${st.safe < 0 ? `<div class="alert bad" style="margin-top:8px"><span class="alert-icon">!</span><div>You're <strong>${money(-st.safe, { cents: false })} short</strong> before ${isPeriod ? 'payday' : 'the month ends'}. Move money from savings, delay a set-aside, or cut spending.</div></div>` : ''}
        <div class="kv" style="margin-top:14px;max-width:520px">
          <span>Money in this ${periodWord}</span><span>${money(st.income)}</span>
          <span>Spent & saved so far</span><span class="neg">−${money(st.spent)}</span>
          <span>Bills still due</span><span class="neg">−${money(st.billsLeft)}</span>
          <span>Savings & debt still to set aside</span><span class="neg">−${money(st.committedLeft)}</span>
          <span class="total">Safe to spend</span><span class="total ${st.safe < 0 ? 'neg' : 'pos'}">${money(st.safe)}</span>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>This ${periodWord}'s pay</h2><a class="btn small" href="#/income">Income</a></div>
        ${pcs.length ? `<div class="list">${pcs.map((p) => {
    const tx = recorded.get(`${p.job.id}|${p.payday}`);
    return `<div class="list-item"><span class="grow"><div class="title">${esc(p.job.name)}</div><div class="small muted">${day(p.payday)} · ${p.salary ? 'salary' : `${p.hours.toFixed(1)} h`}${tx?.estimated ? ' · estimated' : tx ? ' · received' : p.payday > today() ? ' · expected' : ''}</div></span><strong class="num pos">${money(tx && !tx.estimated ? tx.amount : p.net)}</strong></div>`;
  }).join('')}</div>` : `<p class="small muted">${state.jobs.length ? 'No payday falls in this period.' : 'Add your job in Income & shifts and drop your schedule below — your pay shows up here.'}</p>`}
        ${otherIncome.length ? `<div class="list">${otherIncome.map((g) => `<div class="list-item"><span class="grow">${esc(g.name)}</span><span class="num pos">${money(g.total)}</span></div>`).join('')}</div>` : ''}
        ${nextPcs.length ? `<div class="alert good" style="margin-top:10px"><span class="alert-icon">$</span><div class="small">Next paycheck <strong>${day(nextPcs[0].payday)}</strong>: about ${money(sum(nextPcs, (p) => p.net), { cents: false })}</div></div>` : ''}
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>Bills this ${periodWord}</h2><p>${st.bills.length ? `${money(st.billsLeft, { cents: false })} still to pay` : ''}</p></div><a class="btn small" href="#/bills">All bills</a></div>
        ${st.bills.length ? `<div class="list">${st.bills.map((b) => `<div class="list-item">
            <span class="grow"><div class="title">${esc(b.bill.name)}</div><div class="small muted">${day(b.date)}${b.bill.autopay ? ' · autopay' : ''}</div></span>
            <span class="num">${money(b.amount)}</span>
            ${b.paid ? '<span class="badge good">✓ paid</span>' : `<button class="btn small" data-pay="${b.bill.id}">Mark paid</button>`}</div>`).join('')}</div>`
    : `<p class="small muted">No bills due between ${day(r.from)} and ${day(r.to)}. Add rent, phone and subscriptions in <a href="#/bills">Bills</a> so they show up in the right paycheck.</p>`}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Spending plan</h2><p>${m.hasPlan ? `${money(m.actualExpense, { cents: false })} spent of ${money(m.plannedExpense, { cents: false })} planned` : `Nothing planned for this ${periodWord} yet`}</p></div><a class="btn small" href="#/budget">Edit plan</a></div>
        ${plan.length ? `<div class="stack" style="gap:10px">${plan.slice(0, 9).map((row) => {
    const unplanned = !row.planned;
    const ratio = unplanned ? 0 : row.actual / row.planned;
    return `<div><div class="row between small"><span class="row" style="flex-wrap:nowrap"><span class="dot ${row.type}"></span>${esc(row.name.replace(/\s*\(.*\)$/, ''))}</span><span class="${!unplanned && row.actual > row.planned + 0.5 ? 'neg' : 'muted'}">${money(row.actual, { cents: false })} ${unplanned ? '· not planned' : `/ ${money(row.planned, { cents: false })}`}</span></div>
      ${unplanned ? '' : `<div class="meter ${ratio > 1 ? 'bad' : ratio > 0.9 ? 'warn' : ''}" style="height:6px;margin-top:4px"><span style="width:${Math.min(100, ratio * 100)}%"></span></div>`}</div>`;
  }).join('')}</div>` : ''}
        ${!m.hasPlan || m.plannedExpense < 1 ? `<button class="btn primary small" data-action="quick-plan" style="margin-top:12px" ${st.income ? '' : 'disabled'}>Plan this ${periodWord} from my ${esc(m.targets.rule)} targets</button>` : ''}
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>Where money came from</h2><p>${money(flow.totalIn)} in · ${esc(r.label)}</p></div></div>
        ${flow.incoming.length ? flow.incoming.map((g) => group(g, true)).join('') : '<p class="small muted">No income recorded in this period yet.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Where it went</h2><p>${money(flow.totalOut)} out · ${esc(r.label)}</p></div><a class="btn small" href="#/transactions">All</a></div>
        ${flow.outgoing.length ? flow.outgoing.map((g) => group(g, false, flow.totalOut)).join('') : '<p class="small muted">No spending recorded yet. Scan a receipt or add a transaction.</p>'}
      </div>
    </div>

    <div class="grid cols-3" style="margin-top:16px">
      <div class="card span-2">
        <div class="card-head"><h2>Add something</h2></div>
        <div class="quick">
          <label class="dropzone" data-drop="receipt"><div class="big">🧾</div><strong>Receipt</strong><div class="small muted">photo or PDF → sorted expenses</div><input type="file" accept="image/*,application/pdf" multiple hidden></label>
          <label class="dropzone" data-drop="schedule"><div class="big">🗓</div><strong>Work schedule</strong><div class="small muted">screenshot, photo, PDF, CSV or .ics → shifts & pay</div><input type="file" accept="image/*,application/pdf,.csv,.xlsx,.xls,.ics,text/calendar" multiple hidden></label>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn small" data-quick="transaction">✎ Transaction</button>
          <a class="btn small" href="#/income?tab=shifts&add=1">⏱ Shift</a>
          <a class="btn small" href="#/investments">📈 Invest</a>
          <a class="btn small" href="#/review">✓ Review this ${periodWord}</a>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Next 7 days of work</h2></div>
        ${week.length ? `<div class="list">${week.slice(0, 6).map((x) => `<div class="list-item"><span class="grow"><div class="title">${day(x.date)}</div><div class="small muted">${x.start}–${x.end} · ${esc(x.job?.name || '')}</div></span><span class="num small">${money(x.gross, { cents: false })}</span></div>`).join('')}</div>` : '<p class="small muted">No shifts coming up. Drop your schedule to add them.</p>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>Big picture</h2><a class="btn small" href="#/reports">Reports</a></div>
      <div class="grid cols-4">
        <a class="tile" href="#/networth" style="text-decoration:none;color:inherit"><span class="tile-label">Net worth</span><span class="tile-value ${nw.net < 0 ? 'neg' : ''}">${money(nw.net, { cents: false, compact: true })}</span></a>
        <a class="tile" href="#/sinking" style="text-decoration:none;color:inherit"><span class="tile-label">Emergency fund</span><span class="tile-value">${ef.months.toFixed(1)} mo</span><span class="tile-sub">goal ${state.settings.efTargetMonths} months</span></a>
        <a class="tile" href="#/debts" style="text-decoration:none;color:inherit"><span class="tile-label">High-interest debt</span><span class="tile-value">${money(highInterestDebt(state), { cents: false })}</span></a>
        <a class="tile" href="#/investments" style="text-decoration:none;color:inherit"><span class="tile-label">Invested</span><span class="tile-value">${money(inv.total, { cents: false, compact: true })}</span><span class="tile-sub">health score ${health.total}/100</span></a>
      </div>
    </div>`;

  $('#paydayForm', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    update('settings', (s) => { s.planning = { ...(s.planning || {}), mode: 'paycheck', frequency: f.frequency.value, payday: f.payday.value }; });
    toast('Planning by paycheck — use ‹ › at the top to move between paychecks');
    ctx.refresh();
  });
  on(el, 'click', '[data-action=monthly]', () => { update('settings', (s) => { s.planning = { ...(s.planning || {}), mode: 'month' }; }); ctx.refresh(); });
  on(el, 'click', '[data-pay]', (e, b) => { markBillPaid(state.bills.find((x) => x.id === b.dataset.pay)); ctx.refresh(); });
  on(el, 'click', '[data-action=quick-plan]', () => {
    const suggested = suggestPlan(state, st.income);
    for (const row of m.rows) if (row.link) delete suggested[row.id]; // keep bills/savings/debt lines linked
    update('budgets', (b) => { b[r.key] = { income: { ...(b[r.key]?.income || {}) }, planned: suggested, notes: b[r.key]?.notes || {} }; });
    toast(`Plan made for ${r.label} — adjust it any time in Budget`);
    ctx.refresh();
  });
  for (const zone of el.querySelectorAll('[data-drop]')) {
    const start = async (files) => {
      if (!files.length) return;
      if (zone.dataset.drop === 'receipt') (await import('./receipts.js')).startReceipt([...files], ctx);
      else (await import('./income.js')).startSchedule([...files], ctx);
    };
    zone.querySelector('input').addEventListener('change', (e) => start(e.target.files));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); start(e.dataTransfer.files); });
  }
  on(el, 'click', '[data-quick=transaction]', async () => {
    const { openTransactionForm } = await import('./transactions.js');
    if (await openTransactionForm(ctx)) ctx.refresh();
  });
}

// One expandable line: total for a source/category, with its transactions inside.
function group(g, incoming, total = 0) {
  return `<details class="flow-group"><summary>
      <span class="grow">${esc(g.name)} <span class="small muted">· ${g.items.length}</span></span>
      ${total ? `<span class="flow-bar"><span style="width:${Math.max(2, (g.total / total) * 100)}%"></span></span>` : ''}
      <strong class="num ${incoming ? 'pos' : ''}">${money(g.total)}</strong></summary>
    <div class="flow-items">${g.items.map((t) => `<div class="row between small"><span>${fmtDate(t.date)} · ${esc(t.merchant || t.note || '—')}${t.estimated ? ' <span class="badge">estimated</span>' : ''}</span><span class="num">${money(t.amount)}</span></div>`).join('')}</div>
  </details>`;
}
