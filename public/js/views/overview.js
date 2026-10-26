// Overview: a money map. Money in sits in the centre circle; the pots around it (bills, fun,
// savings, investing, debt) are where it goes. Tap a pot to give it money — amounts are the
// same per-paycheck plan the Budget page uses, so both always agree.
import { state, update } from '../store.js';
import { esc, money, fmtDate, today, uid, round2, options, modal, toast, on } from '../util.js';
import { moneyMap, autoPlan, payTimeline } from '../calc.js';

let selected = 'needs';

const W = 720; const H = 600; const CX = W / 2; const CY = H / 2 + 6;
const RING = 200; const CENTER_R = 98;

function ensureBudget(key) {
  update('budgets', (b) => { b[key] ||= { income: {}, planned: {}, notes: {} }; }, { silent: true });
  return state.budgets[key];
}

function mapSvg(map) {
  const maxPlanned = Math.max(1, ...map.pots.map((p) => p.planned), map.funds / 3);
  const nodes = map.pots.map((p, i) => {
    const angle = (-90 + i * (360 / map.pots.length)) * (Math.PI / 180);
    const r = 48 + 26 * Math.sqrt(p.planned / maxPlanned);
    return { ...p, i, r, x: CX + RING * Math.cos(angle), y: CY + RING * Math.sin(angle), angle };
  });
  const spoke = (n) => {
    const share = map.funds ? Math.min(1, n.planned / map.funds) : 0;
    const x1 = CX + CENTER_R * Math.cos(n.angle); const y1 = CY + CENTER_R * Math.sin(n.angle);
    const x2 = n.x - n.r * Math.cos(n.angle); const y2 = n.y - n.r * Math.sin(n.angle);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--series-${n.i + 1})" stroke-opacity="${n.planned ? 0.45 : 0.15}" stroke-width="${2 + 18 * share}" stroke-linecap="round"/>`;
  };
  const node = (n) => {
    const ratio = n.planned ? n.spent / n.planned : n.spent ? 1 : 0;
    const ringR = n.r + 7;
    const circ = 2 * Math.PI * ringR;
    const over = n.spent > n.planned + 0.5;
    const labelY = n.y > CY + 20 ? n.y + n.r + 30 : n.y - n.r - 18;
    return `<g class="pot ${selected === n.id ? 'selected' : ''}" data-pot="${n.id}" role="button" tabindex="0" aria-label="${esc(n.label)}: ${money(n.planned, { cents: false })} assigned, ${money(n.spent, { cents: false })} spent">
      <title>${esc(n.label)} — ${money(n.planned)} assigned · ${money(n.spent)} spent</title>
      <circle cx="${n.x}" cy="${n.y}" r="${ringR}" fill="none" stroke="var(--series-${n.i + 1})" stroke-opacity="0.15" stroke-width="5"/>
      ${ratio ? `<circle cx="${n.x}" cy="${n.y}" r="${ringR}" fill="none" stroke="${over ? 'var(--critical)' : `var(--series-${n.i + 1})`}" stroke-width="5" stroke-linecap="round"
        stroke-dasharray="${Math.min(1, ratio) * circ} ${circ}" transform="rotate(-90 ${n.x} ${n.y})"/>` : ''}
      <circle class="pot-body" cx="${n.x}" cy="${n.y}" r="${n.r}" fill="var(--series-${n.i + 1})" fill-opacity="${selected === n.id ? 0.28 : 0.14}" stroke="var(--series-${n.i + 1})" stroke-width="${selected === n.id ? 3 : 1.5}"/>
      <text x="${n.x}" y="${n.y + 2}" text-anchor="middle" class="pot-amount">${money(n.planned, { cents: false, compact: true })}</text>
      <text x="${n.x}" y="${n.y + 22}" text-anchor="middle" class="pot-sub">${n.spent ? `${money(n.spent, { cents: false, compact: true })} spent` : 'tap to assign'}</text>
      <text x="${n.x}" y="${labelY}" text-anchor="middle" class="pot-label">${esc(n.label)}</text>
    </g>`;
  };
  const un = map.unassigned;
  return `<svg class="money-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money map: ${money(map.funds, { cents: false })} in, ${money(un, { cents: false })} unassigned">
    ${nodes.map(spoke).join('')}
    <g class="center" data-action="add-funds" role="button" tabindex="0" aria-label="Add money">
      <circle cx="${CX}" cy="${CY}" r="${CENTER_R}" fill="var(--accent)" fill-opacity="0.1" stroke="var(--accent)" stroke-width="2"/>
      <text x="${CX}" y="${CY - 40}" text-anchor="middle" class="pot-sub">Money in</text>
      <text x="${CX}" y="${CY - 6}" text-anchor="middle" class="center-amount">${money(map.funds, { cents: false })}</text>
      <text x="${CX}" y="${CY + 22}" text-anchor="middle" class="pot-sub ${un < -0.5 ? 'neg-fill' : ''}">${Math.abs(un) < 0.5 ? '✓ every dollar has a job' : un > 0 ? `${money(un, { cents: false })} unassigned` : `${money(-un, { cents: false })} over-assigned`}</text>
      <rect x="${CX - 52}" y="${CY + 38}" width="104" height="30" rx="15" fill="var(--accent)"/>
      <text x="${CX}" y="${CY + 58}" text-anchor="middle" class="center-btn">+ Add money</text>
    </g>
    ${nodes.map(node).join('')}
  </svg>`;
}

