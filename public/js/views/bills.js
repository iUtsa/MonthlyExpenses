import { state, update, categoryName } from '../store.js';
import {
  esc, money, fmtDate, today, uid, modal, confirmDialog, options, toast, on, $, sum, round2, addDays,
  startOfWeek, monthLabel, emptyState,
} from '../util.js';
import { BILL_FREQUENCIES, monthlyEquivalent, billOccurrences, cashFlowForecast, paychecks } from '../calc.js';
import { lineChart, seriesColor } from '../charts.js';

export async function render(el, ctx) {
  const bills = [...state.bills].sort((a, b) => (a.nextDue || '').localeCompare(b.nextDue || ''));
  const monthly = sum(bills, monthlyEquivalent);
  const subs = bills.filter((b) => b.subscription);
  const subsMonthly = sum(subs, monthlyEquivalent);
  const horizon = addDays(today(), 30);
  const upcoming = bills.flatMap((b) => billOccurrences(b, today(), horizon).map((d) => ({ bill: b, date: d }))).sort((a, b) => a.date.localeCompare(b.date));
  const fc = cashFlowForecast(state, 60);
  const paidThisMonth = new Set(state.transactions.filter((t) => t.billId && t.date.startsWith(ctx.month)).map((t) => t.billId));

  el.innerHTML = `
    <div class="grid cols-4">
      <div class="card tile"><span class="tile-label">Recurring bills, per month</span><span class="tile-value">${money(monthly, { cents: false })}</span><span class="tile-sub">${bills.length} bills · ${money(monthly * 12, { cents: false })}/yr</span></div>
      <div class="card tile"><span class="tile-label">Subscriptions</span><span class="tile-value">${money(subsMonthly)}</span><span class="tile-sub">${subs.length} services · ${money(subsMonthly * 12, { cents: false })}/yr</span></div>
      <div class="card tile"><span class="tile-label">Due in next 30 days</span><span class="tile-value">${money(sum(upcoming, (u) => u.bill.amount), { cents: false })}</span><span class="tile-sub">${upcoming.length} payments</span></div>
      <div class="card tile"><span class="tile-label">Lowest checking balance (60 days)</span><span class="tile-value ${fc.low.balance < 0 ? 'neg' : ''}">${money(fc.low.balance, { cents: false })}</span><span class="tile-sub">on ${fmtDate(fc.low.date)}</span></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>Cash-flow forecast · checking account</h2><p>Starts from your Net Worth checking balance (${money(fc.start)}), adds expected paychecks and subtracts bills.</p></div></div>
      <div class="chart-box"><canvas id="fcChart" aria-label="Cash flow forecast"></canvas></div>
      ${fc.low.balance < 0 ? `<div class="alert bad" style="margin-top:10px"><span class="alert-icon">!</span><div>Your checking account is projected to go negative around <strong>${fmtDate(fc.low.date)}</strong>. Move a bill date, transfer from savings, or trim spending before then.</div></div>` : ''}
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>Due in the next 30 days</h2></div>
        ${upcoming.length ? `<div class="list">${upcoming.map((u) => {
    const days = Math.round((new Date(u.date) - new Date(today())) / 86400000);
    return `<div class="list-item"><span class="grow"><div class="title">${esc(u.bill.name)} ${u.bill.autopay ? '<span class="badge">autopay</span>' : ''}</div><div class="small muted">${fmtDate(u.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${days === 0 ? 'today' : `in ${days} days`}</div></span>
            <strong class="num">${money(u.bill.amount)}</strong>
            ${u.date === u.bill.nextDue ? `<button class="btn small" data-pay="${u.bill.id}">Mark paid</button>` : ''}</div>`;
  }).join('')}</div>` : emptyState('📅', 'Nothing due', 'Add your rent, utilities, phone and subscriptions below.')}
      </div>
      <div class="card">
        <div class="card-head"><h2>${monthLabel(ctx.month)}</h2></div>
        ${calendar(ctx.month)}
      </div>
    </div>

    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Bills & subscriptions</h2><p>“Mark paid” records the expense and moves the due date forward.</p></div><button class="btn primary" data-action="add">+ Add bill</button></div>
      ${bills.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Category</th><th>Frequency</th><th>Next due</th><th class="num">Amount</th><th class="num">Per month</th><th></th></tr></thead>
        <tbody>${bills.map((b) => `<tr>
          <td><strong>${esc(b.name)}</strong> ${b.subscription ? '<span class="badge info">subscription</span>' : ''} ${b.autopay ? '<span class="badge">autopay</span>' : ''}
            ${b.subscription && b.lastReviewed && b.lastReviewed < addDays(today(), -180) ? '<span class="badge warn">review?</span>' : ''}</td>
          <td class="small">${esc(categoryName(b.categoryId))}</td>
          <td class="small">${esc(BILL_FREQUENCIES.find((f) => f.id === b.frequency)?.name || '')}</td>
          <td>${fmtDate(b.nextDue)}${paidThisMonth.has(b.id) ? ' <span class="badge good">✓ paid</span>' : ''}</td>
          <td class="num">${money(b.amount)}</td>
          <td class="num">${money(monthlyEquivalent(b))}</td>
          <td class="actions"><button class="btn small" data-pay="${b.id}">Mark paid</button> <button class="icon-btn small" data-edit="${b.id}" aria-label="Edit">✎</button> <button class="icon-btn small" data-del="${b.id}" aria-label="Delete">🗑</button></td>
        </tr>`).join('')}</tbody></table></div>` : emptyState('🧾', 'No bills yet', 'Recurring bills power the forecast and due-date reminders.')}
    </div>
    ${subs.length ? `<div class="card" style="margin-top:16px"><h2>Subscription audit</h2>
      <p class="text-2 small" style="margin-top:4px">Research consistently finds people underestimate subscription spending. Cancelling the ones you rarely use is the fastest budget win.</p>
      <div class="list">${[...subs].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a)).map((b) => `<div class="list-item"><span class="grow"><div class="title">${esc(b.name)}</div><div class="small muted">${money(monthlyEquivalent(b) * 12)}/yr${b.lastReviewed ? ` · reviewed ${fmtDate(b.lastReviewed)}` : ''}</div></span>
        <button class="btn small" data-keep="${b.id}">Still worth it ✓</button><button class="btn small danger" data-cancel="${b.id}">Cancelled</button></div>`).join('')}</div></div>` : ''}`;

  const labels = fc.series.map((p) => fmtDate(p.date));
  lineChart($('#fcChart', el), { labels, datasets: [{ label: 'Projected balance', data: fc.series.map((p) => round2(p.balance)), color: seriesColor(1), stepped: true }], area: true, zeroLine: true });

  on(el, 'click', '[data-action=add]', async () => { if (await billForm()) ctx.refresh(); });
  on(el, 'click', '[data-edit]', async (e, b) => { if (await billForm(state.bills.find((x) => x.id === b.dataset.edit))) ctx.refresh(); });
  on(el, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog('Delete this bill?'))) return;
    update('bills', (l) => l.filter((x) => x.id !== b.dataset.del));
    ctx.refresh();
  });
  on(el, 'click', '[data-pay]', (e, btn) => {
    const bill = state.bills.find((x) => x.id === btn.dataset.pay);
    const f = BILL_FREQUENCIES.find((x) => x.id === bill.frequency) || BILL_FREQUENCIES[2];
    update('transactions', (l) => l.push({
      id: uid('tx'), type: 'expense', date: bill.nextDue && bill.nextDue <= today() ? bill.nextDue : today(), amount: round2(bill.amount), merchant: bill.name,
      categoryId: bill.categoryId, source: 'bill', billId: bill.id, note: bill.autopay ? 'Autopay' : '', createdAt: new Date().toISOString(),
    }));
    update('bills', () => { bill.nextDue = f.step(bill.nextDue || today()); });
    toast(`${bill.name} recorded · next due ${fmtDate(bill.nextDue)}`);
    ctx.refresh();
  });
  on(el, 'click', '[data-keep]', (e, b) => { update('bills', (l) => { l.find((x) => x.id === b.dataset.keep).lastReviewed = today(); }); ctx.refresh(); });
  on(el, 'click', '[data-cancel]', async (e, b) => {
    const bill = state.bills.find((x) => x.id === b.dataset.cancel);
    if (!(await confirmDialog(`Remove ${bill.name}? You'll save ${money(monthlyEquivalent(bill) * 12)} a year.`, { okLabel: 'Remove' }))) return;
    update('bills', (l) => l.filter((x) => x.id !== bill.id));
    toast(`Nice — ${money(monthlyEquivalent(bill) * 12)}/yr freed up`);
    ctx.refresh();
  });
}

