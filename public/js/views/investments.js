import { state, update } from '../store.js';
import {
  esc, money, pct, uid, modal, confirmDialog, options, toast, on, $, sum, round2, today, thisMonth, emptyState,
} from '../util.js';
import {
  INVESTMENT_TYPES, ASSET_CLASSES, investmentType, contributionLimit, ytdContributions, retirementPlan,
} from '../calc.js';
import { newInvestmentAccount } from '../seed.js';
import { lineChart, barChart, seriesColor } from '../charts.js';

// Keep a month-by-month record of the invested total for the trend line.
function snapshot() {
  update('investing', (inv) => {
    const total = round2(sum(inv.accounts, (a) => a.balance));
    inv.history = inv.history.filter((h) => h.month !== thisMonth());
    inv.history.push({ month: thisMonth(), total });
  }, { silent: true });
}

export async function render(el, ctx) {
  const plan = retirementPlan(state);
  const { inv } = plan;
  const st = state.investing.settings;
  const year = Number(today().slice(0, 4));
  const retirement = inv.accounts.filter((a) => a.typeInfo.bucket === 'retirement');

  el.innerHTML = `
    <div class="grid cols-4">
      <div class="card tile"><span class="tile-label">Invested</span><span class="tile-value">${money(inv.total, { cents: false })}</span><span class="tile-sub">${inv.accounts.length} accounts</span></div>
      <div class="card tile"><span class="tile-label">Going in each month</span><span class="tile-value">${money(plan.monthly, { cents: false })}</span><span class="tile-sub">You ${money(inv.monthlyYou, { cents: false })} + employer ${money(inv.monthlyMatch, { cents: false })}</span></div>
      <div class="card tile"><span class="tile-label">At age ${st.retireAge} (today's dollars)</span><span class="tile-value">${money(plan.atRetirement, { cents: false, compact: true })}</span><span class="tile-sub">at ${pct(st.expectedReturn)} return, ${pct(st.inflation)} inflation</span></div>
      <div class="card tile"><span class="tile-label">Financial independence</span><span class="tile-value">${pct(Math.min(1, plan.progress))}</span><span class="tile-sub">of ${money(plan.fiNumber, { cents: false, compact: true })} · ${plan.yearsToFI === null ? `not by ${st.retireAge}` : `in ~${plan.yearsToFI} yrs`}</span></div>
    </div>
    ${inv.missedMatch > 0.5 ? `<div class="alert bad" style="margin-top:16px"><span class="alert-icon">!</span><div>You're leaving <strong>${money(inv.missedMatch * 12, { cents: false })}/year</strong> of free employer match on the table. Raise your 401(k) contribution to ${money(sum(inv.accounts, (a) => a.match.needed), { cents: false })}/month.</div></div>` : ''}
    ${plan.neededMonthly > plan.monthly + 1 ? `<div class="alert warn" style="margin-top:12px"><span class="alert-icon">→</span><div>To reach financial independence (${money(plan.fiNumber, { cents: false })}) by age ${st.retireAge}, invest about <strong>${money(plan.neededMonthly, { cents: false })}/month</strong> — ${money(plan.neededMonthly - plan.monthly, { cents: false })} more than now.</div></div>` : plan.fiNumber ? `<div class="alert good" style="margin-top:12px"><span class="alert-icon">✓</span><div>At this pace you reach financial independence before ${st.retireAge}.</div></div>` : ''}

    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Accounts</h2><p>Balances count toward Net worth; monthly amounts fill the Retirement / Investing budget lines automatically.</p></div><button class="btn primary" data-action="add">+ Add account</button></div>
      ${inv.accounts.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Account</th><th class="num">Balance</th><th class="num">You add / month</th><th>${year} contributions</th><th>Employer match</th><th></th></tr></thead>
        <tbody>${inv.accounts.map((a) => {
    const limit = contributionLimit(a.type, st, year);
    const ytd = ytdContributions(state, a.id, year);
    return `<tr>
          <td><strong>${esc(a.name || a.typeInfo.name)}</strong><div class="small muted">${esc(a.typeInfo.name)}${a.updatedAt ? ` · value updated ${esc(a.updatedAt)}` : ''}</div></td>
          <td style="width:130px"><input class="cell num" type="number" step="0.01" data-acc="${a.id}" data-field="balance" value="${a.balance}"></td>
          <td style="width:120px"><input class="cell num" type="number" step="1" data-acc="${a.id}" data-field="monthly" value="${a.monthly}"></td>
          <td style="width:190px">${limit ? `<div class="meter ${ytd >= limit ? 'good' : ''}"><span style="width:${Math.min(100, (ytd / limit) * 100)}%"></span></div><div class="small muted">${money(ytd, { cents: false })} of ${money(limit, { cents: false })} limit</div>` : `<span class="small muted">${money(ytd, { cents: false })} · no limit</span>`}</td>
          <td class="small">${a.typeInfo.match ? (a.employerMatchRate ? `${pct(a.employerMatchRate)} up to ${pct(a.employerMatchUpTo, 1)} of pay → ${money(a.match.monthly, { cents: false })}/mo${a.match.missed > 0.5 ? ` <span class="badge bad">missing ${money(a.match.missed, { cents: false })}/mo</span>` : ' <span class="badge good">✓ full match</span>'}` : '<span class="muted">none set</span>') : '—'}</td>
          <td class="actions"><button class="btn small" data-contrib="${a.id}">+ Contribute</button> <button class="btn small" data-value="${a.id}">Update value</button> <button class="icon-btn small" data-edit="${a.id}" aria-label="Edit">✎</button> <button class="icon-btn small" data-del="${a.id}" aria-label="Delete">🗑</button></td>
        </tr>`;
  }).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${money(inv.total)}</td><td class="num">${money(inv.monthlyYou)}</td><td colspan="3"></td></tr></tfoot>
      </table></div>` : emptyState('📈', 'No investment accounts yet', 'Add your 401(k), Roth IRA, HSA or brokerage account.', '<button class="btn primary" data-action="add">+ Add account</button>')}
    </div>

    <div class="grid cols-3" style="margin-top:16px">
      <div class="card span-2">
        <div class="card-head"><div><h2>Growth projection</h2><p>Today's dollars, ${money(plan.monthly, { cents: false })}/month including match, until age ${st.retireAge}</p></div></div>
        ${plan.years ? '<div class="chart-box tall"><canvas id="growth" aria-label="Investment growth projection"></canvas></div>' : '<p class="muted">Set your age and retirement age below.</p>'}
      </div>
      <div class="card">
        <h2>Retirement assumptions</h2>
        <div class="form-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:10px">
          <label class="field">Your age<input type="number" data-st="currentAge" value="${st.currentAge}"></label>
          <label class="field">Retire at<input type="number" data-st="retireAge" value="${st.retireAge}"></label>
          <label class="field">Expected return %<input type="number" step="0.5" data-st="expectedReturn" data-pct value="${round2(st.expectedReturn * 100)}"></label>
          <label class="field">Inflation %<input type="number" step="0.5" data-st="inflation" data-pct value="${round2(st.inflation * 100)}"></label>
          <label class="field">Safe withdrawal %<input type="number" step="0.25" data-st="withdrawalRate" data-pct value="${round2(st.withdrawalRate * 100)}"></label>
          <label class="field">Yearly spending in retirement<input type="number" step="1000" data-st="retirementSpending" value="${st.retirementSpending || ''}" placeholder="${Math.round(plan.spending)}"></label>
        </div>
        <label class="check" style="margin-top:10px"><input type="checkbox" data-st="age50Plus" ${st.age50Plus ? 'checked' : ''}> Age 50+ (catch-up limits)</label>
        <label class="field" style="margin-top:8px">HSA coverage<select data-st="hsaCoverage">${options([{ id: 'self', name: 'Self-only' }, { id: 'family', name: 'Family' }], st.hsaCoverage)}</select></label>
        <p class="small muted" style="margin-top:8px">FI number = yearly spending ÷ withdrawal rate (the “4% rule” ≈ 25× spending). Blank spending uses 125% of your essentials.</p>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>Asset allocation</h2><p>Across all accounts — edit each account's mix with ✎</p></div></div>
        ${inv.total ? '<div class="chart-box short"><canvas id="alloc" aria-label="Asset allocation"></canvas></div>' : '<p class="muted">Add balances to see your mix.</p>'}
        <div class="kv small" style="margin-top:8px">${inv.allocation.filter((c) => c.value).map((c) => `<span>${esc(c.name)}</span><span>${money(c.value, { cents: false })} · ${pct(c.value / inv.total)}</span>`).join('')}</div>
      </div>
      <div class="card">
        <h2>Where the next dollar should go</h2>
        <div class="steps" style="margin-top:12px">${nextDollar(inv, st, year).map((x, i) => `<div class="step ${x.done ? 'done' : ''}"><span class="step-mark">${x.done ? '✓' : i + 1}</span><div><strong>${esc(x.title)}</strong><div class="small muted">${esc(x.detail)}</div></div></div>`).join('')}</div>
        <p class="small muted" style="margin-top:10px">2026 limits: 401(k) $24,500 (+$8,000 at 50+), IRA $7,500 (+$1,100), HSA $4,400 self / $8,750 family. Pay off high-interest debt and keep an emergency fund before investing beyond the match.</p>
      </div>
    </div>`;

  if (plan.years) {
    const labels = plan.scenarios[0].points.map((_, i) => `${st.currentAge + i}`);
    lineChart($('#growth', el), {
      labels,
      datasets: [
        ...plan.scenarios.map((sc, i) => ({ label: `${pct(sc.ret)} return`, data: sc.points.map(round2), color: seriesColor([3, 1, 2][i]) })),
        { label: 'FI target', data: labels.map(() => round2(plan.fiNumber)), color: seriesColor(4), dashed: true },
      ],
    });
  }
  if (inv.total) {
    barChart($('#alloc', el), { horizontal: true, labels: inv.allocation.map((c) => c.name), datasets: [{ label: 'Value', data: inv.allocation.map((c) => round2(c.value)), color: seriesColor(1) }] });
  }

  on(el, 'change', '[data-acc]', (e, inp) => {
    const a = state.investing.accounts.find((x) => x.id === inp.dataset.acc);
    update('investing', () => { a[inp.dataset.field] = Math.max(0, Number(inp.value) || 0); if (inp.dataset.field === 'balance') a.updatedAt = today(); });
    snapshot();
    ctx.refresh();
  });
  on(el, 'change', '[data-st]', (e, inp) => {
    const k = inp.dataset.st;
    update('investing', (iv) => {
      iv.settings[k] = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : inp.dataset.pct !== undefined ? (Number(inp.value) || 0) / 100 : Number(inp.value) || 0;
    });
    ctx.refresh();
  });
  on(el, 'click', '[data-action=add]', async () => { if (await accountForm()) { snapshot(); ctx.refresh(); } });
  on(el, 'click', '[data-edit]', async (e, b) => { if (await accountForm(state.investing.accounts.find((a) => a.id === b.dataset.edit))) ctx.refresh(); });
  on(el, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog('Delete this account? Its balance leaves your net worth.'))) return;
    update('investing', (iv) => { iv.accounts = iv.accounts.filter((a) => a.id !== b.dataset.del); });
    snapshot();
    ctx.refresh();
  });
  on(el, 'click', '[data-contrib]', async (e, b) => { if (await contributeForm(state.investing.accounts.find((a) => a.id === b.dataset.contrib))) ctx.refresh(); });
  on(el, 'click', '[data-value]', async (e, b) => {
    const a = state.investing.accounts.find((x) => x.id === b.dataset.value);
    const ok = await modal({
      title: `Update value · ${a.name}`,
      body: `<p class="text-2">Enter the current balance from your statement or app. The change since last time is market growth plus contributions.</p>
        <label class="field">Current balance<input type="number" step="0.01" name="balance" value="${a.balance}" required autofocus></label>`,
      onSubmit(form, v) {
        const change = v.balance - a.balance;
        update('investing', () => { a.balance = round2(v.balance); a.updatedAt = today(); });
        snapshot();
        toast(`${a.name}: ${money(change, { sign: true })}`);
        return true;
      },
    });
    if (ok) ctx.refresh();
  });
}

