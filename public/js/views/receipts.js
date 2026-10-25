import { state, update, api, categoryName } from '../store.js';
import {
  esc, money, fmtDate, today, uid, options, toast, on, $, round2, sum, confirmDialog, emptyState, loadScript,
} from '../util.js';
import { autoCategorize } from '../calc.js';
import { parseReceiptText } from '../parse.js';
import { totals, splitByCategory } from '../receipt-math.js';
import { learnRule } from './transactions.js';

let draft = null; // receipt being reviewed
let busy = null; // { label, progress }

/* ---------- File preparation ---------- */

// Re-encode photos as JPEG (max 2000px) so phone pictures upload fast and HEIC-from-Safari works.
async function normalizeImage(file) {
  if (file.type === 'application/pdf') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Can't read ${file.name}. If it's an iPhone HEIC photo, export it as JPG or use Safari.`));
      i.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// NVIDIA vision models take a single image: render PDF pages and stack every page
// into one JPEG (max 1600px wide, 7000px tall). Other providers get the files unchanged.
export async function prepareForAI(files, ai) {
  if (ai?.provider !== 'nvidia') return files;
  if (files.length === 1 && files[0].type.startsWith('image/')) return files;
  const canvases = [];
  for (const f of files) {
    if (f.type === 'application/pdf') canvases.push(...(await pdfToCanvases(f)).pages);
    else {
      const url = URL.createObjectURL(f);
      try {
        const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error(`Can't read ${f.name}`)); i.src = url; });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        canvases.push(c);
      } finally { URL.revokeObjectURL(url); }
    }
  }
  const width = Math.min(1600, Math.max(...canvases.map((c) => c.width)));
  const heights = canvases.map((c) => (c.height * width) / c.width);
  const scale = Math.min(1, 7000 / heights.reduce((a, h) => a + h, 0));
  const out = document.createElement('canvas');
  out.width = Math.round(width * scale);
  out.height = Math.round(heights.reduce((a, h) => a + h, 0) * scale);
  const g = out.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
  let y = 0;
  canvases.forEach((c, i) => { const h = heights[i] * scale; g.drawImage(c, 0, y, out.width, h); y += h; });
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.85));
  return [new File([blob], 'pages.jpg', { type: 'image/jpeg' })];
}

export async function uploadFiles(kind, files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  return (await api(`/api/upload/${kind}`, { method: 'POST', body: fd })).files;
}

/* ---------- On-device OCR fallback ---------- */
// Absolute URL of a bundled library (works at the site root or under a GitHub Pages sub-path).
const vendorUrl = (file) => new URL(`vendor/${file}`, document.baseURI).href;

export async function pdfToCanvases(file, maxPages = 4) {
  const pdfjs = await import(vendorUrl('pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = vendorUrl('pdf.worker.min.mjs');
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  let text = '';
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Rebuild lines from positioned text items
    const lines = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      lines.set(y, `${lines.get(y) || ''} ${item.str}`);
    }
    text += [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.trim()).join('\n') + '\n';
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pages.push(canvas);
  }
  return { pages, text };
}

export async function ocr(files, onProgress) {
  await loadScript('vendor/tesseract.min.js');
  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: vendorUrl('tesseract.worker.min.js'),
    logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
  });
  let text = '';
  try {
    for (const f of files) {
      if (f.type === 'application/pdf') {
        const { pages, text: pdfText } = await pdfToCanvases(f);
        if (pdfText.replace(/\s/g, '').length > 40) { text += pdfText; continue; } // digital PDF: skip OCR
        for (const c of pages) text += (await worker.recognize(c)).data.text + '\n';
      } else {
        text += (await worker.recognize(f)).data.text + '\n';
      }
    }
  } finally {
    await worker.terminate();
  }
  return text;
}