function panelHtml(map, pot) {
  const i = map.pots.indexOf(pot);
  return `<div class="card-head"><div><h2 class="row" style="gap:8px"><span class="dot" style="background:var(--series-${i + 1})"></span>${esc(pot.label)}</h2><p>${esc(pot.hint)}</p></div></div>
    <div class="kv small" style="margin-bottom:12px">
      <span>Assigned here</span><span>${money(pot.planned)}</span>
      <span>Spent so far</span><span class="${pot.spent > pot.planned + 0.5 ? 'neg' : ''}">${money(pot.spent)}</span>
      <span>Still unassigned (centre)</span><span class="${map.unassigned < -0.5 ? 'neg' : 'pos'}">${money(map.unassigned)}</span>
    </div>
    <div class="stack" style="gap:8px">${pot.rows.map((r) => `<div class="alloc-row">
      <div class="grow"><div class="small" style="font-weight:550">${esc(r.name.replace(/\s*\(.*\)$/, ''))}</div>
        <div class="small muted">${r.auto ? `${esc(r.auto.from)} · ` : ''}${r.actual ? `${money(r.actual, { cents: false })} spent` : 'nothing spent yet'}</div></div>
      <input type="number" class="num" min="0" step="1" data-alloc="${r.id}" data-key="alloc-${r.id}" value="${Math.round(r.planned) || ''}" placeholder="0" aria-label="${esc(r.name)} amount">
      <button class="btn small" data-rest="${r.id}" ${map.unassigned > 0.5 ? '' : 'disabled'} title="Give this the remaining unassigned money">+ rest</button>
    </div>`).join('')}</div>`;
}

