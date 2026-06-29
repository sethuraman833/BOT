// ─────────────────────────────────────────────────────────
//  Telegram Bot v6 — Message Dispatch + Formatting
// ─────────────────────────────────────────────────────────

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';

// Programmatic .env loader for local development
const possiblePaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '..', '.env'),
  path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')), '.env'),
  path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')), '..', '.env'),
];

for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && !process.env[key]) {
          process.env[key] = val.replace(/^["']|["']$/g, '');
        }
      });
      break;
    } catch (err) {
      // silent fallback
    }
  }
}

const token  = process.env.TELEGRAM_BOT_TOKEN || '7692139204:AAFalwvSeYMunaY_T_zUqQn3rSRWhzo-8N4';
const chatId = process.env.TELEGRAM_CHAT_ID || '1068346212';
let bot = null;

if (token && chatId) {
  bot = new TelegramBot(token, { polling: false });
  console.log('[TELEGRAM] Bot initialized');
} else {
  console.warn('[TELEGRAM] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — notifications disabled');
}

export async function sendTradeAlert(analysis) {
  if (!bot || !chatId) return;

  const {
    symbol, direction, entry, stopLoss, tpDetails,
    positionSize, breakevenMove, confluenceScore,
    session, keyRisk, invalidationLevel, aiAnalysis,
    upProbability, downProbability, waitCondition, decision,
    balance, timeCap, riskAmount
  } = analysis;

  const slPct   = entry && stopLoss?.value ? ((Math.abs(entry - stopLoss.value) / entry) * 100).toFixed(2) : '?';
  const isWait  = decision === 'WAIT';

  // Direction emoji
  const dirEmoji = direction === 'long' ? '🟢 LONG' : '🔴 SHORT';

  // Confluence colour
  const confEmoji = confluenceScore.total >= 8 ? '🔥' : confluenceScore.total >= 6 ? '✅' : '⚠️';

  // AI section (optional)
  const aiSection = aiAnalysis
    ? `\n🧠 *AI OPINION*\nVerdict  : ${aiAnalysis.decision}\nReasoning: ${aiAnalysis.reasoning}\n`
    : '';

  const header = isWait
    ? `⏳ *WATCH SETUP — ${symbol}*`
    : `🚨 *HIGH-PROBABILITY SETUP — ${symbol}*`;

  const waitNote = isWait
    ? `\n⏳ _${waitCondition}_\n`
    : '';

  // TP Lines from tpDetails
  let tpLines = '';
  let isMultiple = tpDetails && tpDetails.length >= 3;
  if (tpDetails && Array.isArray(tpDetails)) {
    tpDetails.forEach((tp, i) => {
      tpLines += `🎯 TP${i + 1}       : $${tp.level?.toFixed(2)} (Close ${tp.closePercent}%) → RRR 1:${tp.rrr?.toFixed(1)}\n`;
    });
  }

  // Management and Exit Rules Section
  let managementRules = `
📋 *TRADE MANAGEMENT*
• BE Trigger: Move SL to Entry at 1.5R ($${breakevenMove?.toFixed(2)})
`;
  if (isMultiple) {
    managementRules += `• TP1: Close 40%, Move SL to BE
• TP2: Close 35%, Trail SL to TP1 ($${tpDetails[0].level?.toFixed(2)})
• TP3: Close 25% (Terminal exit)
`;
  } else {
    managementRules += `• Exit target: Close 100% (Single TP)
`;
  }
  managementRules += `⚠️ *Early Exit Overrides*:
- Close 100% if 2 consecutive 15m candles close against trade
- Close 100% if 15m structure breaks (closes past HL/LH)
- After ${timeCap || '6H'}: if in profit close 50% & BE, if flat/stalled close 100%
`;

  // CME Gap section (if data available)
  let cmeSection = '';
  if (analysis.cmeGapData && analysis.cmeGapData.hasUnfilledGaps) {
    const nearest = analysis.cmeGapData.nearestGap;
    cmeSection = `\n📊 *CME GAP*\n`;
    cmeSection += `${nearest.direction === 'up' ? '⬆' : '⬇'} Gap $${nearest.gapLower.toFixed(0)}–$${nearest.gapUpper.toFixed(0)} (${nearest.gapPct.toFixed(1)}%)\n`;
    cmeSection += `Fill: ${nearest.fillProbability}% ${nearest.fillTier}\n`;
    if (analysis.cmeGapData.gapFillBias) {
      cmeSection += `Bias: ${analysis.cmeGapData.gapFillBias === 'bullish' ? '↑ Bullish' : '↓ Bearish'}\n`;
    }
  }

  const msg = `${header}
${waitNote}
${dirEmoji} | Confluence ${confEmoji} ${confluenceScore.total}/10 (${confluenceScore.tier})
Session   : ${session?.name || 'N/A'}
Probability: ↑${upProbability}% ↓${downProbability}%

📍 Entry     : $${entry?.toFixed(2)}
🛑 Stop Loss : $${stopLoss?.value?.toFixed(2)} (${slPct}% risk)
${tpLines}
${managementRules}
${aiSection}${cmeSection}
📦 Size      : ${positionSize?.toFixed(4)} units
💰 Max Risk  : $${(riskAmount || 5).toFixed(2)} USDT
⚡ Breakeven : $${breakevenMove?.toFixed(2)}

⚠️ Key Risk  : ${keyRisk}
❌ Invalidate: ${invalidationLevel}

#${symbol} #SMC #InstitutionalSetup`;

  try {
    await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    console.log(`[TELEGRAM] Alert sent for ${symbol} — ${decision}`);
  } catch (err) {
    console.error('[TELEGRAM] Send failed:', err.message);
  }
}

export async function sendDailyContext(text) {
  if (!bot || !chatId) return;
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    console.log('[TELEGRAM] Daily context sent');
  } catch (err) {
    console.error('[TELEGRAM] Daily context send failed:', err.message);
  }
}
