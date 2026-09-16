// src/engine/core/analysisEngine.js

/**
 * Central analysis engine entry point.
 * Takes candle data and configuration, runs pattern detection,
 * confluence scoring, risk calculation and returns a comprehensive
 * analysis object compatible with the existing UI.
 */
import { DEFAULT_RISK_PERCENT, DEFAULT_RRR, DEFAULT_TIMEFRAMES, SCORE_WEIGHTS } from '../utils/constants.js';
import { detectPatterns } from './patternRecognizer.js';
import { scoreConfluence } from './confluenceScorer.js';
import { calculateRisk } from './riskCalculator.js';
import { getAIModules } from './aiModules.js';

export async function analyze(candles, userConfig = {}) {
  // Merge defaults with user overrides
  const config = {
    riskPercent: DEFAULT_RISK_PERCENT,
    rrr: DEFAULT_RRR,
    timeframes: DEFAULT_TIMEFRAMES,
    scoreWeights: SCORE_WEIGHTS,
    ...userConfig,
  };

  // 1️⃣ Pattern detection (SMC, OB, FVG, BOS, etc.)
  const patternResult = detectPatterns(candles, config.timeframes);

  // 2️⃣ Institutional confluence scoring
  const confluence = scoreConfluence(candles, patternResult, config.scoreWeights);

  // 3️⃣ AI / ML modules (weekly bias, market regime, etc.)
  const aiModules = await getAIModules(candles);

  // 4️⃣ Determine trade direction & entry levels
  const direction = confluence.direction; // could be 'long', 'short' or null
  const entryPrice = patternResult.entryPrice;
  const stopLoss = patternResult.stopLoss;
  const takeProfit = patternResult.takeProfit;

  // 5️⃣ Risk & position sizing
  const riskInfo = calculateRisk({
    equity: userConfig.equity || 1000, // fallback default
    riskPercent: config.riskPercent,
    rrr: config.rrr,
    direction,
    entryPrice,
    stopLoss,
  });

  // 6️⃣ Assemble final analysis object
  return {
    timestamp: Date.now(),
    candles,
    config,
    patternResult,
    confluence,
    aiModules,
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    riskInfo,
  };
}
