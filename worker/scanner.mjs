// ─────────────────────────────────────────────────────────
//  Scanner v11.0 — All-TF Scan, Parallel, Retry, Deduped
// ─────────────────────────────────────────────────────────

import { sendTradeAlert } from './telegramBot.mjs';
import { getAiSecondOpinion } from './aiAgent.mjs';
import { CANDLE_LIMIT, ASSET_LIST, BINANCE_REST } from '../src/utils/constants.js';
import fs from 'fs';
import path from 'path';

const TFS = ['1w', '1d', '4h', '1h', '15m', '5m'];
const TFS_TO_SCAN = ['5m', '15m', '1h', '4h', '1d']; // All tradeable timeframes
const SCAN_CONCURRENCY = 3; // Parallel asset scanning limit

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

/**
 * Fetch with exponential backoff retry on 429/5xx errors.
 */
async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.log(`[SCANNER] Rate limited/error ${res.status}, retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
    throw new Error(`Binance API error: ${res.status} for ${url}`);
  }
}

async function getKlines(symbol, interval, limit = CANDLE_LIMIT) {
  const res = await fetchWithRetry(`${BINANCE_REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
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

/**
 * Scan a single asset across all timeframes.
 */
async function scanAsset(symbol, runAnalysis) {
  try {
    console.log(`\n[SCANNER] Fetching data for ${symbol}...`);
    const data = {};
    for (const tf of TFS) {
      data[tf] = await getKlines(symbol, tf, CANDLE_LIMIT);
    }

    // Run analysis on ALL tradeable timeframes, pick the best signal
    let bestResult = null;
    for (const tf of TFS_TO_SCAN) {
      const r = runAnalysis(data, { symbol, activeTimeframe: tf });
      if (!bestResult ||
          (r.decision === 'TAKE_NOW' && bestResult.decision !== 'TAKE_NOW') ||
          (r.decision === bestResult.decision && r.confluenceScore.total > bestResult.confluenceScore.total)) {
        bestResult = r;
      }
    }
    const result = bestResult;

    const { decision, confluenceScore, direction, analysisMode } = result;
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
        return;
      }

      console.log(`[SCANNER] Requesting AI Second Opinion for ${symbol}...`);
      const aiResponse = await getAiSecondOpinion(result);
      result.aiAnalysis = aiResponse;
      console.log(`[SCANNER] AI verdict: ${aiResponse.decision} — ${aiResponse.reasoning?.slice(0, 80)}...`);

      // Only alert if AI doesn't explicitly disagree
      if (aiResponse.decision !== 'DISAGREE') {
        await sendTradeAlert(result);
        saveAlertTime(symbol, Date.now());
      } else {
        console.log(`[SCANNER] ${symbol}: AI DISAGREES — alert suppressed.`);
      }
    }

  } catch (err) {
    console.error(`[SCANNER] Error on ${symbol}:`, err.message);
  }
}

export async function runScan() {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(` SMC SCAN v10 — ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(50)}`);

  // Dynamic import of the engine (ESM-compatible)
  const { runAnalysis } = await import('../src/engine/tradeAnalyzer.js');

  // Parallel scanning with concurrency limit
  for (let i = 0; i < ASSET_LIST.length; i += SCAN_CONCURRENCY) {
    const batch = ASSET_LIST.slice(i, i + SCAN_CONCURRENCY);
    await Promise.allSettled(batch.map(symbol => scanAsset(symbol, runAnalysis)));
  }

  console.log(`\n[SCANNER] Scan complete — ${new Date().toISOString()}`);
}
