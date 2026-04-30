

import { sendTradeAlert } from './telegramBot.mjs';
import { getAiSecondOpinion } from './aiAgent.mjs';

const mockAnalysis = {
  symbol: 'BTCUSDT',
  direction: 'short',
  entry: 76300,
  stopLoss: { value: 76680 },
  tp1: 74950,
  tp2: null,
  tp3: null,
  rrr: { tp1: 3.55, tp2: null, tp3: null },
  positionSize: 0.0131,
  breakevenMove: 75730,
  confluenceScore: { total: 10, max: 11 },
  session: { name: 'London-NY Overlap' },
  keyRisk: 'Bull break above 77,100',
  invalidationLevel: 'Close above 76,680 (supply OB boundary)',
  analysisSteps: [
    "Step 1 — Daily Bias: BEARISH (Price below Daily EMA200)",
    "Step 2 — 4H Trend: BEARISH (LH/LL)",
    "Step 3 — EMA Stack: Bearish (20<50<200)",
    "Step 10 — OTE Zone: 76247 – 76622 | Price in OTE: YES"
  ]
};

console.log('Requesting AI Second Opinion...');
const aiResponse = await getAiSecondOpinion(mockAnalysis);
mockAnalysis.aiAnalysis = aiResponse;

console.log('AI Response:', aiResponse);
console.log('Sending trade alert with AI analysis...');
await sendTradeAlert(mockAnalysis);
console.log('Done! Check your Telegram.');
process.exit(0);
