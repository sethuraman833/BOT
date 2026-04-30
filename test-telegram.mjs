// ─────────────────────────────────────────────────────────
//  Telegram Test — Run with: node test-telegram.mjs
//  Set your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID below
// ─────────────────────────────────────────────────────────

import https from 'https';

// ← FILL THESE IN:
const TOKEN   = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE';

if (TOKEN === 'YOUR_BOT_TOKEN_HERE' || CHAT_ID === 'YOUR_CHAT_ID_HERE') {
  console.error('❌  Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first!');
  console.error('   Run: $env:TELEGRAM_BOT_TOKEN="xxx"; $env:TELEGRAM_CHAT_ID="yyy"; node test-telegram.mjs');
  process.exit(1);
}

const msg = `✅ *TERMINUS — Connection Test*

🟢 Bot is alive and connected!
⏰ Time: ${new Date().toUTCString()}
📡 Scanner: Ready
🎯 Strategy: SMC Institutional v5.0

#test #terminus`;

const body = JSON.stringify({
  chat_id: CHAT_ID,
  text: msg,
  parse_mode: 'Markdown',
});

const options = {
  hostname: 'api.telegram.org',
  path:     `/bot${TOKEN}/sendMessage`,
  method:   'POST',
  headers:  {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    if (json.ok) {
      console.log('✅  Message sent successfully!');
      console.log(`   Chat ID : ${CHAT_ID}`);
      console.log(`   Msg ID  : ${json.result.message_id}`);
    } else {
      console.error('❌  Telegram API error:', json.description);
    }
  });
});

req.on('error', err => console.error('❌  Request failed:', err.message));
req.write(body);
req.end();
