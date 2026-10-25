// Formatting, dates, DOM and modal helpers shared by every view.

let currency = 'USD';
export function setCurrency(code) { currency = code || 'USD'; }

export function money(value, { cents = true, sign = false, compact = false } = {}) {
  const v = Number(value) || 0;
  const opts = { style: 'currency', currency, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 };
  if (compact && Math.abs(v) >= 10000) Object.assign(opts, { notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const s = new Intl.NumberFormat('en-US', opts).format(v);
  return sign && v > 0 ? `+${s}` : s;
}
export const pct = (v, digits = 0) => `${((Number(v) || 0) * 100).toFixed(digits)}%`;
export const num = (v, digits = 0) => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let idCounter = 0;
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/* ---------- Dates (all local, ISO yyyy-mm-dd strings) ---------- */
export function isoDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export const today = () => isoDate();
export const thisMonth = () => today().slice(0, 7);
export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); }
export function addMonths(s, n) {
  const d = parseDate(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(isoDate(d).slice(0, 7))));
  return isoDate(d);
}
export function shiftMonth(month, n) { return addMonths(`${month}-01`, n).slice(0, 7); }
export function daysInMonth(month) { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); }
export function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
export function monthLabel(month, style = 'long') {
  return parseDate(`${month}-01`).toLocaleDateString('en-US', { month: style, year: 'numeric' });
}
export function fmtDate(s, opts = { month: 'short', day: 'numeric' }) {
  if (!s) return '—';
  return parseDate(s).toLocaleDateString('en-US', opts);
}
export function monthsRange(endMonth, count) {
  return Array.from({ length: count }, (_, i) => shiftMonth(endMonth, i - count + 1));
}
export function startOfWeek(s, weekStartsOn = 0) {
  const d = parseDate(s); const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Delegate events: on(root, 'click', '[data-action=x]', handler)
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  });
}

export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200);
}

// Generic modal. `body` is HTML. Resolves with the result of onSubmit or null on cancel.
export function modal({ title, body, submitLabel = 'Save', wide = false, onSubmit, onOpen, extraButtons = '' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <form class="modal ${wide ? 'wide' : ''}" novalidate>
        <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn small" data-close aria-label="Close">✕</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${extraButtons}<span class="spacer"></span>
          <button type="button" class="btn" data-close>Cancel</button>
          ${submitLabel ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ''}
        </div>
      </form>`;
    const form = wrap.querySelector('form');
    const close = (value) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
    on(wrap, 'click', '[data-close]', () => close(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      try {
        const result = onSubmit ? await onSubmit(form, formValues(form)) : true;
        if (result !== false) close(result ?? true);
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    root.append(wrap);
    onOpen?.(form, close);
    (form.querySelector('[autofocus]') || form.querySelector('input,select,textarea'))?.focus();
  });
}

export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Delete' } = {}) {
  return modal({ title, body: `<p>${esc(message)}</p>`, submitLabel: okLabel }).then(Boolean);
}

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? 0 : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

export function options(list, selected, { value = (x) => x.id, label = (x) => x.name, empty } = {}) {
  const opts = list.map((x) => `<option value="${esc(value(x))}" ${String(value(x)) === String(selected) ? 'selected' : ''}>${esc(label(x))}</option>`);
  if (empty !== undefined) opts.unshift(`<option value="">${esc(empty)}</option>`);
  return opts.join('');
}

export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines).
export function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

export function emptyState(icon, title, text = '', action = '') {
  return `<div class="empty"><div class="big">${icon}</div><div><strong>${esc(title)}</strong></div><p>${esc(text)}</p>${action}</div>`;
}

export function statusBadge(status) {
  const map = { 'On Track': 'good', Under: 'info', Over: 'bad', Strong: 'good', Building: 'warn', Priority: 'bad' };
  const icon = { good: '✓', bad: '!', warn: '•', info: '↓' };
  const k = map[status] || '';
  return `<span class="badge ${k}">${icon[k] || ''} ${esc(status)}</span>`;
}
