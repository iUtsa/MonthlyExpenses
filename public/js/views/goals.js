import { state, update } from '../store.js';
import { esc, money, fmtDate, uid, modal, confirmDialog, toast, on, sum, round2, today } from '../util.js';
import { projectSaving, roadmap } from '../calc.js';

const STATUS = { 'On track': 'good', Behind: 'bad', Funded: 'good', 'No date': '', 'Not funded': 'warn' };

export async function render(el, ctx) {
  const rm = roadmap(state, ctx.month);
  const goals = state.goals.map((g) => ({ g, p: projectSaving(g) }));

  el.innerHTML = `
    <div class="grid cols-3">
      <div class="card">
        <h2>Your financial roadmap</h2>
        <p class="small muted" style="margin:4px 0 12px">The research-consensus order of operations. Steps tick themselves off from your data.</p>
        <div class="steps">${rm.steps.map((s, i) => `<div class="step ${s.done ? 'done' : i === rm.current ? 'current' : ''}">
          <span class="step-mark">${s.done ? '✓' : i + 1}</span>
          <div><strong>${esc(s.title)}</strong>${i === rm.current ? ' <span class="badge info">you are here</span>' : ''}<div class="small muted">${esc(s.detail)}</div></div></div>`).join('')}</div>
      </div>
      <div class="stack span-2">
        <div class="row between"><h2>Goals</h2><button class="btn primary" data-action="add">+ Add goal</button></div>
        <div class="grid cols-2">${goals.map(({ g, p }) => `<div class="card">
          <div class="card-head" style="margin-bottom:8px"><input class="cell" data-id="${g.id}" data-field="name" value="${esc(g.name)}" style="font-weight:600;font-size:15px"><span class="badge ${STATUS[p.status]}">${esc(p.status)}</span></div>
          <div class="row between"><span class="tile-value" style="font-size:20px">${money(g.current, { cents: false })}</span><span class="muted">of ${money(g.target, { cents: false })}</span></div>
          <div class="meter ${p.status === 'Behind' ? 'warn' : p.remaining === 0 ? 'good' : ''}" style="margin:8px 0"><span style="width:${Math.round(p.progress * 100)}%"></span></div>
          <div class="form-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
            <label class="field">Target $<input type="number" data-id="${g.id}" data-field="target" value="${g.target}"></label>
            <label class="field">Saved so far<input type="number" data-id="${g.id}" data-field="current" value="${g.current}"></label>
            <label class="field">Monthly $<input type="number" data-id="${g.id}" data-field="monthly" value="${g.monthly}"></label>
            <label class="field">Target date<input type="date" data-id="${g.id}" data-field="targetDate" value="${esc(g.targetDate || '')}"></label>
          </div>
          <div class="small text-2" style="margin-top:10px">
            ${p.remaining === 0 ? '🎉 Goal reached!' : `${p.monthsToGoal ? `At ${money(g.monthly, { cents: false })}/mo you'll get there in <strong>${p.monthsToGoal} months</strong> (${fmtDate(p.projectedDate, { month: 'short', year: 'numeric' })}).` : 'Set a monthly amount to see a finish date.'}
            ${g.targetDate && p.status === 'Behind' ? `<br>To hit ${fmtDate(g.targetDate, { month: 'short', year: 'numeric' })} you need <strong>${money(p.requiredMonthly, { cents: false })}/mo</strong>. <button class="btn small" data-fix="${g.id}" data-amount="${Math.ceil(p.requiredMonthly)}">Use this</button>` : ''}`}
          </div>
          <input class="cell small" data-id="${g.id}" data-field="notes" value="${esc(g.notes || '')}" placeholder="Next action…" style="margin-top:8px">
          <div class="row" style="margin-top:10px"><button class="btn small" data-contrib="${g.id}">+ Contribution</button><span class="spacer"></span><button class="icon-btn small" data-del="${g.id}" aria-label="Delete">🗑</button></div>
        </div>`).join('')}</div>
        <div class="card"><div class="kv">
          <span>Total saved toward goals</span><span>${money(sum(state.goals, (g) => g.current))}</span>
          <span>Monthly goal contributions</span><span>${money(sum(state.goals, (g) => g.monthly))}</span>
          <span>Still needed</span><span>${money(sum(goals, ({ p }) => p.remaining))}</span>
        </div></div>
      </div>
    </div>`;

  on(el, 'change', '[data-field]', (e, inp) => {
    const g = state.goals.find((x) => x.id === inp.dataset.id);
    update('goals', () => { g[inp.dataset.field] = inp.type === 'number' ? Math.max(0, Number(inp.value) || 0) : inp.value; });
    ctx.refresh();
  });
  on(el, 'click', '[data-fix]', (e, b) => { update('goals', (l) => { l.find((x) => x.id === b.dataset.fix).monthly = Number(b.dataset.amount); }); ctx.refresh(); });
  on(el, 'click', '[data-action=add]', () => {
    update('goals', (l) => l.push({ id: uid('goal'), name: 'New goal', target: 1000, current: 0, monthly: 50, targetDate: '', notes: '' }));
    ctx.refresh();
  });
  on(el, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog('Delete this goal?'))) return;
    update('goals', (l) => l.filter((x) => x.id !== b.dataset.del));
    ctx.refresh();
  });
  on(el, 'click', '[data-contrib]', async (e, b) => {
    const g = state.goals.find((x) => x.id === b.dataset.contrib);
    const ok = await modal({
      title: `Contribute to ${g.name}`,
      body: `<div class="form-grid"><label class="field">Amount<input type="number" step="0.01" name="amount" value="${g.monthly}" required autofocus></label>
        <label class="field">Date<input type="date" name="date" value="${today()}"></label></div>
        <label class="check" style="margin-top:12px"><input type="checkbox" name="record" checked> Record as a transaction under “Other Investing / Goals”</label>`,
      onSubmit(form, v) {
        update('goals', () => { g.current = round2(g.current + v.amount); });
        if (v.record) update('transactions', (l) => l.push({ id: uid('tx'), type: 'expense', date: v.date, amount: round2(v.amount), merchant: `Goal: ${g.name}`, categoryId: 'investing', source: 'manual', note: 'Goal contribution', createdAt: new Date().toISOString() }));
        toast(`${money(v.amount)} added to ${g.name}`);
        return true;
      },
    });
    if (ok) ctx.refresh();
  });
}
