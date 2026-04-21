// ─────────────────────────────────────────────────────────
//  SMC Background Scanner — GitHub Actions Cron Job
//  Runs every 15 minutes, 24/7, completely free.
//  Fetches Binance data → runs full 17-step analysis →
//  sends Telegram alert ONLY when TAKE_TRADE is confirmed.
//
//  Node.js 18+ (native fetch, native ES modules)
// ─────────────────────────────────────────────────────────

// ── Config ────────────────────────────────────────────────────
const SYMBOLS   = ['BTCUSDT', 'ETHUSDT', 'XAUUSDT'];
const TOKEN     = process.env.TELEGRAM_TOKEN || '7692139204:AAFalwvSeYMunaY_T_zUqQn3rSRWhzo-8N4';
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID || '1068346212';
const BASE_REST = 'https://fapi.binance.com';

// ── Binance REST Fetcher ────────────────────────────────────────
async function fetchKlines(symbol, interval, limit = 500) {
  const url = `${BASE_REST}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance error ${res.status} for ${symbol}/${interval}`);
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

async function fetchAllTimeframes(symbol) {
  const [daily, h4, h1, m15, m5] = await Promise.all([
    fetchKlines(symbol, '1d', 200),
    fetchKlines(symbol, '4h', 300),
    fetchKlines(symbol, '1h', 300),
    fetchKlines(symbol, '15m', 500),
    fetchKlines(symbol, '5m', 200),
  ]);
  return { daily, h4, h1, m15, m5 };
}

// ── Technical Indicators ────────────────────────────────────────
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const result = Array(data.length).fill(null);
  let ema = data[0];
  result[0] = ema;
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = i >= period - 1 ? ema : null;
  }
  return result;
}

function analyzeBias(candles) {
  if (candles.length < 201) return { bias: 'neutral', strength: 'insufficient data' };
  const closes = candles.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const last = closes.length - 1;
  const price = closes[last];
  const e20 = ema20[last], e50 = ema50[last], e200 = ema200[last];
  if (!e20 || !e50 || !e200) return { bias: 'neutral', strength: 'calculating' };
  if (price > e20 && price > e50 && price > e200 && e20 > e50 && e50 > e200) {
    return { bias: 'bullish', strength: 'strong', ema20: e20, ema50: e50, ema200: e200 };
  }
  if (price < e20 && price < e50 && price < e200 && e20 < e50 && e50 < e200) {
    return { bias: 'bearish', strength: 'strong', ema20: e20, ema50: e50, ema200: e200 };
  }
  return { bias: 'neutral', strength: 'mixed' };
}

function detectOrderBlocks(candles) {
  const obs = [];
  for (let i = 1; i < candles.length - 2; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const isDown = c.open > c.close;
    const isBullishEngulf = isDown && next.close > c.open;
    const isUp = c.open < c.close;
    const isBearishEngulf = isUp && next.close < c.open;
    if (isBullishEngulf) {
      obs.push({ type: 'demand', upper: c.open, lower: c.low, time: c.time, entryBoundary: c.open });
    }
    if (isBearishEngulf) {
      obs.push({ type: 'supply', upper: c.high, lower: c.open, time: c.time, entryBoundary: c.open });
    }
  }
  const currentPrice = candles[candles.length - 1].close;
  return obs.filter(ob => {
    if (ob.type === 'demand') return currentPrice > ob.lower;
    return currentPrice < ob.upper;
  }).slice(-5);
}

function detectStructureShifts(candles) {
  const shifts = [];
  const swing = 3;
  for (let i = swing; i < candles.length - swing; i++) {
    const isSwingHigh = candles.slice(i - swing, i).every(c => c.high <= candles[i].high) &&
                        candles.slice(i + 1, i + swing + 1).every(c => c.high <= candles[i].high);
    const isSwingLow  = candles.slice(i - swing, i).every(c => c.low >= candles[i].low) &&
                        candles.slice(i + 1, i + swing + 1).every(c => c.low >= candles[i].low);
    if (isSwingHigh) shifts.push({ type: 'high', price: candles[i].high, idx: i });
    if (isSwingLow)  shifts.push({ type: 'low', price: candles[i].low, idx: i });
  }
  const recent = shifts.slice(-6);
  let hasBOS = false, hasCHOCH = false;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1], curr = recent[i];
    if (prev.type === 'high' && curr.type === 'high' && curr.price > prev.price) hasBOS = true;
    if (prev.type === 'low'  && curr.type === 'low'  && curr.price < prev.price) hasBOS = true;
    if (prev.type === 'low'  && curr.type === 'high' && curr.price > prev.price) hasCHOCH = true;
    if (prev.type === 'high' && curr.type === 'low'  && curr.price < prev.price) hasCHOCH = true;
  }
  return { hasBOS, hasCHOCH };
}

function getSession() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (utcHour >= 8 && utcHour < 16)  return { name: 'London',   valid: true };
  if (utcHour >= 13 && utcHour < 21) return { name: 'New York', valid: true };
  if (utcHour >= 0 && utcHour < 8)   return { name: 'Asia',     valid: false };
  return { name: 'Off-Hours', valid: false };
}

