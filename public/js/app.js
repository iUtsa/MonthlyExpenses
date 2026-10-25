import { state, loadState, api } from './store.js';
import { $, esc, thisMonth, shiftMonth, toast } from './util.js';
import { destroyCharts } from './charts.js';

const ROUTES = [
  { group: 'Overview' },
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { group: 'Money in & out' },
  { id: 'transactions', label: 'Transactions', icon: '⇄' },
  { id: 'receipts', label: 'Scan receipts', icon: '🧾' },
  { id: 'budget', label: 'Monthly budget', icon: '▤' },
  { id: 'income', label: 'Income & shifts', icon: '⏱' },
  { id: 'bills', label: 'Bills & cash flow', icon: '📅' },
  { group: 'Plan' },
  { id: 'sinking', label: 'Sinking funds', icon: '🪣' },
  { id: 'debts', label: 'Debt payoff', icon: '⬇' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'networth', label: 'Net worth', icon: '▲' },
  { group: 'Review' },
  { id: 'reports', label: 'Reports', icon: '▥' },
  { id: 'review', label: 'Monthly review', icon: '✓' },
  { id: 'guide', label: 'Research & guide', icon: '📖' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

const ctx = {
  month: localStorageGet('month') || thisMonth(),
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

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

function renderNav() {
  $('#nav').innerHTML = ROUTES.map((r) => (r.group
    ? `<div class="nav-group-label nav-group">${esc(r.group)}</div>`
    : `<a class="nav-link ${ctx.route === r.id ? 'active' : ''}" href="#/${r.id}"><span class="nav-icon" aria-hidden="true">${r.icon}</span>${esc(r.label)}</a>`)).join('');
}

function setMonth(month) {
  ctx.month = month;
  localStorageSet('month', month);
  $('#monthInput').value = month;
  render();
}

function renderAiBadge() {
  $('#aiBadge').innerHTML = ctx.ai.enabled
    ? `<span class="badge good">✓ AI parsing on</span><div class="small muted" style="margin-top:4px">${esc(ctx.ai.model)}</div>`
    : `<span class="badge">On-device OCR</span><div class="small muted" style="margin-top:4px">Add an Anthropic API key ${ctx.ai.mode === 'browser' ? 'in <a href="#/settings">Settings</a>' : 'to .env'} for more accurate receipt & schedule reading.</div>`;
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const route = ROUTES.find((r) => r.id === ctx.route) || ROUTES[1];
  $('#pageTitle').textContent = route.label;
  document.title = `${route.label} · Finance Manager`;
  renderNav();
  renderAiBadge();

  // Keep focus and caret on the same logical input across re-renders.
  const active = document.activeElement;
  const focusKey = active?.dataset?.key;
  const caret = focusKey && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  let view = $('#view');
  try {
    const mod = await import(`./views/${route.id}.js`);
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
  ctx.route = ROUTES.some((r) => r.id === path) ? path : 'dashboard';
  ctx.params = new URLSearchParams(query || '');
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('open');
  window.scrollTo(0, 0);
  render();
}

function initChrome() {
  $('#monthInput').value = ctx.month;
  $('#monthInput').addEventListener('change', (e) => e.target.value && setMonth(e.target.value));
  $('#monthPicker').addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]')?.dataset.step;
    if (step) setMonth(shiftMonth(ctx.month, Number(step)));
  });
  $('#quickAdd').addEventListener('click', async () => {
    const { openTransactionForm } = await import('./views/transactions.js');
    if (await openTransactionForm(ctx)) render();
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
}

async function boot() {
  initChrome();
  try {
    await loadState();
  } catch (err) {
    $('#view').innerHTML = `<div class="alert bad"><span class="alert-icon">!</span><div><strong>Cannot reach the server.</strong><br>Start it with <code>npm start</code> and reload. (${esc(err.message)})</div></div>`;
    return;
  }
  ctx.ai = await api('/api/ai/status').catch(() => ({ enabled: false }));
  window.addEventListener('hashchange', onRoute);
  onRoute();
  if (!state.settings) toast('Database is empty', 'bad');
}

boot();
