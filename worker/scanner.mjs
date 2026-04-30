// ─────────────────────────────────────────────────────────
//  Scanner — 15-min Scan Loop
// ─────────────────────────────────────────────────────────


import { sendTradeAlert } from './telegramBot.mjs';
import { getAiSecondOpinion } from './aiAgent.mjs';

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

      // Trigger AI Analysis for high confluence or valid decisions
      if (result.decision === 'TAKE_NOW' || (result.decision === 'WAIT' && result.confluenceScore.total >= 5)) {
        console.log(`[SCANNER] Requesting AI Second Opinion for ${symbol}...`);
        const aiResponse = await getAiSecondOpinion(result);
        result.aiAnalysis = aiResponse;
        
        if (result.decision === 'TAKE_NOW' && result.confluenceScore.total >= 6) {
          await sendTradeAlert(result);
        } else if (result.decision === 'WAIT') {
          // Optional: Send WAIT signals to Telegram if AI AGREES
          if (aiResponse.decision === 'AGREE' || aiResponse.decision === 'CAUTION') {
            console.log(`[SCANNER] ${symbol}: AI agrees with WAIT signal. (Reason: ${aiResponse.reasoning})`);
            // await sendTradeAlert(result); // Uncomment if you want WAIT alerts too
          }
        }
      }
    } catch (err) {
      console.error(`[SCANNER] Error on ${symbol}:`, err.message);
    }
  }

  console.log(`[SCANNER] Scan complete`);
}