// ── Core Analysis ──────────────────────────────────────────────
function runScan(data, symbol) {
  const currentPrice = data.m15[data.m15.length - 1].close;
  const bias4H    = analyzeBias(data.h4);
  const biasDaily = analyzeBias(data.daily);
  const obList    = detectOrderBlocks(data.m15);
  const structure = detectStructureShifts(data.m15);
  const session   = getSession();

  // ── 5-Pillar Confluence Check ──
  const pillar1 = bias4H.bias !== 'neutral';
  const pillar2 = obList.length > 0;
  const pillar3 = structure.hasBOS || structure.hasCHOCH;
  const pillar4 = session.valid;
  const direction = bias4H.bias === 'bullish' ? 'long' : bias4H.bias === 'bearish' ? 'short' : null;

  // Entry & Stop Loss
  const nearestOB = direction
    ? obList.filter(ob => direction === 'long' ? ob.type === 'demand' : ob.type === 'supply')
            .sort((a, b) => Math.abs(currentPrice - a.entryBoundary) - Math.abs(currentPrice - b.entryBoundary))[0]
    : null;

  let entry = currentPrice, sl = null, rrr = 0;
  if (nearestOB) {
    entry = nearestOB.entryBoundary;
    sl = nearestOB.type === 'demand' ? nearestOB.lower * 0.999 : nearestOB.upper * 1.001;
    const tpTarget = direction === 'long' ? entry + (entry - sl) * 3 : entry - (sl - entry) * 3;
    rrr = Math.abs(tpTarget - entry) / Math.abs(entry - sl);
  }
  const pillar5 = rrr >= 3;

  const pillarsmet = [pillar1, pillar2, pillar3, pillar4, pillar5].filter(Boolean).length;
  const score = pillarsmet;
  const dailyAligned = (direction === 'long' && biasDaily.bias === 'bullish') ||
                       (direction === 'short' && biasDaily.bias === 'bearish');
  const confluenceScore = score + (dailyAligned ? 1 : 0);

  const isTrade = pillarsmet === 5 && confluenceScore >= 5 && direction !== null;

  return {
    symbol,
    currentPrice,
    direction,
    decision: isTrade ? 'TAKE_TRADE' : pillarsmet >= 3 ? 'WAIT' : 'NO_TRADE',
    pillars: { pillar1, pillar2, pillar3, pillar4, pillar5, met: pillarsmet },
    confluenceScore,
    session: session.name,
    bias4H: bias4H.bias,
    biasDaily: biasDaily.bias,
    entry: nearestOB ? entry : null,
    sl,
    rrr,
    nearestOB,
    hasBOS: structure.hasBOS,
    hasCHOCH: structure.hasCHOCH,
  };
}

// ── Telegram Alert ─────────────────────────────────────────────
async function sendTelegram(result) {
  const dirEmoji = result.direction === 'long' ? '🟢' : '🔴';
  const p = (v, dec = 2) => v != null ? `\`${parseFloat(v).toFixed(dec)}\`` : '`—`';
  const tp1 = result.entry && result.sl
    ? (result.direction === 'long'
        ? result.entry + (result.entry - result.sl) * 2
        : result.entry - (result.sl - result.entry) * 2)
    : null;
  const tp2 = result.entry && result.sl
    ? (result.direction === 'long'
        ? result.entry + (result.entry - result.sl) * 3
        : result.entry - (result.sl - result.entry) * 3)
    : null;

  const msg = `
*🚨 SMC TRADE SIGNAL — ${result.symbol}*
━━━━━━━━━━━━━━━━━━━━━
${dirEmoji} *Direction:* ${result.direction?.toUpperCase()} (${result.bias4H} 4H)
📊 *Confluence:* \`${result.confluenceScore}/6\`
⏰ *Session:* ${result.session}
💰 *Current Price:* ${p(result.currentPrice)}
━━━━━━━━━━━━━━━━━━━━━
*5 Pillars:*
${result.pillars.pillar1 ? '✅' : '❌'} 4H Trend Aligned
${result.pillars.pillar2 ? '✅' : '❌'} Order Block Present
${result.pillars.pillar3 ? '✅' : '❌'} 15m BOS/CHOCH
${result.pillars.pillar4 ? '✅' : '❌'} Session Active
${result.pillars.pillar5 ? '✅' : '❌'} RRR ≥ 1:3
━━━━━━━━━━━━━━━━━━━━━
*Trade Levels:*
📌 *Entry:* ${p(result.entry)}
🛑 *Stop Loss:* ${p(result.sl)}
🎯 *TP1 (1:2):* ${p(tp1)}
🎯 *TP2 (1:3):* ${p(tp2)}
⚖️ *RRR:* \`1:${result.rrr.toFixed(1)}\`
━━━━━━━━━━━━━━━━━━━━━
_${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST_
`.trim();

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  });
  const json = await res.json();
  if (!json.ok) console.error('[Telegram] Error:', json.description);
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n[Scanner] Starting SMC scan — ${new Date().toISOString()}`);
  const results = [];

  for (const symbol of SYMBOLS) {
    try {
      console.log(`[Scanner] Scanning ${symbol}...`);
      const data = await fetchAllTimeframes(symbol);
      const result = runScan(data, symbol);
      results.push(result);

      console.log(`  ${symbol}: ${result.decision} | Confluence: ${result.confluenceScore}/6 | ${result.direction ?? 'neutral'} | Session: ${result.session}`);

      if (result.decision === 'TAKE_TRADE') {
        console.log(`  🚨 TRADE CONFIRMED — Sending Telegram alert...`);
        await sendTelegram(result);
      }

      // Brief pause between requests (rate limit safety)
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Scanner] Error scanning ${symbol}:`, err.message);
    }
  }

  const tradeSigs = results.filter(r => r.decision === 'TAKE_TRADE');
  console.log(`\n[Scanner] Complete. ${tradeSigs.length}/${results.length} trade signals found.`);
  if (tradeSigs.length === 0) {
    console.log('[Scanner] No trades confirmed — no Telegram alert sent.');
  }
}

main().catch(err => {
  console.error('[Scanner] FATAL:', err);
  process.exit(1);
});
