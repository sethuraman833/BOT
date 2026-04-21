// ─────────────────────────────────────────────────────────
//  Telegram Notification Service
//  Sends analysis results to your Telegram bot
// ─────────────────────────────────────────────────────────

const TOKEN = '7692139204:AAFalwvSeYMunaY_T_zUqQn3rSRWhzo-8N4';
const CHAT_ID = '1068346212';
const API_URL = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

/**
 * Send a message via Telegram bot.
 * @param {string} text - Markdown text to send
 */
async function sendMessage(text) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('[Telegram] Send failed:', err);
    }
  } catch (e) {
    console.error('[Telegram] Network error:', e);
  }
}

/**
 * Format and send the full analysis result to Telegram.
 * @param {Object} analysis - The result from runAnalysis()
 * @param {string} symbol   - e.g. 'BTCUSDT'
 * @param {number} riskAmount
 */
export async function notifyAnalysisResult(analysis, symbol, riskAmount) {
  if (!analysis) return;

  const { decision, confluenceScore, direction, tradeSetup, steps, outlook } = analysis;

  const dirEmoji = direction === 'long' ? '🟢' : direction === 'short' ? '🔴' : '⚪';
  const decisionEmoji = decision.icon || '📊';

  // Build trade levels block
  let levelsBlock = '';
  if (tradeSetup?.valid) {
    levelsBlock = `
📌 *Entry:* \`${tradeSetup.entry?.toFixed(2)}\`
🛑 *Stop Loss:* \`${tradeSetup.stopLoss?.final?.toFixed(2)}\`
🎯 *TP1:* \`${tradeSetup.takeProfits?.[0]?.level?.toFixed(2) ?? '—'}\`
🎯 *TP2:* \`${tradeSetup.takeProfits?.[1]?.level?.toFixed(2) ?? '—'}\`
⚖️ *RRR:* \`1:${tradeSetup.rrr?.toFixed(1)}\`
💰 *Position Size:* \`${tradeSetup.positionSize} units\``;
  }

  // Pillar summary
  const pillarStatus = (met) => met ? '✅' : '❌';
  const cf = analysis.confluenceFactors || {};
  const pillars = `
${pillarStatus(cf.pillar1?.met)} 4H Trend Aligned
${pillarStatus(cf.pillar2?.met)} Liquidity Event
${pillarStatus(cf.pillar3?.met)} 15m BOS/CHOCH
${pillarStatus(cf.pillar4?.met)} Session Active
${pillarStatus(cf.pillar5?.met)} RRR ≥ 1:3`;

  const message = `
*SMC Trading Bot — Analysis Alert* 🤖
━━━━━━━━━━━━━━━━━━━━━
*Symbol:* \`${symbol}\`
*Direction:* ${dirEmoji} ${direction?.toUpperCase() ?? 'NEUTRAL'}
*Decision:* ${decisionEmoji} \`${decision.action}\`
*Confluence:* \`${confluenceScore}/11\` — ${steps.step10?.rating ?? '—'}
*Session:* ${steps.step8?.name ?? '—'}
*Risk Amount:* $${riskAmount}
━━━━━━━━━━━━━━━━━━━━━
*5 Pillars:*${pillars}
${levelsBlock ? `━━━━━━━━━━━━━━━━━━━━━\n*Trade Levels:*${levelsBlock}` : ''}
━━━━━━━━━━━━━━━━━━━━━
*📡 Outlook:*
_${outlook ?? 'No outlook available.'}_
━━━━━━━━━━━━━━━━━━━━━
_${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST_
`.trim();

  await sendMessage(message);
}