function calendar(month) {
  const start = startOfWeek(`${month}-01`, 0);
  const end = addDays(start, 41);
  const bills = state.bills.flatMap((b) => billOccurrences(b, start, end).map((d) => ({ d, b })));
  const pays = paychecks(state, { from: start, to: end });
  const cells = [];
  for (let d = start, i = 0; i < 42; i++, d = addDays(d, 1)) {
    if (i >= 35 && !d.startsWith(month)) break;
    cells.push(`<div class="cal-day ${d.startsWith(month) ? '' : 'out'} ${d === today() ? 'today' : ''}"><div class="cal-num">${Number(d.slice(8))}</div>
      ${pays.filter((p) => p.payday === d).map((p) => `<span class="cal-chip pay" title="${esc(p.job.name)} payday">+${money(p.net, { cents: false })}</span>`).join('')}
      ${bills.filter((x) => x.d === d).map((x) => `<span class="cal-chip bill" title="${esc(x.b.name)}">${esc(x.b.name)}</span>`).join('')}</div>`);
  }
  return `<div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<div class="cal-head">${n}</div>`).join('')}${cells.join('')}</div>
    <div class="legend" style="margin-top:8px"><span><span class="dot" style="background:var(--good-soft);border:1px solid var(--good)"></span>Payday</span><span><span class="dot" style="background:var(--warning-soft);border:1px solid var(--warning)"></span>Bill due</span></div>`;
}

async function billForm(bill) {
  const b = bill || { name: '', amount: '', categoryId: 'utilities', frequency: 'monthly', nextDue: today(), autopay: false, subscription: false };
  return modal({
    title: bill ? 'Edit bill' : 'Add recurring bill',
    body: `<div class="form-grid">
      <label class="field span-2">Name<input name="name" value="${esc(b.name)}" required placeholder="Rent, Netflix, Electric…" autofocus></label>
      <label class="field">Amount<input type="number" step="0.01" name="amount" value="${esc(b.amount)}" required></label>
      <label class="field">Frequency<select name="frequency">${options(BILL_FREQUENCIES, b.frequency)}</select></label>
      <label class="field">Next due date<input type="date" name="nextDue" value="${esc(b.nextDue)}" required></label>
      <label class="field">Budget category<select name="categoryId">${options(state.categories, b.categoryId)}</select></label>
    </div>
    <div class="row" style="margin-top:12px;gap:20px">
      <label class="check"><input type="checkbox" name="autopay" ${b.autopay ? 'checked' : ''}> Autopay</label>
      <label class="check"><input type="checkbox" name="subscription" ${b.subscription ? 'checked' : ''}> Subscription (include in audit)</label>
    </div>`,
    onSubmit(form, v) {
      const record = { ...(bill || { id: uid('bill'), lastReviewed: today() }), ...v, name: v.name.trim(), amount: round2(v.amount) };
      update('bills', (l) => { const i = l.findIndex((x) => x.id === record.id); if (i >= 0) l[i] = record; else l.push(record); });
      return true;
    },
  });
}
