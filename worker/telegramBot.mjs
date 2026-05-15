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
    balance
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
  if (tpDetails && Array.isArray(tpDetails)) {
    tpDetails.forEach((tp, i) => {
      tpLines += `🎯 TP${i + 1}       : $${tp.level?.toFixed(2)} → RRR 1:${tp.rrr?.toFixed(1)}\n`;
    });
  }

  const msg = `${header}
${waitNote}
${dirEmoji} | Confluence ${confEmoji} ${confluenceScore.total}/10 (${confluenceScore.tier})
Session   : ${session?.name || 'N/A'}
Probability: ↑${upProbability}% ↓${downProbability}%

📍 Entry     : $${entry?.toFixed(2)}
🛑 Stop Loss : $${stopLoss?.value?.toFixed(2)} (${slPct}% risk)
${tpLines}
${aiSection}
📦 Size      : ${positionSize?.toFixed(4)} units
💰 Max Risk  : 1% ($${((balance || 10000) * 0.01).toFixed(2)})
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
