import { state, update, api } from '../store.js';
import {
  esc, money, pct, num, fmtDate, today, uid, modal, confirmDialog, options, toast, on, $, $$, sum, round2,
  monthLabel, emptyState, parseCSV, loadScript, daysInMonth, addDays, startOfWeek,
} from '../util.js';
import {
  computeShifts, earningsForMonth, paychecks, yearTaxProjection, annualTax, shiftHours,
  PAY_FREQUENCIES, FILING_STATUSES, TAX_TABLES,
} from '../calc.js';
import { parseScheduleRows, parseScheduleText, parseICS } from '../parse.js';
import { barChart, seriesColor } from '../charts.js';
import { uploadFiles, ocr, prepareForAI } from './receipts.js';

let tab = 'overview';
let pending = null; // parsed schedule awaiting confirmation
let stubDraft = null;
let busy = '';

const TABS = [
  ['overview', 'Earnings overview'], ['shifts', 'Schedule & shifts'], ['jobs', 'Jobs & pay rates'],
  ['stubs', 'Pay stubs'], ['tax', 'Tax estimator'],
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function render(el, ctx) {
  if (ctx.params.get('tab')) tab = ctx.params.get('tab');
  el.innerHTML = `<div class="tabs">${TABS.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</div><div id="tabBody"></div>`;
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; ctx.refresh(); });
  const body = $('#tabBody', el);
  if (!state.jobs.length && tab !== 'tax' && tab !== 'stubs') {
    body.innerHTML = `<div class="card">${emptyState('⏱', 'Add your job first', 'Tell the app your pay rate, overtime rules and pay schedule. Then upload your work schedule and it will work out hours, overtime, gross pay, taxes and take-home for each paycheck.', '<button class="btn primary" data-action="new-job">+ Add a job</button>')}</div>`;
    on(body, 'click', '[data-action=new-job]', async () => { if (await jobForm()) ctx.refresh(); });
    return;
  }
  ({ overview, shifts: shiftsTab, jobs: jobsTab, stubs: stubsTab, tax: taxTab })[tab](body, ctx);
}

