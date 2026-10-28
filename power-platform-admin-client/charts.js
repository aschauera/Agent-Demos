export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

const percent = (value, total) => (total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0);
const round = (value) => Math.round(value * 1000) / 1000;

function rowShell(item, inner) {
  const tooltip = escapeHtml(item.tooltip || `${item.label}: ${item.value}`);
  return item.href
    ? `<a class="chart-row chart-link" href="${escapeHtml(item.href)}" title="${tooltip}">${inner}</a>`
    : `<div class="chart-row" title="${tooltip}">${inner}</div>`;
}

// Bars are SVG geometry attributes so the page CSP (style-src 'self') never needs inline styles.
export function barChart({ label, items, emptyText = "No data returned." }) {
  if (!items.length) return `<p class="chart-empty">${escapeHtml(emptyText)}</p>`;
  const max = Math.max(...items.map((item) => item.value), 0);
  return `<ol class="bar-chart" aria-label="${escapeHtml(label)}">${items.map((item, index) => `<li>${rowShell(item, `
    <span class="chart-label">${escapeHtml(item.label)}</span>
    <span class="chart-value">${escapeHtml(item.value.toLocaleString())}</span>
    <svg class="chart-track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect class="track" x="0" y="0" width="100" height="6" rx="3"></rect>
      <rect class="bar chart-c${index % 6}" x="0" y="0" width="${round(percent(item.value, max))}" height="6" rx="3"></rect>
    </svg>`)}${item.copy ? `<button type="button" class="button button-quiet button-small chart-copy" data-copy="${escapeHtml(item.copy)}" aria-label="${escapeHtml(`Copy ${item.copy}`)}">Copy ID</button>` : ""}</li>`).join("")}</ol>`;
}

export function donutChart({ label, items, centerLabel = "Total", emptyText = "No data returned." }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return `<p class="chart-empty">${escapeHtml(emptyText)}</p>`;
  let offset = 0;
  const segments = items.map((item, index) => {
    const share = percent(item.value, total);
    const segment = item.value ? `<circle class="segment chart-c${item.color ?? index % 6}" cx="21" cy="21" r="15.9155" fill="none" stroke-width="6"
      stroke-dasharray="${round(share)} ${round(100 - share)}" stroke-dashoffset="${round(25 - offset)}"><title>${escapeHtml(`${item.label}: ${item.value}`)}</title></circle>` : "";
    offset += share;
    return item.href && segment ? `<a href="${escapeHtml(item.href)}" tabindex="-1" aria-hidden="true">${segment}</a>` : segment;
  }).join("");
  const legend = items.map((item, index) => `<li>${rowShell(item, `
    <span class="legend-swatch chart-c${item.color ?? index % 6}" aria-hidden="true"></span>
    <span class="chart-label">${escapeHtml(item.label)}</span>
    <span class="chart-value">${escapeHtml(item.value.toLocaleString())} <small>${Math.round(percent(item.value, total))}%</small></span>`)}</li>`).join("");
  return `<div class="donut-chart">
    <svg viewBox="0 0 42 42" role="img" aria-label="${escapeHtml(`${label}: ${items.map((item) => `${item.label} ${item.value}`).join(", ")}`)}">
      <circle class="donut-track" cx="21" cy="21" r="15.9155" fill="none" stroke-width="6"></circle>
      ${segments}
      <text class="donut-total" x="21" y="21.5" text-anchor="middle">${escapeHtml(total.toLocaleString())}</text>
      <text class="donut-caption" x="21" y="26" text-anchor="middle">${escapeHtml(centerLabel)}</text>
    </svg>
    <ul class="chart-legend" aria-label="${escapeHtml(label)}">${legend}</ul>
  </div>`;
}
