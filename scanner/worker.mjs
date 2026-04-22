// ─────────────────────────────────────────────────────────
//  SMC Background Worker — Render.com 24/7 Service
//  Runs a true setInterval() every 15 minutes, never misses.
//  Deploy as a "Background Worker" on Render.com free tier.
// ─────────────────────────────────────────────────────────

import http from 'http';

// ── Config ────────────────────────────────────────────────────
const SYMBOLS    = ['BTCUSDT', 'ETHUSDT', 'XAUUSDT'];
const TOKEN      = process.env.TELEGRAM_TOKEN  || '7692139204:AAFalwvSeYMunaY_T_zUqQn3rSRWhzo-8N4';
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID || '1068346212';
const BASE_REST  = 'https://fapi.binance.com';
const INTERVAL   = 15 * 60 * 1000; // 15 minutes in ms

// Keep Render from marking service as crashed (needs a port listener)
const PORT = process.env.PORT || 4000;
const healthServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({
    status: 'running',
    uptime: process.uptime(),
    nextScan: new Date(Date.now() + (INTERVAL - (Date.now() % INTERVAL))).toISOString(),
  }));
});
healthServer.listen(PORT, () => {
  console.log(`[Worker] Health server running on port ${PORT}`);
});

// ── Binance REST Fetcher ────────────────────────────────────────
async function fetchKlines(symbol, interval, limit = 500) {
  const url = `${BASE_REST}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol}/${interval}`);
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
  if (candles.length < 201) return { bias: 'neutral' };
  const closes = candles.map(c => c.close);
  const ema20  = calculateEMA(closes, 20);
  const ema50  = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const last = closes.length - 1;
  const price = closes[last];
  const e20 = ema20[last], e50 = ema50[last], e200 = ema200[last];
  if (!e20 || !e50 || !e200) return { bias: 'neutral' };
  if (price > e20 && price > e50 && price > e200 && e20 > e50 && e50 > e200)
    return { bias: 'bullish', ema20: e20, ema50: e50, ema200: e200 };
  if (price < e20 && price < e50 && price < e200 && e20 < e50 && e50 < e200)
    return { bias: 'bearish', ema20: e20, ema50: e50, ema200: e200 };
  return { bias: 'neutral' };
}

function detectOrderBlocks(candles) {
  const obs = [];
  for (let i = 1; i < candles.length - 2; i++) {
    const c = candles[i], next = candles[i + 1];
    if (c.open > c.close && next.close > c.open)
      obs.push({ type: 'demand', upper: c.open, lower: c.low, entryBoundary: c.open });
    if (c.open < c.close && next.close < c.open)
      obs.push({ type: 'supply', upper: c.high, lower: c.open, entryBoundary: c.open });
  }
  const price = candles[candles.length - 1].close;
  return obs.filter(ob => ob.type === 'demand' ? price > ob.lower : price < ob.upper).slice(-5);
}

function detectStructureShifts(candles) {
  const shifts = [], swing = 3;
  for (let i = swing; i < candles.length - swing; i++) {
    const isHigh = candles.slice(i - swing, i).every(c => c.high <= candles[i].high) &&
                   candles.slice(i + 1, i + swing + 1).every(c => c.high <= candles[i].high);
    const isLow  = candles.slice(i - swing, i).every(c => c.low >= candles[i].low) &&
                   candles.slice(i + 1, i + swing + 1).every(c => c.low >= candles[i].low);
    if (isHigh) shifts.push({ type: 'high', price: candles[i].high });
    if (isLow)  shifts.push({ type: 'low',  price: candles[i].low });
  }
  const recent = shifts.slice(-6);
  let hasBOS = false, hasCHOCH = false;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1], curr = recent[i];
    if (prev.type === 'high' && curr.type === 'high' && curr.price > prev.price) hasBOS = true;
    if (prev.type === 'low'  && curr.type === 'low'  && curr.price < prev.price) hasBOS = true;
    if (prev.type === 'low'  && curr.type === 'high') hasCHOCH = true;
    if (prev.type === 'high' && curr.type === 'low')  hasCHOCH = true;
  }
  return { hasBOS, hasCHOCH };
}

function getSession() {
  const h = new Date().getUTCHours();
  if (h >= 8  && h < 16) return { name: 'London',   valid: true };
  if (h >= 13 && h < 21) return { name: 'New York', valid: true };
  return { name: 'Asia/Off-Hours', valid: false };
}

