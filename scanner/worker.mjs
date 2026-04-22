// ─────────────────────────────────────────────────────────
//  SMC Background Worker — Render.com 24/7 Service
//  Runs a true setInterval() every 15 minutes, never misses.
//  Deploy as a "Background Worker" on Render.com free tier.
// ─────────────────────────────────────────────────────────

import http from 'http';
import { analyzeTrade } from '../src/engine/tradeAnalyzer.js';
import { calcPDHL, calcAsianRange, calcWeeklyOpen } from '../src/engine/smcLevels.js';

// ── Config ────────────────────────────────────────────────────
const SYMBOLS    = ['BTCUSDT', 'ETHUSDT', 'XAUUSDT'];
const TOKEN      = process.env.TELEGRAM_TOKEN  || '7692139204:AAFalwvSeYMunaY_T_zUqQn3rSRWhzo-8N4';
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID || '1068346212';
const BASE_REST  = 'https://fapi.binance.com';
const INTERVAL   = 15 * 60 * 1000; // 15 minutes in ms

let lastDailyContextReportSent = null;

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
    fetchKlines(symbol, '1d', 500),
    fetchKlines(symbol, '4h', 500),
    fetchKlines(symbol, '1h', 500),
    fetchKlines(symbol, '15m', 500),
    fetchKlines(symbol, '5m', 500),
  ]);
  return { daily, h4, h1, m15, m5 };
}

// ── Telegram ───────────────────────────────────────────────────
async function sendTelegramText(msg) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  });
  const json = await res.json();
  if (!json.ok) console.error('[Telegram] Error:', json.description);
}

async function sendTelegramSignal(symbol, analysis) {
  const r = analysis.steps.step15; // Trade setup
  const d = analysis.decision;
  
  const dirEmoji = r?.direction === 'long' ? '🟢' : '🔴';
  const cautionStr = d.action === 'CAUTION' ? '⚠️ *CAUTION (Reduced Confidence)*\n' : '';
  const p = (v, d = 2) => v != null ? `\`${parseFloat(v).toFixed(d)}\`` : '`—`';
  
  const tp1 = r?.takeProfits?.[0]?.level;
  const tp2 = r?.takeProfits?.[1]?.level || r?.takeProfits?.[0]?.level;

  let outlookText = '';
  if (Array.isArray(analysis.outlook)) {
    outlookText = analysis.outlook.map(bullet => `• ${bullet}`).join('\n');
  } else {
    outlookText = `• ${analysis.outlook || 'No specific narrative generated.'}`;
  }

  const msg = `
*🚨 SMC TRADE SIGNAL — ${symbol}*
━━━━━━━━━━━━━━━━━━━━━
${dirEmoji} *Direction:* ${r?.direction?.toUpperCase()}
📊 *Confluence Score:* \`${analysis.confluenceScore}/11\`
⏰ *Session:* ${analysis.steps.step8?.name || 'Asian/Unknown'}
${cautionStr}━━━━━━━━━━━━━━━━━━━━━
*Market Narrative:*
${outlookText}
━━━━━━━━━━━━━━━━━━━━━
📌 *Entry:* ${p(r?.entry)}
🛑 *Stop Loss:* ${p(r?.stopLoss?.final)}
🎯 *TP1:* ${p(tp1)}  *TP2:* ${p(tp2)}
⚖️ *RRR:* \`1:${r?.rrr?.toFixed(1)}\`
━━━━━━━━━━━━━━━━━━━━━
_${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST_
`.trim();

  await sendTelegramText(msg);
  console.log(`[Telegram] Alert sent for ${symbol} ✅`);
}

async function sendDailyContextReport(data) {
  const pdhl = calcPDHL(data.daily);
  const asian = calcAsianRange(data.h1);
  const weekly = calcWeeklyOpen(data.daily);
  const currentPrice = data.m15[data.m15.length - 1].close;

  const p = (v) => v != null ? `\`${parseFloat(v).toFixed(2)}\`` : '`—`';
  
  const msg = `
*🏦 BTC DAILY INSTITUTIONAL CONTEXT*
12:15 PM IST / 06:45 UTC Snapshot
━━━━━━━━━━━━━━━━━━━━━
💵 *Current Price:* ${p(currentPrice)}
📅 *Weekly Open:* ${p(weekly)}

*🎯 Daily Liquidity Targets (PDL/PDH)*
🔺 PDH: ${p(pdhl.pdh)}
🔻 PDL: ${p(pdhl.pdl)}

*🌏 Asian Session Range*
🔺 High: ${p(asian.high)}
🔻 Low: ${p(asian.low)}

_These levels act as strong magnets and sweep targets for the London/NY sessions today._
`.trim();

  await sendTelegramText(msg);
  console.log(`[Telegram] Daily Market Context Report sent! ✅`);
}

// ── Main Scan Loop ─────────────────────────────────────────────
async function runAllScans() {
  const now = new Date();
  const timeIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const hours = timeIST.getHours();
  const mins = timeIST.getMinutes();
  
  console.log(\`\\n[Scanner] Running Engine Pipeline — \${timeIST.toLocaleString('en-IN')} IST\`);

  // Check 12:15 PM IST Daily Context condition
  if (hours === 12 && mins >= 15 && mins < 30) {
    const todayStr = timeIST.toDateString();
    if (lastDailyContextReportSent !== todayStr) {
      console.log(\`[Scanner] Triggering 12:15 PM IST Daily Market Context report for BTC...\`);
      try {
        const btcData = await fetchAllTimeframes('BTCUSDT');
        await sendDailyContextReport(btcData);
        lastDailyContextReportSent = todayStr;
      } catch (err) {
        console.error('[Scanner] Failed to send context report:', err.message);
      }
    }
  }

  // Scan all pairs using the TRUE analysis engine
  for (const symbol of SYMBOLS) {
    try {
      const data     = await fetchAllTimeframes(symbol);
      const btcData  = symbol === 'BTCUSDT' ? data : await fetchAllTimeframes('BTCUSDT');
      
      const analysis = await analyzeTrade(data, symbol, 2, 'm15', btcData);
      const action   = analysis.decision?.action;

      console.log(\`  \${symbol}: \${action} | Score: \${analysis?.confluenceScore || 0}/11\`);
      
      if (action === 'TAKE_TRADE' || action === 'CAUTION') {
        // Double check setup is valid before sending
        if (analysis.steps.step15?.entry && analysis.steps.step15?.stopLoss) {
          console.log(\`  🚨 \${action} CONFIRMED — Sending Telegram...\`);
          await sendTelegramSignal(symbol, analysis);
        }
      }
      
      await new Promise(r => setTimeout(r, 1500)); // rate limit pause
    } catch (err) {
      console.error(\`[Scanner] Error on \${symbol}:\`, err.message);
    }
  }
}

// ── Start ──────────────────────────────────────────────────────
console.log('[Worker] Advanced Engine Worker started — scanning every 15 minutes.');
runAllScans(); // Run immediately on startup
setInterval(runAllScans, INTERVAL); // Then every 15 minutes, precisely
