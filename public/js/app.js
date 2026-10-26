import { state, loadState, api, backendMode } from './store.js';
import { $, esc, today, toast, on } from './util.js';
import { periodFor, shiftRange } from './calc.js';
import { destroyCharts } from './charts.js';
import { runAutomations } from './automation.js';

// Sidebar sections; pages inside a section show as tabs under the title.
const HUBS = [
  { id: 'home', label: 'Home', icon: '◉', pages: [['dashboard', 'Home'], ['overview', 'Overview']] },
  { id: 'spending', label: 'Spending', icon: '⇄', pages: [['transactions', 'Transactions'], ['receipts', 'Scan receipts']] },
  { id: 'income', label: 'Income & shifts', icon: '⏱', pages: [['income', 'Income & shifts']] },
  { id: 'budget', label: 'Budget & bills', icon: '▤', pages: [['budget', 'Budget'], ['bills', 'Bills & cash flow']] },
  { id: 'save', label: 'Save & invest', icon: '▲', pages: [['investments', 'Investments'], ['goals', 'Goals'], ['sinking', 'Sinking funds'], ['networth', 'Net worth']] },
  { id: 'debt', label: 'Debt', icon: '⬇', pages: [['debts', 'Debt payoff']] },
  { id: 'insights', label: 'Insights', icon: '▥', pages: [['reports', 'Reports'], ['review', 'Monthly review'], ['guide', 'Research & guide']] },
  { id: 'settings', label: 'Settings', icon: '⚙', pages: [['settings', 'Settings']] },
];
const PAGES = new Map(HUBS.flatMap((h) => h.pages.map(([id, label]) => [id, { id, label, hub: h }])));
const lastPage = {}; // remembers the last tab opened in each section

const ctx = {
  date: today(), // any day inside the period being viewed
  range: null, // current period (a paycheck, or a calendar month)
  month: today().slice(0, 7), // calendar month of that period, for month-based pages
  route: 'dashboard',
  params: new URLSearchParams(),
  ai: { enabled: false },
  refresh: () => render(),
  // Navigate; re-renders even when the hash is unchanged.
  go: (route, params = '') => {
    const hash = `#/${route}${params ? `?${params}` : ''}`;
    if (location.hash === hash) render(); else location.hash = hash;
  },
};
window.__ctx = ctx;

function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

function renderNav(page) {
  $('#nav').innerHTML = HUBS.map((h) => `<a class="nav-link ${page.hub === h ? 'active' : ''}" href="#/${lastPage[h.id] || h.pages[0][0]}"><span class="nav-icon" aria-hidden="true">${h.icon}</span>${esc(h.label)}</a>`).join('');
  const sub = $('#subnav');
  sub.classList.toggle('hidden', page.hub.pages.length < 2);
  sub.innerHTML = page.hub.pages.map(([id, label]) => `<a href="#/${id}" class="${id === page.id ? 'active' : ''}">${esc(label)}</a>`).join('');
}

function setDate(date) {
  ctx.date = date;
  render();
}
ctx.setDate = (date) => { ctx.date = date; }; // set the period without re-rendering (used before navigating)

// The period shown everywhere follows Settings → "Plan my money by" (each paycheck by default).
function updatePeriod() {
  if (!state.settings) return;
  ctx.range = periodFor(state, ctx.date);
  const r = ctx.range;
  const t = today();
  ctx.month = r.kind === 'month' ? r.key : (t >= r.from && t <= r.to ? t : r.from).slice(0, 7);
  const current = t >= r.from && t <= r.to;
  $('#periodLabel').innerHTML = r.kind === 'period' ? `<span class="muted">Paycheck · </span>${esc(r.label)}` : esc(r.label);
  $('#dateInput').value = ctx.date;
  let todayBtn = $('#todayBtn');
  if (!current && !todayBtn) {
    todayBtn = document.createElement('button');
    todayBtn.id = 'todayBtn'; todayBtn.className = 'btn small today-btn'; todayBtn.textContent = 'Today';
    todayBtn.addEventListener('click', () => setDate(today()));
    $('#monthPicker').after(todayBtn);
  } else if (current) todayBtn?.remove();
}

function renderAiBadge() {
  const provider = ctx.ai.provider === 'nvidia' ? 'NVIDIA' : 'Claude';
  const quota = ctx.ai.limit ? ` · ${Math.max(0, ctx.ai.limit - (ctx.ai.used || 0))} of ${ctx.ai.limit} reads left today` : '';
  const account = ctx.user ? `<div class="small" style="margin-bottom:10px"><div class="title" style="font-weight:600">${esc(ctx.user.name || ctx.user.email)}</div><div class="muted">${esc(ctx.user.email)}</div><a href="#" data-signout>Sign out</a></div>` : '';
  $('#aiBadge').innerHTML = account + (ctx.ai.enabled
    ? `<span class="badge good">✓ AI reading on</span><div class="small muted" style="margin-top:4px">${provider}${quota}</div>`
    : `<span class="badge">On-device OCR</span><div class="small muted" style="margin-top:4px">${ctx.ai.mode === 'browser' ? 'Add an Anthropic key in <a href="#/settings">Settings</a>' : 'Add an NVIDIA or Anthropic key to .env'} for more accurate receipt & schedule reading.</div>`);
}