// ── Core Scan ──────────────────────────────────────────────────
function runScan(data, symbol) {
  const price     = data.m15[data.m15.length - 1].close;
  const bias4H    = analyzeBias(data.h4);
  const biasDaily = analyzeBias(data.daily);
  const obs       = detectOrderBlocks(data.m15);
  const struct    = detectStructureShifts(data.m15);
  const session   = getSession();
  const direction = bias4H.bias === 'bullish' ? 'long' : bias4H.bias === 'bearish' ? 'short' : null;

  const nearestOB = direction
    ? obs.filter(ob => direction === 'long' ? ob.type === 'demand' : ob.type === 'supply')
        .sort((a, b) => Math.abs(price - a.entryBoundary) - Math.abs(price - b.entryBoundary))[0]
    : null;

  let entry = price, sl = null, rrr = 0;
  if (nearestOB) {
    entry = nearestOB.entryBoundary;
    sl    = nearestOB.type === 'demand' ? nearestOB.lower * 0.999 : nearestOB.upper * 1.001;
    const tp = direction === 'long' ? entry + (entry - sl) * 3 : entry - (sl - entry) * 3;
    rrr   = Math.abs(tp - entry) / Math.abs(entry - sl);
  }

  const p1 = bias4H.bias !== 'neutral';
  const p2 = obs.length > 0;
  const p3 = struct.hasBOS || struct.hasCHOCH;
  const p4 = session.valid;
  const p5 = rrr >= 3;
  const met = [p1, p2, p3, p4, p5].filter(Boolean).length;
  const dailyAligned = (direction === 'long' && biasDaily.bias === 'bullish') ||
                       (direction === 'short' && biasDaily.bias === 'bearish');
  const confluence = met + (dailyAligned ? 1 : 0);
  const isTrade = met === 5 && confluence >= 5 && direction !== null;

  return {
    symbol, price, direction,
    decision: isTrade ? 'TAKE_TRADE' : met >= 3 ? 'WAIT' : 'NO_TRADE',
    pillars: { p1, p2, p3, p4, p5, met },
    confluence, session: session.name,
    bias4H: bias4H.bias, biasDaily: biasDaily.bias,
    entry: nearestOB ? entry : null, sl, rrr,
  };
}

// ── Telegram ───────────────────────────────────────────────────
async function sendTelegram(r) {
  const dirEmoji = r.direction === 'long' ? '🟢' : '🔴';
  const p = (v, d = 2) => v != null ? `\`${parseFloat(v).toFixed(d)}\`` : '`—`';
  const tp1 = r.entry && r.sl ? (r.direction === 'long' ? r.entry + (r.entry - r.sl) * 2 : r.entry - (r.sl - r.entry) * 2) : null;
  const tp2 = r.entry && r.sl ? (r.direction === 'long' ? r.entry + (r.entry - r.sl) * 3 : r.entry - (r.sl - r.entry) * 3) : null;

  const msg = `
*🚨 SMC TRADE SIGNAL — ${r.symbol}*
━━━━━━━━━━━━━━━━━━━━━
${dirEmoji} *Direction:* ${r.direction?.toUpperCase()} (${r.bias4H} 4H)
📊 *Confluence:* \`${r.confluence}/6\`
⏰ *Session:* ${r.session}
💰 *Price:* ${p(r.price)}
━━━━━━━━━━━━━━━━━━━━━
${r.pillars.p1 ? '✅' : '❌'} 4H Trend Aligned
${r.pillars.p2 ? '✅' : '❌'} Order Block Present
${r.pillars.p3 ? '✅' : '❌'} 15m BOS/CHOCH
${r.pillars.p4 ? '✅' : '❌'} Session Active
${r.pillars.p5 ? '✅' : '❌'} RRR ≥ 1:3
━━━━━━━━━━━━━━━━━━━━━
📌 *Entry:* ${p(r.entry)}
🛑 *Stop:* ${p(r.sl)}
🎯 *TP1:* ${p(tp1)}  *TP2:* ${p(tp2)}
⚖️ *RRR:* \`1:${r.rrr.toFixed(1)}\`
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
  else console.log(`[Telegram] Alert sent for ${r.symbol} ✅`);
}

// ── Main Scan Loop ─────────────────────────────────────────────
async function runAllScans() {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`\n[Scanner] Running SMC scan — ${now} IST`);

  for (const symbol of SYMBOLS) {
    try {
      const data   = await fetchAllTimeframes(symbol);
      const result = runScan(data, symbol);
      console.log(`  ${symbol}: ${result.decision} | Score: ${result.confluence}/6 | ${result.direction ?? 'neutral'} | ${result.session}`);
      if (result.decision === 'TAKE_TRADE') {
        console.log(`  🚨 TRADE CONFIRMED — Sending Telegram...`);
        await sendTelegram(result);
      }
      await new Promise(r => setTimeout(r, 1200)); // rate limit pause
    } catch (err) {
      console.error(`[Scanner] Error on ${symbol}:`, err.message);
    }
  }
  console.log('[Scanner] Scan complete. Next scan in 15 minutes.');
}

// ── Start ──────────────────────────────────────────────────────
console.log('[Worker] SMC Background Worker started — scanning every 15 minutes exactly.');
runAllScans(); // Run immediately on startup
setInterval(runAllScans, INTERVAL); // Then every 15 minutes, precisely
