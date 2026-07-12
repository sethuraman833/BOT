// ─────────────────────────────────────────────────────────
//  Formatters — Price, Percent, Size
// ─────────────────────────────────────────────────────────

import { ASSETS } from './constants.js';

const priceFormatters = {};

export function formatPrice(value, symbol = 'BTCUSDT') {
  if (value == null || isNaN(value)) return '—';
  
  let decimals = 2;
  if (typeof symbol === 'number') {
    decimals = symbol;
  } else if (symbol && ASSETS[symbol]) {
    decimals = ASSETS[symbol].decimals;
  }

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

export function formatSize(value, symbol = 'BTCUSDT') {
  if (value == null || isNaN(value)) return '—';
  
  let decimals = 4;
  if (symbol && ASSETS[symbol]) {
    const stepSize = ASSETS[symbol].stepSize;
    if (stepSize >= 1) decimals = 0;
    else if (stepSize >= 0.1) decimals = 1;
    else if (stepSize >= 0.01) decimals = 2;
    else if (stepSize >= 0.001) decimals = 3;
    else if (stepSize >= 0.0001) decimals = 4;
    else if (stepSize >= 0.00001) decimals = 5;
  }
  
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
