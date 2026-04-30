// ─────────────────────────────────────────────────────────
//  Formatters — Price, Percent, Size
// ─────────────────────────────────────────────────────────

const priceFormatters = {};

export function formatPrice(value, decimals = 2) {
  if (value == null || isNaN(value)) return '—';
  const key = `price_${decimals}`;
  if (!priceFormatters[key]) {
    priceFormatters[key] = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return priceFormatters[key].format(value);
}

export function formatPercent(value) {
  if (value == null || isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatSize(value, decimals = 4) {
  if (value == null || isNaN(value)) return '—';
  return value.toFixed(decimals);
}

export function formatRRR(value) {
  if (value == null || isNaN(value)) return '—';
  return `1:${value.toFixed(1)}`;
}

export function formatUTCTime(date = new Date()) {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s} UTC`;
}
