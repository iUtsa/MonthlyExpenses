// Upcoming pay, looking forward from today: the next pay, the one after it, and later shifts.
// Shared by Home and Income & shifts.
import { esc, money, fmtDate, daysBetween, today, num } from '../util.js';

const day = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
const when = (d) => {
  const n = daysBetween(today(), d);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 ? `in ${n} days` : `${-n} days ago`;
};

function shiftLine(x) {
  const isToday = x.date === today();
  const mark = x.done ? '<span class="shift-mark done" title="Worked">✓</span>' : `<span class="shift-mark ${isToday ? 'today' : ''}" title="${isToday ? 'Today' : 'Scheduled'}">${isToday ? '•' : '○'}</span>`;
  return `<div class="shift-line ${x.done ? 'done' : ''}">${mark}<span class="grow">${day(x.date)} · ${x.start}–${x.end}${x.overtime ? ` <span class="badge warn">${num(x.overtime, 1)} OT</span>` : ''}</span><span class="small muted">${num(x.hours, 1)} h</span><span class="num">${money(x.gross, { cents: false })}</span></div>`;
}

function payCard(p, i) {
  const title = i === 0 ? 'Next pay' : 'Pay after that';
  const shortBy = p.leftAfterBills < 0 ? -p.leftAfterBills : 0;
  return `<div class="card pay-card ${i === 0 ? 'next' : ''}">
    <div class="row between"><span class="tile-label">${title} · ${day(p.payday)}</span><span class="badge ${i === 0 ? 'info' : ''}">${when(p.payday)}</span></div>
    <div class="row between" style="align-items:baseline;margin:4px 0 2px">
      <span class="tile-value pos">${money(p.amount, { cents: false })}</span>
      <span class="badge ${p.status === 'received' ? 'good' : ''}">${p.status === 'received' ? '✓ received' : 'expected'}</span>
    </div>
    ${p.shifts.length ? `<div class="small text-2">For your work ${fmtDate(p.workFrom)} – ${fmtDate(p.workTo)} · ${num(p.hours, 1)} h · <strong>${p.done} of ${p.shifts.length} shifts done</strong></div>
      <div class="meter good" style="height:5px;margin:6px 0 8px"><span style="width:${(p.done / p.shifts.length) * 100}%"></span></div>
      <details class="shift-list" ${i === 0 ? 'open' : ''}><summary class="small">Shifts in this pay</summary>${p.shifts.map(shiftLine).join('')}</details>`
    : `<div class="small muted">${p.checks.length ? 'Salary' : 'No shifts in this pay yet — upload your schedule or add shifts.'}</div>`}
    <div class="pay-covers">
      <div class="small text-2" style="margin-bottom:4px">Has to cover ${fmtDate(p.range.from)} – ${fmtDate(p.range.to)}:</div>
      ${p.bills.length ? p.bills.map((b) => `<div class="row between small"><span>${esc(b.bill.name)} · ${fmtDate(b.date)}</span><span class="neg">−${money(b.amount)}</span></div>`).join('') : '<div class="small muted">No bills due.</div>'}
      <div class="row between" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px"><strong>Left after bills</strong><strong class="${shortBy ? 'neg' : ''}">${money(p.leftAfterBills)}</strong></div>
      ${shortBy ? `<div class="alert warn" style="margin-top:8px"><span class="alert-icon">!</span><div class="small">Short by ${money(shortBy, { cents: false })}. Hold that much back from the pay before it.</div></div>` : ''}
    </div>
    <button class="btn small" data-plan-date="${p.payday}" style="margin-top:10px">Plan this paycheck →</button>
  </div>`;
}

export function payCardsHtml(tl) {
  if (!tl.pays.length) return '';
  return tl.pays.map(payCard).join('');
}

export function laterHtml(tl) {
  if (!tl.later.length) return '';
  return `<div class="card flush" style="margin-top:16px">
    <div class="card-head"><div><h2>Later scheduled shifts</h2><p>Work you're already scheduled for, grouped by the payday it lands on.</p></div><a class="btn small" href="#/income?tab=shifts">All shifts</a></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Payday</th><th>For work</th><th class="num">Shifts</th><th class="num">Hours</th><th class="num">Est. take-home</th></tr></thead>
      <tbody>${tl.later.map((l) => `<tr>
        <td><strong>${day(l.payday)}</strong><div class="small muted">${when(l.payday)}${l.job ? ` · ${esc(l.job.name)}` : ''}</div></td>
        <td class="small">${fmtDate(l.workFrom)} – ${fmtDate(l.workTo)}<details class="shift-list"><summary class="small">${l.shifts.length} shift${l.shifts.length === 1 ? '' : 's'}</summary>${l.shifts.map(shiftLine).join('')}</details></td>
        <td class="num">${l.shifts.length}</td><td class="num">${num(l.hours, 1)}</td><td class="num pos">${money(l.amount, { cents: false })}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

// "Plan this paycheck →" opens the Budget for that pay period.
export function bindTimeline(el, ctx) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-plan-date]');
    if (!b) return;
    ctx.setDate(b.dataset.planDate);
    ctx.go('budget');
  });
}
