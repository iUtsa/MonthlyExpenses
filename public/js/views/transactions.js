import { state, update, categoryName } from '../store.js';
import {
  esc, money, fmtDate, today, uid, modal, confirmDialog, options, toast, on, $, $$,
  download, toCSV, parseCSV, round2, sum, emptyState, loadScript,
} from '../util.js';
import { autoCategorize } from '../calc.js';
import { parseAnyDate, guessCsvColumns, toNumber } from '../parse.js';
import { dismissPaycheck, replaceEstimate } from '../automation.js';

const SOURCE_BADGE = { receipt: '🧾 Receipt', import: '⇩ Import', paycheck: '⏱ Paycheck', bill: '📅 Bill', manual: '' };
let filters = { q: '', type: '', category: '', scope: 'period', source: '' };
export function setFilters(next) { filters = { q: '', type: '', category: '', scope: 'period', source: '', ...next }; }

export function learnRule(merchant, categoryId) {
  const match = String(merchant || '').trim().toLowerCase();
  if (!match || !categoryId) return;
  update('rules', (rules) => {
    const existing = rules.find((r) => r.match === match);
    if (existing) existing.categoryId = categoryId;
    else rules.push({ id: uid('rule'), match, categoryId });
  }, { silent: true });
}

export async function openTransactionForm(ctx, tx = null, defaults = {}) {
  const t = tx || { id: null, type: 'expense', date: today() >= ctx.range.from && today() <= ctx.range.to ? today() : ctx.range.from, amount: '', merchant: '', categoryId: '', sourceId: 'salary', note: '', account: '', ...defaults };
  const groups = ['need', 'want', 'savings'].map((type) => `<optgroup label="${{ need: 'Needs', want: 'Wants', savings: 'Savings & Debt' }[type]}">${options(state.categories.filter((c) => c.type === type), t.categoryId)}</optgroup>`).join('');
  return modal({
    title: tx ? 'Edit transaction' : 'Add transaction',
    body: `
      <div class="form-grid">
        <label class="field">Type
          <select name="type" id="txType">
            ${options([{ id: 'expense', name: 'Expense' }, { id: 'income', name: 'Income' }, { id: 'transfer', name: 'Transfer (ignored in budget)' }], t.type)}
          </select>
        </label>
        <label class="field">Date<input type="date" name="date" value="${esc(t.date)}" required></label>
        <label class="field">Amount<input type="number" name="amount" step="0.01" value="${esc(t.amount)}" required autofocus placeholder="0.00"></label>
        <label class="field">Merchant / payer<input name="merchant" value="${esc(t.merchant)}" placeholder="e.g. Trader Joe's" list="merchantList"></label>
        <label class="field span-2" id="catField">Category<select name="categoryId"><option value="">— Choose —</option>${groups}</select></label>
        <label class="field span-2 hidden" id="srcField">Income source<select name="sourceId">${options(state.incomeSources, t.sourceId)}</select></label>
        <label class="field">Account<input name="account" value="${esc(t.account || '')}" placeholder="Checking, Visa…"></label>
        <label class="field">Note<input name="note" value="${esc(t.note || '')}"></label>
      </div>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="learn" ${tx ? '' : 'checked'}> Always use this category for this merchant</label>
      <datalist id="merchantList">${[...new Set(state.transactions.map((x) => x.merchant).filter(Boolean))].slice(-200).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`,
    onOpen(form) {
      const sync = () => {
        const type = form.type.value;
        $('#catField', form).classList.toggle('hidden', type !== 'expense');
        $('#srcField', form).classList.toggle('hidden', type !== 'income');
      };
      form.type.addEventListener('change', sync);
      form.merchant.addEventListener('change', () => {
        if (form.type.value === 'expense' && !form.categoryId.value) {
          const guess = autoCategorize(state, form.merchant.value);
          if (guess) form.categoryId.value = guess;
        }
      });
      sync();
    },
    onSubmit(form, v) {
      if (!v.amount) throw new Error('Enter an amount');
      if (v.type === 'expense' && !v.categoryId) throw new Error('Choose a category');
      const record = {
        ...(tx || { id: uid('tx'), source: 'manual', createdAt: new Date().toISOString() }),
        type: v.type, date: v.date, amount: round2(v.amount), merchant: v.merchant.trim(),
        categoryId: v.type === 'expense' ? v.categoryId : '', sourceId: v.type === 'income' ? v.sourceId : '',
        account: v.account, note: v.note,
      };
      update('transactions', (list) => {
        const i = list.findIndex((x) => x.id === record.id);
        if (i >= 0) list[i] = record; else list.push(record);
      });
      if (v.learn && record.type === 'expense') learnRule(record.merchant, record.categoryId);
      toast(tx ? 'Transaction updated' : 'Transaction added');
      return true;
    },
  });
}

