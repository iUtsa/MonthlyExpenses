import { state } from '../store.js';
import { esc, money } from '../util.js';
import { incomeBracket, TAX_TABLES } from '../calc.js';

export async function render(el) {
  const b = incomeBracket(state.settings.annualGross);
  const t = TAX_TABLES[2026];
  el.innerHTML = `
    <div class="grid cols-3">
      <div class="card span-2 prose">
        <h2>Research notes & benchmarks</h2>
        <p class="small muted">From your Monthly Financial Planner workbook (2025–2026 sources), extended for this app.</p>

        <h3>Allocation rules</h3>
        <ul>
          <li><strong>50/30/20</strong> remains the most popular starting framework (Needs / Wants / Savings + Debt).</li>
          <li>Lower-income households often need <strong>60–70% for needs</strong>; forcing 50/30/20 leads to abandonment. Use 70/20/10 or “Auto” in Settings.</li>
          <li>Higher-income households can push savings to <strong>25–40%</strong> while living well — the key is avoiding lifestyle inflation.</li>
          <li>Housing: Ramsey and many CFPs recommend <strong>≤25% of take-home</strong>; real-world averages run higher in high-cost areas.</li>
        </ul>

        <h3>Category benchmarks (share of take-home pay)</h3>
        <table class="table-compact"><tbody>
          <tr><td>Housing</td><td>25–30% (30–40% at lower incomes or in HCOL areas)</td></tr>
          <tr><td>Food (groceries + dining)</td><td>10–15%</td></tr>
          <tr><td>Transportation</td><td>10–15%</td></tr>
          <tr><td>Utilities</td><td>5–10%</td></tr>
          <tr><td>Insurance (health + other)</td><td>5–15%</td></tr>
          <tr><td>Savings + debt payoff</td><td>10–20%+ (higher once high-interest debt is gone)</td></tr>
        </tbody></table>

        <h3>Sinking funds</h3>
        <ul>
          <li>The single highest-ROI budgeting habit for preventing crises.</li>
          <li>Divide any annual or irregular cost by 12 (or by the months until it's due) and treat it as a monthly bill — the Sinking funds page does this when you set a due date.</li>
        </ul>

        <h3>Emergency fund</h3>
        <ul>
          <li>Starter: <strong>$1,000</strong>. Standard: <strong>3–6 months</strong> of essential expenses.</li>
          <li>Self-employed, irregular/shift income, or single-income household: <strong>6–12 months</strong>.</li>
        </ul>

        <h3>Debt</h3>
        <ul>
          <li><strong>Avalanche</strong> (highest interest first) is mathematically optimal; <strong>Snowball</strong> (smallest balance first) often has higher completion rates thanks to quick wins.</li>
          <li>Credit cards above 15–20% APR should be attacked aggressively after the starter emergency fund.</li>
          <li>If a minimum payment doesn't cover the monthly interest, the balance grows forever — the Debt page flags this.</li>
        </ul>

        <h3>Paychecks & taxes (added)</h3>
        <ul>
          <li>2026 federal figures (IRS Rev. Proc. 2025-32): standard deduction ${money(t.standard.single, { cents: false })} single / ${money(t.standard.mfj, { cents: false })} married filing jointly / ${money(t.standard.hoh, { cents: false })} head of household; brackets 10%–37%.</li>
          <li>FICA: Social Security 6.2% up to the ${money(t.ssWageBase, { cents: false })} wage base, Medicare 1.45% (+0.9% above $200k single).</li>
          <li><strong>“No tax on overtime”</strong> (2025–2028): deduct the <em>premium</em> part of FLSA overtime (the “half” in time-and-a-half), up to $12,500 ($25,000 joint), phasing out above $150k MAGI ($300k joint). State-law daily overtime and double-time premiums don't qualify.</li>
          <li><strong>“No tax on tips”</strong> (2025–2028): deduct qualified tips up to $25,000, same phase-out. Both still owe FICA and are usually not reflected in withholding, so they tend to show up as a refund.</li>
          <li>F-1/J-1 nonresident students are generally exempt from FICA for their first 5 calendar years in the US and usually can't take the standard deduction (India treaty is an exception). Toggle FICA-exempt in the Tax estimator if it applies.</li>
          <li>Under the FLSA, overtime is owed after 40 hours in a fixed 7-day workweek; some states (e.g. California) also require daily overtime after 8 hours — set this per job.</li>
        </ul>

        <h3>Process</h3>
        <ul>
          <li>A weekly 5-minute check plus a monthly 20–40 minute review beats a perfect system you abandon.</li>
          <li>Subscriptions are easy to underestimate — audit them every few months (Bills page).</li>
          <li>The best budget is the one you will actually open and update. Scanning receipts the day you shop keeps it current.</li>
        </ul>
        <p class="small muted">Sources: WalletHub 2026 budget percentages, Wealthvieu income-level studies, Bankrate, NerdWallet, Ramsey Solutions, CFPB spending guidance, Tiller/FinancialAha spreadsheet best practices; IRS Rev. Proc. 2025-32 and IRS guidance on the One Big Beautiful Bill Act deductions; SSA 2026 wage base. Tax figures are estimates, not tax advice.</p>
      </div>
      <div class="stack">
        <div class="card">
          <h2>Your income bracket</h2>
          <p class="small muted">${money(state.settings.annualGross, { cents: false })} gross / year</p>
          <div class="kv small" style="margin-top:8px">
            <span>Bracket</span><span>${esc(b.label)}</span>
            <span>Typical needs</span><span>${b.needs}</span>
            <span>Typical savings</span><span>${b.savings}</span>
            <span>Housing guidance</span><span>${b.housing}</span>
            <span>Suggested rule</span><span>${b.rule}</span>
          </div>
          <p class="small" style="margin-top:8px"><strong>Priority focus:</strong> ${esc(b.focus)}</p>
        </div>
        <div class="card prose">
          <h2>Getting the best scans</h2>
          <ul class="small">
            <li>Lay receipts flat on a dark surface, in good light, filling the frame.</li>
            <li>Long receipts: take 2–3 overlapping photos and upload them together.</li>
            <li>Schedules: a screenshot from the scheduling app reads better than a photo of a printed roster. Calendar (.ics) or spreadsheet exports are exact.</li>
            <li>When you correct a merchant's category, the app remembers it for imports and future receipts.</li>
          </ul>
        </div>
        <div class="card prose">
          <h2>Fixed from the workbook</h2>
          <ul class="small">
            <li>“Totals by type” rows were shifted (Wants actual summed Needs; Savings actual summed Wants). Totals are now computed per bucket.</li>
            <li>The Dashboard referenced a Transactions sheet that didn't exist — transactions are now the source of every actual.</li>
            <li>Net Worth liabilities didn't match the Debt Tracker ($0 car loan vs $9,500). Loans now come from one list.</li>
            <li>Debt Tracker only showed one month ahead; it now simulates every month to payoff with rollover.</li>
            <li>Emergency fund goal ($21,000 = 6 × $3,500) and the sinking fund target ($12,000) disagreed — check both in Goals and Sinking funds.</li>
          </ul>
        </div>
      </div>
    </div>`;
}
