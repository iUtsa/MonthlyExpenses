// Text parsers used when AI parsing is off (and for CSV / ICS / spreadsheet uploads).
import { isoDate, today, round2, parseDate } from './util.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Pick the year that puts month/day closest to `ref` (schedules and receipts rarely print years).
function nearestYear(m, d, ref = today()) {
  const y = Number(ref.slice(0, 4));
  const candidates = [y - 1, y, y + 1].map((yy) => isoDate(new Date(yy, m - 1, d)));
  return candidates.sort((a, b) => Math.abs(new Date(a) - new Date(ref)) - Math.abs(new Date(b) - new Date(ref)))[0];
}

function valid(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? isoDate(dt) : null;
}

// Accepts 2026-10-25, 10/25/2026, 10/25/26, 10-25, Oct 25 2026, 25 Oct, October 25. US order for numeric dates.
export function parseAnyDate(input, ref = today()) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return valid(y, +m[1], +m[2]) || valid(y, +m[2], +m[1]);
  }
  m = s.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if (m && MONTHS.includes(m[1].slice(0, 3))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3)) + 1;
    return m[3] ? valid(+m[3], mo, +m[2]) : nearestYear(mo, +m[2], ref);
  }
  m = s.match(/\b(\d{1,2})(?!\d)(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?/);
  if (m && MONTHS.includes(m[2].slice(0, 3))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3)) + 1;
    return m[3] ? valid(+m[3], mo, +m[1]) : nearestYear(mo, +m[1], ref);
  }
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m) return nearestYear(+m[1], +m[2], ref);
  if (typeof input === 'number' && input > 20000 && input < 80000) {
    // Excel serial date
    return isoDate(new Date(Math.round((input - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000));
  }
  return null;
}

// "9", "9a", "9:30pm", "21:30", "9.30 PM", "noon" -> "HH:MM"
export function parseTime(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'noon') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(a|am|p|pm)?\.?m?\.?$/);
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] || 0);
  if (m[3]?.startsWith('p') && h < 12) h += 12;
  if (m[3]?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const TIME = String.raw`(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?)`;
const RANGE = new RegExp(`${TIME}\\s*(?:-|–|—|to|until)\\s*${TIME}`, 'i');

// Infer missing am/pm: "4-10pm" -> 16:00-22:00, "9-5pm" -> 09:00-17:00, "10-2" -> 10:00-14:00.
function timeRange(a, b) {
  let start = parseTime(a); let end = parseTime(b);
  if (!start || !end) return null;
  const sh = +start.slice(0, 2); const eh = +end.slice(0, 2);
  const startMeridiem = /[ap]/i.test(a); const endMeridiem = /[ap]/i.test(b);
  const pad = (h, rest) => `${String(h).padStart(2, '0')}${rest.slice(2)}`;
  if (!startMeridiem && endMeridiem && sh < 12 && sh + 12 < eh) start = pad(sh + 12, start);
  if (!startMeridiem && !endMeridiem && eh <= 12 && sh < 12 && end <= start && eh + 12 > sh) end = pad(eh + 12, end);
  return { start, end };
}

/* ---------------- Receipts (OCR text) ---------------- */
const AMOUNT = /(-?\$?\s?\d{1,5}(?:,\d{3})*[.,]\d{2})\s*-?\s*[A-Z]{0,2}\s*$/;
function toAmount(raw) {
  let t = String(raw).replace(/[$\s]/g, '');
  if (/,\d{2}$/.test(t) && !t.includes('.')) t = t.replace(/,(\d{2})$/, '.$1'); // "4,99" (comma decimals)
  return Number(t.replace(/,/g, '')) || 0;
}

export function parseReceiptText(text, categorize) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = { merchant: '', date: '', items: [], subtotal: 0, tax: 0, tip: 0, fees: 0, discount: 0, total: 0, payment_method: '', confidence: 'low', notes: 'Read on-device with OCR — please check every line.' };
  out.merchant = (lines.find((l) => /[a-z]{3,}/i.test(l) && !AMOUNT.test(l)) || '').replace(/[^\w&'.\- ]/g, '').trim();
  for (const l of lines) {
    if (!out.date) out.date = parseAnyDate(l) || '';
    if (!out.payment_method) {
      const pm = l.match(/\b(visa|mastercard|amex|discover|debit|credit|cash|apple pay|google pay)\b/i);
      if (pm) out.payment_method = pm[1];
    }
    const m = l.match(AMOUNT);
    if (!m) continue;
    const amount = toAmount(m[1]);
    const label = l.slice(0, m.index).replace(/[\s.:$*]+$/, '').trim();
    const low = label.toLowerCase();
    if (/\b(sub\s*-?total|subtotal)\b/.test(low)) out.subtotal = amount;
    else if (/\b(tax|vat|gst|hst)\b/.test(low)) out.tax += amount;
    else if (/\b(tip|gratuity)\b/.test(low)) out.tip += amount;
    else if (/\b(total|amount due|balance due|grand total)\b/.test(low)) out.total = Math.max(out.total, amount);
    else if (/\b(change|cash tendered|tender|visa|mastercard|amex|debit|credit|payment|card)\b/.test(low)) continue;
    else if (/\b(discount|coupon|savings|promo)\b/.test(low)) out.items.push({ description: label || 'Discount', quantity: 1, amount: -Math.abs(amount), category_id: null });
    else if (label.length >= 2) {
      const qty = label.match(/^(\d+)\s*[x@]\s*/i);
      out.items.push({ description: label.replace(/^\d+\s*[x@]\s*/i, ''), quantity: qty ? +qty[1] : 1, amount, category_id: null });
    }
  }
  // The store decides food items ("coffee beans" at a grocer is groceries, not dining);
  // item keywords still win for non-food lines like clothing or pharmacy.
  const merchantCat = categorize(out.merchant);
  for (const item of out.items) {
    const itemCat = categorize(item.description);
    item.category_id = merchantCat && (!itemCat || itemCat === 'dining' || itemCat === 'groceries') ? merchantCat : itemCat || merchantCat;
  }
  if (!out.subtotal) out.subtotal = round2(out.items.reduce((a, i) => a + i.amount, 0));
  if (!out.total) out.total = round2(out.subtotal + out.tax + out.tip);
  return out;
}

/* ---------------- Schedules ---------------- */
// Lines like "Mon 10/27  9:00 AM - 5:30 PM  Cashier" or "Oct 28: 4p-10p". Weekday-only lines
// ("Tuesday 9-5") are placed in the week of `weekOf`.
export function parseScheduleText(text, weekOf = today()) {
  const shifts = [];
  let lastDate = null;
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const date = parseAnyDate(line) || weekdayDate(line, weekOf);
    if (date) lastDate = date;
    const r = line.match(RANGE);
    if (!r) continue;
    const range = timeRange(r[1], r[2]);
    if (!range || !(date || lastDate)) continue;
    const rest = line.replace(r[0], '').replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/gi, '').replace(/[\d/.,-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const brk = line.match(/(\d{2,3})\s*(?:min|m)\b.*break|break\D{0,6}(\d{2,3})/i);
    shifts.push({ date: date || lastDate, start: range.start, end: range.end, break_minutes: brk ? +(brk[1] || brk[2]) : 0, role: rest.slice(0, 40), location: '', notes: '' });
  }
  return { shifts, employer: '', notes: 'Read on-device — check dates and times.' };
}

function weekdayDate(line, weekOf) {
  const m = line.toLowerCase().match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (!m) return null;
  const base = parseDate(weekOf);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay());
  start.setDate(start.getDate() + WEEKDAYS.indexOf(m[1]));
  return isoDate(start);
}

// iCalendar (.ics) export from Google Calendar, Outlook, When I Work, Homebase, Deputy, etc.
export function parseICS(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  const events = unfolded.split('BEGIN:VEVENT').slice(1).map((block) => {
    const get = (key) => block.match(new RegExp(`^${key}[^:\\n]*:(.*)$`, 'm'))?.[1]?.trim() || '';
    return { start: get('DTSTART'), end: get('DTEND'), summary: get('SUMMARY').replace(/\\,/g, ','), location: get('LOCATION').replace(/\\,/g, ',') };
  });
  const toLocal = (v) => {
    const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if (!m) return null;
    const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return { date: isoDate(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, allDay: !m[4] };
  };
  const shifts = events.map((e) => {
    const s = toLocal(e.start); const en = toLocal(e.end);
    if (!s || !en || s.allDay) return null;
    return { date: s.date, start: s.time, end: en.time, break_minutes: 0, role: e.summary, location: e.location, notes: '' };
  }).filter(Boolean);
  return { shifts, employer: '', notes: `${shifts.length} timed events found in calendar file.` };
}

// Spreadsheet/CSV rows with a header row. Recognizes Date / Start / End / Break / Role (+ "Shift" = "9-5").
export function parseScheduleRows(rows) {
  if (!rows.length) return { shifts: [], notes: 'Empty file' };
  const header = rows[0].map((h) => String(h).toLowerCase());
  const col = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const c = {
    date: col('date', 'day'), start: col('start', 'in', 'from', 'begin'), end: col('end', 'out', 'to', 'finish'),
    shift: col('shift', 'time', 'hours'), brk: col('break', 'lunch', 'meal'), role: col('role', 'position', 'job', 'title', 'summary', 'task'),
  };
  const shifts = [];
  for (const row of rows.slice(1)) {
    const date = parseAnyDate(row[c.date]);
    if (!date) continue;
    let start = c.start >= 0 ? parseTime(row[c.start]) || excelTime(row[c.start]) : null;
    let end = c.end >= 0 && c.end !== c.start ? parseTime(row[c.end]) || excelTime(row[c.end]) : null;
    if ((!start || !end) && c.shift >= 0) {
      const r = String(row[c.shift]).match(RANGE);
      if (r) ({ start, end } = timeRange(r[1], r[2]) || {});
    }
    if (!start || !end) continue;
    shifts.push({ date, start, end, break_minutes: c.brk >= 0 ? Number(String(row[c.brk]).replace(/\D/g, '')) || 0 : 0, role: c.role >= 0 ? String(row[c.role] || '') : '', location: '', notes: '' });
  }
  return { shifts, employer: '', notes: `${shifts.length} shifts read from ${rows.length - 1} rows.` };
}

function excelTime(v) {
  if (typeof v !== 'number' || v < 0 || v >= 1) return null;
  const mins = Math.round(v * 1440);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/* ---------------- Bank statement CSV ---------------- */
export function guessCsvColumns(header) {
  const h = header.map((x) => String(x).toLowerCase());
  const find = (...names) => h.findIndex((x) => names.some((n) => x.includes(n)));
  return {
    date: find('date', 'posted'),
    description: find('description', 'merchant', 'payee', 'name', 'memo', 'details'),
    amount: find('amount', 'value'),
    debit: find('debit', 'withdrawal', 'out'),
    credit: find('credit', 'deposit', 'in'),
    category: find('category'),
  };
}

export function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  const n = Number(s.replace(/[^0-9.]/g, '')) || 0;
  return negative ? -n : n;
}

/* ---------------- Shift times & names (schedule reading) ---------------- */
const HALF = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?|noon)?`;
const SHIFT_RANGE = new RegExp(`${HALF}\\s*(?:-|–|—|to|until|till)\\s*${HALF}`, 'i');
const hm = (h, m) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

// Turn printed shift text into 24h start/end. Explicit am/pm and 24-hour times are used
// as written. Bare 12-hour ranges ("1-5", "3-11", "9:30-5:30") follow how work schedules
// are written: starts 1–5 are afternoon, 6–11 morning, 12 noon; the end is the first
// matching hour after the start (so "11-7" is 11:00–19:00, "4-12" is 16:00–00:00).
// Returns null when the text has no time range.
export function resolveShiftTimes(text) {
  const m = String(text || '').replace(/\s+/g, ' ').match(SHIFT_RANGE);
  if (!m) return null;
  const side = (h, min, mer, raw) => {
    const hour = Number(h); const minute = Number(min || 0);
    if (hour > 24 || minute > 59) return null;
    const meridiem = mer ? (mer[0].toLowerCase() === 'n' ? 'p' : mer[0].toLowerCase()) : null;
    const is24 = hour >= 13 || hour === 0 || (/^0\d/.test(raw) && min !== undefined);
    return { hour, minute, meridiem, is24 };
  };
  const a = side(m[1], m[2], m[3], m[0].trim());
  const b = side(m[4], m[5], m[6], m[0].split(/-|–|—|to|until|till/i).pop().trim());
  if (!a || !b) return null;
  const explicit = (s) => (s.is24 ? s.hour % 24 : s.meridiem === 'p' ? (s.hour % 12) + 12 : s.meridiem === 'a' ? s.hour % 12 : null);
  let start = explicit(a);
  let end = explicit(b);
  const dur = (s, e) => ((e * 60 + b.minute) - (s * 60 + a.minute) + 1440) % 1440;
  if (start === null && end === null) {
    start = a.hour >= 1 && a.hour <= 5 ? a.hour + 12 : a.hour % 12 === 0 ? 12 : a.hour;
  } else if (start === null) {
    const options = [a.hour % 12, (a.hour % 12) + 12];
    start = options.find((s) => dur(s, end) >= 60 && dur(s, end) <= 14 * 60) ?? options[1];
  }
  if (end === null) {
    const options = [b.hour % 12, (b.hour % 12) + 12];
    end = options.map((e) => [e, dur(start, e)]).filter(([, d]) => d >= 30).sort((x, y) => x[1] - y[1])[0]?.[0] ?? options[1];
  }
  return { start: hm(start, a.minute), end: hm(end, b.minute) };
}

const nameTokens = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z\s.]/g, ' ').replace(/\./g, ' ').split(/\s+/).filter(Boolean);

// Does a name printed on a schedule belong to the user? `aliases` are the user's names
// ("Arnab", "Arnab Das", "A. Das"). Every token of an alias must appear in the printed
// name; a single printed initial counts for a first/middle name when the alias has a
// surname too ("A. Das" matches "Arnab Das"). Look-alikes ("Arnav") never match.
export function personMatches(printed, aliases) {
  const p = nameTokens(printed);
  if (!p.length) return false;
  return (aliases || []).some((alias) => {
    const a = nameTokens(alias);
    if (!a.length) return false;
    let full = 0;
    const ok = a.every((t) => {
      if (p.includes(t)) { if (t.length > 1) full++; return true; }
      return a.length > 1 && p.some((x) => x.length === 1 && x === t[0]);
    });
    return ok && full > 0;
  });
}
