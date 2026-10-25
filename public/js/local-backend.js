// Browser-only backend used when no server is present (e.g. the GitHub Pages build).
// Emulates the /api routes: data lives in this browser's IndexedDB, uploads become
// data URLs, and AI parsing calls the Anthropic API directly with a key the user
// pastes into Settings (kept in this browser's localStorage).
import { createSeed } from './seed.js';
import { AIError, DEFAULT_MODEL, extract, fileBlock, receiptRequest, scheduleRequest, paystubRequest } from './ai-core.js';

const DB_NAME = 'finance-manager';
const STORE = 'kv';
const KEY_STORAGE = 'anthropicApiKey';
const MODEL_STORAGE = 'anthropicModel';

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('This browser blocked local storage (IndexedDB). Private windows may not keep data.'));
  });
  return dbPromise;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
  });
}
const getAll = () => tx('readonly', (s) => s.get('state'));
const putAll = (value) => tx('readwrite', (s) => s.put(value, 'state'));

let cache = null;
async function state() {
  if (cache) return cache;
  cache = await getAll();
  if (!cache) { cache = createSeed(); await putAll(cache); }
  const seed = createSeed();
  for (const k of Object.keys(seed)) if (cache[k] === undefined) cache[k] = seed[k];
  return cache;
}

let saving = Promise.resolve();
function save() {
  const snapshot = structuredClone(cache);
  saving = saving.then(() => putAll(snapshot));
  return saving;
}

/* ---------- AI in the browser ---------- */
export const getApiKey = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } };
export const getModel = () => { try { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; } };
export function setApiKey(key) {
  try { if (key) localStorage.setItem(KEY_STORAGE, key.trim()); else localStorage.removeItem(KEY_STORAGE); } catch { /* storage blocked */ }
  client = null;
}

let client = null;
let SDK = null;
async function anthropic() {
  const key = getApiKey();
  if (!key) throw new AIError('Add your Anthropic API key in Settings to use AI reading.', 501);
  if (!SDK) SDK = (await import(new URL('vendor/anthropic-sdk.mjs', document.baseURI).href)).default;
  client ??= new SDK({ apiKey: key, dangerouslyAllowBrowser: true });
  return { Anthropic: SDK, client };
}

const blocksFrom = (files = []) => files.map((f) => fileBlock({ mimeType: f.type, base64: String(f.url).split(',')[1] || '', name: f.name }));
const todayIso = () => new Date().toLocaleDateString('en-CA');

async function runAI(kind, body) {
  const s = await state();
  const blocks = blocksFrom(body.files);
  const request = kind === 'receipt' ? receiptRequest({ blocks, categories: s.categories, today: todayIso() })
    : kind === 'schedule' ? scheduleRequest({ blocks, person: body.person || s.settings.schedulePerson, today: todayIso() })
      : paystubRequest({ blocks, today: todayIso() });
  return extract({ ...(await anthropic()), model: getModel(), ...request });
}

const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

/* ---------- Route emulation ---------- */
export async function handle(path, { method = 'GET', body } = {}) {
  const p = path.replace(/^\/?api\//, '');
  if (p === 'state' && method === 'GET') return structuredClone(await state());
  if (p.startsWith('state/') && method === 'PUT') {
    const s = await state();
    s[p.slice(6)] = body;
    await save();
    return { ok: true };
  }
  if (p === 'ai/status') return { enabled: Boolean(getApiKey()), provider: 'anthropic', model: getModel(), mode: 'browser' };
  if (p.startsWith('upload/')) {
    const files = body.getAll('files');
    return { files: await Promise.all(files.map(async (f) => ({ url: await readAsDataURL(f), type: f.type, name: f.name, size: f.size }))) };
  }
  if (p === 'ai/receipt') return runAI('receipt', body);
  if (p === 'ai/schedule') return runAI('schedule', body);
  if (p === 'ai/paystub') return runAI('paystub', body);
  if (p === 'files') return { ok: true }; // images live inside the receipt records
  if (p === 'restore') {
    if (!body?.settings || !Array.isArray(body.categories)) throw Object.assign(new Error('Not a valid backup file'), { status: 400 });
    const seed = createSeed();
    cache = { version: seed.version };
    for (const k of Object.keys(seed)) cache[k] = body[k] ?? seed[k];
    await save();
    return { ok: true };
  }
  if (p === 'reset') {
    cache = createSeed();
    await save();
    return { ok: true };
  }
  throw Object.assign(new Error(`Not available in browser mode: ${path}`), { status: 404 });
}