export async function render(el, ctx) {
  const r = ctx.range;
  const map = moneyMap(state, r);
  const pot = map.pots.find((p) => p.id === selected) || map.pots[0];
  const tl = r.kind === 'period' ? payTimeline(state) : null;
  const next = tl?.pays[0];
  const viewingNext = next && r.from === next.payday;

  el.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row">
        ${r.kind === 'period' ? `<div class="seg">
          <button data-jump="${today()}" class="${!viewingNext && today() >= r.from && today() <= r.to ? 'active' : ''}">This paycheck</button>
          ${next ? `<button data-jump="${next.payday}" class="${viewingNext ? 'active' : ''}">Next pay · ${fmtDate(next.payday)}</button>` : ''}
        </div>` : ''}
        <span class="small muted">${esc(r.title)}</span>
      </div>
      <div class="row">
        <button class="btn small" data-action="auto" ${map.funds ? '' : 'disabled'}>Auto-split (${esc(map.summary.targets.rule)})</button>
        <button class="btn small" data-action="clear">Start over</button>
        <button class="btn primary small" data-action="add-funds">+ Add money</button>
      </div>
    </div>
    <div class="grid cols-3">
      <div class="card span-2" style="padding:8px">${mapSvg(map)}
        <p class="small muted" style="text-align:center;margin:0 0 6px">Circle size = money assigned · outer ring = how much of it is spent · tap a circle to assign money</p>
      </div>
      <div class="card" id="potPanel">${panelHtml(map, pot)}</div>
    </div>
    <div class="grid cols-5" style="margin-top:16px">
      ${map.pots.map((p, i) => `<button class="card tile pot-tile ${p.id === pot.id ? 'selected' : ''}" data-pot="${p.id}">
        <span class="tile-label row" style="gap:6px"><span class="dot" style="background:var(--series-${i + 1})"></span>${esc(p.label)}</span>
        <span class="tile-value">${money(p.planned, { cents: false })}</span>
        <span class="tile-sub">${map.funds ? `${Math.round((p.planned / map.funds) * 100)}% of money in` : ''}${p.spent ? ` · ${money(p.spent, { cents: false })} spent` : ''}</span>
      </button>`).join('')}
    </div>
    ${map.uncategorized ? `<div class="alert warn" style="margin-top:12px"><span class="alert-icon">?</span><div class="small">${money(map.uncategorized)} of spending has no category yet, so it isn't in any circle. <a href="#/transactions">Sort it</a></div></div>` : ''}`;

  const select = (id) => { selected = id; ctx.refresh(); };
  on(el, 'click', '[data-pot]', (e, g) => select(g.dataset.pot));
  on(el, 'keydown', '[data-pot]', (e, g) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(g.dataset.pot); } });
  on(el, 'click', '[data-jump]', (e, b) => { ctx.setDate(b.dataset.jump); ctx.refresh(); });

  const setPlanned = (id, value) => {
    const b = ensureBudget(r.key);
    update('budgets', () => { b.planned[id] = Math.max(0, round2(value)); });
    ctx.refresh();
  };
  on(el, 'change', '[data-alloc]', (e, inp) => setPlanned(inp.dataset.alloc, Number(inp.value) || 0));
  on(el, 'click', '[data-rest]', (e, b) => {
    const row = map.summary.rows.find((x) => x.id === b.dataset.rest);
    setPlanned(row.id, row.planned + Math.max(0, map.unassigned));
  });
  on(el, 'click', '[data-action=auto]', () => {
    const b = ensureBudget(r.key);
    const planned = autoPlan(state, r, map.funds);
    update('budgets', () => { b.planned = planned; });
    toast(`Split ${money(map.funds, { cents: false })} using your ${map.summary.targets.rule} targets — adjust any circle`);
    ctx.refresh();
  });
  on(el, 'click', '[data-action=clear]', () => {
    const b = ensureBudget(r.key);
    update('budgets', () => { b.planned = {}; });
    toast('Back to just your linked bills, savings and debt payments');
    ctx.refresh();
  });
  const addFunds = async () => {
    const inRange = today() >= r.from && today() <= r.to;
    const ok = await modal({
      title: 'Add money',
      body: `<div class="form-grid">
        <label class="field">Amount<input type="number" step="0.01" min="0" name="amount" required autofocus></label>
        <label class="field">From<select name="sourceId">${options(state.incomeSources, 'other_income')}</select></label>
        <label class="field">What is it<input name="merchant" placeholder="Tips, gift, refund, side job…"></label>
        <label class="field">Date<input type="date" name="date" value="${inRange ? today() : r.from}" min="${r.from}" max="${r.to}"></label>
      </div>
      <div class="seg" style="margin-top:12px"><label class="check" style="padding:6px 10px"><input type="radio" name="kind" value="received" checked> I have it now</label><label class="check" style="padding:6px 10px"><input type="radio" name="kind" value="expected"> Expecting it this period</label></div>`,
      submitLabel: 'Add to the centre',
      onSubmit(form, v) {
        const amount = round2(v.amount);
        if (!amount) throw new Error('Enter an amount');
        if (form.querySelector('input[name=kind]:checked').value === 'received') {
          update('transactions', (l) => l.push({ id: uid('tx'), type: 'income', date: v.date, amount, merchant: v.merchant.trim() || 'Added money', sourceId: v.sourceId, categoryId: '', source: 'manual', note: 'Added from Overview', createdAt: new Date().toISOString() }));
        } else {
          const b = ensureBudget(r.key);
          const current = map.summary.income.find((i) => i.id === v.sourceId);
          update('budgets', () => { b.income[v.sourceId] = round2((current?.planned || 0) + amount); });
        }
        toast(`${money(amount)} added — now tap a circle to give it a job`);
        return true;
      },
    });
    if (ok) ctx.refresh();
  };
  on(el, 'click', '[data-action=add-funds]', addFunds);
  on(el, 'keydown', '.center', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addFunds(); } });
}