/* ====================== Overview ====================== */
function overview(el, ctx) {
  const e = earningsForMonth(state, ctx.month);
  const upcoming = paychecks(state, { from: today(), to: addDays(today(), 45) });
  const recorded = new Set(state.transactions.filter((t) => t.paycheckKey).map((t) => t.paycheckKey));

  // Weekly breakdown for the chart
  const weeks = [...new Set(e.shifts.map((s) => s.week))].sort();
  const per = (w, fn) => round2(sum(e.shifts.filter((s) => s.week === w), fn));

  el.innerHTML = `
    <div class="grid cols-4">
      <div class="card tile"><span class="tile-label">Hours scheduled / worked</span><span class="tile-value">${num(e.hours, 1)}</span><span class="tile-sub">${num(e.overtime, 1)} overtime hrs</span></div>
      <div class="card tile"><span class="tile-label">Earned (by shift date)</span><span class="tile-value">${money(e.earned, { cents: false })}</span><span class="tile-sub">Gross incl. tips & differentials</span></div>
      <div class="card tile"><span class="tile-label">Paid this month (gross)</span><span class="tile-value">${money(e.paidGross, { cents: false })}</span><span class="tile-sub">${e.paychecks.length} paychecks</span></div>
      <div class="card tile"><span class="tile-label">Expected take-home</span><span class="tile-value pos">${money(e.paidNet, { cents: false })}</span><span class="tile-sub"><button class="btn small" data-action="to-budget">Send to ${monthLabel(ctx.month, 'short')} budget</button></span></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>Weekly gross earnings</h2><p>${monthLabel(ctx.month)} · week starting</p></div></div>
        ${weeks.length ? '<div class="chart-box"><canvas id="weekChart" aria-label="Weekly earnings chart"></canvas></div>' : emptyState('📅', 'No shifts this month', 'Upload a schedule or add shifts.')}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Earnings by job</h2></div></div>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Job</th><th class="num">Shifts</th><th class="num">Hours</th><th class="num">OT</th><th class="num">Earned</th><th class="num">Take-home paid</th></tr></thead>
          <tbody>${e.byJob.map((j) => `<tr><td>${esc(j.job.name)}</td><td class="num">${j.shifts}</td><td class="num">${num(j.hours, 1)}</td><td class="num">${num(j.overtime, 1)}</td><td class="num">${money(j.earned)}</td><td class="num">${money(j.paidNet)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>
    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Paychecks</h2><p>This month's and the next 45 days. Estimates use your tax settings${state.settings.tax.useStubRates ? ' (rates from your latest pay stub)' : ''}.</p></div></div>
      ${paycheckTable([...new Map([...e.paychecks, ...upcoming].map((p) => [`${p.job.id}|${p.payday}`, p])).values()].sort((a, b) => a.payday.localeCompare(b.payday)), recorded)}
    </div>`;

  if (weeks.length) {
    barChart($('#weekChart', el), {
      labels: weeks.map((w) => fmtDate(w)),
      stacked: true,
      datasets: [
        { label: 'Regular', data: weeks.map((w) => per(w, (s) => s.regularPay)), color: seriesColor(1) },
        { label: 'Overtime', data: weeks.map((w) => per(w, (s) => s.otPay)), color: seriesColor(2) },
        { label: 'Differentials', data: weeks.map((w) => per(w, (s) => s.diffPay)), color: seriesColor(3) },
        { label: 'Tips', data: weeks.map((w) => per(w, (s) => s.tips)), color: seriesColor(4) },
      ].filter((d) => d.data.some((v) => v)),
    });
  }

  on(el, 'click', '[data-action=to-budget]', () => {
    const bySource = {};
    for (const j of e.byJob) if (j.job.sourceId) bySource[j.job.sourceId] = (bySource[j.job.sourceId] || 0) + j.paidNet;
    update('budgets', (b) => {
      b[ctx.month] ||= { income: {}, planned: {}, notes: {} };
      for (const [src, v] of Object.entries(bySource)) b[ctx.month].income[src] = round2(v);
    });
    toast(`Planned income for ${monthLabel(ctx.month)} updated from your schedule`);
  });
  on(el, 'click', '[data-record]', async (ev, b) => {
    const pc = [...e.paychecks, ...upcoming].find((p) => `${p.job.id}|${p.payday}` === b.dataset.record);
    if (!pc) return;
    const amount = await modal({
      title: `Record paycheck · ${pc.job.name}`,
      body: `<p class="text-2">Estimated take-home is ${money(pc.net)}. Enter the amount that actually arrived.</p>
        <div class="form-grid"><label class="field">Amount received<input type="number" step="0.01" name="amount" value="${round2(pc.net)}" required></label>
        <label class="field">Date<input type="date" name="date" value="${pc.payday}" required></label></div>`,
      submitLabel: 'Record income',
      onSubmit: (f, v) => v,
    });
    if (!amount) return;
    update('transactions', (l) => l.push({
      id: uid('tx'), type: 'income', date: amount.date, amount: round2(amount.amount), merchant: pc.job.name, sourceId: pc.job.sourceId || 'salary',
      categoryId: '', source: 'paycheck', paycheckKey: b.dataset.record, note: `Pay period ${fmtDate(pc.start)}–${fmtDate(pc.end)} · ${num(pc.hours, 1)} hrs`, createdAt: new Date().toISOString(),
    }));
    toast('Paycheck recorded as income');
    ctx.refresh();
  });
  on(el, 'click', '[data-breakdown]', (ev, b) => {
    const pc = [...e.paychecks, ...upcoming].find((p) => `${p.job.id}|${p.payday}` === b.dataset.breakdown);
    if (pc) paycheckModal(pc);
  });
}

function paycheckTable(list, recorded) {
  if (!list.length) return emptyState('💵', 'No paychecks in range', 'Add shifts (or a salaried job) to see paychecks.');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Payday</th><th>Job</th><th>Period</th><th class="num">Hours</th><th class="num">Gross</th><th class="num">Taxes</th><th class="num">Take-home</th><th></th></tr></thead>
    <tbody>${list.map((p) => {
    const key = `${p.job.id}|${p.payday}`;
    return `<tr>
      <td><strong>${fmtDate(p.payday, { weekday: 'short', month: 'short', day: 'numeric' })}</strong></td>
      <td>${esc(p.job.name)}</td>
      <td class="small muted">${fmtDate(p.start)} – ${fmtDate(p.end)}</td>
      <td class="num">${p.salary ? '—' : num(p.hours, 1)}</td>
      <td class="num">${money(p.gross)}</td>
      <td class="num neg">−${money(p.total + p.preTax)}</td>
      <td class="num pos"><strong>${money(p.net)}</strong></td>
      <td class="actions"><button class="btn small" data-breakdown="${key}">Breakdown</button>
        ${recorded.has(key) ? '<span class="badge good">✓ Recorded</span>' : `<button class="btn small" data-record="${key}">Record</button>`}</td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

function paycheckModal(p) {
  const lines = [
    ['Regular pay', sum(p.shifts, (s) => s.regularPay) + (p.salary || 0)],
    ['Overtime pay', sum(p.shifts, (s) => s.otPay)],
    ['Shift differentials', sum(p.shifts, (s) => s.diffPay)],
    ['Tips', p.tips],
  ].filter(([, v]) => v);
  modal({
    title: `Paycheck ${fmtDate(p.payday, { month: 'long', day: 'numeric', year: 'numeric' })}`,
    submitLabel: '',
    body: `
      <div class="kv">
        ${lines.map(([k, v]) => `<span>${k}</span><span>${money(v)}</span>`).join('')}
        <span class="total">Gross pay</span><span class="total">${money(p.gross)}</span>
        ${p.preTax ? `<span>Pre-tax deductions (401k, health…)</span><span class="neg">−${money(p.preTax)}</span>` : ''}
        <span>Federal income tax withholding</span><span class="neg">−${money(p.federal)}</span>
        <span>Social Security (6.2%)</span><span class="neg">−${money(p.socialSecurity)}</span>
        <span>Medicare (1.45%)</span><span class="neg">−${money(p.medicare)}</span>
        <span>State income tax</span><span class="neg">−${money(p.state)}</span>
        ${p.local ? `<span>Local tax</span><span class="neg">−${money(p.local)}</span>` : ''}
        <span class="total">Take-home</span><span class="total pos">${money(p.net)}</span>
      </div>
      ${p.shifts.length ? `<h3 style="margin-top:16px">Shifts</h3><table class="table-compact" style="margin-top:6px"><tbody>${p.shifts.map((s) => `<tr><td>${fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${s.start}–${s.end}</td><td class="num">${num(s.hours, 2)} h${s.overtime ? ` <span class="badge warn">${num(s.overtime, 2)} OT</span>` : ''}</td><td class="num">${money(s.gross)}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="small muted" style="margin-top:12px">Withholding is estimated by annualizing this paycheck (${p.source}). Your real stub may differ by W-4 settings and benefits.</p>`,
  });
}

/* ====================== Shifts ====================== */
function shiftsTab(el, ctx) {
  const month = ctx.month;
  const computed = computeShifts(state).filter((s) => s.date.startsWith(month));
  const weeks = new Map();
  for (const s of computed) { if (!weeks.has(s.week)) weeks.set(s.week, []); weeks.get(s.week).push(s); }

  el.innerHTML = `
    <div class="grid cols-3">
      <div class="card span-2">
        <div class="card-head"><div><h2>Upload your work schedule</h2><p>Screenshot or photo of the roster, a PDF, a spreadsheet/CSV, or a calendar (.ics) export.</p></div>
          <span class="badge ${ctx.ai.enabled ? 'good' : ''}">${ctx.ai.enabled ? '✓ AI reading on' : 'On-device reading'}</span></div>
        ${busy ? `<div class="alert info"><span class="alert-icon">⏳</span><div>${esc(busy)}</div></div>` : `
        <div class="form-grid" style="margin-bottom:12px">
          <label class="field">Assign shifts to job<select id="schedJob">${options(state.jobs, state.jobs[0]?.id)}</select></label>
          <label class="field">Your name on the schedule<input id="schedPerson" value="${esc(state.settings.schedulePerson || '')}" placeholder="Only if the roster lists several people"></label>
        </div>
        <label class="dropzone" id="schedDrop">
          <div class="big">🗓</div><div><strong>Drop schedule here</strong> or click to choose</div>
          <div class="small muted">PNG/JPG/PDF · XLSX/CSV · ICS</div>
          <input type="file" id="schedFile" accept="image/*,application/pdf,.csv,.xlsx,.xls,.ics,text/calendar" multiple hidden>
        </label>`}
      </div>
      <div class="card">
        <h2>${monthLabel(month)}</h2>
        <div class="kv" style="margin-top:10px">
          <span>Shifts</span><span>${computed.length}</span>
          <span>Hours</span><span>${num(sum(computed, (s) => s.hours), 1)}</span>
          <span>Overtime hours</span><span>${num(sum(computed, (s) => s.overtime), 1)}</span>
          <span>Gross earned</span><span>${money(sum(computed, (s) => s.gross))}</span>
        </div>
        <button class="btn primary" data-action="add-shift" style="margin-top:14px;width:100%">+ Add shift manually</button>
      </div>
    </div>
    <div id="pendingBox"></div>
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>Calendar</h2></div>
      ${calendar(month, computed)}
    </div>
    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><div><h2>Shifts by workweek</h2><p>Overtime is applied after ${state.jobs[0]?.otWeeklyThreshold ?? 40} hours per workweek per job.</p></div></div>
      ${computed.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Time</th><th>Job / role</th><th class="num">Hours</th><th class="num">OT</th><th class="num">Tips</th><th class="num">Gross</th><th></th></tr></thead>
        <tbody>${[...weeks.entries()].map(([w, list]) => `
          <tr class="group-row"><td colspan="3">Week of ${fmtDate(w)}</td><td class="num">${num(sum(list, (s) => s.hours), 1)}</td><td class="num">${num(sum(list, (s) => s.overtime), 1)}</td><td></td><td class="num">${money(sum(list, (s) => s.gross))}</td><td></td></tr>
          ${list.map((s) => `<tr>
            <td>${fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
            <td>${s.start}–${s.end}${s.breakMin ? ` <span class="small muted">(${s.breakMin}m break)</span>` : ''}</td>
            <td>${esc(s.job?.name || '?')}${s.role ? ` <span class="small muted">· ${esc(s.role)}</span>` : ''}${s.diffs.length ? ` <span class="badge info">${s.diffs.map((d) => esc(d.name)).join(', ')}</span>` : ''}</td>
            <td class="num">${num(s.hours, 2)}</td>
            <td class="num">${s.overtime ? num(s.overtime, 2) : ''}</td>
            <td class="num">${s.tips ? money(s.tips) : ''}</td>
            <td class="num">${money(s.gross)}</td>
            <td class="actions"><button class="icon-btn small" data-edit-shift="${s.id}" aria-label="Edit">✎</button> <button class="icon-btn small" data-del-shift="${s.id}" aria-label="Delete">🗑</button></td>
          </tr>`).join('')}`).join('')}</tbody></table></div>`
    : emptyState('🗓', 'No shifts this month', 'Upload a schedule above.')}
    </div>`;

  renderPending($('#pendingBox', el), ctx);
  const drop = $('#schedDrop', el);
  if (drop) {
    const go = (files) => files.length && readSchedule([...files], ctx);
    $('#schedFile', el).addEventListener('change', (e) => go(e.target.files));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); go(e.dataTransfer.files); });
    $('#schedPerson', el).addEventListener('change', (e) => update('settings', (s) => { s.schedulePerson = e.target.value.trim(); }, { silent: true }));
  }
  on(el, 'click', '[data-action=add-shift]', async () => { if (await shiftForm(null, ctx)) ctx.refresh(); });
  on(el, 'click', '[data-edit-shift]', async (e, b) => { if (await shiftForm(state.shifts.find((s) => s.id === b.dataset.editShift), ctx)) ctx.refresh(); });
  on(el, 'click', '[data-del-shift]', (e, b) => { update('shifts', (l) => l.filter((s) => s.id !== b.dataset.delShift)); ctx.refresh(); });
}

function calendar(month, shifts) {
  const first = `${month}-01`;
  const start = startOfWeek(first, 0);
  const cells = [];
  for (let d = start, i = 0; i < 42; i++, d = addDays(d, 1)) {
    if (i >= 35 && !d.startsWith(month)) break;
    const list = shifts.filter((s) => s.date === d);
    cells.push(`<div class="cal-day ${d.startsWith(month) ? '' : 'out'} ${d === today() ? 'today' : ''}">
      <div class="cal-num">${Number(d.slice(8))}</div>
      ${list.map((s) => `<span class="cal-chip" title="${esc(s.job?.name || '')} ${s.start}–${s.end}">${s.start}–${s.end}</span>`).join('')}
    </div>`);
  }
  return `<div class="cal">${DAY_NAMES.map((n) => `<div class="cal-head">${n}</div>`).join('')}${cells.join('')}</div>`;
}

async function readSchedule(files, ctx) {
  const jobId = $('#schedJob')?.value || state.jobs[0]?.id;
  const person = $('#schedPerson')?.value.trim() || '';
  try {
    let result;
    const f = files[0];
    if (/\.ics$/i.test(f.name) || f.type === 'text/calendar') {
      result = parseICS(await f.text());
    } else if (/\.csv$/i.test(f.name)) {
      result = parseScheduleRows(parseCSV(await f.text()));
    } else if (/\.xlsx?$/i.test(f.name)) {
      await loadScript('vendor/xlsx.full.min.js');
      const wb = window.XLSX.read(await f.arrayBuffer());
      result = parseScheduleRows(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }));
    } else {
      busy = 'Uploading…'; ctx.refresh();
      const uploaded = await uploadFiles('schedules', await prepareForAI(files, ctx.ai));
      if (ctx.ai.enabled) {
        busy = 'Reading your schedule with AI… (10–40 seconds)'; ctx.refresh();
        try { result = await api('/api/ai/schedule', { method: 'POST', body: { files: uploaded, person } }); } catch (err) { toast(`AI reading failed (${err.message}); trying on-device OCR`, 'bad'); }
      }
      if (!result) {
        busy = 'Reading text on this device…'; ctx.refresh();
        result = parseScheduleText(await ocr(files), `${ctx.month}-01`);
      }
    }
    pending = {
      jobId, notes: result.notes, employer: result.employer, hourlyRate: result.hourly_rate,
      shifts: result.shifts.map((s) => ({ ...s, include: true })),
    };
    if (!pending.shifts.length) toast('No shifts found in that file. Try a clearer image or add them manually.', 'bad');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    busy = '';
    ctx.refresh();
  }
}

function renderPending(box, ctx) {
  if (!pending) return;
  const job = state.jobs.find((j) => j.id === pending.jobId);
  const dupes = new Set(state.shifts.map((s) => `${s.jobId}|${s.date}|${s.start}`));
  box.innerHTML = `<div class="card flush" style="margin-top:16px">
    <div class="card-head"><div><h2>Review ${pending.shifts.length} shifts found</h2><p>${esc(pending.notes || '')}</p></div>
      <div class="row"><button class="btn" data-action="cancel-pending">Discard</button><button class="btn primary" data-action="save-pending">Add selected shifts</button></div></div>
    ${pending.hourlyRate && job && Math.abs(pending.hourlyRate - job.rate) > 0.01 ? `<div class="alert info" style="margin:0 16px 12px"><span class="alert-icon">i</span><div>The schedule shows a rate of ${money(pending.hourlyRate)}/hr; ${esc(job.name)} is set to ${money(job.rate)}/hr. <button class="btn small" data-action="use-rate">Use ${money(pending.hourlyRate)}</button></div></div>` : ''}
    <div class="table-wrap"><table class="table-compact">
      <thead><tr><th></th><th>Date</th><th>Start</th><th>End</th><th>Break (min)</th><th>Role / notes</th><th class="num">Hours</th></tr></thead>
      <tbody>${pending.shifts.map((s, i) => `<tr>
        <td><input type="checkbox" data-p="${i}" data-field="include" ${s.include ? 'checked' : ''}></td>
        <td><input type="date" class="cell" data-p="${i}" data-field="date" value="${esc(s.date)}"></td>
        <td><input type="time" class="cell" data-p="${i}" data-field="start" value="${esc(s.start)}"></td>
        <td><input type="time" class="cell" data-p="${i}" data-field="end" value="${esc(s.end)}"></td>
        <td><input type="number" class="cell num" data-p="${i}" data-field="break_minutes" value="${s.break_minutes || 0}" style="width:80px"></td>
        <td><input class="cell" data-p="${i}" data-field="role" value="${esc([s.role, s.location].filter(Boolean).join(' · '))}"></td>
        <td class="num">${num(shiftHours({ start: s.start, end: s.end, breakMin: s.break_minutes }), 2)}${dupes.has(`${pending.jobId}|${s.date}|${s.start}`) ? ' <span class="badge warn">already added</span>' : ''}</td>
      </tr>`).join('')}</tbody></table></div></div>`;

  on(box, 'change', '[data-p]', (e, inp) => {
    const s = pending.shifts[+inp.dataset.p];
    s[inp.dataset.field] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
    ctx.refresh();
  });
  on(box, 'click', '[data-action=cancel-pending]', () => { pending = null; ctx.refresh(); });
  on(box, 'click', '[data-action=use-rate]', () => { update('jobs', () => { job.rate = pending.hourlyRate; }); ctx.refresh(); });
  on(box, 'click', '[data-action=save-pending]', () => {
    const add = pending.shifts.filter((s) => s.include && s.date && s.start && s.end && !dupes.has(`${pending.jobId}|${s.date}|${s.start}`));
    update('shifts', (l) => l.push(...add.map((s) => ({
      id: uid('shift'), jobId: pending.jobId, date: s.date, start: s.start, end: s.end, breakMin: s.break_minutes || 0,
      tips: 0, role: s.role || '', notes: s.notes || '', source: 'upload',
    }))));
    toast(`Added ${add.length} shifts`);
    pending = null;
    ctx.refresh();
  });
}

async function shiftForm(shift, ctx) {
  const s = shift || { jobId: state.jobs[0]?.id, date: `${ctx.month}-${String(Math.min(Number(today().slice(8)), daysInMonth(ctx.month))).padStart(2, '0')}`, start: '09:00', end: '17:00', breakMin: 30, tips: 0, role: '', notes: '' };
  return modal({
    title: shift ? 'Edit shift' : 'Add shift',
    body: `<div class="form-grid">
      <label class="field">Job<select name="jobId">${options(state.jobs, s.jobId)}</select></label>
      <label class="field">Date<input type="date" name="date" value="${s.date}" required></label>
      <label class="field">Start<input type="time" name="start" value="${s.start}" required></label>
      <label class="field">End<input type="time" name="end" value="${s.end}" required></label>
      <label class="field">Unpaid break (min)<input type="number" name="breakMin" value="${s.breakMin || 0}" min="0"></label>
      <label class="field">Tips<input type="number" step="0.01" name="tips" value="${s.tips || 0}" min="0"></label>
      <label class="field">Rate override ($/hr)<input type="number" step="0.01" name="rate" value="${s.rate || ''}" placeholder="Job default"></label>
      <label class="field">Role<input name="role" value="${esc(s.role || '')}"></label>
      <label class="field span-2">Notes<input name="notes" value="${esc(s.notes || '')}"></label>
    </div>
    ${shift ? '' : '<label class="check" style="margin-top:12px"><input type="checkbox" name="repeat"> Repeat weekly for <input type="number" name="weeks" value="4" min="1" max="52" style="width:60px"> weeks</label>'}`,
    onSubmit(form, v) {
      const base = { jobId: v.jobId, start: v.start, end: v.end, breakMin: v.breakMin, tips: v.tips, rate: v.rate || 0, role: v.role, notes: v.notes };
      update('shifts', (l) => {
        if (shift) Object.assign(l.find((x) => x.id === shift.id), base, { date: v.date });
        else {
          const n = v.repeat ? Math.max(1, Math.min(52, v.weeks || 1)) : 1;
          for (let i = 0; i < n; i++) l.push({ id: uid('shift'), ...base, date: addDays(v.date, 7 * i), source: 'manual', tips: i ? 0 : v.tips });
        }
      });
      return true;
    },
  });
}

/* ====================== Jobs ====================== */
function jobsTab(el, ctx) {
  el.innerHTML = `
    <div class="row between" style="margin-bottom:12px"><p class="text-2" style="margin:0">Pay rules used to turn shifts into paychecks.</p><button class="btn primary" data-action="new-job">+ Add job</button></div>
    <div class="grid cols-2">${state.jobs.map((j) => `<div class="card">
      <div class="card-head"><div><h2>${esc(j.name)}</h2><p>${esc(state.incomeSources.find((s) => s.id === j.sourceId)?.name || '')}</p></div>
        <div class="row"><button class="btn small" data-edit-job="${j.id}">Edit</button><button class="icon-btn small" data-del-job="${j.id}" aria-label="Delete">🗑</button></div></div>
      <div class="kv">
        <span>Pay</span><span>${j.payType === 'salary' ? `${money(j.salaryAnnual, { cents: false })}/yr` : `${money(j.rate)}/hr`}</span>
        <span>Pay schedule</span><span>${esc(PAY_FREQUENCIES.find((f) => f.id === j.payFrequency)?.name || '')}</span>
        ${j.payType === 'salary' ? '' : `<span>Overtime</span><span>${j.otMultiplier}× after ${j.otWeeklyThreshold || '—'} h/week${j.dailyOtThreshold ? ` or ${j.dailyOtThreshold} h/day` : ''}</span>`}
        <span>Pre-tax deductions</span><span>${pct(j.preTaxPercent || 0, 1)}</span>
        ${(j.differentials || []).map((d) => `<span>${esc(d.name)}</span><span>+${money(d.amount)}/hr · ${d.days?.length && d.days.length < 7 ? d.days.map((x) => DAY_NAMES[x]).join(' ') : 'every day'} ${d.start === d.end ? '' : `${d.start}–${d.end}`}</span>`).join('')}
      </div></div>`).join('')}</div>`;
  on(el, 'click', '[data-action=new-job]', async () => { if (await jobForm()) ctx.refresh(); });
  on(el, 'click', '[data-edit-job]', async (e, b) => { if (await jobForm(state.jobs.find((j) => j.id === b.dataset.editJob))) ctx.refresh(); });
  on(el, 'click', '[data-del-job]', async (e, b) => {
    const n = state.shifts.filter((s) => s.jobId === b.dataset.delJob).length;
    if (!(await confirmDialog(`Delete this job${n ? ` and its ${n} shifts` : ''}?`))) return;
    update('shifts', (l) => l.filter((s) => s.jobId !== b.dataset.delJob));
    update('jobs', (l) => l.filter((j) => j.id !== b.dataset.delJob));
    ctx.refresh();
  });
}

// Last Saturday on or before today: a sensible default end-of-period anchor.
const lastSaturday = () => addDays(today(), -((new Date().getDay() + 1) % 7));

async function jobForm(job) {
  const j = job || { name: '', sourceId: state.jobs.length ? 'side' : 'salary', payType: 'hourly', rate: 15, salaryAnnual: 0, payFrequency: 'biweekly', periodEndAnchor: lastSaturday(), payLagDays: 6, otMultiplier: 1.5, otWeeklyThreshold: 40, dailyOtThreshold: 0, preTaxPercent: 0, differentials: [] };
  let diffs = structuredClone(j.differentials || []);
  const diffRows = () => diffs.map((d, i) => `<div class="row" style="margin-bottom:6px" data-diff="${i}">
    <input data-df="name" value="${esc(d.name)}" placeholder="Night / Weekend" style="width:120px">
    <span class="small">+$</span><input data-df="amount" type="number" step="0.01" value="${d.amount}" style="width:70px"><span class="small">/hr</span>
    <input data-df="start" type="time" value="${d.start}"><span class="small">to</span><input data-df="end" type="time" value="${d.end}">
    <span class="row" style="gap:2px">${DAY_NAMES.map((n, k) => `<label class="small" title="${n}"><input type="checkbox" data-dday="${k}" ${!d.days?.length || d.days.includes(k) ? 'checked' : ''}>${n[0]}</label>`).join('')}</span>
    <button type="button" class="icon-btn small" data-rm-diff="${i}">✕</button></div>`).join('');
  return modal({
    title: job ? `Edit ${job.name}` : 'Add a job',
    wide: true,
    body: `<div class="form-grid">
      <label class="field">Job name<input name="name" value="${esc(j.name)}" required placeholder="e.g. Campus Library"></label>
      <label class="field">Budget income line<select name="sourceId">${options(state.incomeSources, j.sourceId)}</select></label>
      <label class="field">Pay type<select name="payType">${options([{ id: 'hourly', name: 'Hourly (shifts)' }, { id: 'salary', name: 'Salary' }], j.payType)}</select></label>
      <label class="field">Hourly rate<input type="number" step="0.01" name="rate" value="${j.rate}"></label>
      <label class="field">Annual salary<input type="number" step="100" name="salaryAnnual" value="${j.salaryAnnual || 0}"></label>
      <label class="field">Pay frequency<select name="payFrequency">${options(PAY_FREQUENCIES, j.payFrequency)}</select></label>
      <label class="field">A pay-period end date<input type="date" name="periodEndAnchor" value="${j.periodEndAnchor || lastSaturday()}" title="Weekly/biweekly: the last day of any pay period"></label>
      <label class="field">Payday = period end + days<input type="number" name="payLagDays" value="${j.payLagDays ?? 6}" min="0" max="31"></label>
      <label class="field">Overtime multiplier<input type="number" step="0.1" name="otMultiplier" value="${j.otMultiplier}"></label>
      <label class="field">Weekly OT after (hours, 0 = none)<input type="number" name="otWeeklyThreshold" value="${j.otWeeklyThreshold}"></label>
      <label class="field">Daily OT after (hours, 0 = off; CA = 8)<input type="number" name="dailyOtThreshold" value="${j.dailyOtThreshold || 0}"></label>
      <label class="field">Pre-tax deductions (% of gross)<input type="number" step="0.1" name="preTaxPct" value="${round2((j.preTaxPercent || 0) * 100)}"></label>
    </div>
    <h3 style="margin:16px 0 8px">Shift differentials</h3>
    <p class="small muted">Extra pay per hour for nights, weekends, holidays. Set the same start and end time for all-day.</p>
    <div id="diffs">${diffRows()}</div>
    <button type="button" class="btn small" data-add-diff>+ Differential</button>`,
    onOpen(form) {
      const refresh = () => { $('#diffs', form).innerHTML = diffRows(); };
      const read = () => {
        diffs = $$('[data-diff]', form).map((row) => ({
          id: uid('diff'),
          name: $('[data-df=name]', row).value, amount: Number($('[data-df=amount]', row).value) || 0,
          start: $('[data-df=start]', row).value || '00:00', end: $('[data-df=end]', row).value || '00:00',
          days: $$('[data-dday]', row).filter((c) => c.checked).map((c) => +c.dataset.dday),
        }));
      };
      on(form, 'click', '[data-add-diff]', () => { read(); diffs.push({ name: 'Night', amount: 1.5, start: '22:00', end: '06:00', days: [] }); refresh(); });
      on(form, 'click', '[data-rm-diff]', (e, b) => { read(); diffs.splice(+b.dataset.rmDiff, 1); refresh(); });
      form.addEventListener('submit', read, { capture: true });
    },
    onSubmit(form, v) {
      const record = {
        ...(job || { id: uid('job') }),
        name: v.name.trim(), sourceId: v.sourceId, payType: v.payType, rate: v.rate, salaryAnnual: v.salaryAnnual,
        payFrequency: v.payFrequency, periodEndAnchor: v.periodEndAnchor, payLagDays: v.payLagDays, otMultiplier: v.otMultiplier || 1.5,
        otWeeklyThreshold: v.otWeeklyThreshold, dailyOtThreshold: v.dailyOtThreshold, preTaxPercent: (v.preTaxPct || 0) / 100,
        differentials: diffs.map((d) => ({ ...d, days: d.days.length === 7 ? [] : d.days })),
      };
      update('jobs', (l) => { const i = l.findIndex((x) => x.id === record.id); if (i >= 0) l[i] = record; else l.push(record); });
      toast(job ? 'Job updated' : 'Job added — now upload your schedule');
      return true;
    },
  });
}

/* ====================== Pay stubs ====================== */
function stubsTab(el, ctx) {
  const stubs = [...state.paystubs].sort((a, b) => b.pay_date.localeCompare(a.pay_date));
  const latest = stubs[0];
  el.innerHTML = `
    <div class="grid cols-3">
      <div class="card span-2">
        <div class="card-head"><div><h2>Upload a pay stub</h2><p>Dissects gross pay, every tax and deduction, and net pay — then calibrates your paycheck estimates with your real withholding rates.</p></div></div>
        ${busy ? `<div class="alert info"><span class="alert-icon">⏳</span><div>${esc(busy)}</div></div>` : `
        <div class="row">
          ${ctx.ai.enabled ? '<label class="btn primary">⇧ Upload stub (photo or PDF)<input type="file" id="stubFile" accept="image/*,application/pdf" hidden></label>' : '<span class="small muted">Stub reading needs an Anthropic API key; you can still enter one by hand.</span>'}
          <button class="btn" data-action="manual-stub">✎ Enter manually</button>
        </div>`}
      </div>
      <div class="card">
        <h2>Withholding calibration</h2>
        ${latest ? `<div class="kv small" style="margin-top:10px">
          <span>Federal</span><span>${pct(latest.federal_income_tax / latest.gross_pay, 1)}</span>
          <span>State</span><span>${pct(latest.state_income_tax / latest.gross_pay, 1)}</span>
          <span>Social Security + Medicare</span><span>${pct((latest.social_security + latest.medicare) / latest.gross_pay, 2)}</span>
          <span class="total">Take-home share</span><span class="total">${pct(latest.net_pay / latest.gross_pay, 1)}</span></div>
          <label class="check" style="margin-top:12px"><input type="checkbox" id="useStub" ${state.settings.tax.useStubRates ? 'checked' : ''}> Use these rates for paycheck estimates</label>`
    : '<p class="muted small" style="margin-top:8px">Add a stub to compare your real withholding with the estimate.</p>'}
      </div>
    </div>
    <div id="stubDraft"></div>
    <div class="card flush" style="margin-top:16px">
      <div class="card-head"><h2>Saved pay stubs</h2></div>
      ${stubs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Pay date</th><th>Employer</th><th class="num">Hours</th><th class="num">Gross</th><th class="num">Fed</th><th class="num">State</th><th class="num">FICA</th><th class="num">Deductions</th><th class="num">Net</th><th></th></tr></thead>
        <tbody>${stubs.map((s) => `<tr>
          <td>${fmtDate(s.pay_date, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${esc(s.employer)}</td>
          <td class="num">${num(s.hours_regular + s.hours_overtime, 1)}</td><td class="num">${money(s.gross_pay)}</td>
          <td class="num">${money(s.federal_income_tax)}</td><td class="num">${money(s.state_income_tax)}</td>
          <td class="num">${money(s.social_security + s.medicare)}</td>
          <td class="num">${money(sum(s.pre_tax_deductions, (d) => d.amount) + sum(s.post_tax_deductions, (d) => d.amount))}</td>
          <td class="num pos"><strong>${money(s.net_pay)}</strong></td>
          <td class="actions">${s.transactionId ? '<span class="badge good">✓ Income</span>' : `<button class="btn small" data-stub-income="${s.id}">Record income</button>`} <button class="icon-btn small" data-del-stub="${s.id}" aria-label="Delete">🗑</button></td>
        </tr>`).join('')}</tbody></table></div>` : emptyState('📄', 'No pay stubs yet', '')}
    </div>`;

  renderStubDraft($('#stubDraft', el), ctx);
  $('#stubFile', el)?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    try {
      busy = 'Uploading…'; ctx.refresh();
      const uploaded = await uploadFiles('paystubs', await prepareForAI(files, ctx.ai));
      busy = 'Reading pay stub with AI…'; ctx.refresh();
      stubDraft = { ...(await api('/api/ai/paystub', { method: 'POST', body: { files: uploaded } })), files: uploaded };
    } catch (err) { toast(err.message, 'bad'); } finally { busy = ''; ctx.refresh(); }
  });
  $('#useStub', el)?.addEventListener('change', (e) => {
    update('settings', (s) => {
      s.tax.useStubRates = e.target.checked;
      const g = latest.gross_pay || 1;
      s.tax.stubRates = { federal: latest.federal_income_tax / g, state: latest.state_income_tax / g, local: latest.local_tax / g, socialSecurity: latest.social_security / g, medicare: latest.medicare / g };
    });
    toast(e.target.checked ? 'Paycheck estimates now use your stub’s rates' : 'Back to bracket-based estimates');
  });
  on(el, 'click', '[data-action=manual-stub]', () => {
    stubDraft = { employer: state.jobs[0]?.name || '', pay_date: today(), period_start: '', period_end: '', hours_regular: 0, hours_overtime: 0, hourly_rate: 0, gross_pay: 0, tips: 0, federal_income_tax: 0, state_income_tax: 0, local_tax: 0, social_security: 0, medicare: 0, pre_tax_deductions: [], post_tax_deductions: [], net_pay: 0, ytd_gross: 0, notes: '' };
    ctx.refresh();
  });
  on(el, 'click', '[data-del-stub]', (e, b) => { update('paystubs', (l) => l.filter((s) => s.id !== b.dataset.delStub)); ctx.refresh(); });
  on(el, 'click', '[data-stub-income]', (e, b) => {
    const s = state.paystubs.find((x) => x.id === b.dataset.stubIncome);
    const job = state.jobs.find((j) => j.name.toLowerCase() === (s.employer || '').toLowerCase());
    const tx = { id: uid('tx'), type: 'income', date: s.pay_date, amount: round2(s.net_pay), merchant: s.employer || 'Paycheck', sourceId: job?.sourceId || 'salary', categoryId: '', source: 'paycheck', note: `Gross ${money(s.gross_pay)}`, createdAt: new Date().toISOString() };
    update('transactions', (l) => l.push(tx));
    update('paystubs', () => { s.transactionId = tx.id; });
    toast('Net pay recorded as income');
    ctx.refresh();
  });
}

function renderStubDraft(box, ctx) {
  if (!stubDraft) return;
  const s = stubDraft;
  const fields = [
    ['employer', 'Employer', 'text'], ['pay_date', 'Pay date', 'date'], ['period_start', 'Period start', 'date'], ['period_end', 'Period end', 'date'],
    ['hours_regular', 'Regular hours'], ['hours_overtime', 'Overtime hours'], ['hourly_rate', 'Hourly rate'], ['gross_pay', 'Gross pay'], ['tips', 'Tips'],
    ['federal_income_tax', 'Federal income tax'], ['state_income_tax', 'State income tax'], ['local_tax', 'Local tax'], ['social_security', 'Social Security'], ['medicare', 'Medicare'],
    ['net_pay', 'Net pay'], ['ytd_gross', 'YTD gross'],
  ];
  const deductions = sum(s.pre_tax_deductions, (d) => d.amount) + sum(s.post_tax_deductions, (d) => d.amount);
  const check = round2(s.gross_pay - s.federal_income_tax - s.state_income_tax - s.local_tax - s.social_security - s.medicare - deductions - s.net_pay);
  box.innerHTML = `<div class="card" style="margin-top:16px">
    <div class="card-head"><div><h2>Review pay stub</h2><p>${esc(s.notes || 'Check the numbers, then save.')}</p></div>
      <div class="row"><button class="btn" data-action="discard-stub">Discard</button><button class="btn primary" data-action="save-stub">Save stub</button></div></div>
    <div class="form-grid">${fields.map(([k, label, type = 'number']) => `<label class="field">${label}<input type="${type}" ${type === 'number' ? 'step="0.01"' : ''} data-sf="${k}" value="${esc(s[k] ?? '')}"></label>`).join('')}</div>
    ${[...s.pre_tax_deductions.map((d) => ['Pre-tax', d]), ...s.post_tax_deductions.map((d) => ['Post-tax', d])].length ? `<h3 style="margin:14px 0 6px">Deductions</h3><div class="kv small">${[...s.pre_tax_deductions.map((d) => ['Pre-tax', d]), ...s.post_tax_deductions.map((d) => ['Post-tax', d])].map(([k, d]) => `<span>${k}: ${esc(d.name)}</span><span>${money(d.amount)}</span>`).join('')}</div>` : ''}
    ${Math.abs(check) > 0.05 ? `<div class="alert warn" style="margin-top:12px"><span class="alert-icon">!</span><div>Gross minus taxes and deductions differs from net pay by ${money(check)}. Some deductions may be missing.</div></div>` : '<div class="alert good" style="margin-top:12px"><span class="alert-icon">✓</span><div>Gross − taxes − deductions = net pay.</div></div>'}
  </div>`;
  on(box, 'change', '[data-sf]', (e, inp) => { s[inp.dataset.sf] = inp.type === 'number' ? Number(inp.value) || 0 : inp.value; ctx.refresh(); });
  on(box, 'click', '[data-action=discard-stub]', () => { stubDraft = null; ctx.refresh(); });
  on(box, 'click', '[data-action=save-stub]', () => {
    if (!s.gross_pay) return toast('Enter gross pay', 'bad');
    update('paystubs', (l) => l.push({ id: uid('stub'), ...s }));
    stubDraft = null;
    toast('Pay stub saved');
    ctx.refresh();
  });
}

/* ====================== Tax estimator ====================== */
function taxTab(el, ctx) {
  const year = Number(ctx.month.slice(0, 4));
  const tx = state.settings.tax;
  const p = yearTaxProjection(state, year);
  const hasShifts = p.wages + p.tips > 0;
  const table = TAX_TABLES[tx.year] || TAX_TABLES[2026];
  const whatIf = annualTax({ wages: state.settings.annualGross, preTax: state.settings.annualGross * (tx.preTaxPercent || 0), settingsTax: tx });
  const block = (r, title, sub) => `<div class="card"><div class="card-head"><div><h2>${title}</h2><p>${sub}</p></div></div>
    <div class="kv">
      <span>Gross income</span><span>${money(r.gross)}</span>
      ${r.preTax ? `<span>Pre-tax deductions</span><span>−${money(r.preTax)}</span>` : ''}
      <span>Standard deduction</span><span>−${money(r.standardDeduction)}</span>
      ${r.otDeduction ? `<span>“No tax on overtime” deduction</span><span>−${money(r.otDeduction)}</span>` : ''}
      ${r.tipsDeduction ? `<span>“No tax on tips” deduction</span><span>−${money(r.tipsDeduction)}</span>` : ''}
      <span class="total">Taxable income</span><span class="total">${money(r.taxable)}</span>
      <span>Federal income tax</span><span>${money(r.federal)}</span>
      <span>Social Security</span><span>${money(r.socialSecurity)}</span>
      <span>Medicare</span><span>${money(r.medicare)}</span>
      <span>State${r.local ? ' + local' : ''}</span><span>${money(r.state + r.local)}</span>
      <span class="total">Total tax</span><span class="total">${money(r.total)}</span>
      <span>Effective rate · marginal bracket</span><span>${pct(r.effectiveRate, 1)} · ${pct(r.marginal)}</span>
      <span class="total">Take-home</span><span class="total pos">${money(r.net)} <span class="small muted">(${money(r.net / 12, { cents: false })}/mo)</span></span>
    </div></div>`;

  el.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Tax settings (${tx.year} federal figures)</h2><p>Standard deduction ${money(table.standard[tx.filingStatus], { cents: false })} · Social Security wage base ${money(table.ssWageBase, { cents: false })}</p></div></div>
      <div class="form-grid">
        <label class="field">Filing status<select data-tax="filingStatus">${options(FILING_STATUSES, tx.filingStatus)}</select></label>
        <label class="field">State income tax (flat %)<input type="number" step="0.1" data-tax="stateRate" value="${round2(tx.stateRate * 100)}"></label>
        <label class="field">Local income tax (%)<input type="number" step="0.1" data-tax="localRate" value="${round2((tx.localRate || 0) * 100)}"></label>
        <label class="field">Pre-tax savings (% of pay)<input type="number" step="0.5" data-tax="preTaxPercent" value="${round2((tx.preTaxPercent || 0) * 100)}"></label>
      </div>
      <div class="row" style="margin-top:12px;gap:20px">
        <label class="check"><input type="checkbox" data-tax="ficaExempt" ${tx.ficaExempt ? 'checked' : ''}> FICA exempt (e.g. F-1/J-1 nonresident students, first 5 years)</label>
        <label class="check"><input type="checkbox" data-tax="applyObbbaDeductions" ${tx.applyObbbaDeductions ? 'checked' : ''}> Apply 2025–2028 “no tax on tips / overtime” deductions</label>
      </div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      ${hasShifts ? block(p, `${year} projection from your jobs & shifts`, `Uses every shift and salary recorded for ${year}.`) : `<div class="card">${emptyState('🧮', `No ${year} shifts yet`, 'Add jobs and shifts to project your real tax year.')}</div>`}
      ${block(whatIf, `Salary check: ${money(state.settings.annualGross, { cents: false })}/yr`, 'Uses the annual gross income from Settings.')}
    </div>
    ${hasShifts && p.obbbaSavings > 1 ? `<div class="alert good" style="margin-top:16px"><span class="alert-icon">$</span><div>The overtime/tips deductions lower your ${year} tax by about <strong>${money(p.obbbaSavings)}</strong>. Employers usually don't withhold for this, so expect it back as a refund — or adjust your W-4.</div></div>` : ''}
    <p class="small muted" style="margin-top:12px">Estimates only: no credits (child, education, EITC), itemized deductions, or state brackets. Nonresident aliens generally can't use the standard deduction (treaty exceptions apply). Check with a tax professional for filing.</p>`;

  on(el, 'change', '[data-tax]', (e, inp) => {
    const k = inp.dataset.tax;
    update('settings', (s) => {
      s.tax[k] = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : (Number(inp.value) || 0) / 100;
    });
    ctx.refresh();
  });
}
