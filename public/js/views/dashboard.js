import { state, categoryName } from '../store.js';
import { esc, money, pct, fmtDate, today, addDays, sum, monthLabel, monthsRange, statusBadge, $, on } from '../util.js';
import {
  monthSummary, netWorth, emergencyFund, highInterestDebt, healthScore, roadmap, billOccurrences, paychecks, projectSaving,
  computeShifts, investmentSummary,
} from '../calc.js';
import { barChart, seriesColor, scoreRing } from '../charts.js';

export async function render(el, ctx) {
  const m = monthSummary(state, ctx.month);
  const nw = netWorth(state);
  const ef = emergencyFund(state);
  const hi = highInterestDebt(state);
  const score = healthScore(state, ctx.month);
  const rm = roadmap(state, ctx.month);
  const funds = state.sinkingFunds.filter((f) => f.target > 0);
  const fundedCount = funds.filter((f) => projectSaving({ target: f.target, current: f.balance, monthly: f.monthly }).remaining === 0).length;
  const months = monthsRange(ctx.month, 6);
  const trend = months.map((mo) => monthSummary(state, mo));
  const topCats = m.rows.filter((r) => r.actual > 0).sort((a, b) => b.actual - a.actual).slice(0, 8);

  const soon = addDays(today(), 14);
  const upcoming = [
    ...state.bills.flatMap((b) => billOccurrences(b, today(), soon).map((d) => ({ date: d, label: b.name, amount: -b.amount, kind: 'bill' }))),
    ...paychecks(state, { from: today(), to: soon }).map((p) => ({ date: p.payday, label: `${p.job.name} payday`, amount: p.net, kind: 'pay' })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

  const alerts = [];
  for (const r of m.rows.filter((x) => x.planned > 0 && x.actual > x.planned).sort((a, b) => (b.actual - b.planned) - (a.actual - a.planned)).slice(0, 3)) {
    alerts.push(['bad', '!', `<strong>${esc(r.name)}</strong> is ${money(r.actual - r.planned)} over budget.`]);
  }
  for (const r of m.rows.filter((x) => x.planned > 0 && x.actual <= x.planned && x.actual >= x.planned * 0.9).slice(0, 2)) {
    alerts.push(['warn', '•', `<strong>${esc(r.name)}</strong> has used ${pct(r.actual / r.planned)} of its budget.`]);
  }
  if (m.uncategorized.length) alerts.push(['warn', '?', `${m.uncategorized.length} transactions need a category. <a href="#/transactions">Fix</a>`]);
  if (m.plannedIncome && Math.abs(m.remainingToAssign) >= 1) alerts.push([m.remainingToAssign < 0 ? 'bad' : 'info', '$', `${money(Math.abs(m.remainingToAssign))} ${m.remainingToAssign < 0 ? 'over-planned' : 'still to assign'} in the ${monthLabel(ctx.month, 'short')} budget. <a href="#/budget">Plan it</a>`]);
  if (state.debts.some((d) => d.balance > 0 && d.minPayment <= (d.balance * d.apr) / 12)) alerts.push(['bad', '!', 'A debt\'s minimum payment doesn\'t cover its interest. <a href="#/debts">Review</a>']);

  const isEmpty = !m.hasPlan && !state.transactions.length;
  const week = computeShifts(state).filter((x) => x.date >= today() && x.date <= addDays(today(), 7));
  const nextPay = paychecks(state, { from: today(), to: addDays(today(), 31) })[0];
  const inv = investmentSummary(state);

  el.innerHTML = `
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card span-2">
        <div class="card-head"><div><h2>Add something</h2><p>Drop a file and it goes to the right place — expenses, shifts, paychecks and your budget update together.</p></div></div>
        <div class="quick">
          <label class="dropzone" data-drop="receipt"><div class="big">🧾</div><strong>Receipt</strong><div class="small muted">photo or PDF → sorted expenses</div><input type="file" accept="image/*,application/pdf" multiple hidden data-file="receipt"></label>
          <label class="dropzone" data-drop="schedule"><div class="big">🗓</div><strong>Work schedule</strong><div class="small muted">screenshot, photo, PDF, CSV or .ics → shifts & pay</div><input type="file" accept="image/*,application/pdf,.csv,.xlsx,.xls,.ics,text/calendar" multiple hidden data-file="schedule"></label>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn small" data-quick="transaction">✎ Transaction</button>
          <a class="btn small" href="#/income?tab=shifts&add=1">⏱ Shift</a>
          <a class="btn small" href="#/bills">📅 Pay a bill</a>
          <a class="btn small" href="#/investments">📈 Invest</a>
          <a class="btn small" href="#/review">✓ Monthly review</a>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Coming up</h2><a class="btn small" href="#/income?tab=shifts">Shifts</a></div>
        ${week.length ? `<div class="list">${week.slice(0, 5).map((x) => `<div class="list-item"><span class="grow"><div class="title">${fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div class="small muted">${x.start}–${x.end} · ${esc(x.job?.name || '')}</div></span><span class="num small">${money(x.gross, { cents: false })}</span></div>`).join('')}</div>` : '<p class="small muted">No shifts in the next 7 days. Drop your schedule on the left.</p>'}
        ${nextPay ? `<div class="alert good" style="margin-top:10px"><span class="alert-icon">$</span><div class="small">Next payday <strong>${fmtDate(nextPay.payday, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>: about ${money(nextPay.net, { cents: false })} take-home</div></div>` : ''}
        ${inv.accounts.length ? `<div class="kv small" style="margin-top:10px"><span>Invested</span><span>${money(inv.total, { cents: false })}</span><span>Adding monthly</span><span>${money(inv.monthlyYou + inv.monthlyMatch, { cents: false })}</span></div>` : ''}
      </div>
    </div>
    ${isEmpty ? `<div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>Welcome! Set up in four steps</h2><p>Your workbook's sinking funds, debts, goals and net worth are already loaded.</p></div></div>
      <div class="grid cols-4">
        <a class="btn" href="#/settings">1 · Check income & allocation rule</a>
        <a class="btn" href="#/income">2 · Add your job & schedule</a>
        <a class="btn" href="#/budget">3 · Plan ${monthLabel(ctx.month, 'short')}</a>
        <a class="btn" href="#/receipts">4 · Scan your first receipt</a>
      </div></div>` : ''}

    <div class="grid cols-4">
      ${tile('Planned income', money(m.plannedIncome, { cents: false }), `Actual ${money(m.actualIncome, { cents: false })}`)}
      ${tile('Planned expenses', money(m.plannedExpense, { cents: false }), `Actual ${money(m.actualExpense, { cents: false })}`)}
      ${tile('Remaining to assign', money(m.remainingToAssign, { cents: false }), Math.abs(m.remainingToAssign) < 1 ? '✓ Zero-based' : 'Goal: $0', m.remainingToAssign < 0 ? 'neg' : '')}
      ${tile('Actual surplus / (deficit)', money(m.surplus, { cents: false }), `${monthLabel(ctx.month)}`, m.surplus < 0 ? 'neg' : 'pos')}
      ${tile('Savings rate (actual)', pct(m.savingsRate), `Planned ${pct(m.plannedSavingsRate)}`)}
      ${tile('Net worth', money(nw.net, { cents: false, compact: true }), `${money(nw.assets, { cents: false, compact: true })} assets · ${money(nw.liabilities, { cents: false, compact: true })} debt`, nw.net < 0 ? 'neg' : '')}
      ${tile('Emergency fund', `${ef.months.toFixed(1)} months`, `${statusBadge(ef.status)}`)}
      ${tile('High-interest debt', money(hi, { cents: false }), hi <= 0 ? '<span class="badge good">✓ Debt free!</span>' : hi < 5000 ? '<span class="badge warn">Manageable</span>' : '<span class="badge bad">! Focus here</span>')}
    </div>

    <div class="grid cols-3" style="margin-top:16px">
      <div class="card span-2">
        <div class="card-head"><div><h2>Allocation snapshot · actual vs target</h2><p>${esc(m.targets.rule)} rule · within ±5% counts as on track</p></div><a class="btn small" href="#/settings">Change rule</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Bucket</th><th class="num">Actual $</th><th class="num">Actual %</th><th class="num">Target %</th><th class="num">Variance</th><th>Status</th><th style="width:30%">vs target</th></tr></thead>
          <tbody>${m.allocation.map((a) => `<tr>
            <td><span class="row"><span class="dot ${a.id}"></span>${a.label}</span></td>
            <td class="num">${money(a.actual, { cents: false })}</td><td class="num">${pct(a.actualPct, 1)}</td><td class="num">${pct(a.target)}</td>
            <td class="num">${(a.variance * 100).toFixed(1)}%</td><td>${statusBadge(a.status)}</td>
            <td><div class="meter ${a.status === 'Over' ? 'bad' : ''}"><span style="width:${a.target ? Math.min(100, (a.actualPct / a.target) * 100) : 0}%"></span></div></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Financial health</h2><span class="badge ${score.total >= 60 ? 'good' : score.total >= 40 ? 'warn' : 'bad'}">${score.grade}</span></div>
        <div class="row" style="gap:16px;align-items:flex-start">
          ${scoreRing(score.total)}
          <div class="stack" style="gap:6px;flex:1;min-width:140px">${score.parts.map((p) => `<div title="${esc(p.detail)}"><div class="row between small"><span>${p.label}</span><span class="muted">${Math.round(p.score)}/${p.max}</span></div>
            <div class="meter" style="height:5px"><span style="width:${(p.score / p.max) * 100}%"></span></div></div>`).join('')}</div>
        </div>
        <div class="alert info" style="margin-top:12px"><span class="alert-icon">→</span><div class="small"><strong>Next step:</strong> ${rm.current < rm.steps.length ? esc(rm.steps[rm.current].title) : 'Keep building wealth'} · <a href="#/goals">Roadmap</a></div></div>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>Spending by category</h2><p>${monthLabel(ctx.month)} · top ${topCats.length}</p></div><a class="btn small" href="#/reports">Reports</a></div>
        ${topCats.length ? '<div class="chart-box"><canvas id="catChart" aria-label="Spending by category"></canvas></div>' : '<div class="empty">No spending recorded this month.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Income vs expenses</h2><p>Last 6 months</p></div></div>
        <div class="chart-box"><canvas id="trendChart" aria-label="Income versus expenses"></canvas></div>
      </div>
    </div>

    <div class="grid cols-3" style="margin-top:16px">
      <div class="card">
        <h2>Alerts</h2>
        <div class="stack" style="gap:8px;margin-top:10px">${alerts.length ? alerts.map(([k, i, t]) => `<div class="alert ${k}"><span class="alert-icon">${i}</span><div class="small">${t}</div></div>`).join('') : '<div class="alert good"><span class="alert-icon">✓</span><div class="small">All clear for this month.</div></div>'}
          <div class="kv small" style="margin-top:6px">
            <span>Sinking funds fully funded</span><span>${fundedCount} of ${funds.length}</span>
            <span>Liquid cash</span><span>${money(ef.liquid, { cents: false })}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Next 14 days</h2><a class="btn small" href="#/bills">Bills</a></div>
        ${upcoming.length ? `<div class="list">${upcoming.map((u) => `<div class="list-item"><span class="grow"><div class="title">${esc(u.label)}</div><div class="small muted">${fmtDate(u.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div></span><span class="num ${u.amount > 0 ? 'pos' : ''}">${money(u.amount, { sign: true })}</span></div>`).join('')}</div>` : '<div class="empty small">Add bills and jobs to see what\'s coming.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent transactions</h2><a class="btn small" href="#/transactions">All</a></div>
        ${state.transactions.length ? `<div class="list">${[...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 7).map((t) => `<div class="list-item"><span class="grow"><div class="title">${esc(t.merchant || '—')}</div><div class="small muted">${fmtDate(t.date)} · ${t.type === 'expense' ? esc(categoryName(t.categoryId)) : t.type}</div></span><span class="num ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : ''}${money(t.amount)}</span></div>`).join('')}</div>` : '<div class="empty small">No transactions yet. <a href="#/receipts">Scan a receipt</a></div>'}
      </div>
    </div>`;

  for (const zone of el.querySelectorAll('[data-drop]')) {
    const kind = zone.dataset.drop;
    const start = async (files) => {
      if (!files.length) return;
      if (kind === 'receipt') (await import('./receipts.js')).startReceipt([...files], ctx);
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

  if (topCats.length) {
    barChart($('#catChart', el), {
      horizontal: true,
      labels: topCats.map((r) => r.name.replace(/\s*\(.*\)$/, '')),
      datasets: [{ label: 'Spent', data: topCats.map((r) => r.actual), color: seriesColor(1) }],
    });
  }
  barChart($('#trendChart', el), {
    labels: months.map((mo) => monthLabel(mo, 'short')),
    datasets: [
      { label: 'Income', data: trend.map((t) => t.actualIncome), color: seriesColor(1) },
      { label: 'Expenses', data: trend.map((t) => t.actualExpense), color: seriesColor(2) },
    ],
  });
}

function tile(label, value, sub, cls = '') {
  return `<div class="card tile"><span class="tile-label">${label}</span><span class="tile-value ${cls}">${value}</span><span class="tile-sub">${sub}</span></div>`;
}
