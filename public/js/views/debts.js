import { state, update } from '../store.js';
import { esc, money, pct, fmtDate, uid, modal, confirmDialog, options, toast, on, $, sum, round2, today, addMonths } from '../util.js';
import { simulateDebts } from '../calc.js';
import { lineChart, seriesColor } from '../charts.js';

const KINDS = [
  { id: 'credit_card', name: 'Credit card' }, { id: 'student_loan', name: 'Student loan' }, { id: 'auto_loan', name: 'Auto loan' },
  { id: 'personal_loan', name: 'Personal loan' }, { id: 'medical', name: 'Medical debt' }, { id: 'bnpl', name: 'Buy now, pay later' }, { id: 'other', name: 'Other' },
];
const METHODS = { avalanche: 'Avalanche', snowball: 'Snowball', minimum: 'Minimums only' };

const months = (n) => (n === null ? 'Never (payment < interest)' : n >= 12 ? `${Math.floor(n / 12)} yr ${n % 12} mo` : `${n} mo`);

export async function render(el, ctx) {
  const strat = state.debtStrategy;
  const debts = state.debts;
  const active = debts.filter((d) => d.balance > 0);
  const total = sum(active, (d) => d.balance);
  const mins = sum(active, (d) => d.minPayment);
  const avgApr = total ? sum(active, (d) => d.balance * d.apr) / total : 0;
  const sims = Object.fromEntries(Object.keys(METHODS).map((m) => [m, simulateDebts(debts, { method: m, extra: strat.extraMonthly })]));
  const chosen = sims[strat.method];
  const order = Object.fromEntries(chosen.payoffs.map((p, i) => [p.id, { ...p, rank: i + 1 }]));
  const monthlyInterest = sum(active, (d) => (d.balance * d.apr) / 12);

  el.innerHTML = `
    <div class="grid cols-4">
      <div class="card tile"><span class="tile-label">Total debt</span><span class="tile-value">${money(total, { cents: false })}</span><span class="tile-sub">${active.length} debts · avg APR ${pct(avgApr, 1)}</span></div>
      <div class="card tile"><span class="tile-label">Interest this month</span><span class="tile-value neg">${money(monthlyInterest)}</span><span class="tile-sub">${money(monthlyInterest * 12, { cents: false })}/yr at today's balances</span></div>
      <div class="card tile"><span class="tile-label">Debt-free date (${METHODS[strat.method]})</span><span class="tile-value">${chosen.months === null ? '—' : fmtDate(addMonths(today(), chosen.months), { month: 'short', year: 'numeric' })}</span><span class="tile-sub">${months(chosen.months)}</span></div>
      <div class="card tile"><span class="tile-label">Interest saved vs minimums</span><span class="tile-value pos">${money(Math.max(0, sims.minimum.totalInterest - chosen.totalInterest), { cents: false })}</span><span class="tile-sub">Total interest ${money(chosen.totalInterest, { cents: false })}</span></div>
    </div>

    <div class="grid cols-3" style="margin-top:16px">
      <div class="card">
        <h2>Payoff strategy</h2>
        <div class="seg" style="margin:12px 0">${['avalanche', 'snowball'].map((m) => `<button data-method="${m}" class="${strat.method === m ? 'active' : ''}">${METHODS[m]}</button>`).join('')}</div>
        <p class="small text-2">${strat.method === 'avalanche' ? 'Highest interest rate first — mathematically cheapest.' : 'Smallest balance first — quick wins that keep you motivated (higher completion rates in studies).'}</p>
        <label class="field" style="margin-top:12px">Extra paid each month on top of minimums<input type="number" step="10" min="0" data-extra data-key="debt-extra" value="${strat.extraMonthly}"></label>
        <div class="kv small" style="margin-top:12px">
          <span>Minimum payments</span><span>${money(mins)}</span>
          <span class="total">Total monthly payment</span><span class="total">${money(mins + Number(strat.extraMonthly || 0))}</span>
        </div>
        <p class="small muted" style="margin-top:10px">When a debt is paid off, its minimum rolls into the next target, so your total payment stays the same.</p>
      </div>
      <div class="card span-2">
        <div class="card-head"><div><h2>Total balance over time</h2><p>Same total payment each month, three strategies</p></div></div>
        ${active.length ? '<div class="chart-box"><canvas id="debtChart" aria-label="Debt balance projection"></canvas></div>' : '<div class="empty"><div class="big">🎉</div><strong>Debt free!</strong></div>'}
      </div>
    </div>

    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><h2>Strategy comparison</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Strategy</th><th class="num">Monthly payment</th><th>Time to debt-free</th><th>Debt-free date</th><th class="num">Total interest</th><th class="num">Saved vs minimums</th></tr></thead>
        <tbody>${Object.entries(sims).map(([m, s]) => `<tr ${m === strat.method ? 'style="font-weight:600"' : ''}>
          <td>${METHODS[m]} ${m === strat.method ? '<span class="badge info">selected</span>' : ''}</td><td class="num">${money(s.monthlyPayment)}</td><td>${months(s.months)}</td>
          <td>${s.months === null ? '—' : fmtDate(addMonths(today(), s.months), { month: 'short', year: 'numeric' })}</td>
          <td class="num">${money(s.totalInterest)}</td><td class="num pos">${m === 'minimum' ? '—' : money(sims.minimum.totalInterest - s.totalInterest)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Your debts</h2><p>Edit balances after each statement. Order and payoff dates follow the selected strategy.</p></div><button class="btn primary" data-action="add">+ Add debt</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Debt</th><th>Type</th><th class="num">Balance</th><th class="num">APR %</th><th class="num">Min payment</th><th class="num">Monthly interest</th><th>Paid off</th><th></th></tr></thead>
        <tbody>${[...debts].sort((a, b) => (order[a.id]?.rank ?? 99) - (order[b.id]?.rank ?? 99)).map((d) => {
    const o = order[d.id];
    const warn = d.balance > 0 && d.minPayment <= (d.balance * d.apr) / 12;
    return `<tr>
          <td>${o ? `<span class="badge ${o.rank === 1 ? 'info' : ''}">${o.rank}</span>` : '✓'}</td>
          <td><input class="cell" data-id="${d.id}" data-field="name" value="${esc(d.name)}" style="min-width:150px"></td>
          <td><select class="cell" data-id="${d.id}" data-field="kind">${options(KINDS, d.kind)}</select></td>
          <td style="width:120px"><input class="cell num" type="number" step="0.01" data-id="${d.id}" data-field="balance" value="${d.balance}"></td>
          <td style="width:90px"><input class="cell num" type="number" step="0.01" data-id="${d.id}" data-field="apr" value="${round2(d.apr * 100)}"></td>
          <td style="width:110px"><input class="cell num" type="number" step="1" data-id="${d.id}" data-field="minPayment" value="${d.minPayment}"></td>
          <td class="num ${warn ? 'neg' : ''}">${money((d.balance * d.apr) / 12)}${warn ? ' <span class="badge bad" title="Minimum payment does not cover interest">!</span>' : ''}</td>
          <td>${o?.date ? fmtDate(o.date, { month: 'short', year: 'numeric' }) : d.balance > 0 ? '—' : '<span class="badge good">Paid</span>'}${o?.interest ? `<div class="small muted">${money(o.interest, { cents: false })} interest</div>` : ''}</td>
          <td class="actions"><button class="btn small" data-pay="${d.id}">Log payment</button> <button class="icon-btn small" data-del="${d.id}" aria-label="Delete">🗑</button></td>
        </tr>`;
  }).join('')}</tbody>
        <tfoot><tr><td></td><td>Total</td><td></td><td class="num">${money(total)}</td><td class="num">${pct(avgApr, 1)}</td><td class="num">${money(mins)}</td><td class="num">${money(monthlyInterest)}</td><td colspan="2"></td></tr></tfoot>
      </table></div>
    </div>`;

  if (active.length) {
    const horizon = Math.min(Math.max(...Object.values(sims).map((s) => s.timeline.length)), 361);
    const labels = Array.from({ length: horizon }, (_, i) => fmtDate(addMonths(today(), i), { month: 'short', year: '2-digit' }));
    const pad = (t) => Array.from({ length: horizon }, (_, i) => round2(t[i] ?? 0));
    lineChart($('#debtChart', el), {
      labels,
      datasets: [
        { label: 'Avalanche', data: pad(sims.avalanche.timeline), color: seriesColor(1) },
        { label: 'Snowball', data: pad(sims.snowball.timeline), color: seriesColor(2) },
        { label: 'Minimums only', data: pad(sims.minimum.timeline), color: seriesColor(3), dashed: true },
      ],
      zeroLine: true,
    });
  }

  on(el, 'click', '[data-method]', (e, b) => { update('debtStrategy', (s) => { s.method = b.dataset.method; }); ctx.refresh(); });
  on(el, 'change', '[data-extra]', (e, inp) => { update('debtStrategy', (s) => { s.extraMonthly = Math.max(0, Number(inp.value) || 0); }); ctx.refresh(); });
  on(el, 'change', '[data-field]', (e, inp) => {
    const d = state.debts.find((x) => x.id === inp.dataset.id);
    const k = inp.dataset.field;
    update('debts', () => { d[k] = k === 'apr' ? (Number(inp.value) || 0) / 100 : inp.type === 'number' ? Math.max(0, Number(inp.value) || 0) : inp.value; });
    ctx.refresh();
  });
  on(el, 'click', '[data-action=add]', () => {
    update('debts', (l) => l.push({ id: uid('debt'), name: 'New debt', kind: 'credit_card', balance: 0, apr: 0.2, minPayment: 0, extraPayment: 0, notes: '' }));
    ctx.refresh();
  });
  on(el, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog('Delete this debt?'))) return;
    update('debts', (l) => l.filter((x) => x.id !== b.dataset.del));
    ctx.refresh();
  });
  on(el, 'click', '[data-pay]', async (e, b) => {
    const d = state.debts.find((x) => x.id === b.dataset.pay);
    const ok = await modal({
      title: `Payment · ${d.name}`,
      body: `<div class="form-grid">
        <label class="field">Amount paid<input type="number" step="0.01" name="amount" value="${d.minPayment}" required autofocus></label>
        <label class="field">Date<input type="date" name="date" value="${today()}"></label>
      </div>
      <p class="small muted" style="margin-top:8px">Up to the minimum (${money(d.minPayment)}) is filed under “Minimum Debt Payments”; anything above goes to “Extra Debt Payments”. Interest is not deducted here — update the balance from your statement for exact figures.</p>`,
      onSubmit(form, v) {
        const amt = round2(v.amount);
        const minPart = Math.min(amt, d.minPayment);
        const extraPart = round2(amt - minPart);
        update('debts', () => { d.balance = round2(Math.max(0, d.balance - amt)); });
        update('transactions', (l) => {
          const base = { type: 'expense', date: v.date, merchant: d.name, source: 'manual', note: 'Debt payment', debtId: d.id, createdAt: new Date().toISOString() };
          if (minPart > 0) l.push({ ...base, id: uid('tx'), amount: minPart, categoryId: 'min_debt' });
          if (extraPart > 0) l.push({ ...base, id: uid('tx'), amount: extraPart, categoryId: 'extra_debt' });
        });
        toast(d.balance === 0 ? `🎉 ${d.name} is paid off!` : `Payment logged · ${money(d.balance)} left`);
        return true;
      },
    });
    if (ok) ctx.refresh();
  });
}