// Refresh the AI read counter after each upload (cheap; only in account mode).
export async function refreshAi() {
  if (!ctx.user) return;
  ctx.ai = await api('/api/ai/status').catch(() => ctx.ai);
  renderAiBadge();
}
ctx.refreshAi = refreshAi;

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const page = PAGES.get(ctx.route) || PAGES.get('dashboard');
  lastPage[page.hub.id] = page.id;
  $('#pageTitle').textContent = page.hub.pages.length > 1 ? page.hub.label : page.label;
  document.title = `${page.label} · Finance Manager`;
  renderNav(page);
  renderAiBadge();
  runAutomations(state);
  updatePeriod();

  // Keep focus and caret on the same logical input across re-renders.
  const active = document.activeElement;
  const focusKey = active?.dataset?.key;
  const caret = focusKey && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  let view = $('#view');
  try {
    const mod = await import(`./views/${page.id}.js`);
    if (token !== renderToken) return;
    destroyCharts();
    // Fresh element each render so delegated listeners from the last render are dropped.
    const fresh = view.cloneNode(false);
    view.replaceWith(fresh);
    view = fresh;
    await mod.render(view, ctx);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="alert bad"><span class="alert-icon">!</span><div><strong>This page failed to load.</strong><br>${esc(err.message)}</div></div>`;
  }
  if (focusKey) {
    const el = view.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (el) { el.focus(); try { if (caret) el.setSelectionRange(...caret); } catch { /* not a text input */ } }
  }
}

function onRoute() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  ctx.route = PAGES.has(path) ? path : 'dashboard';
  ctx.params = new URLSearchParams(query || '');
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('open');
  window.scrollTo(0, 0);
  render();
}

// "+ Add" menu: the everyday actions, reachable from every page.
const ADD_ACTIONS = [
  ['transaction', '✎ Transaction'],
  ['receipt', '🧾 Scan a receipt'],
  ['schedule', '🗓 Upload work schedule'],
  ['shift', '⏱ Add a shift'],
  ['bill', '📅 Pay a bill'],
  ['invest', '📈 Investment contribution'],
];
async function runAdd(action) {
  if (action === 'transaction') {
    const { openTransactionForm } = await import('./views/transactions.js');
    if (await openTransactionForm(ctx)) render();
  } else if (action === 'receipt' || action === 'schedule') {
    const input = $(action === 'receipt' ? '#globalReceipt' : '#globalSchedule');
    input.value = '';
    input.click();
  } else if (action === 'shift') ctx.go('income', 'tab=shifts&add=1');
  else if (action === 'bill') ctx.go('bills');
  else if (action === 'invest') ctx.go('investments');
}

function initChrome() {
  $('#dateInput').addEventListener('change', (e) => e.target.value && setDate(e.target.value));
  $('#periodLabel').addEventListener('click', () => { try { $('#dateInput').showPicker(); } catch { $('#dateInput').focus(); } });
  $('#monthPicker').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]')?.dataset.step;
    if (!step) return;
    const next = shiftRange(state, ctx.range, Number(step));
    const t = today();
    setDate(t >= next.from && t <= next.to ? t : next.from);
  });
  const menu = $('#addMenu');
  menu.innerHTML = ADD_ACTIONS.map(([id, label]) => `<button data-add="${id}">${label}</button>`).join('');
  $('#quickAdd').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', () => menu.classList.add('hidden'));
  on(menu, 'click', '[data-add]', (e, b) => { menu.classList.add('hidden'); runAdd(b.dataset.add); });
  $('#globalReceipt').addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    const { startReceipt } = await import('./views/receipts.js');
    startReceipt([...e.target.files], ctx);
  });
  $('#globalSchedule').addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    const { startSchedule } = await import('./views/income.js');
    startSchedule([...e.target.files], ctx);
  });
  $('#themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    localStorageSet('theme', root.dataset.theme);
    render();
  });
  $('#menuBtn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); });
  $('#scrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());
  on(document.body, 'click', '[data-signout]', async (e) => {
    e.preventDefault();
    const { flushAll } = await import('./store.js');
    await flushAll().catch(() => {});
    await api('/api/auth/logout', { method: 'POST' });
    location.hash = '';
    location.reload();
  });
}

async function boot() {
  // Server with accounts: sign in first.
  if ((await backendMode()) === 'server') {
    let me;
    try {
      me = await api('/api/auth/me');
    } catch (err) {
      if (err.status === 401) {
        document.querySelector('.layout').classList.add('hidden');
        const health = await api('/api/health').catch(() => ({}));
        (await import('./auth-screen.js')).showAuthScreen({ signup: health.signup !== false });
        return;
      }
    }
    ctx.user = me?.user || null;
    ctx.ai = me?.ai || { enabled: false };
  }
  initChrome();
  try {
    await loadState();
  } catch (err) {
    $('#view').innerHTML = `<div class="alert bad"><span class="alert-icon">!</span><div><strong>Cannot reach the server.</strong><br>Start it with <code>npm start</code> and reload. (${esc(err.message)})</div></div>`;
    return;
  }
  if (!ctx.user) ctx.ai = await api('/api/ai/status').catch(() => ({ enabled: false }));
  window.addEventListener('hashchange', onRoute);
  onRoute();
  if (!state.settings) toast('Database is empty', 'bad');
}

boot();
