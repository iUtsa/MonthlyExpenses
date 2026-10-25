// Chart.js wrappers following the dataviz spec: <=24px bars with 4px rounded data-ends,
// 2px lines, ~10% area washes, hairline recessive grid, hover tooltips, a legend only
// for 2+ series, colors assigned by fixed slot order and read from CSS tokens.
import { money } from './util.js';

const instances = new Map();

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const seriesColor = (slot) => css(`--series-${slot}`);
export const bucketColor = (bucket) => css({ need: '--need', want: '--want', savings: '--savings' }[bucket] || '--series-1');

function alpha(hex, a) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

const compactMoney = (v) => money(v, { cents: false, compact: true });

function baseOptions({ legend, moneyAxis = true, horizontal = false, stacked = false }) {
  const grid = css('--grid'); const axis = css('--axis'); const muted = css('--muted'); const text2 = css('--text-2');
  const valueAxis = {
    stacked,
    beginAtZero: true,
    grid: { color: grid, drawTicks: false },
    border: { display: false },
    ticks: { color: muted, padding: 6, maxTicksLimit: 6, callback: moneyAxis ? compactMoney : undefined },
  };
  const catAxis = {
    stacked,
    grid: { display: false },
    border: { color: axis },
    ticks: { color: muted, padding: 4, autoSkip: true, maxRotation: 0 },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    indexAxis: horizontal ? 'y' : 'x',
    interaction: { mode: horizontal ? 'nearest' : 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
    plugins: {
      legend: {
        display: legend,
        position: 'top',
        align: 'start',
        labels: { color: text2, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: css('--text'),
        titleColor: css('--page'),
        bodyColor: css('--page'),
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          label: (ctx) => {
            const v = horizontal ? ctx.parsed.x : ctx.parsed.y;
            return ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ''}${moneyAxis ? money(v) : v.toLocaleString()}`;
          },
        },
      },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

function mount(canvas, config) {
  if (!canvas || !window.Chart) return null;
  instances.get(canvas)?.destroy();
  const chart = new window.Chart(canvas, config);
  instances.set(canvas, chart);
  return chart;
}

export function destroyCharts() {
  for (const chart of instances.values()) chart.destroy();
  instances.clear();
}

// datasets: [{ label, data, color }] — color is a resolved CSS color.
export function barChart(canvas, { labels, datasets, horizontal = false, stacked = false, moneyAxis = true }) {
  const surface = css('--surface');
  const last = datasets.length - 1;
  return mount(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.color,
        hoverBackgroundColor: d.color,
        maxBarThickness: 24,
        borderRadius: stacked && i !== last ? 0 : 4,
        borderSkipped: 'start',
        borderColor: surface,
        borderWidth: stacked ? { top: horizontal ? 0 : 2, right: horizontal ? 2 : 0 } : 0,
        categoryPercentage: 0.7,
        barPercentage: datasets.length > 1 && !stacked ? 0.9 : 0.8,
      })),
    },
    options: baseOptions({ legend: datasets.length > 1, moneyAxis, horizontal, stacked }),
  });
}

export function lineChart(canvas, { labels, datasets, area = false, moneyAxis = true, zeroLine = false }) {
  const surface = css('--surface');
  const opts = baseOptions({ legend: datasets.length > 1, moneyAxis });
  opts.scales.y.beginAtZero = zeroLine;
  opts.elements = { point: { radius: 0, hoverRadius: 5, hitRadius: 12, hoverBorderWidth: 2, hoverBorderColor: surface } };
  return mount(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: area ? alpha(d.color, 0.1) : d.color,
        pointBackgroundColor: d.color,
        fill: area ? 'origin' : false,
        borderWidth: 2,
        borderDash: d.dashed ? [5, 4] : undefined,
        tension: 0.25,
        stepped: d.stepped || false,
      })),
    },
    options: opts,
  });
}

// Health score ring: a meter, not a chart. Fill = score, track = lighter step of the same hue.
export function scoreRing(score) {
  const r = 52; const c = 2 * Math.PI * r;
  const color = score >= 60 ? 'var(--good)' : score >= 40 ? 'var(--warning)' : 'var(--critical)';
  return `<svg class="score-ring" viewBox="0 0 120 120" role="img" aria-label="Health score ${score} of 100">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.18" stroke-width="10"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${(c * score) / 100} ${c}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" font-size="30" font-weight="700" fill="var(--text)">${score}</text>
    <text x="60" y="78" text-anchor="middle" font-size="11" fill="var(--muted)">of 100</text>
  </svg>`;
}
