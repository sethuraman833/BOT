// ─────────────────────────────────────────────────────────
//  Market Context — PDH/PDL, Asian Range, Weekly Open
// ─────────────────────────────────────────────────────────

import fetch from 'node-fetch';
import { sendDailyContext } from './telegramBot.mjs';

const REST = 'https://fapi.binance.com/fapi/v1';

async function getKlines(symbol, interval, limit) {
  const res = await fetch(`${REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const raw = await res.json();
  return raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

function calcEMA(candles, period) {
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

export async function sendDailyReport() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  try {
    const assets = ['BTCUSDT', 'ETHUSDT'];
    let report = `📊 *MARKET CONTEXT REPORT — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━\n`;

    for (const symbol of assets) {
      const daily = await getKlines(symbol, '1d', 7);
      const h4 = await getKlines(symbol, '4h', 200);

      const prevDay = daily[daily.length - 2];
      const pdh = prevDay?.high?.toFixed(2) || '—';
      const pdl = prevDay?.low?.toFixed(2) || '—';

      // Asian range: candles between 00:00-07:00 UTC today
      const todayStart = Math.floor(new Date(dateStr).getTime() / 1000);
      const asianEnd = todayStart + 7 * 3600;
      const h1 = await getKlines(symbol, '1h', 24);
      const asianCandles = h1.filter(c => c.time >= todayStart && c.time < asianEnd);
      const asianHigh = asianCandles.length > 0 ? Math.max(...asianCandles.map(c => c.high)).toFixed(2) : '—';
      const asianLow = asianCandles.length > 0 ? Math.min(...asianCandles.map(c => c.low)).toFixed(2) : '—';

      // Weekly open
      const weekStart = daily.find(d => {
        const day = new Date(d.time * 1000).getUTCDay();
        return day === 1; // Monday
      });
      const weeklyOpen = weekStart?.open?.toFixed(2) || daily[0]?.open?.toFixed(2) || '—';

      const ema200 = calcEMA(h4, Math.min(200, h4.length)).toFixed(2);

      const icon = symbol === 'BTCUSDT' ? '₿' : 'Ξ';
      report += `\n${icon} *${symbol}*\n`;
      report += `• PDH: $${pdh}\n• PDL: $${pdl}\n`;
      report += `• Asian High: $${asianHigh}\n• Asian Low: $${asianLow}\n`;
      report += `• Weekly Open: $${weeklyOpen}\n`;
      report += `• EMA200 (4H): $${ema200}\n`;
    }

    report += `\n━━━━━━━━━━━━━━━━━━━━━━\n⏰ ${now.toUTCString()}`;

    await sendDailyContext(report);
  } catch (err) {
    console.error('[CONTEXT] Daily report failed:', err.message);
  }
}
