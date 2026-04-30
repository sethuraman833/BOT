// ─────────────────────────────────────────────────────────
//  Scanner — 15-min Scan Loop
// ─────────────────────────────────────────────────────────

import fetch from 'node-fetch';
import { sendTradeAlert } from './telegramBot.mjs';

const REST = 'https://fapi.binance.com/fapi/v1';
const ASSETS = ['BTCUSDT', 'ETHUSDT'];
const TFS = ['1d', '4h', '1h', '15m'];

async function getKlines(symbol, interval, limit = 200) {
  const res = await fetch(`${REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const raw = await res.json();
  return raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function runScan() {
  console.log(`[SCANNER] Starting scan at ${new Date().toISOString()}`);

  // Dynamic import of engine (ESM from src/)
  const { runAnalysis } = await import('../src/engine/tradeAnalyzer.js');

  for (const symbol of ASSETS) {
    try {
      const data = {};
      for (const tf of TFS) {
        data[tf] = await getKlines(symbol, tf, 200);
      }

      const result = runAnalysis(data, { symbol });
      console.log(`[SCANNER] ${symbol}: ${result.decision} (Score: ${result.confluenceScore.total}/11)`);

      if (result.decision === 'TAKE_NOW' && result.confluenceScore.total >= 7) {
        await sendTradeAlert(result);
      } else if (result.decision === 'WAIT' && result.confluenceScore.total >= 5) {
        console.log(`[SCANNER] ${symbol}: CAUTION signal — not sending (score ${result.confluenceScore.total})`);
      }
    } catch (err) {
      console.error(`[SCANNER] Error on ${symbol}:`, err.message);
    }
  }

  console.log(`[SCANNER] Scan complete`);
}
