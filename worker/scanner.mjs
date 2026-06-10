// ─────────────────────────────────────────────────────────
//  Scanner v9.0 — Dual-TF Scan with Audited Limits & Validation
// ─────────────────────────────────────────────────────────

import { sendTradeAlert } from './telegramBot.mjs';
import { getAiSecondOpinion } from './aiAgent.mjs';
import { CANDLE_LIMIT } from '../src/utils/constants.js';
import fs from 'fs';
import path from 'path';

const REST   = 'https://fapi.binance.com/fapi/v1';
const ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LINKUSDT'];
const TFS    = ['1w', '1d', '4h', '1h', '15m', '5m'];  // 1w added for weekly context

// L11: Track last alert per symbol and persist to a local file
const ALERT_FILE = path.join(process.cwd(), 'worker', 'lastAlertTime.json');
let lastAlertTime = {};
try {
  if (fs.existsSync(ALERT_FILE)) {
    lastAlertTime = JSON.parse(fs.readFileSync(ALERT_FILE, 'utf8'));
  }
} catch (err) {
  console.error('[SCANNER] Failed to load lastAlertTime.json:', err.message);
}

function saveAlertTime(symbol, timestamp) {
  lastAlertTime[symbol] = timestamp;
  try {
    fs.mkdirSync(path.dirname(ALERT_FILE), { recursive: true });
    fs.writeFileSync(ALERT_FILE, JSON.stringify(lastAlertTime, null, 2), 'utf8');
  } catch (err) {
    console.error('[SCANNER] Failed to save lastAlertTime.json:', err.message);
  }
}

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown per symbol

async function getKlines(symbol, interval, limit = CANDLE_LIMIT) { // H7: use CANDLE_LIMIT (1500)
  const res = await fetch(`${REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance API error: ${res.status} for ${symbol} ${interval}`);
  const raw = await res.json();
  
  // H9: Verify API kline response is array & filter NaN values
  if (!Array.isArray(raw)) {
    throw new Error(`Binance API returned invalid data format: expected array, got ${typeof raw}`);
  }

  return raw
    .map(k => {
      if (!Array.isArray(k) || k.length < 6) return null;
      const candle = {
        time:   Math.floor(k[0] / 1000),
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5]),
      };
      
      if (isNaN(candle.time) || isNaN(candle.open) || isNaN(candle.high) || isNaN(candle.low) || isNaN(candle.close) || isNaN(candle.volume)) {
        return null;
      }
      return candle;
    })
    .filter(k => k !== null);
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
        data[tf] = await getKlines(symbol, tf, CANDLE_LIMIT); // H7: sync candle limit
      }

      // Run dual-TF analysis: 15m intraday + 5m scalping
      const result15m = runAnalysis(data, { symbol, activeTimeframe: '15m' });
      const result5m  = runAnalysis(data, { symbol, activeTimeframe: '5m' });

      // Pick whichever has a valid signal with higher confluence
      const result = (
        result5m.decision !== 'NO_TRADE' &&
        result5m.confluenceScore.total >= result15m.confluenceScore.total
      ) ? result5m : result15m;

      const { decision, confluenceScore, direction, entry, analysisMode } = result;
      console.log(`[SCANNER] ${symbol}: ${decision} (${analysisMode}) | Score: ${confluenceScore.total}/${confluenceScore.max} | Pillars: ${confluenceScore.pillarsMet}/${confluenceScore.pillarsTotal} | Dir: ${direction || 'N/A'}`);

      // TAKE_NOW: Send alert if score >= 5 and not sent recently
      const shouldAlertTakeNow = decision === 'TAKE_NOW' && confluenceScore.total >= 5;

      // WAIT: Send alert if score >= 4 and we have clear trigger levels
      const shouldAlertWait = decision === 'WAIT' && confluenceScore.total >= 4;

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
          saveAlertTime(symbol, Date.now()); // L11: save persistent alert time
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