function nextDollar(inv, st, year) {
  const k401 = inv.accounts.filter((a) => a.typeInfo.limit === 'k401');
  const has = (type) => inv.accounts.some((a) => a.type === type);
  const ytdFull = (limitKey) => inv.accounts.filter((a) => a.typeInfo.limit === limitKey).some((a) => ytdContributions(state, a.id, year) >= (contributionLimit(a.type, st, year) || Infinity) - 1);
  return [
    { title: 'Get the full employer match', detail: 'Free money — usually a 50–100% instant return.', done: k401.length > 0 && k401.every((a) => a.match.missed < 0.5) && k401.some((a) => a.match.needed > 0) },
    { title: 'Fund an HSA (if on a high-deductible plan)', detail: 'Tax-free in, tax-free growth, tax-free for medical costs.', done: has('hsa') },
    { title: 'Roth IRA up to the limit', detail: 'Tax-free growth; great while your tax bracket is low.', done: ytdFull('ira') },
    { title: 'Max out the 401(k)', detail: 'More tax-advantaged room before taxable investing.', done: ytdFull('k401') },
    { title: 'Taxable brokerage', detail: 'Low-cost index funds for anything beyond the above.', done: has('brokerage') && inv.accounts.some((a) => a.type === 'brokerage' && a.monthly > 0) },
  ];
}

