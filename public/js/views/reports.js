import { state } from '../store.js';
import { esc, money, pct, sum, monthLabel, fmtDate, on, $, emptyState } from '../util.js';
import { monthSummary, BUCKETS, rangesBack } from '../calc.js';
import { barChart, lineChart, seriesColor, bucketColor } from '../charts.js';
import { exportWorkbook } from '../exporter.js';

let span = 0; // index into the span choices for the current planning mode

export async function render(el, ctx) {
  const byPaycheck = ctx.range.kind === 'period';
  const choices = byPaycheck ? [[6, '6 paychecks'], [13, '6 months'], [26, '1 year']] : [[3, '3 months'], [6, '6 months'], [12, '12 months']];
  const range = choices[Math.min(span, 2)][0];
  const months = rangesBack(state, ctx.range, range);
  const sums = months.map((m) => monthSummary(state, m));
  const from = months[0].from;
  const to = ctx.range.to;
  const tx = state.transactions.filter((t) => t.date >= from && t.date <= to);
  const unit = byPaycheck ? 'paycheck' : 'mo';
  const short = (r) => (r.kind === 'period' ? fmtDate(r.from) : monthLabel(r.key, 'short'));
  const expenses = tx.filter((t) => t.type === 'expense');
  const totalIncome = sum(sums, (s) => s.actualIncome);
  const totalExpense = sum(sums, (s) => s.actualExpense);

  const merchants = new Map();
  for (const t of expenses) {
    const key = (t.merchant || 'Unknown').trim();
    const m = merchants.get(key) || { name: key, count: 0, total: 0 };
    m.count++; m.total += t.amount;
    merchants.set(key, m);
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.total - a.total).slice(0, 12);
  const catRows = state.categories.map((c) => ({ c, values: sums.map((s) => s.rows.find((r) => r.id === c.id)?.actual || 0) }))
    .filter((r) => r.values.some((v) => v));

  el.innerHTML = `
    <div class="row between" style="margin-bottom:16px">
      <div class="seg">${choices.map(([n, label], i) => `<button data-range="${i}" class="${range === n ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div class="row"><span class="small muted">${fmtDate(from)} – ${fmtDate(to)}</span>
        <button class="btn primary" data-action="xlsx">⇩ Export Excel workbook</button></div>
    </div>
    <div class="grid cols-4">
      <div class="card tile"><span class="tile-label">Income</span><span class="tile-value">${money(totalIncome, { cents: false })}</span><span class="tile-sub">avg ${money(totalIncome / range, { cents: false })}/${unit}</span></div>
      <div class="card tile"><span class="tile-label">Expenses</span><span class="tile-value">${money(totalExpense, { cents: false })}</span><span class="tile-sub">avg ${money(totalExpense / range, { cents: false })}/${unit}</span></div>
      <div class="card tile"><span class="tile-label">Net saved</span><span class="tile-value ${totalIncome - totalExpense < 0 ? 'neg' : 'pos'}">${money(totalIncome - totalExpense, { cents: false })}</span><span class="tile-sub">${totalIncome ? pct((totalIncome - totalExpense) / totalIncome) : '—'} of income</span></div>
      <div class="card tile"><span class="tile-label">Transactions</span><span class="tile-value">${tx.length}</span><span class="tile-sub">${state.receipts.filter((r) => r.date >= from && r.date <= to).length} receipts scanned</span></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Income vs expenses</h2></div><div class="chart-box"><canvas id="ie"></canvas></div></div>
      <div class="card"><div class="card-head"><div><h2>Where the money went</h2><p>Needs, wants, savings & debt by month</p></div></div><div class="chart-box"><canvas id="buckets"></canvas></div></div>
      <div class="card"><div class="card-head"><div><h2>Savings rate</h2><p>Savings & debt lines ÷ actual income</p></div></div><div class="chart-box short"><canvas id="rate"></canvas></div></div>
      <div class="card flush"><div class="card-head"><h2>Top merchants</h2></div>
        ${topMerchants.length ? `<div class="table-wrap"><table class="table-compact"><thead><tr><th>Merchant</th><th class="num">Visits</th><th class="num">Total</th><th class="num">Avg</th></tr></thead>
        <tbody>${topMerchants.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${m.count}</td><td class="num">${money(m.total)}</td><td class="num">${money(m.total / m.count)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('🏪', 'No spending yet')}
      </div>
    </div>
    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Category trends</h2><p>Monthly actuals; the last column is the monthly average.</p></div></div>
      ${catRows.length ? `<div class="table-wrap"><table class="table-compact">
        <thead><tr><th>Category</th>${months.map((m) => `<th class="num">${short(m)}</th>`).join('')}<th class="num">Average</th></tr></thead>
        <tbody>${catRows.map(({ c, values }) => `<tr><td><span class="row"><span class="dot ${c.type}"></span>${esc(c.name)}</span></td>${values.map((v) => `<td class="num">${v ? money(v, { cents: false }) : '<span class="muted">—</span>'}</td>`).join('')}<td class="num"><strong>${money(sum(values) / range, { cents: false })}</strong></td></tr>`).join('')}</tbody>
      </table></div>` : emptyState('▥', 'No categorized spending in this range')}
    </div>`;

  const labels = months.map(short);
  barChart($('#ie', el), { labels, datasets: [
    { label: 'Income', data: sums.map((s) => s.actualIncome), color: seriesColor(1) },
    { label: 'Expenses', data: sums.map((s) => s.actualExpense), color: seriesColor(2) },
  ] });
  barChart($('#buckets', el), { labels, stacked: true, datasets: BUCKETS.map((b) => ({ label: b.label, data: sums.map((s) => s.byType[b.id].actual), color: bucketColor(b.id) })) });
  const rateChart = lineChart($('#rate', el), { labels, datasets: [{ label: 'Savings rate', data: sums.map((s) => Math.round(s.savingsRate * 1000) / 10), color: seriesColor(3) }], moneyAxis: false, zeroLine: true, area: true });
  if (rateChart) {
    rateChart.options.scales.y.ticks.callback = (v) => `${v}%`;
    rateChart.options.plugins.tooltip.callbacks.label = (c) => ` ${c.parsed.y}%`;
    rateChart.update();
  }

  on(el, 'click', '[data-range]', (e, b) => { span = Number(b.dataset.range); ctx.refresh(); });
  on(el, 'click', '[data-action=xlsx]', () => exportWorkbook(ctx.month));
}
