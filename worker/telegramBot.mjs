// ─────────────────────────────────────────────────────────
//  Telegram Bot v6 — Message Dispatch + Formatting
// ─────────────────────────────────────────────────────────

import TelegramBot from 'node-telegram-bot-api';

const token  = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
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

  const msg = `${header}
${waitNote}
${dirEmoji} | Confluence ${confEmoji} ${confluenceScore.total}/10 (${confluenceScore.tier})
Session   : ${session?.name || 'N/A'}
Probability: ↑${upProbability}% ↓${downProbability}%

📍 Entry     : $${entry?.toFixed(2)}
🛑 Stop Loss : $${stopLoss?.value?.toFixed(2)} (${slPct}% risk)
${tpLines}
${managementRules}
${aiSection}
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