/* ---------- Page ---------- */
export async function render(el, ctx) {
  const openId = ctx.params.get('id');
  if (!openId && draft && !draft.isNew) draft = null; // left a saved receipt; unsaved new scans are kept
  if (openId && (!draft || draft.id !== openId)) {
    const r = state.receipts.find((x) => x.id === openId);
    if (r) draft = structuredClone(r);
  }
  if (draft) return renderReview(el, ctx);

  const receipts = [...state.receipts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const monthReceipts = receipts.filter((r) => r.date?.startsWith(ctx.month));
  el.innerHTML = `
    <div class="grid cols-3">
      <div class="card span-2">
        <div class="card-head"><div><h2>Scan a receipt</h2><p>Photos or PDFs. Several photos = pages of one long receipt.</p></div>
          <span class="badge ${ctx.ai.enabled ? 'good' : ''}">${ctx.ai.enabled ? '✓ AI reading on' : 'On-device OCR'}</span></div>
        ${busy ? `<div class="stack"><strong>${esc(busy.label)}</strong><div class="progress-line"><span style="width:${Math.round((busy.progress || 0.05) * 100)}%"></span></div></div>` : `
        <label class="dropzone" id="drop">
          <div class="big">🧾</div>
          <div><strong>Drop receipt photos here</strong> or click to choose</div>
          <div class="small muted">JPG, PNG, WEBP or PDF · up to 6 files</div>
          <input type="file" id="fileInput" accept="image/*,application/pdf" multiple hidden>
        </label>
        <div class="row" style="margin-top:10px">
          <label class="btn">📷 Take photo<input type="file" id="camInput" accept="image/*" capture="environment" hidden></label>
          <button class="btn" data-action="manual">✎ Enter manually</button>
        </div>`}
        ${ctx.ai.enabled ? '' : `<div class="alert info" style="margin-top:12px"><span class="alert-icon">i</span><div class="small">Without an API key, receipts are read with on-device OCR (Tesseract) and keyword rules. It works best on clear, flat, well-lit photos. ${ctx.ai.mode === 'browser' ? 'Add your Anthropic API key in <a href="#/settings">Settings</a>' : 'Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code>'} for accurate line items and categories.</div></div>`}
      </div>
      <div class="card">
        <h2>This month</h2>
        <div class="kv" style="margin-top:10px">
          <span>Receipts scanned</span><span>${monthReceipts.length}</span>
          <span>Total</span><span>${money(sum(monthReceipts, (r) => r.computedTotal ?? r.total))}</span>
          <span>All-time receipts</span><span>${receipts.length}</span>
        </div>
        <p class="small muted" style="margin-top:12px">Every saved receipt becomes one expense per budget category, linked back to the photo.</p>
      </div>
    </div>
    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><h2>Saved receipts</h2></div>
      ${receipts.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Merchant</th><th>Split into</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${receipts.map((r) => `<tr>
          <td>${fmtDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td><strong>${esc(r.merchant || 'Unknown')}</strong> <span class="small muted">${r.items.length} items · ${r.parsedBy === 'ai' ? 'AI' : r.parsedBy === 'ocr' ? 'OCR' : 'manual'}</span></td>
          <td>${splitByCategory(r).map((g) => `<span class="badge" style="margin:2px">${esc(categoryName(g.categoryId))} ${money(g.amount)}</span>`).join('')}</td>
          <td class="num">${money(r.computedTotal ?? r.total)}</td>
          <td class="actions"><a class="btn small" href="#/receipts?id=${r.id}">Open</a> <button class="icon-btn small" data-action="del" data-id="${r.id}" aria-label="Delete">🗑</button></td>
        </tr>`).join('')}</tbody></table></div>`
    : emptyState('🧾', 'No receipts yet', 'Scan your first receipt above.')}
    </div>`;

  const handle = (files) => files.length && processFiles([...files], ctx);
  const drop = $('#drop', el);
  if (drop) {
    $('#fileInput', el).addEventListener('change', (e) => handle(e.target.files));
    $('#camInput', el).addEventListener('change', (e) => handle(e.target.files));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files); });
  }
  on(el, 'click', '[data-action=manual]', () => {
    draft = blankDraft([], 'manual');
    draft.items.push({ description: '', quantity: 1, amount: 0, category_id: '' });
    ctx.refresh();
  });
  on(el, 'click', '[data-action=del]', async (e, b) => {
    if (!(await confirmDialog('Delete this receipt and the expenses created from it?'))) return;
    await deleteReceipt(b.dataset.id);
    ctx.refresh();
  });
}

function blankDraft(files, parsedBy) {
  return { id: uid('rcpt'), files, parsedBy, merchant: '', date: today(), payment_method: '', items: [], subtotal: 0, tax: 0, tip: 0, fees: 0, discount: 0, total: 0, notes: '', confidence: '', transactionIds: [], isNew: true };
}

async function processFiles(rawFiles, ctx) {
  try {
    busy = { label: 'Preparing images…', progress: 0.05 }; ctx.refresh();
    const files = await Promise.all(rawFiles.slice(0, 6).map(normalizeImage));
    busy = { label: 'Uploading…', progress: 0.15 }; ctx.refresh();
    const uploaded = await uploadFiles('receipts', await prepareForAI(files, ctx.ai));
    let parsed = null; let parsedBy = 'ai';
    if (ctx.ai.enabled) {
      busy = { label: 'Reading receipt with AI… (10–40 seconds)', progress: 0.4 }; ctx.refresh();
      try {
        parsed = await api('/api/ai/receipt', { method: 'POST', body: { files: uploaded } });
      } catch (err) {
        toast(`AI reading failed (${err.message}). Falling back to on-device OCR.`, 'bad');
      }
    }
    if (!parsed) {
      parsedBy = 'ocr';
      busy = { label: 'Reading text on this device…', progress: 0.2 }; ctx.refresh();
      const text = await ocr(files, (p) => { busy.progress = 0.2 + p * 0.75; const bar = document.querySelector('.progress-line span'); if (bar) bar.style.width = `${Math.round(busy.progress * 100)}%`; });
      parsed = parseReceiptText(text, (s) => autoCategorize(state, s));
      parsed.rawText = text;
    }
    draft = { ...blankDraft(uploaded, parsedBy), ...parsed, date: parsed.date || today() };
    for (const item of draft.items) item.quantity ||= 1;
    // Learned merchant rules override the model's guess when the user has corrected it before.
    const ruled = autoCategorize({ ...state, categories: [] }, draft.merchant);
    if (ruled) for (const i of draft.items) if (!i.category_id) i.category_id = ruled;
    if (!draft.items.length) draft.items.push({ description: draft.merchant || 'Purchase', quantity: 1, amount: draft.total || 0, category_id: ruled || autoCategorize(state, draft.merchant) || '' });
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    busy = null;
    ctx.refresh();
  }
}

/* ---------- Review & save ---------- */
function renderReview(el, ctx) {
  const d = draft;
  const img = d.files?.find((f) => f.type.startsWith('image/'));
  const pdf = d.files?.find((f) => f.type === 'application/pdf');
  el.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <button class="btn ghost" data-action="back">← Back to receipts</button>
      <div class="row">
        ${d.isNew ? '' : '<button class="btn danger" data-action="delete">Delete receipt</button>'}
        <button class="btn primary" data-action="save">${d.isNew ? 'Save expenses' : 'Save changes'}</button>
      </div>
    </div>
    <div class="grid cols-3">
      <div class="card">
        ${img ? `<a href="${esc(img.url)}" target="_blank" rel="noopener"><img class="receipt-img" src="${esc(img.url)}" alt="Receipt photo"></a>` : pdf ? `<a class="btn" href="${esc(pdf.url)}" target="_blank" rel="noopener">Open PDF</a>` : '<p class="muted">No image (manual entry)</p>'}
        ${d.files?.length > 1 ? `<p class="small muted">${d.files.length} pages · ${d.files.map((f, i) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${i + 1}</a>`).join(' ')}</p>` : ''}
        ${d.notes ? `<div class="alert ${d.confidence === 'low' ? 'warn' : 'info'}" style="margin-top:10px"><span class="alert-icon">i</span><div class="small">${esc(d.notes)}</div></div>` : ''}
        ${d.rawText ? `<details style="margin-top:10px"><summary class="small muted">Raw OCR text</summary><pre class="small" style="white-space:pre-wrap">${esc(d.rawText)}</pre></details>` : ''}
      </div>
      <div class="stack span-2">
        <div class="card">
          <div class="form-grid">
            <label class="field">Merchant<input data-d="merchant" data-key="r-merchant" value="${esc(d.merchant)}"></label>
            <label class="field">Date<input type="date" data-d="date" value="${esc(d.date)}"></label>
            <label class="field">Paid with<input data-d="payment_method" value="${esc(d.payment_method || '')}" placeholder="Visa, cash…"></label>
          </div>
        </div>
        <div class="card flush">
          <div class="card-head"><div><h2>Line items</h2><p>Change a category to re-section the receipt. Negative amounts = coupons/refunds.</p></div>
            <div class="row"><select id="setAll"><option value="">Set all items to…</option>${options(state.categories, '')}</select><button class="btn small" data-action="add-item">+ Item</button></div></div>
          <div class="table-wrap"><table class="table-compact">
            <thead><tr><th>Item</th><th style="width:70px">Qty</th><th style="width:240px">Category</th><th class="num" style="width:110px">Amount</th><th></th></tr></thead>
            <tbody>${d.items.map((it, i) => `<tr>
              <td><input class="cell" data-item="${i}" data-field="description" data-key="ri-${i}-d" value="${esc(it.description)}"></td>
              <td><input class="cell num" type="number" step="any" data-item="${i}" data-field="quantity" value="${esc(it.quantity ?? 1)}"></td>
              <td><select class="cell" data-item="${i}" data-field="category_id">${it.category_id ? '' : '<option value="">⚠ Choose…</option>'}${options(state.categories, it.category_id)}</select></td>
              <td><input class="cell num" type="number" step="0.01" data-item="${i}" data-field="amount" data-key="ri-${i}-a" value="${esc(it.amount)}"></td>
              <td class="actions"><button class="icon-btn small" data-action="rm-item" data-i="${i}" aria-label="Remove">✕</button></td>
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="form-grid" style="padding:14px 16px">
            ${['tax', 'tip', 'fees', 'discount', 'total'].map((k) => `<label class="field">${k === 'total' ? 'Printed total' : k[0].toUpperCase() + k.slice(1)}<input type="number" step="0.01" data-d="${k}" data-key="r-${k}" value="${esc(d[k] || 0)}"></label>`).join('')}
          </div>
        </div>
        <div class="card" id="splitCard"></div>
      </div>
    </div>`;
  renderSplit(el);

  on(el, 'input', '[data-d]', (e, inp) => { d[inp.dataset.d] = inp.type === 'number' ? Number(inp.value) || 0 : inp.value; renderSplit(el); });
  on(el, 'input', '[data-item]', (e, inp) => {
    const item = d.items[+inp.dataset.item];
    item[inp.dataset.field] = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
    renderSplit(el);
  });
  on(el, 'change', 'select[data-item]', (e, s) => { d.items[+s.dataset.item].category_id = s.value; renderSplit(el); });
  on(el, 'change', '#setAll', (e) => { if (!e.target.value) return; d.items.forEach((i) => { i.category_id = e.target.value; }); ctx.refresh(); });
  on(el, 'click', '[data-action=add-item]', () => { d.items.push({ description: '', quantity: 1, amount: 0, category_id: d.items.at(-1)?.category_id || '' }); ctx.refresh(); });
  on(el, 'click', '[data-action=rm-item]', (e, b) => { d.items.splice(+b.dataset.i, 1); ctx.refresh(); });
  on(el, 'click', '[data-action=back]', () => { draft = null; ctx.go('receipts'); });
  on(el, 'click', '[data-action=delete]', async () => {
    if (!(await confirmDialog('Delete this receipt and its expenses?'))) return;
    await deleteReceipt(d.id); draft = null; ctx.go('receipts');
  });
  on(el, 'click', '[data-action=save]', () => save(ctx));
}

function renderSplit(el) {
  const d = draft;
  const t = totals(d);
  const groups = splitByCategory(d);
  const missing = d.items.filter((i) => !i.category_id && i.amount).length;
  $('#splitCard', el).innerHTML = `
    <div class="card-head"><div><h2>Sectioned expenses</h2><p>Tax, tip and fees are shared across categories in proportion to their items.</p></div></div>
    <div class="grid cols-2">
      <div class="list">${groups.map((g) => `<div class="list-item"><span class="grow">${g.categoryId ? esc(categoryName(g.categoryId)) : '<span class="neg">⚠ Uncategorized</span>'}<div class="small muted">items ${money(g.items)}</div></span><strong class="num">${money(g.amount)}</strong></div>`).join('')}</div>
      <div class="kv">
        <span>Items</span><span>${money(t.itemsTotal)}</span>
        <span>Tax + tip + fees − discount</span><span>${money(t.extras)}</span>
        <span class="total">Will be recorded</span><span class="total">${money(t.computed)}</span>
        ${t.printed ? `<span>Printed total</span><span>${money(t.printed)}</span>` : ''}
      </div>
    </div>
    ${Math.abs(t.mismatch) >= 0.02 ? `<div class="alert warn" style="margin-top:12px"><span class="alert-icon">!</span><div>Items + extras differ from the printed total by <strong>${money(t.mismatch)}</strong>. Check for a missed or misread line.</div></div>` : t.printed ? '<div class="alert good" style="margin-top:12px"><span class="alert-icon">✓</span><div>Matches the printed total.</div></div>' : ''}
    ${missing ? `<div class="alert bad" style="margin-top:8px"><span class="alert-icon">!</span><div>${missing} item(s) still need a category.</div></div>` : ''}`;
}

async function save(ctx) {
  const d = draft;
  if (!d.date) return toast('Add the receipt date', 'bad');
  if (d.items.some((i) => !i.category_id && i.amount)) return toast('Give every item a category first', 'bad');
  const groups = splitByCategory(d);
  const oldIds = new Set(d.transactionIds || []);
  const now = new Date().toISOString();
  const txs = groups.map((g) => ({
    id: uid('tx'), type: g.amount < 0 ? 'income' : 'expense', date: d.date, amount: Math.abs(g.amount), merchant: d.merchant || 'Receipt',
    categoryId: g.categoryId, sourceId: g.amount < 0 ? 'other_income' : '', account: d.payment_method || '', source: 'receipt', receiptId: d.id, createdAt: now,
    note: d.items.filter((i) => (i.category_id || '') === g.categoryId).map((i) => i.description).filter(Boolean).slice(0, 6).join(', '),
  }));
  const { isNew, rawText, ...record } = d;
  record.transactionIds = txs.map((t) => t.id);
  record.computedTotal = totals(d).computed;
  update('transactions', (list) => list.filter((t) => !oldIds.has(t.id)).concat(txs));
  update('receipts', (list) => {
    const i = list.findIndex((r) => r.id === record.id);
    if (i >= 0) list[i] = record; else list.push(record);
  });
  if (d.merchant && groups[0]?.categoryId && groups.length === 1) learnRule(d.merchant, groups[0].categoryId);
  toast(`Saved ${txs.length} expense${txs.length === 1 ? '' : 's'} from ${d.merchant || 'receipt'}`);
  draft = null;
  ctx.go('receipts');
}

async function deleteReceipt(id) {
  const r = state.receipts.find((x) => x.id === id);
  if (!r) return;
  const ids = new Set(r.transactionIds || []);
  update('transactions', (list) => list.filter((t) => !ids.has(t.id) && t.receiptId !== id));
  update('receipts', (list) => list.filter((x) => x.id !== id));
  if (r.files?.length) await api('/api/files', { method: 'DELETE', body: { files: r.files } }).catch(() => {});
  toast('Receipt deleted');
}
