// ─────────────────────────────────────────────────────────
//  Telegram Bot — Message Dispatch + Formatting
// ─────────────────────────────────────────────────────────

import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_BOT_TOKEN;
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
  const { symbol, direction, entry, stopLoss, tp1, tp2, tp3, rrr, positionSize, breakevenMove, confluenceScore, session, keyRisk, invalidationLevel } = analysis;

  const slPct = entry && stopLoss?.value ? ((Math.abs(entry - stopLoss.value) / entry) * 100).toFixed(2) : '?';

  const aiSection = analysis.aiAnalysis ? `
🧠 *AI SECOND OPINION*
Status  : ${analysis.aiAnalysis.decision}
Reason  : ${analysis.aiAnalysis.reasoning}
` : '';

  const msg = `🚨 *HIGH PROBABILITY SETUP — ${symbol}*

Direction : ${direction?.toUpperCase() || '—'}
Confluence: ${confluenceScore.total} / ${confluenceScore.max} ⭐
Session   : ${session.name}

📍 Entry     : $${entry?.toFixed(2)}
🛑 Stop Loss : $${stopLoss?.value?.toFixed(2)} (${slPct}% risk)
🎯 TP1       : $${tp1?.toFixed(2)} → RRR 1:${rrr.tp1?.toFixed(1)}
🎯 TP2       : $${tp2?.toFixed(2) || '—'} → RRR 1:${rrr.tp2?.toFixed(1) || '—'}
🎯 TP3       : $${tp3?.toFixed(2) || '—'} → RRR 1:${rrr.tp3?.toFixed(1) || '—'}
${aiSection}
📦 Size      : ${positionSize?.toFixed(4)}
💰 Max Risk  : $5.00
⚡ Breakeven : $${breakevenMove?.toFixed(2)}

⚠️ Key Risk  : ${keyRisk}
❌ Invalidate: ${invalidationLevel}

#${symbol} #SMC #InstitutionalSetup`;

  try {
    await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    console.log(`[TELEGRAM] Alert sent for ${symbol}`);
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
