import { state, update, api, loadState, flushAll, categoryName } from '../store.js';
import { download } from '../util.js';
import {
  esc, pct, uid, on, $, options, toast, confirmDialog, modal, today, addDays, shiftMonth, round2, monthsRange,
} from '../util.js';
import { RULES, incomeBracket, targets } from '../calc.js';
import { exportWorkbook, importPlannerWorkbook } from '../exporter.js';

const RULE_OPTIONS = [
  ...Object.keys(RULES).map((r) => ({ id: r, name: r === '40/30/20/10' ? '40/30/20/10 (needs/wants/savings/giving)' : r })),
  { id: 'auto', name: 'Auto — adapt to my income bracket' },
  { id: 'custom', name: 'Custom percentages' },
];
const TYPES = [{ id: 'need', name: 'Need' }, { id: 'want', name: 'Want' }, { id: 'savings', name: 'Savings & Debt' }];

export async function render(el, ctx) {
  const s = state.settings;
  const t = targets(s);
  const bracket = incomeBracket(s.annualGross);
  const usage = new Map();
  for (const tx of state.transactions) usage.set(tx.categoryId, (usage.get(tx.categoryId) || 0) + 1);

  const account = ctx.user ? `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>Your account</h2><p>${esc(ctx.user.email)}${ctx.user.isAdmin ? ' · site owner' : ''}</p></div>
        <button class="btn" data-signout>Sign out</button></div>
      <div class="grid cols-3">
        <form class="stack" id="pwForm" style="gap:8px">
          <h3>Change password</h3>
          <input type="email" name="username" value="${esc(ctx.user.email)}" autocomplete="username" hidden>
          <input type="password" name="current" placeholder="Current password" autocomplete="current-password" required>
          <input type="password" name="next" placeholder="New password (8+ characters)" autocomplete="new-password" required minlength="8">
          <button class="btn" type="submit">Update password</button>
          <p class="small muted" style="margin:0">Signs you out on other devices.</p>
        </form>
        <div>
          <h3>AI reading today</h3>
          <p class="text-2" style="margin-top:6px">${ctx.ai.enabled ? (ctx.ai.limit ? `${Math.max(0, ctx.ai.limit - ctx.ai.used)} of ${ctx.ai.limit} reads left (resets at midnight UTC). After that, on-device reading still works.` : 'Unlimited for your account.') : 'AI reading is not configured on this site.'}</p>
        </div>
        <div>
          <h3>Delete account</h3>
          <p class="small text-2" style="margin:6px 0">Permanently erases your account, data and uploaded photos. Download a backup first if you want to keep anything.</p>
          <button class="btn danger" data-action="delete-account">Delete my account…</button>
        </div>
      </div>
    </div>` : '';

  el.innerHTML = `${account}
    <div class="grid cols-2">
      <div class="card">
        <h2>Profile & assumptions</h2>
        <div class="form-grid" style="margin-top:12px">
          <label class="field">Name / household<input data-s="name" value="${esc(s.name)}"></label>
          <label class="field">Location<input data-s="location" value="${esc(s.location)}"></label>
          <label class="field">Currency<select data-s="currency">${options(['USD', 'CAD', 'EUR', 'GBP', 'INR', 'AUD'].map((c) => ({ id: c, name: c })), s.currency)}</select></label>
          <label class="field">Annual gross household income<input type="number" data-s="annualGross" value="${s.annualGross}"></label>
          <label class="field">Monthly essential expenses<input type="number" data-s="monthlyEssentials" value="${s.monthlyEssentials}"></label>
          <label class="field">Emergency fund target (months)<input type="number" data-s="efTargetMonths" value="${s.efTargetMonths}" min="1" max="24"></label>
          <label class="field">“High-interest” debt is APR ≥ (%)<input type="number" step="0.5" data-s="highInterestApr" data-pct value="${round2(s.highInterestApr * 100)}"></label>
          <label class="field span-2">Your name(s) on work schedules (comma-separated)<input data-names value="${esc([s.schedulePerson, ...(s.scheduleAliases || [])].filter(Boolean).join(', '))}" placeholder="Arnab, Arnab Das, A. Das"></label>
          <label class="field">Workweek starts on<select data-s="weekStartsOn">${options(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((n, i) => ({ id: i, name: n })), s.weekStartsOn)}</select></label>
        </div>
        <label class="check" style="margin-top:12px"><input type="checkbox" data-s="employerMatch" ${s.employerMatch ? 'checked' : ''}> I contribute enough to get my full employer retirement match</label>
        <p class="small muted" style="margin-top:8px">Income bracket: <strong>${esc(bracket.label)}</strong>. Essentials are used for emergency-fund months (3 months minimum; 6 recommended; 9–12 if self-employed or on irregular income).</p>
      </div>
      <div class="card">
        <h2>Allocation rule</h2>
        <p class="small muted">Changes targets across the dashboard, budget and reports.</p>
        <label class="field" style="margin-top:12px">Rule<select data-s="rule">${options(RULE_OPTIONS, s.rule)}</select></label>
        ${s.rule === 'custom' ? `<div class="form-grid" style="margin-top:10px">${TYPES.map((x) => `<label class="field">${x.name} %<input type="number" data-custom="${x.id}" value="${round2(s.customTargets[x.id] * 100)}"></label>`).join('')}</div>
          ${Math.abs(s.customTargets.need + s.customTargets.want + s.customTargets.savings - 1) > 0.001 ? '<p class="small neg">Custom percentages should add up to 100%.</p>' : ''}` : ''}
        <div class="grid cols-3" style="margin-top:14px">${TYPES.map((x) => `<div class="tile"><span class="tile-label"><span class="dot ${x.id}"></span> ${x.name}</span><span class="tile-value">${pct(t[x.id])}</span></div>`).join('')}</div>
        <table class="table-compact" style="margin-top:14px">
          <thead><tr><th>Bracket</th><th>Needs</th><th>Savings</th><th>Housing</th><th>Focus</th></tr></thead>
          <tbody>${[30000, 70000, 150000].map((g) => incomeBracket(g)).map((x) => `<tr ${x.id === bracket.id ? 'style="font-weight:600"' : ''}><td>${esc(x.label)}</td><td>${x.needs}</td><td>${x.savings}</td><td>${x.housing}</td><td class="small">${esc(x.focus)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Budget categories</h2><p>Keywords drive auto-categorization of imports and on-device receipt scans.</p></div><button class="btn small" data-action="add-cat">+ Category</button></div>
      <div class="table-wrap"><table class="table-compact">
        <thead><tr><th>Name</th><th>Type</th><th>Suggested %</th><th>Keywords (comma-separated)</th><th class="num">Used</th><th></th></tr></thead>
        <tbody>${state.categories.map((c) => `<tr>
          <td><input class="cell" data-cat="${c.id}" data-field="name" value="${esc(c.name)}" style="min-width:240px"></td>
          <td><select class="cell" data-cat="${c.id}" data-field="type">${options(TYPES, c.type)}</select></td>
          <td style="width:100px"><input class="cell" data-cat="${c.id}" data-field="suggested" value="${esc(c.suggested)}"></td>
          <td><input class="cell small" data-cat="${c.id}" data-field="keywords" value="${esc((c.keywords || []).join(', '))}" style="min-width:280px"></td>
          <td class="num">${usage.get(c.id) || 0}</td>
          <td class="actions"><button class="icon-btn small" data-del-cat="${c.id}" aria-label="Delete">🗑</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>Income sources</h2><button class="btn small" data-action="add-src">+ Source</button></div>
        ${state.incomeSources.map((x) => `<div class="row" style="margin-bottom:6px"><input style="flex:1" data-src="${x.id}" value="${esc(x.name)}"></div>`).join('')}
      </div>
      <div class="card">
        <h2>Learned merchant rules</h2>
        <p class="small muted">Created when you re-categorize a transaction. They override keywords.</p>
        ${state.rules.length ? `<div class="list">${state.rules.map((r) => `<div class="list-item"><span class="grow small"><strong>${esc(r.match)}</strong> → ${esc(categoryName(r.categoryId))}</span><button class="icon-btn small" data-del-rule="${r.id}" aria-label="Delete">✕</button></div>`).join('')}</div>` : '<p class="small muted" style="margin-top:8px">None yet.</p>'}
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h2>AI document reading</h2>
        ${ctx.ai.mode === 'browser' ? `
          <p class="small muted" style="margin-top:6px">This copy runs entirely in your browser. Without a key, receipts are read with on-device OCR. An Anthropic key turns on AI reading here. NVIDIA keys only work in the local version (<code>npm start</code>) because NVIDIA's API blocks calls made directly from web pages.</p>
          <div class="row" style="margin-top:10px">
            <input type="password" id="apiKey" placeholder="${ctx.ai.enabled ? '•••••••• key saved in this browser' : 'sk-ant-…'}" autocomplete="off" style="flex:1;min-width:200px">
            <button class="btn primary" data-action="save-key">Save key</button>
            ${ctx.ai.enabled ? '<button class="btn danger" data-action="clear-key">Remove</button>' : ''}
          </div>
          <div class="alert ${ctx.ai.enabled ? 'good' : 'info'}" style="margin-top:10px"><span class="alert-icon">${ctx.ai.enabled ? '✓' : 'i'}</span><div class="small">${ctx.ai.enabled ? `AI reading is on (${esc(ctx.ai.model)}).` : 'Create a key at console.anthropic.com.'} The key is stored only in this browser's local storage and sent only to api.anthropic.com. Use a key with a spending limit, and don't save it on shared computers.</div></div>`
    : ctx.ai.enabled ? `<div class="alert good" style="margin-top:10px"><span class="alert-icon">✓</span><div>On, using <strong>${esc(ctx.ai.model)}</strong>. Receipts, schedules and pay stubs are read by ${ctx.ai.provider === 'nvidia' ? 'NVIDIA-hosted vision models (build.nvidia.com)' : 'Claude'} through the API key in <code>.env</code>.</div></div>`
      : `<div class="alert info" style="margin-top:10px"><span class="alert-icon">i</span><div class="small">Currently using on-device OCR. For much better receipt line items, schedule reading and pay-stub parsing:
          <ol style="margin:6px 0 0;padding-left:18px"><li>Get a free API key at build.nvidia.com (or an Anthropic key)</li><li>Copy <code>.env.example</code> to <code>.env</code> and set <code>NVIDIA_API_KEY=nvapi-…</code> (or <code>ANTHROPIC_API_KEY</code>)</li><li>Restart with <code>npm start</code></li></ol></div></div>`}
        <p class="small muted" style="margin-top:10px">${ctx.ai.mode === 'browser' ? 'Your data and photos are stored in this browser (IndexedDB) — back up regularly; clearing site data erases them.' : 'Uploaded images are stored in <code>data/uploads</code> on this computer.'} With AI on, each document you scan is sent to the AI provider (${ctx.ai.provider === 'nvidia' ? 'NVIDIA' : 'Anthropic'}) to be read.</p>
      </div>
      <div class="card">
        <h2>Data</h2>
        <p class="small muted">${ctx.ai.mode === 'browser' ? 'Everything is saved in this browser only. Use Backup to move it to another device.' : 'Everything is saved to your account. Backup downloads a copy you can restore any time.'}</p>
        <div class="row" style="margin-top:12px">
          <button class="btn" data-action="backup">⇩ Backup (JSON)</button>
          <label class="btn">⇧ Restore backup<input type="file" id="restore" accept=".json,application/json" hidden></label>
          <button class="btn" data-action="xlsx">⇩ Export Excel</button>
          <label class="btn">⇧ Import planner .xlsx<input type="file" id="importXlsx" accept=".xlsx" hidden></label>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn" data-action="demo">Load demo data</button>
          <button class="btn" data-action="undemo">Remove demo data</button>
          <span class="spacer"></span>
          <button class="btn danger" data-action="reset">Reset everything</button>
        </div>
      </div>
    </div>`;

  on(el, 'change', '[data-s]', (e, inp) => {
    const k = inp.dataset.s;
    update('settings', (x) => {
      if (inp.type === 'checkbox') x[k] = inp.checked;
      else if (inp.type === 'number') x[k] = inp.dataset.pct !== undefined ? (Number(inp.value) || 0) / 100 : Number(inp.value) || 0;
      else x[k] = k === 'weekStartsOn' ? Number(inp.value) : inp.value;
    });
    ctx.refresh();
  });
  $('#pwForm', el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/auth/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      f.reset();
      toast('Password updated');
    } catch (err) { toast(err.message, 'bad'); }
  });
  on(el, 'click', '[data-action=delete-account]', async () => {
    const ok = await modal({
      title: 'Delete your account?',
      body: `<p>This permanently deletes <strong>${esc(ctx.user.email)}</strong>, all your budgets, transactions, shifts and uploaded photos. It can't be undone.</p>
        <label class="field">Type your password to confirm<input type="password" name="password" required autocomplete="current-password"></label>`,
      submitLabel: 'Delete everything',
      onSubmit: async (form, v) => { await api('/api/auth/delete', { method: 'POST', body: { password: v.password } }); return true; },
    });
    if (ok) { location.hash = ''; location.reload(); }
  });
  on(el, 'change', '[data-names]', (e, inp) => {
    const names = inp.value.split(',').map((x) => x.trim()).filter(Boolean);
    update('settings', (x) => { x.schedulePerson = names[0] || ''; x.scheduleAliases = names.slice(1); });
    toast(names.length ? `Schedules will pick out shifts for: ${names.join(', ')}` : 'Schedule names cleared');
  });
  on(el, 'change', '[data-custom]', (e, inp) => { update('settings', (x) => { x.customTargets[inp.dataset.custom] = (Number(inp.value) || 0) / 100; }); ctx.refresh(); });
  on(el, 'change', '[data-cat]', (e, inp) => {
    const c = state.categories.find((x) => x.id === inp.dataset.cat);
    update('categories', () => { c[inp.dataset.field] = inp.dataset.field === 'keywords' ? inp.value.split(',').map((k) => k.trim()).filter(Boolean) : inp.value; });
  });
  on(el, 'click', '[data-action=add-cat]', async () => {
    const ok = await modal({
      title: 'New category',
      body: `<div class="form-grid"><label class="field span-2">Name<input name="name" required autofocus></label><label class="field">Type<select name="type">${options(TYPES, 'want')}</select></label><label class="field">Suggested %<input name="suggested" value="varies"></label></div>`,
      onSubmit(form, v) { update('categories', (l) => l.push({ id: uid('cat'), name: v.name.trim(), type: v.type, suggested: v.suggested, mid: 0, keywords: [] })); return true; },
    });
    if (ok) ctx.refresh();
  });
  on(el, 'click', '[data-del-cat]', async (e, b) => {
    const n = usage.get(b.dataset.delCat) || 0;
    if (!(await confirmDialog(n ? `${n} transactions use this category and will become uncategorized. Delete anyway?` : 'Delete this category?'))) return;
    update('categories', (l) => l.filter((c) => c.id !== b.dataset.delCat));
    ctx.refresh();
  });
  on(el, 'change', '[data-src]', (e, inp) => { update('incomeSources', (l) => { l.find((x) => x.id === inp.dataset.src).name = inp.value; }); });
  on(el, 'click', '[data-action=add-src]', () => { update('incomeSources', (l) => l.push({ id: uid('src'), name: 'New income source' })); ctx.refresh(); });
  on(el, 'click', '[data-del-rule]', (e, b) => { update('rules', (l) => l.filter((r) => r.id !== b.dataset.delRule)); ctx.refresh(); });
  on(el, 'click', '[data-action=xlsx]', () => exportWorkbook(ctx.month));
  on(el, 'click', '[data-action=backup]', async () => {
    await flushAll();
    download(`finance-backup-${today()}.json`, JSON.stringify(await api('/api/state'), null, 1), 'application/json');
  });
  on(el, 'click', '[data-action=save-key]', async () => {
    const key = $('#apiKey', el).value.trim();
    if (/^nvapi-/.test(key)) return toast('NVIDIA keys can\'t be used from a web page (NVIDIA blocks browser calls). Run the app locally with npm start and put it in .env.', 'bad');
    if (!/^sk-ant-/.test(key)) return toast('That doesn\'t look like an Anthropic API key (sk-ant-…)', 'bad');
    const { setApiKey } = await import('../local-backend.js');
    setApiKey(key);
    ctx.ai = await api('/api/ai/status');
    toast('API key saved in this browser');
    ctx.refresh();
  });
  on(el, 'click', '[data-action=clear-key]', async () => {
    const { setApiKey } = await import('../local-backend.js');
    setApiKey('');
    ctx.ai = await api('/api/ai/status');
    toast('API key removed');
    ctx.refresh();
  });
  $('#importXlsx', el).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmDialog(`Import ${f.name}? Setup, sinking funds, debts, goals and net worth are replaced; the Monthly Budget sheet becomes the ${ctx.month} plan.`, { okLabel: 'Import', title: 'Import planner workbook' }))) return;
    if (await importPlannerWorkbook(f, ctx.month)) ctx.refresh();
  });
  $('#restore', el).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmDialog('Restoring replaces ALL current data with the backup. Continue?', { okLabel: 'Restore' }))) return;
    try {
      await flushAll();
      await api('/api/restore', { method: 'POST', body: JSON.parse(await f.text()) });
      await loadState();
      toast('Backup restored');
      ctx.refresh();
    } catch (err) { toast(err.message, 'bad'); }
  });
  on(el, 'click', '[data-action=reset]', async () => {
    if (!(await confirmDialog('Erase all transactions, receipts, shifts and settings and start over from the workbook defaults? Download a backup first.', { okLabel: 'Erase everything' }))) return;
    await flushAll();
    await api('/api/reset', { method: 'POST', body: { confirm: 'RESET' } });
    await loadState();
    toast('Reset complete');
    ctx.refresh();
  });
  on(el, 'click', '[data-action=demo]', () => { loadDemo(ctx.month); toast('Demo data added (tagged so you can remove it)'); ctx.refresh(); });
  on(el, 'click', '[data-action=undemo]', () => { removeDemo(); toast('Demo data removed'); ctx.refresh(); });
}

