import { state, update } from '../store.js';
import { esc, money, pct, on, toast, sum, shiftMonth, monthLabel, round2, confirmDialog } from '../util.js';
import { monthSummary, suggestPlan, earningsForMonth, BUCKETS } from '../calc.js';

function ensure(month) {
  update('budgets', (b) => { b[month] ||= { income: {}, planned: {}, notes: {} }; }, { silent: true });
  return state.budgets[month];
}

function meterClass(actual, planned) {
  if (!planned) return actual ? 'bad' : '';
  const r = actual / planned;
  return r > 1.0001 ? 'bad' : r > 0.9 ? 'warn' : '';
}

export async function render(el, ctx) {
  const month = ctx.month;
  const m = monthSummary(state, month);
  const earnings = earningsForMonth(state, month);
  const bySource = {};
  for (const j of earnings.byJob) if (j.job.sourceId) bySource[j.job.sourceId] = (bySource[j.job.sourceId] || 0) + j.paidNet;
  const notes = state.budgets[month]?.notes || {};
  const rta = m.remainingToAssign;
  const prev = shiftMonth(month, -1);
  const sinkingTotal = sum(state.sinkingFunds, (f) => f.monthly);
  const minDebt = sum(state.debts.filter((d) => d.balance > 0), (d) => d.minPayment);
  const extraDebt = state.debtStrategy?.extraMonthly || 0;

  const catRows = (type) => m.rows.filter((r) => r.type === type).map((r) => {
    const diff = r.planned - r.actual;
    const share = m.plannedIncome ? r.planned / m.plannedIncome : 0;
    return `<tr>
      <td><a href="#/transactions" data-cat-link="${r.id}" class="text-2" style="text-decoration:none">${esc(r.name)}</a>${r.count ? ` <span class="small muted">· ${r.count}</span>` : ''}</td>
      <td class="small muted">${esc(r.suggested)}${m.plannedIncome && r.planned ? ` <span class="${r.mid && share > r.mid * 1.5 ? 'neg' : ''}">(${pct(share, 1)})</span>` : ''}</td>
      <td style="width:130px"><input class="cell num" type="number" step="1" min="0" data-plan="${r.id}" data-key="plan-${r.id}" value="${r.planned || ''}" placeholder="0"></td>
      <td class="num">${money(r.actual)}</td>
      <td class="num ${diff < 0 ? 'neg' : ''}">${money(diff)}</td>
      <td style="width:120px"><div class="meter ${meterClass(r.actual, r.planned)}"><span style="width:${r.planned ? Math.min(100, (r.actual / r.planned) * 100) : r.actual ? 100 : 0}%"></span></div></td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="grid cols-4">
      <div class="card tile"><span class="tile-label">Planned income</span><span class="tile-value">${money(m.plannedIncome, { cents: false })}</span><span class="tile-sub">Actual ${money(m.actualIncome, { cents: false })}</span></div>
      <div class="card tile"><span class="tile-label">Planned expenses</span><span class="tile-value">${money(m.plannedExpense, { cents: false })}</span><span class="tile-sub">Actual ${money(m.actualExpense, { cents: false })}</span></div>
      <div class="card tile"><span class="tile-label">Remaining to assign (goal $0)</span><span class="tile-value ${Math.abs(rta) < 1 ? 'pos' : rta < 0 ? 'neg' : ''}">${money(rta, { cents: false })}</span>
        <span class="tile-sub">${Math.abs(rta) < 1 ? '✓ Every dollar has a job' : rta > 0 ? 'Assign this to savings or a goal' : '! Planned more than you earn'}</span></div>
      <div class="card tile"><span class="tile-label">Actual surplus / (deficit)</span><span class="tile-value ${m.surplus < 0 ? 'neg' : 'pos'}">${money(m.surplus, { cents: false })}</span><span class="tile-sub">Savings rate ${pct(m.savingsRate)}</span></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="row">
        <strong>${monthLabel(month)}</strong><span class="spacer"></span>
        <button class="btn small" data-action="copy">Copy plan from ${monthLabel(prev, 'short')}</button>
        <button class="btn small" data-action="autofill">Auto-fill from ${esc(m.targets.rule)} targets</button>
        <button class="btn small" data-action="linked">Fill sinking funds & debt lines</button>
        <button class="btn small danger" data-action="clear">Clear plan</button>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card flush">
        <div class="card-head"><div><h2>Income (take-home)</h2><p>Actuals come from income transactions. Shift-based estimates come from Income & shifts.</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Source</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">From schedule</th></tr></thead>
          <tbody>${m.income.map((s) => `<tr>
            <td>${esc(s.name)}</td>
            <td style="width:130px"><input class="cell num" type="number" step="1" min="0" data-income="${s.id}" data-key="inc-${s.id}" value="${s.planned || ''}" placeholder="0"></td>
            <td class="num">${money(s.actual)}</td>
            <td class="num">${bySource[s.id] ? `${money(bySource[s.id])} <button class="btn small" data-use="${s.id}" data-amount="${round2(bySource[s.id])}">Use</button>` : '<span class="muted">—</span>'}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td>Total income</td><td class="num">${money(m.plannedIncome)}</td><td class="num">${money(m.actualIncome)}</td><td class="num">${earnings.paidNet ? money(earnings.paidNet) : ''}</td></tr></tfoot>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Dynamic targets · ${esc(m.targets.rule)}</h2><p>Change the rule in Settings. Targets are a share of planned income.</p></div></div>
        ${BUCKETS.map((b) => {
    const t = m.targets[b.id]; const target = m.plannedIncome * t; const planned = m.byType[b.id].planned;
    return `<div style="margin-bottom:14px">
            <div class="row between"><span class="row"><span class="dot ${b.id}"></span><strong>${b.label}</strong> <span class="muted small">${pct(t)} target</span></span>
            <span class="small">${money(planned, { cents: false })} planned of ${money(target, { cents: false })}</span></div>
            <div class="meter ${b.id !== 'savings' && planned > target * 1.05 ? 'bad' : ''}" style="margin-top:6px"><span style="width:${target ? Math.min(100, (planned / target) * 100) : 0}%"></span></div>
          </div>`;
  }).join('')}
        <div class="kv small" style="margin-top:6px">
          <span>Sinking funds monthly total</span><span>${money(sinkingTotal)}</span>
          <span>Debt minimums</span><span>${money(minDebt)}</span>
          <span>Planned extra debt payment</span><span>${money(extraDebt)}</span>
        </div>
      </div>
    </div>

    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Expenses — every dollar has a job</h2><p>Enter planned amounts; actuals fill in from transactions and scanned receipts.</p></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Category</th><th>Suggested % of income</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Difference</th><th>Used</th></tr></thead>
        <tbody>
          ${BUCKETS.map((b) => `<tr class="group-row"><td colspan="6"><span class="row"><span class="dot ${b.id}"></span>${b.label}</span></td></tr>${catRows(b.id)}`).join('')}
          ${m.uncategorized.length ? `<tr><td class="neg">⚠ Uncategorized (${m.uncategorized.length})</td><td></td><td></td><td class="num">${money(sum(m.uncategorized, (t) => t.amount))}</td><td></td><td><a href="#/transactions" class="btn small">Fix</a></td></tr>` : ''}
        </tbody>
      </table></div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h2>Totals by type</h2>
        <div class="table-wrap" style="margin-top:8px"><table class="table-compact">
          <thead><tr><th>Type</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Difference</th></tr></thead>
          <tbody>${BUCKETS.map((b) => `<tr><td><span class="row"><span class="dot ${b.id}"></span>${b.label}</span></td><td class="num">${money(m.byType[b.id].planned)}</td><td class="num">${money(m.byType[b.id].actual)}</td><td class="num">${money(m.byType[b.id].planned - m.byType[b.id].actual)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Grand total</td><td class="num">${money(m.plannedExpense)}</td><td class="num">${money(m.actualExpense)}</td><td class="num">${money(m.plannedExpense - m.actualExpense)}</td></tr></tfoot>
        </table></div>
      </div>
      <div class="card">
        <h2>Cash flow summary</h2>
        <div class="kv" style="margin-top:10px">
          <span>Total planned income</span><span>${money(m.plannedIncome)}</span>
          <span>Total planned expenses</span><span>${money(m.plannedExpense)}</span>
          <span class="total">Remaining to assign</span><span class="total ${rta < 0 ? 'neg' : ''}">${money(rta)}</span>
          <span>Actual income</span><span>${money(m.actualIncome)}</span>
          <span>Actual expenses</span><span>${money(m.actualExpense)}</span>
          <span class="total">Actual surplus / (deficit)</span><span class="total ${m.surplus < 0 ? 'neg' : 'pos'}">${money(m.surplus)}</span>
        </div>
        <label class="field" style="margin-top:14px">Notes for ${monthLabel(month, 'short')}<textarea rows="2" data-note data-key="budget-note">${esc(notes._month || '')}</textarea></label>
      </div>
    </div>`;

  on(el, 'change', '[data-plan]', (e, inp) => {
    const b = ensure(month);
    update('budgets', () => { b.planned[inp.dataset.plan] = Math.max(0, Number(inp.value) || 0); });
    ctx.refresh();
  });
  on(el, 'change', '[data-income]', (e, inp) => {
    const b = ensure(month);
    update('budgets', () => { b.income[inp.dataset.income] = Math.max(0, Number(inp.value) || 0); });
    ctx.refresh();
  });
  on(el, 'click', '[data-use]', (e, btn) => {
    const b = ensure(month);
    update('budgets', () => { b.income[btn.dataset.use] = Number(btn.dataset.amount); });
    ctx.refresh();
  });
  on(el, 'change', '[data-note]', (e, t) => {
    const b = ensure(month);
    update('budgets', () => { b.notes._month = t.value; }, { silent: true });
  });
  on(el, 'click', '[data-cat-link]', (e, a) => {
    e.preventDefault();
    import('./transactions.js').then((t) => { t.setFilters({ category: a.dataset.catLink, type: 'expense' }); ctx.go('transactions'); });
  });
  on(el, 'click', '[data-action=copy]', () => {
    const src = state.budgets[prev];
    if (!src) return toast(`No plan saved for ${monthLabel(prev)}`, 'bad');
    update('budgets', (b) => { b[month] = { income: { ...src.income }, planned: { ...src.planned }, notes: { ...(b[month]?.notes || {}) } }; });
    toast(`Copied ${monthLabel(prev)} plan`);
    ctx.refresh();
  });
  on(el, 'click', '[data-action=autofill]', async () => {
    if (!m.plannedIncome) return toast('Enter planned income first', 'bad');
    if (m.plannedExpense && !(await confirmDialog('Replace the planned expense amounts with target-based suggestions?', { okLabel: 'Replace' }))) return;
    const b = ensure(month);
    update('budgets', () => { b.planned = suggestPlan(state, m.plannedIncome); });
    toast('Plan filled from targets — adjust to your real bills');
    ctx.refresh();
  });
  on(el, 'click', '[data-action=linked]', () => {
    const b = ensure(month);
    update('budgets', () => {
      b.planned.sinking_funds = round2(sinkingTotal);
      b.planned.min_debt = round2(minDebt);
      b.planned.extra_debt = round2(extraDebt);
    });
    toast('Sinking funds, debt minimums and extra debt payment filled in');
    ctx.refresh();
  });
  on(el, 'click', '[data-action=clear]', async () => {
    if (!(await confirmDialog(`Clear the plan for ${monthLabel(month)}? Transactions are kept.`, { okLabel: 'Clear' }))) return;
    update('budgets', (b) => { delete b[month]; });
    ctx.refresh();
  });
}
