// Receipt arithmetic: totals and the per-category split (pure, unit tested).
import { round2, sum } from './util.js';

export function totals(d) {
  const itemsTotal = round2(sum(d.items, (i) => i.amount));
  const extras = round2((+d.tax || 0) + (+d.tip || 0) + (+d.fees || 0) - (+d.discount || 0));
  const computed = round2(itemsTotal + extras);
  const printed = +d.total || 0;
  return { itemsTotal, extras, computed, printed, mismatch: printed ? round2(printed - computed) : 0 };
}

// Tax, tip, fees and discounts are spread across categories in proportion to their items,
// with rounding pushed into the largest category so the split adds up to the cent.
export function splitByCategory(d) {
  const { itemsTotal, extras, computed } = totals(d);
  const groups = new Map();
  for (const item of d.items) {
    const key = item.category_id || '';
    groups.set(key, (groups.get(key) || 0) + (+item.amount || 0));
  }
  if (!groups.size) groups.set('', 0);
  const rows = [...groups.entries()].map(([categoryId, items]) => ({
    categoryId, items: round2(items), amount: round2(items + (itemsTotal ? (items / itemsTotal) * extras : extras / groups.size)),
  })).sort((a, b) => b.amount - a.amount);
  const diff = round2(computed - sum(rows, (r) => r.amount));
  if (rows.length) rows[0].amount = round2(rows[0].amount + diff);
  return rows.filter((r) => Math.abs(r.amount) >= 0.005);
}