/* ---------- Demo data (tagged demo:true) ---------- */
function loadDemo(month) {
  const tx = [];
  const add = (date, merchant, categoryId, amount, extra = {}) => tx.push({ id: uid('tx'), type: 'expense', date, merchant, categoryId, amount, source: 'manual', note: '', demo: true, createdAt: new Date().toISOString(), ...extra });
  const months = monthsRange(month, 3);
  months.forEach((m, k) => {
    const d = (day) => `${m}-${String(day).padStart(2, '0')}`;
    const jitter = (v) => round2(v * (0.85 + ((k * 7 + v) % 30) / 100));
    tx.push({ id: uid('tx'), type: 'income', date: d(1), merchant: 'Employer payroll', sourceId: 'salary', amount: 2350, source: 'manual', demo: true, note: '' });
    tx.push({ id: uid('tx'), type: 'income', date: d(15), merchant: 'Employer payroll', sourceId: 'salary', amount: 2350, source: 'manual', demo: true, note: '' });
    add(d(1), 'Parkview Apartments', 'housing', 1450);
    add(d(5), 'City Power & Light', 'utilities', jitter(118));
    add(d(8), 'Verizon Wireless', 'internet_phone', 85);
    add(d(3), "Trader Joe's", 'groceries', jitter(96)); add(d(12), 'Kroger', 'groceries', jitter(142)); add(d(22), 'Costco', 'groceries', jitter(188));
    add(d(6), 'Shell', 'transportation', jitter(48)); add(d(19), 'Shell', 'transportation', jitter(52));
    add(d(10), 'Chipotle', 'dining', jitter(24)); add(d(17), 'Starbucks', 'dining', jitter(16)); add(d(24), 'Olive Garden', 'dining', jitter(64));
    add(d(2), 'Netflix', 'entertainment', 15.49); add(d(4), 'Spotify', 'subscriptions', 11.99);
    add(d(14), 'Amazon', 'shopping', jitter(73)); add(d(9), 'Planet Fitness', 'fitness', 25);
    add(d(20), 'Credit Card 1 payment', 'min_debt', 90); add(d(20), 'Credit Card 1 extra', 'extra_debt', 150);
    add(d(16), 'Transfer to savings', 'emergency_fund', 300); add(d(16), 'Roth IRA', 'retirement', 250);
  });
  update('transactions', (l) => l.push(...tx));
  update('budgets', (b) => {
    for (const m of months) {
      if (b[m]) continue;
      b[m] = { demo: true, income: { salary: 4700 }, planned: { housing: 1450, utilities: 130, internet_phone: 85, groceries: 450, transportation: 120, min_debt: 585, health: 80, dining: 120, entertainment: 20, subscriptions: 15, shopping: 100, fitness: 25, travel: 60, emergency_fund: 300, retirement: 250, extra_debt: 200, sinking_funds: 710 }, notes: {} };
    }
  });
  const jobId = uid('job');
  update('jobs', (l) => l.push({ id: jobId, demo: true, name: 'Campus Café (demo)', sourceId: 'side', payType: 'hourly', rate: 16.5, payFrequency: 'biweekly', periodEndAnchor: addDays(today(), -((new Date().getDay() + 1) % 7)), payLagDays: 6, otMultiplier: 1.5, autoOvertime: false, otWeeklyThreshold: 40, dailyOtThreshold: 0, preTaxPercent: 0, tax: { mode: 'none', rates: {}, flat: 0 }, differentials: [{ id: uid('diff'), name: 'Weekend', amount: 1, start: '00:00', end: '00:00', days: [0, 6] }] }));
  const shifts = [];
  for (let i = 0; i < 28; i++) {
    const date = addDays(`${month}-01`, i);
    if (!date.startsWith(month)) break;
    const dow = new Date(`${date}T12:00`).getDay();
    if ([1, 3, 5, 6].includes(dow)) shifts.push({ id: uid('shift'), demo: true, jobId, date, start: dow === 6 ? '10:00' : '16:00', end: dow === 6 ? '18:00' : '21:30', breakMin: dow === 6 ? 30 : 0, tips: dow === 5 ? 22 : 0, role: 'Barista', notes: '', source: 'manual' });
  }
  update('shifts', (l) => l.push(...shifts));
  update('bills', (l) => l.push(
    { id: uid('bill'), demo: true, name: 'Rent', amount: 1450, categoryId: 'housing', frequency: 'monthly', nextDue: `${shiftMonth(month, 1)}-01`, autopay: false, subscription: false, lastReviewed: today() },
    { id: uid('bill'), demo: true, name: 'Netflix', amount: 15.49, categoryId: 'entertainment', frequency: 'monthly', nextDue: addDays(today(), 6), autopay: true, subscription: true, lastReviewed: addDays(today(), -240) },
    { id: uid('bill'), demo: true, name: 'Spotify', amount: 11.99, categoryId: 'subscriptions', frequency: 'monthly', nextDue: addDays(today(), 10), autopay: true, subscription: true, lastReviewed: today() },
    { id: uid('bill'), demo: true, name: 'Car insurance', amount: 612, categoryId: 'transportation', frequency: 'semiannual', nextDue: addDays(today(), 40), autopay: false, subscription: false, lastReviewed: today() },
  ));
}

function removeDemo() {
  for (const key of ['transactions', 'jobs', 'shifts', 'bills']) update(key, (l) => l.filter((x) => !x.demo));
  update('budgets', (b) => { for (const [m, v] of Object.entries(b)) if (v.demo) delete b[m]; });
}
