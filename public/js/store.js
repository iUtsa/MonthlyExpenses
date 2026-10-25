// Client-side copy of the database. Views mutate `state` through `update()`,
// which persists the changed top-level key (debounced) to the server or browser storage.
import { toast, setCurrency } from './util.js';

export const state = {};
const listeners = new Set();
const pending = new Map();

// Where data lives: the Node server ('server') or this browser's IndexedDB ('browser',
// used by the static GitHub Pages build). Detected once by probing the server.
let backend = null;
export function backendMode() {
  backend ??= fetch('api/health', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.mode === 'server' ? 'server' : 'browser'))
    .catch(() => 'browser');
  return backend;
}

export async function api(path, { method = 'GET', body } = {}) {
  if ((await backendMode()) === 'browser') {
    const local = await import('./local-backend.js');
    return local.handle(path, { method, body });
  }
  const res = await fetch(path.replace(/^\//, ''), {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export async function loadState() {
  const data = await api('/api/state');
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, data);
  setCurrency(state.settings.currency);
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function persist(key) {
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(async () => {
    pending.delete(key);
    try {
      await api(`/api/state/${key}`, { method: 'PUT', body: state[key] });
    } catch (err) {
      toast(`Could not save ${key}: ${err.message}`, 'bad');
    }
  }, 250));
}

// Mutate in place — update('transactions', (list) => list.push(tx)) — or return a replacement
// object/array — update('transactions', (list) => list.filter(...)). Other return values
// (push's new length, assignment results) are ignored.
export function update(key, fn, { silent = false } = {}) {
  const result = fn(state[key]);
  if (result !== null && typeof result === 'object') state[key] = result;
  if (key === 'settings') setCurrency(state.settings.currency);
  persist(key);
  if (!silent) for (const l of listeners) l(key);
}

export async function flushAll() {
  const keys = [...pending.keys()];
  for (const key of keys) {
    clearTimeout(pending.get(key));
    pending.delete(key);
    await api(`/api/state/${key}`, { method: 'PUT', body: state[key] });
  }
}
// Saves are debounced by 250ms; push anything still queued if the tab closes.
window.addEventListener('pagehide', () => {
  for (const [key, timer] of pending) {
    clearTimeout(timer);
    if (backend === null) continue;
    backend.then((mode) => (mode === 'server'
      ? fetch(`api/state/${key}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state[key]) })
      : api(`/api/state/${key}`, { method: 'PUT', body: state[key] })));
  }
  pending.clear();
});

/* ---------- Lookups ---------- */
export const category = (id) => state.categories.find((c) => c.id === id);
export const categoryName = (id) => category(id)?.name || 'Uncategorized';
export const incomeSource = (id) => state.incomeSources.find((s) => s.id === id);
export const job = (id) => state.jobs.find((j) => j.id === id);