async function accountForm(account) {
  const a = account || newInvestmentAccount('roth_ira', { name: '' });
  return modal({
    title: account ? `Edit ${account.name}` : 'Add investment account',
    wide: true,
    body: `<div class="form-grid">
      <label class="field">Name<input name="name" value="${esc(a.name)}" placeholder="Fidelity Roth IRA" required autofocus></label>
      <label class="field">Type<select name="type">${options(INVESTMENT_TYPES, a.type)}</select></label>
      <label class="field">Current balance<input type="number" step="0.01" name="balance" value="${a.balance}"></label>
      <label class="field">You contribute / month<input type="number" step="1" name="monthly" value="${a.monthly}"></label>
      <label class="field">Employer match % (e.g. 50)<input type="number" step="1" name="matchRate" value="${round2((a.employerMatchRate || 0) * 100)}"></label>
      <label class="field">…on contributions up to % of pay (e.g. 6)<input type="number" step="0.5" name="matchUpTo" value="${round2((a.employerMatchUpTo || 0) * 100)}"></label>
    </div>
    <h3 style="margin:16px 0 6px">Investment mix (%)</h3>
    <div class="form-grid">${ASSET_CLASSES.map((c) => `<label class="field">${c.name}<input type="number" step="1" name="alloc_${c.id}" value="${round2((a.allocation?.[c.id] || 0) * 100)}"></label>`).join('')}</div>
    <p class="small muted" style="margin-top:6px">A target-date fund is roughly 55% US / 35% international / 10% bonds when you're young. Match fields apply to 401(k)-type accounts.</p>`,
    onSubmit(form, v) {
      const allocation = Object.fromEntries(ASSET_CLASSES.map((c) => [c.id, (v[`alloc_${c.id}`] || 0) / 100]));
      const totalPct = sum(Object.values(allocation));
      if (totalPct && Math.abs(totalPct - 1) > 0.01) throw new Error(`Investment mix adds up to ${Math.round(totalPct * 100)}% — make it 100%`);
      const record = {
        ...a, name: v.name.trim() || investmentType(v.type).name, type: v.type, balance: round2(v.balance), monthly: v.monthly,
        employerMatchRate: (v.matchRate || 0) / 100, employerMatchUpTo: (v.matchUpTo || 0) / 100, allocation, updatedAt: account ? a.updatedAt : today(),
      };
      update('investing', (iv) => { const i = iv.accounts.findIndex((x) => x.id === record.id); if (i >= 0) iv.accounts[i] = record; else iv.accounts.push(record); });
      return true;
    },
  });
}

export async function contributeForm(a) {
  return modal({
    title: `Contribute to ${a.name}`,
    body: `<div class="form-grid">
      <label class="field">Amount<input type="number" step="0.01" name="amount" value="${a.monthly || ''}" required autofocus></label>
      <label class="field">Date<input type="date" name="date" value="${today()}"></label>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="record" checked> Record as spending under “${investmentType(a.type).bucket === 'retirement' ? 'Retirement' : 'Other Investing / Goals'}” (counts toward your savings rate)</label>`,
    onSubmit(form, v) {
      const amt = round2(v.amount);
      update('investing', () => { a.balance = round2(a.balance + amt); a.updatedAt = today(); });
      if (v.record) {
        update('transactions', (l) => l.push({
          id: uid('tx'), type: 'expense', date: v.date, amount: amt, merchant: a.name, investmentAccountId: a.id,
          categoryId: investmentType(a.type).bucket === 'retirement' ? 'retirement' : 'investing', source: 'manual', note: 'Investment contribution', createdAt: new Date().toISOString(),
        }));
      }
      snapshot();
      toast(`${money(amt)} added to ${a.name}`);
      return true;
    },
  });
}
