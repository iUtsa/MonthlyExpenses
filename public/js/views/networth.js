import { state, update } from '../store.js';
import { esc, money, uid, confirmDialog, toast, on, $, round2, monthLabel, emptyState } from '../util.js';
import { netWorth, emergencyFund } from '../calc.js';
import { lineChart, seriesColor } from '../charts.js';

export async function render(el, ctx) {
  const nw = netWorth(state);
  const ef = emergencyFund(state);
  const history = [...state.netWorth.history].sort((a, b) => a.month.localeCompare(b.month));
  const prev = history.filter((h) => h.month < ctx.month).at(-1);

  el.innerHTML = `
    <div class="grid cols-4">
      <div class="card tile"><span class="tile-label">Net worth</span><span class="tile-value ${nw.net < 0 ? 'neg' : ''}">${money(nw.net, { cents: false })}</span>
        <span class="tile-sub">${prev ? `${nw.net >= prev.net ? '▲' : '▼'} ${money(nw.net - prev.net, { cents: false, sign: true })} since ${monthLabel(prev.month, 'short')}` : 'Take a snapshot each month to see your trend'}</span></div>
      <div class="card tile"><span class="tile-label">Total assets</span><span class="tile-value">${money(nw.assets, { cents: false })}</span><span class="tile-sub">${money(nw.liquid, { cents: false })} liquid</span></div>
      <div class="card tile"><span class="tile-label">Total liabilities</span><span class="tile-value">${money(nw.liabilities, { cents: false })}</span><span class="tile-sub">${money(nw.debtTotal, { cents: false })} from Debt payoff</span></div>
      <div class="card tile"><span class="tile-label">Emergency fund coverage</span><span class="tile-value">${ef.months.toFixed(1)} mo</span><span class="tile-sub">Liquid assets ÷ ${money(state.settings.monthlyEssentials, { cents: false })} essentials</span></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>Net worth over time</h2><p>Direction matters more than precision. Snapshot once a month.</p></div>
        <button class="btn primary" data-action="snapshot">Save ${monthLabel(ctx.month, 'short')} snapshot</button></div>
      ${history.length >= 2 ? '<div class="chart-box"><canvas id="nwChart" aria-label="Net worth trend"></canvas></div>' : emptyState('📈', history.length ? 'One snapshot saved' : 'No snapshots yet', 'Save a snapshot each month and your trend line appears here.')}
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card flush">
        <div class="card-head"><div><h2>Assets</h2><p>Tick “liquid” for cash you could use in an emergency.</p></div><button class="btn small" data-action="add-asset">+ Asset</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Asset</th><th class="num">Value</th><th>Liquid</th><th></th></tr></thead>
          <tbody>${state.netWorth.assets.map((a) => `<tr>
            <td><input class="cell" data-asset="${a.id}" data-field="name" value="${esc(a.name)}"></td>
            <td style="width:140px"><input class="cell num" type="number" step="0.01" data-asset="${a.id}" data-field="value" data-key="a-${a.id}" value="${a.value}"></td>
            <td><input type="checkbox" data-asset="${a.id}" data-field="liquid" ${a.liquid ? 'checked' : ''} aria-label="Liquid"></td>
            <td class="actions"><button class="icon-btn small" data-del-asset="${a.id}" aria-label="Delete">🗑</button></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total assets</td><td class="num">${money(nw.assets)}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
      </div>
      <div class="card flush">
        <div class="card-head"><div><h2>Liabilities</h2><p>Loans and cards come from Debt payoff, so they always match.</p></div><button class="btn small" data-action="add-liab">+ Other liability</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Liability</th><th class="num">Balance</th><th></th></tr></thead>
          <tbody>
            ${state.debts.map((d) => `<tr><td>${esc(d.name)} <a href="#/debts" class="small">edit</a></td><td class="num">${money(d.balance)}</td><td></td></tr>`).join('')}
            ${state.netWorth.otherLiabilities.map((l) => `<tr>
              <td><input class="cell" data-liab="${l.id}" data-field="name" value="${esc(l.name)}"></td>
              <td style="width:140px"><input class="cell num" type="number" step="0.01" data-liab="${l.id}" data-field="value" value="${l.value}"></td>
              <td class="actions"><button class="icon-btn small" data-del-liab="${l.id}" aria-label="Delete">🗑</button></td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td>Total liabilities</td><td class="num">${money(nw.liabilities)}</td><td></td></tr></tfoot>
        </table></div>
      </div>
    </div>
    ${history.length ? `<div class="card flush" style="margin-top:16px"><div class="card-head"><h2>Snapshots</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Month</th><th class="num">Assets</th><th class="num">Liabilities</th><th class="num">Net worth</th><th class="num">Change</th><th></th></tr></thead>
      <tbody>${history.map((h, i) => `<tr><td>${monthLabel(h.month)}</td><td class="num">${money(h.assets)}</td><td class="num">${money(h.liabilities)}</td><td class="num"><strong>${money(h.net)}</strong></td>
        <td class="num ${i && h.net < history[i - 1].net ? 'neg' : 'pos'}">${i ? money(h.net - history[i - 1].net, { sign: true }) : ''}</td>
        <td class="actions"><button class="icon-btn small" data-del-snap="${h.month}" aria-label="Delete">🗑</button></td></tr>`).reverse().join('')}</tbody></table></div></div>` : ''}`;

  if (history.length >= 2) {
    lineChart($('#nwChart', el), {
      labels: history.map((h) => monthLabel(h.month, 'short')),
      datasets: [
        { label: 'Net worth', data: history.map((h) => h.net), color: seriesColor(1) },
        { label: 'Assets', data: history.map((h) => h.assets), color: seriesColor(3) },
        { label: 'Liabilities', data: history.map((h) => h.liabilities), color: seriesColor(2) },
      ],
    });
  }

  const set = (list, id, field, inp) => {
    const item = state.netWorth[list].find((x) => x.id === id);
    update('netWorth', () => { item[field] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) || 0 : inp.value; });
    ctx.refresh();
  };
  on(el, 'change', '[data-asset]', (e, inp) => set('assets', inp.dataset.asset, inp.dataset.field, inp));
  on(el, 'change', '[data-liab]', (e, inp) => set('otherLiabilities', inp.dataset.liab, inp.dataset.field, inp));
  on(el, 'click', '[data-action=add-asset]', () => { update('netWorth', (n) => { n.assets.push({ id: uid('asset'), name: 'New asset', value: 0, liquid: false, notes: '' }); }); ctx.refresh(); });
  on(el, 'click', '[data-action=add-liab]', () => { update('netWorth', (n) => { n.otherLiabilities.push({ id: uid('liab'), name: 'New liability', value: 0, notes: '' }); }); ctx.refresh(); });
  on(el, 'click', '[data-del-asset]', async (e, b) => { if (await confirmDialog('Delete this asset?')) { update('netWorth', (n) => { n.assets = n.assets.filter((a) => a.id !== b.dataset.delAsset); }); ctx.refresh(); } });
  on(el, 'click', '[data-del-liab]', async (e, b) => { if (await confirmDialog('Delete this liability?')) { update('netWorth', (n) => { n.otherLiabilities = n.otherLiabilities.filter((a) => a.id !== b.dataset.delLiab); }); ctx.refresh(); } });
  on(el, 'click', '[data-del-snap]', (e, b) => { update('netWorth', (n) => { n.history = n.history.filter((h) => h.month !== b.dataset.delSnap); }); ctx.refresh(); });
  on(el, 'click', '[data-action=snapshot]', () => {
    update('netWorth', (n) => {
      n.history = n.history.filter((h) => h.month !== ctx.month);
      n.history.push({ month: ctx.month, assets: round2(nw.assets), liabilities: round2(nw.liabilities), net: round2(nw.net) });
    });
    toast(`Snapshot saved for ${monthLabel(ctx.month)}`);
    ctx.refresh();
  });
}