function filtered(ctx) {
  const q = filters.q.toLowerCase();
  return state.transactions
    .filter((t) => (filters.scope === 'period' ? t.date >= ctx.range.from && t.date <= ctx.range.to : true))
    .filter((t) => !filters.type || t.type === filters.type)
    .filter((t) => !filters.category || (filters.category === '__none' ? t.type === 'expense' && !state.categories.some((c) => c.id === t.categoryId) : t.categoryId === filters.category))
    .filter((t) => !filters.source || (t.source || 'manual') === filters.source)
    .filter((t) => !q || `${t.merchant} ${t.note} ${categoryName(t.categoryId)} ${t.amount}`.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function render(el, ctx) {
  const list = filtered(ctx);
  const expenses = sum(list.filter((t) => t.type === 'expense'), (t) => t.amount);
  const income = sum(list.filter((t) => t.type === 'income'), (t) => t.amount);
  const catOptions = `<option value="">All categories</option><option value="__none" ${filters.category === '__none' ? 'selected' : ''}>Uncategorized</option>${options(state.categories, filters.category)}`;

  el.innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="row">
          <input type="search" placeholder="Search merchant, note, amount…" value="${esc(filters.q)}" data-f="q" data-key="tx-search" style="flex:1;min-width:200px">
          <select data-f="scope">${options([{ id: 'period', name: ctx.range.kind === 'period' ? `This ${ctx.range.word} (${ctx.range.label})` : ctx.range.label }, { id: 'all', name: 'All time' }], filters.scope)}</select>
          <select data-f="type">${options([{ id: '', name: 'All types' }, { id: 'expense', name: 'Expenses' }, { id: 'income', name: 'Income' }, { id: 'transfer', name: 'Transfers' }], filters.type)}</select>
          <select data-f="category">${catOptions}</select>
          <select data-f="source">${options([{ id: '', name: 'Any source' }, { id: 'manual', name: 'Manual' }, { id: 'receipt', name: 'Receipts' }, { id: 'import', name: 'Imported' }, { id: 'paycheck', name: 'Paychecks' }, { id: 'bill', name: 'Bills' }], filters.source)}</select>
        </div>
      </div>
      <div class="row between">
        <div class="row">
          <span class="badge">${list.length} transactions</span>
          <span class="badge bad">Spent ${money(expenses)}</span>
          <span class="badge good">Received ${money(income)}</span>
        </div>
        <div class="row">
          <button class="btn" data-action="import">⇩ Import bank CSV</button>
          <button class="btn" data-action="export">⇧ Export CSV</button>
          <button class="btn primary" data-action="add">+ Add</button>
        </div>
      </div>
      <div class="card flush">
        <div class="row hidden" id="bulkBar" style="padding:10px 16px;border-bottom:1px solid var(--border)">
          <strong id="bulkCount"></strong>
          <select id="bulkCat"><option value="">Move to category…</option>${options(state.categories, '')}</select>
          <button class="btn small danger" data-action="bulk-delete">Delete selected</button>
        </div>
        ${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th style="width:28px"><input type="checkbox" id="selAll" aria-label="Select all"></th><th>Date</th><th>Merchant / note</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>${list.slice(0, 500).map((t) => row(t)).join('')}</tbody>
        </table></div>${list.length > 500 ? '<p class="small muted" style="padding:10px 16px">Showing the newest 500 — narrow the filters to see more.</p>' : ''}`
    : emptyState('⇄', 'No transactions here yet', 'Add one, scan a receipt, or import a CSV from your bank.', '<button class="btn primary" data-action="add">+ Add transaction</button> <a class="btn" href="#/receipts">🧾 Scan a receipt</a>')}
      </div>
    </div>`;

  on(el, 'input', '[data-f=q]', (e) => { filters.q = e.target.value; ctx.refresh(); });
  on(el, 'change', 'select[data-f]', (e, s) => { filters[s.dataset.f] = s.value; ctx.refresh(); });
  on(el, 'click', '[data-action=add]', async () => { if (await openTransactionForm(ctx)) ctx.refresh(); });
  on(el, 'click', '[data-action=edit]', async (e, b) => {
    const tx = state.transactions.find((t) => t.id === b.dataset.id);
    if (await openTransactionForm(ctx, tx)) ctx.refresh();
  });
  on(el, 'click', '[data-action=delete]', async (e, b) => {
    if (!(await confirmDialog('Delete this transaction?'))) return;
    dismissPaycheck(state.transactions.find((t) => t.id === b.dataset.id));
    update('transactions', (l) => l.filter((t) => t.id !== b.dataset.id));
    ctx.refresh();
  });
  on(el, 'change', 'select[data-cat]', (e, s) => {
    const tx = state.transactions.find((t) => t.id === s.dataset.cat);
    update('transactions', () => { tx.categoryId = s.value; }, { silent: true });
    if (tx.merchant) { learnRule(tx.merchant, s.value); toast(`"${tx.merchant}" will be filed under ${categoryName(s.value)} from now on`); }
  });
  on(el, 'click', '[data-action=export]', () => exportCSV(list));
  on(el, 'click', '[data-action=import]', async () => { if (await importCSV()) ctx.refresh(); });

  // Bulk selection
  const selected = () => $$('input[data-sel]:checked', el).map((c) => c.dataset.sel);
  const syncBulk = () => {
    const n = selected().length;
    $('#bulkBar', el)?.classList.toggle('hidden', n === 0);
    if ($('#bulkCount', el)) $('#bulkCount', el).textContent = `${n} selected`;
  };
  on(el, 'change', 'input[data-sel]', syncBulk);
  on(el, 'change', '#selAll', (e) => { $$('input[data-sel]', el).forEach((c) => { c.checked = e.target.checked; }); syncBulk(); });
  on(el, 'change', '#bulkCat', (e) => {
    const ids = new Set(selected());
    if (!e.target.value || !ids.size) return;
    update('transactions', (l) => { for (const t of l) if (ids.has(t.id) && t.type === 'expense') t.categoryId = e.target.value; });
    toast(`Moved ${ids.size} transactions`);
    ctx.refresh();
  });
  on(el, 'click', '[data-action=bulk-delete]', async () => {
    const ids = new Set(selected());
    if (!(await confirmDialog(`Delete ${ids.size} transactions?`))) return;
    state.transactions.filter((t) => ids.has(t.id)).forEach(dismissPaycheck);
    update('transactions', (l) => l.filter((t) => !ids.has(t.id)));
    ctx.refresh();
  });
}

function row(t) {
  const isExpense = t.type === 'expense';
  const known = state.categories.some((c) => c.id === t.categoryId);
  const cat = isExpense
    ? `<select data-cat="${t.id}" class="cell" aria-label="Category" style="max-width:240px">${known ? '' : '<option value="">⚠ Uncategorized</option>'}${options(state.categories, t.categoryId)}</select>`
    : `<span class="badge ${t.type === 'income' ? 'good' : ''}">${t.type === 'income' ? esc(state.incomeSources.find((x) => x.id === t.sourceId)?.name || 'Income') : 'Transfer'}</span>`;
  const badge = SOURCE_BADGE[t.source || 'manual'];
  const receiptLink = t.receiptId ? `<a href="#/receipts?id=${esc(t.receiptId)}" class="badge info">${badge}</a>` : badge ? `<span class="badge">${badge}</span>` : '';
  return `<tr>
    <td><input type="checkbox" data-sel="${t.id}" aria-label="Select"></td>
    <td class="nowrap">${fmtDate(t.date, { month: 'short', day: 'numeric', year: '2-digit' })}</td>
    <td><div class="title">${esc(t.merchant || '—')} ${receiptLink}</div>${t.note ? `<div class="small muted">${esc(t.note)}</div>` : ''}</td>
    <td>${cat}</td>
    <td class="num ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : ''}${money(t.amount)}</td>
    <td class="actions"><button class="icon-btn small" data-action="edit" data-id="${t.id}" aria-label="Edit">✎</button> <button class="icon-btn small" data-action="delete" data-id="${t.id}" aria-label="Delete">🗑</button></td>
  </tr>`;
}

function exportCSV(list) {
  const rows = [['Date', 'Type', 'Merchant', 'Category', 'Income source', 'Amount', 'Account', 'Note', 'Source']];
  for (const t of list) rows.push([t.date, t.type, t.merchant, t.type === 'expense' ? categoryName(t.categoryId) : '', state.incomeSources.find((s) => s.id === t.sourceId)?.name || '', t.amount, t.account || '', t.note || '', t.source || 'manual']);
  download(`transactions-${today()}.csv`, toCSV(rows), 'text/csv');
}

async function readTable(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    await loadScript('vendor/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { cellDates: false });
    return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  }
  return parseCSV(await file.text());
}

async function importCSV() {
  let rows = [];
  const colSelect = (name, idx, header) => `<select name="${name}"><option value="-1">—</option>${header.map((h, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}</select>`;
  return modal({
    title: 'Import bank or card statement',
    wide: true,
    submitLabel: 'Import',
    body: `
      <p class="text-2">Export a CSV (or Excel) file from your bank or card website, then map its columns. Duplicates (same date, amount and description) are skipped, and every row is auto-categorized using your category keywords and learned merchant rules.</p>
      <input type="file" name="file" accept=".csv,.xlsx,.xls,text/csv" required>
      <div id="mapping" style="margin-top:14px"></div>`,
    onOpen(form) {
      form.file.addEventListener('change', async () => {
        const file = form.file.files[0];
        if (!file) return;
        rows = await readTable(file);
        if (rows.length < 2) { $('#mapping', form).innerHTML = '<p class="neg">No rows found.</p>'; return; }
        const header = rows[0].map(String);
        const g = guessCsvColumns(header);
        $('#mapping', form).innerHTML = `
          <div class="form-grid">
            <label class="field">Date column${colSelect('cDate', g.date, header)}</label>
            <label class="field">Description column${colSelect('cDesc', g.description, header)}</label>
            <label class="field">Amount column${colSelect('cAmount', g.amount, header)}</label>
            <label class="field">…or Debit column${colSelect('cDebit', g.amount >= 0 ? -1 : g.debit, header)}</label>
            <label class="field">…and Credit column${colSelect('cCredit', g.amount >= 0 ? -1 : g.credit, header)}</label>
            <label class="field">Spending shows as
              <select name="sign"><option value="neg">Negative numbers (most banks)</option><option value="pos">Positive numbers (most credit cards)</option></select>
            </label>
            <label class="field">Account name<input name="account" value="${esc(file.name.replace(/\.[^.]+$/, ''))}"></label>
          </div>
          <p class="small muted" style="margin-top:10px">${rows.length - 1} rows found. Preview of the first row: ${esc(rows[1].join(' · '))}</p>`;
      });
    },
    onSubmit(form, v) {
      if (rows.length < 2) throw new Error('Choose a file first');
      const c = { date: +v.cDate, desc: +v.cDesc, amount: +v.cAmount, debit: +v.cDebit, credit: +v.cCredit };
      if (c.date < 0 || c.desc < 0 || (c.amount < 0 && c.debit < 0 && c.credit < 0)) throw new Error('Map the date, description and amount columns');
      const existing = new Set(state.transactions.map((t) => `${t.date}|${round2(t.amount)}|${(t.merchant || '').toLowerCase()}`));
      const added = []; let skipped = 0;
      for (const r of rows.slice(1)) {
        const date = parseAnyDate(r[c.date]);
        if (!date) { skipped++; continue; }
        let value;
        if (c.amount >= 0) value = toNumber(r[c.amount]) * (v.sign === 'pos' ? -1 : 1);
        else value = toNumber(r[c.credit]) - Math.abs(toNumber(r[c.debit]));
        if (!value) { skipped++; continue; }
        const merchant = String(r[c.desc] || '').replace(/\s+/g, ' ').trim();
        const amount = round2(Math.abs(value));
        const key = `${date}|${amount}|${merchant.toLowerCase()}`;
        if (existing.has(key)) { skipped++; continue; }
        existing.add(key);
        const type = value < 0 ? 'expense' : 'income';
        added.push({
          id: uid('tx'), type, date, amount, merchant, account: v.account, note: '', source: 'import', createdAt: new Date().toISOString(),
          categoryId: type === 'expense' ? autoCategorize(state, merchant) || '' : '',
          sourceId: type === 'income' ? (/payroll|direct dep|salary/i.test(merchant) ? 'salary' : 'other_income') : '',
        });
      }
      // A deposit from the bank replaces the matching estimated paycheck.
      const replaced = new Set();
      for (const t of added.filter((x) => x.type === 'income')) {
        const est = replaceEstimate({ transactions: state.transactions.filter((x) => !replaced.has(x.id)) }, { date: t.date, amount: t.amount });
        if (est) { replaced.add(est.id); t.sourceId = est.sourceId; t.paycheckKey = est.paycheckKey; }
      }
      update('transactions', (l) => l.filter((x) => !replaced.has(x.id)).concat(added));
      const uncategorized = added.filter((t) => t.type === 'expense' && !t.categoryId).length;
      toast(`Imported ${added.length} transactions${skipped ? `, skipped ${skipped}` : ''}${uncategorized ? ` — ${uncategorized} need a category` : ''}`);
      return true;
    },
  });
}
