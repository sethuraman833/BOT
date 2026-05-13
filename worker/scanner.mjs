// ─────────────────────────────────────────────────────────
//  Scanner v6.0 — 15-min Scan Loop with AI Reasoning
// ─────────────────────────────────────────────────────────

import { sendTradeAlert } from './telegramBot.mjs';
import { getAiSecondOpinion } from './aiAgent.mjs';

const REST   = 'https://fapi.binance.com/fapi/v1';
const ASSETS = ['BTCUSDT', 'ETHUSDT'];
const TFS    = ['1d', '4h', '1h', '15m'];

// Track last alert per symbol to avoid duplicate notifications
const lastAlertTime = {};
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown per symbol

async function getKlines(symbol, interval, limit = 200) {
  const res = await fetch(`${REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance API error: ${res.status} for ${symbol} ${interval}`);
  const raw = await res.json();
  return raw.map(k => ({
    time:   Math.floor(k[0] / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function runScan() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(` SMC SCAN v6 — ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(50)}`);

  // Dynamic import of the engine (ESM-compatible)
  const { runAnalysis } = await import('../src/engine/tradeAnalyzer.js');

  for (const symbol of ASSETS) {
    try {
      console.log(`\n[SCANNER] Fetching data for ${symbol}...`);
      const data = {};
      for (const tf of TFS) {
        data[tf] = await getKlines(symbol, tf, 200);
      }

      const result = runAnalysis(data, { symbol });
      const { decision, confluenceScore, direction, entry, waitCondition } = result;

      console.log(`[SCANNER] ${symbol}: ${decision} | Score: ${confluenceScore.total}/10 | Pillars: ${confluenceScore.pillarsMet}/${confluenceScore.pillarsTotal} | Dir: ${direction || 'N/A'}`);

      // TAKE_NOW: Send alert if score >= 6 and not sent recently
      const shouldAlertTakeNow = decision === 'TAKE_NOW' && confluenceScore.total >= 6;

      // WAIT: Send alert if score >= 5 and we have clear trigger levels
      const shouldAlertWait = decision === 'WAIT' && confluenceScore.total >= 5;

      if (shouldAlertTakeNow || shouldAlertWait) {
        const lastSent = lastAlertTime[symbol] || 0;
        const elapsed  = Date.now() - lastSent;

        if (elapsed < ALERT_COOLDOWN_MS) {
          console.log(`[SCANNER] ${symbol}: Skipping duplicate alert (${Math.round(elapsed / 60000)}m since last alert)`);
          continue;
        }

        console.log(`[SCANNER] Requesting AI Second Opinion for ${symbol}...`);
        const aiResponse = await getAiSecondOpinion(result);
        result.aiAnalysis = aiResponse;
        console.log(`[SCANNER] AI verdict: ${aiResponse.decision} — ${aiResponse.reasoning?.slice(0, 80)}...`);

        // Only alert if AI doesn't explicitly disagree
        if (aiResponse.decision !== 'DISAGREE') {
          await sendTradeAlert(result);
          lastAlertTime[symbol] = Date.now();
        } else {
          console.log(`[SCANNER] ${symbol}: AI DISAGREES — alert suppressed.`);
        }
      }

    } catch (err) {
      console.error(`[SCANNER] Error on ${symbol}:`, err.message);
    }
  }

  console.log(`\n[SCANNER] Scan complete — ${new Date().toISOString()}`);
}
