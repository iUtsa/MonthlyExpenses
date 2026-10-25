import { state, update } from '../store.js';
import { esc, money, fmtDate, uid, modal, confirmDialog, options, toast, on, sum, round2, today, monthLabel } from '../util.js';
import { projectSaving } from '../calc.js';

const PRIORITIES = ['High', 'Medium', 'Low'].map((p) => ({ id: p, name: p }));
const isEmergency = (f) => /emergency/i.test(f.name);

export async function render(el, ctx) {
  const funds = state.sinkingFunds;
  const rows = funds.map((f) => ({ f, p: projectSaving({ target: f.target, current: f.balance, monthly: f.monthly, targetDate: f.dueDate }) }));
  const totalMonthly = sum(funds, (f) => f.monthly);
  const requiredMonthly = sum(rows, (r) => (r.f.dueDate ? r.p.requiredMonthly : r.f.monthly));
  const funded = rows.filter((r) => r.f.target > 0 && r.p.remaining === 0).length;
  const withTarget = rows.filter((r) => r.f.target > 0).length;
  const planned = state.budgets[ctx.month]?.planned?.sinking_funds || 0;

  el.innerHTML = `
    <div class="alert info"><span class="alert-icon">i</span><div>Irregular expenses (car repairs, insurance, holidays, medical deductibles) are the #1 cause of budget failure. Divide each known cost by the months until it's due and treat it like a monthly bill. Set a due date and the app works out the monthly amount for you.</div></div>
    <div class="grid cols-4" style="margin-top:16px">
      <div class="card tile"><span class="tile-label">Total monthly commitment</span><span class="tile-value">${money(totalMonthly, { cents: false })}</span><span class="tile-sub">${monthLabel(ctx.month, 'short')} budget line: ${money(planned, { cents: false })}</span></div>
      <div class="card tile"><span class="tile-label">Needed to hit every due date</span><span class="tile-value ${requiredMonthly > totalMonthly + 1 ? 'neg' : ''}">${money(requiredMonthly, { cents: false })}</span><span class="tile-sub">per month</span></div>
      <div class="card tile"><span class="tile-label">Saved so far</span><span class="tile-value">${money(sum(funds, (f) => f.balance), { cents: false })}</span><span class="tile-sub">of ${money(sum(funds, (f) => f.target), { cents: false })}</span></div>
      <div class="card tile"><span class="tile-label">Fully funded</span><span class="tile-value">${funded} of ${withTarget}</span><span class="tile-sub">funds</span></div>
    </div>
    <div class="row" style="margin:16px 0 8px">
      <button class="btn" data-action="to-budget">Send ${money(totalMonthly, { cents: false })} to ${monthLabel(ctx.month, 'short')} budget</button>
      <button class="btn" data-action="to-networth" title="Sets the Net Worth “Sinking Funds (total)” line. Emergency fund is excluded — it belongs in Savings.">Sync balances to Net Worth</button>
      <span class="spacer"></span>
      <button class="btn primary" data-action="add">+ Add fund</button>
    </div>
    <div class="card flush"><div class="table-wrap"><table>
      <thead><tr><th>Fund</th><th class="num">Target</th><th class="num">Balance</th><th class="num">Monthly</th><th>Due date</th><th>Priority</th><th>Progress</th><th class="num">Months to goal</th><th></th></tr></thead>
      <tbody>${rows.map(({ f, p }) => `<tr>
        <td><input class="cell" data-id="${f.id}" data-field="name" data-key="sf-${f.id}-n" value="${esc(f.name)}" style="min-width:200px">
          ${f.notes ? `<div class="small muted" style="padding-left:8px">${esc(f.notes)}</div>` : ''}</td>
        <td style="width:110px"><input class="cell num" type="number" data-id="${f.id}" data-field="target" value="${f.target}"></td>
        <td style="width:110px"><input class="cell num" type="number" data-id="${f.id}" data-field="balance" value="${f.balance}"></td>
        <td style="width:100px"><input class="cell num" type="number" data-id="${f.id}" data-field="monthly" value="${f.monthly}"></td>
        <td style="width:150px"><input class="cell" type="date" data-id="${f.id}" data-field="dueDate" value="${esc(f.dueDate || '')}">
          ${f.dueDate && p.remaining ? `<div class="small ${p.status === 'Behind' ? 'neg' : 'muted'}" style="padding-left:8px">needs ${money(p.requiredMonthly, { cents: false })}/mo${p.status === 'Behind' ? ` <button class="btn small" data-fix="${f.id}" data-amount="${Math.ceil(p.requiredMonthly)}">Fix</button>` : ''}</div>` : ''}</td>
        <td><select class="cell" data-id="${f.id}" data-field="priority">${options(PRIORITIES, f.priority)}</select></td>
        <td style="width:130px"><div class="meter ${p.remaining === 0 && f.target ? 'good' : ''}"><span style="width:${Math.round(p.progress * 100)}%"></span></div><div class="small muted">${Math.round(p.progress * 100)}% · ${money(p.remaining, { cents: false })} left</div></td>
        <td class="num">${p.remaining === 0 ? (f.target ? '✓' : '—') : p.monthsToGoal ?? '—'}${p.projectedDate && p.remaining ? `<div class="small muted">${fmtDate(p.projectedDate, { month: 'short', year: 'numeric' })}</div>` : ''}</td>
        <td class="actions"><button class="btn small" data-move="${f.id}">± Money</button> <button class="icon-btn small" data-del="${f.id}" aria-label="Delete">🗑</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(sum(funds, (f) => f.target))}</td><td class="num">${money(sum(funds, (f) => f.balance))}</td><td class="num">${money(totalMonthly)}</td><td colspan="5"></td></tr></tfoot>
    </table></div></div>
    <p class="small muted" style="margin-top:10px">Tip: when a fund reaches its target, pause it or redirect the monthly amount to your Emergency Fund, debt, or investing.</p>`;

  on(el, 'change', '[data-field]', (e, inp) => {
    const f = state.sinkingFunds.find((x) => x.id === inp.dataset.id);
    update('sinkingFunds', () => { f[inp.dataset.field] = inp.type === 'number' ? Math.max(0, Number(inp.value) || 0) : inp.value; });
    ctx.refresh();
  });
  on(el, 'click', '[data-fix]', (e, b) => {
    update('sinkingFunds', (l) => { l.find((x) => x.id === b.dataset.fix).monthly = Number(b.dataset.amount); });
    ctx.refresh();
  });
  on(el, 'click', '[data-action=add]', () => {
    update('sinkingFunds', (l) => l.push({ id: uid('sf'), name: 'New fund', target: 0, balance: 0, monthly: 0, priority: 'Medium', notes: '', dueDate: '' }));
    ctx.refresh();
  });
  on(el, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog('Delete this sinking fund?'))) return;
    update('sinkingFunds', (l) => l.filter((x) => x.id !== b.dataset.del));
    ctx.refresh();
  });
  on(el, 'click', '[data-action=to-budget]', () => {
    update('budgets', (b) => { b[ctx.month] ||= { income: {}, planned: {}, notes: {} }; b[ctx.month].planned.sinking_funds = round2(totalMonthly); });
    toast(`Budget line “Sinking Funds Total Monthly” set to ${money(totalMonthly)}`);
    ctx.refresh();
  });
  on(el, 'click', '[data-action=to-networth]', () => {
    const total = round2(sum(funds.filter((f) => !isEmergency(f)), (f) => f.balance));
    update('netWorth', (nw) => {
      const row = nw.assets.find((a) => a.id === 'sinking');
      if (row) row.value = total; else nw.assets.push({ id: 'sinking', name: 'Sinking Funds (total)', value: total, liquid: true, notes: '' });
    });
    toast(`Net Worth sinking-funds line set to ${money(total)}`);
  });
  on(el, 'click', '[data-move]', async (e, b) => {
    const f = state.sinkingFunds.find((x) => x.id === b.dataset.move);
    const ok = await modal({
      title: f.name,
      body: `<div class="form-grid">
        <label class="field">Action<select name="dir"><option value="in">Add contribution</option><option value="out">Spend from fund</option></select></label>
        <label class="field">Amount<input type="number" step="0.01" name="amount" value="${f.monthly || ''}" required autofocus></label>
        <label class="field">Date<input type="date" name="date" value="${today()}"></label>
      </div>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="record" checked> Also record a transaction</label>
      <p class="small muted" style="margin-top:6px">Contributions count toward the “Sinking Funds Total Monthly” budget line. Spending from a fund is logged as a transfer, so money you already set aside isn't counted twice.</p>`,
      onSubmit(form, v) {
        const amt = round2(v.amount);
        update('sinkingFunds', () => { f.balance = round2(Math.max(0, f.balance + (v.dir === 'in' ? amt : -amt))); });
        if (v.record) {
          update('transactions', (l) => l.push({
            id: uid('tx'), type: v.dir === 'in' ? 'expense' : 'transfer', date: v.date, amount: amt, merchant: v.dir === 'in' ? `Sinking fund: ${f.name}` : f.name,
            categoryId: v.dir === 'in' ? 'sinking_funds' : '', source: 'manual', note: v.dir === 'in' ? 'Contribution' : `Paid from ${f.name} fund`, createdAt: new Date().toISOString(),
          }));
        }
        toast(v.dir === 'in' ? `Added ${money(amt)} to ${f.name}` : `Spent ${money(amt)} from ${f.name}`);
        return true;
      },
    });
    if (ok) ctx.refresh();
  });
}
