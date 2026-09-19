/**
 * Trade Analyzer Engine
 * Institutional Grade Technical Analysis Engine with Multi-Timeframe Confluence
 */

import {
  detectOrderBlocks, detectBreakerBlocks, detectFVGs, detectSweeps, detectStructureShifts,
  calculateEMA, calculateSMA, calculateRSI, detectRSISmaCross, detectRSIDivergence,
  findSwingPoints, calculateVWAP, detectCandlePatterns, calculateFibonacci, isInGoldenPocket,
  calculateBollingerBands, calculateMACD, calculateStochRSI, calculateVolumeProfile,
  detectWyckoffPhase, calculateOBVDivergence, detectHiddenDivergence, getWeeklyOpenBias,
  validateDisplacement, classifyLiquidityLevels, detectInducement, assessChochQuality,
  classifyVolatilityRegime, identifyDrawOnLiquidity, detectEqualHighsLows, calculateSignalGrade
} from './smcDetector.js';

import { calculateOTE, isInOTE, calculatePremiumDiscount, isInDiscount, isInPremium } from './oteCalculator.js';
import { calculateSmartSL, calculateTPs, calculatePositionSize, calculateRRR, calculateBreakevenMove, calculateLeverage, estimateLiquidationPrice } from './riskManager.js';
import { getCurrentSession, getKillZone } from './sessionFilter.js';
import { detectCMEGaps, analyzeCMEGaps } from './cmeGapAnalyzer.js';
import { getFundingOISentiment } from './fundingRate.js';
import { RISK_AMOUNT, ASSETS, CHALLENGE_CONFIG } from '../utils/constants.js';
import { canTrade as challengeCanTrade, getChallengeStatus } from './challengeTracker.js';
import { computeRegime } from './marketRegime.js';

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────

/**
 * Calculates Wilder's 14-period ATR
 */
function calculateATR(candles, period = 14) {
  if (!candles || candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    ));
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * Calculates the dynamic minimum Stop Loss distance using ATR.
 */
function getMinSlDistance(atr, timeframe, symbol) {
  if (!atr) return 0;
  const tfMult = { '1m': 0.8, '5m': 1.0, '15m': 1.2, '1h': 1.5, '4h': 2.0, '1d': 2.5 }[timeframe] || 1.2;
  const symScale = { 'BTCUSDT': 1.0, 'ETHUSDT': 1.05, 'XAUUSDT': 1.15 }[symbol] || 1.0;
  return atr * tfMult * symScale;
}

// ─── TIMEFRAME PROFILES ──────────────────────────────────────────────────────

const PROFILES = {
  '1m': { primaryKey: '1m', structureKey: '5m', biasKey: '15m', riskAmount: 10, minRrr: 3.0, isScalping: true, label: 'Micro Scalp', modeColor: '#ff6b35' },
  '5m': { primaryKey: '5m', structureKey: '15m', biasKey: '1h', riskAmount: 10, minRrr: 3.0, isScalping: true, label: 'Scalp', modeColor: '#00d4ff' },
  '15m': { primaryKey: '15m', structureKey: '1h', biasKey: '4h', riskAmount: 10, minRrr: 3.0, isScalping: false, label: 'Intraday', modeColor: '#3b8ef0' },
  '1h': { primaryKey: '1h', structureKey: '4h', biasKey: '1d', riskAmount: 10, minRrr: 3.0, isScalping: false, label: 'Swing', modeColor: '#f7c948' },
  '4h': { primaryKey: '4h', structureKey: '1d', biasKey: '1w', riskAmount: 10, minRrr: 3.0, isScalping: false, label: 'Position', modeColor: '#9d6fff' },
  '1d': { primaryKey: '1d', structureKey: '1w', biasKey: '1w', riskAmount: 10, minRrr: 3.0, isScalping: false, label: 'Trend', modeColor: '#ff3f5e' },
};

// ─── REJECTION BUILDER ───────────────────────────────────────────────────────

/**
 * Builds a uniform NO_TRADE rejection result when execution cannot proceed.
 */
function buildRejection(decision, rejectionReason, steps, profile) {
  return {
    decision,
    rejectionReason,
    direction: null,
    entry: null,
    stopLoss: null,
    tpDetails: [],
    confluenceScore: { total: 0, max: 10, checks: [], aiConfidence: 0, aiGrade: 'LOW', tier: 'REJECT' },
    analysisSteps: [...steps, rejectionReason],
    analysisMode: profile?.label || 'Standard',
    primaryTimeframe: profile?.primaryKey || '15m',
    regimeContext: null,
    marketRegime: null,
    indicators: null,
    smcPillars: [],
    smcPillarsMet: 0,
    confluenceQuality: [],
    confluenceQualityMet: 0,
  };
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * Runs the full trading analysis engine.
 * @param {Object} allData - Market data keyed by timeframe.
 * @param {Object} config - Configuration including symbol, balance, newsStatus, activeTimeframe.
 * @returns {Promise<Object>} The comprehensive trade analysis result.
 */
export async function runAnalysis(allData, config = {}, regimeContext = null) {
  const { symbol = 'BTCUSDT', balance = 10000, newsStatus = { veto: false }, activeTimeframe = '15m' } = config;
  const profile = PROFILES[activeTimeframe] || PROFILES['15m'];
  let adjustedRiskAmount = profile.riskAmount;
  const steps = [];

  // ── Regime Gate (Hybrid Mode) ────────────────────────────────────
  // If regime context says don't trade, skip analysis entirely
  if (regimeContext !== null && !regimeContext.allowTrade) {
    return {
      decision: 'NO_TRADE',
      rejectionReason: `🌀 Regime: ${regimeContext.regime} — ${regimeContext.regime === 'CHAOTIC' ? 'Extreme volatility, no edge' : 'Market unclear, no tradeable setup'}`,
      confluenceScore: { total: 0, max: 10, checks: [], tier: 'REJECT' },
      analysisSteps: [`Regime Gate: ${regimeContext.regime} → NO_TRADE`],
      analysisMode: profile.label,
      primaryTimeframe: profile.primaryKey,
      regimeContext,
    };
  }

  // 1. Challenge Mode Guard
  if (CHALLENGE_CONFIG.enabled) {
    const tradeAllowed = challengeCanTrade();
    if (!tradeAllowed.allowed) {
      return buildRejection('NO_TRADE', `CHALLENGE GUARD: ${tradeAllowed.reason}`, steps, profile);
    }
  }

  // 2. News Veto
  if (newsStatus.veto) {
    return buildRejection('NO_TRADE', `ECONOMIC VETO: ${newsStatus.reason}`, steps, profile);
  }

  const candlesPrimary = allData[profile.primaryKey] || [];
  const candlesStructure = allData[profile.structureKey] || [];
  const candlesBias = allData[profile.biasKey] || [];
  const candles1d = allData['1d'] || [];
  const candles1h = allData['1h'] || [];

  // 3. Candle Validation
  if (candlesPrimary.length < 30) {
    return buildRejection('NO_TRADE', `Insufficient ${profile.primaryKey} data`, steps, profile);
  }
  const currentPrice = candlesPrimary[candlesPrimary.length - 1].close;

  // 4. ATR Calculation
  const primaryATR = calculateATR(candlesPrimary, 14);

  // 5. Daily Bias
  const ema200_1d = calculateEMA(candles1d.length > 200 ? candles1d : candlesBias, 200);
  const lastEma200_1d = ema200_1d[ema200_1d.length - 1];
  const dailyBias = lastEma200_1d ? (currentPrice > lastEma200_1d ? 'bullish' : 'bearish') : 'neutral';

  // 6. HTF Trend
  const swingsBias = findSwingPoints(candlesBias.length > 0 ? candlesBias : candlesPrimary, 5);
  const lastHighsBias = swingsBias.filter(s => s.type === 'high').slice(-2);
  const lastLowsBias = swingsBias.filter(s => s.type === 'low').slice(-2);
  let trendBias = 'ranging';
  if (lastHighsBias.length >= 2 && lastLowsBias.length >= 2) {
    if (lastHighsBias[1].price > lastHighsBias[0].price && lastLowsBias[1].price > lastLowsBias[0].price) trendBias = 'bullish';
    else if (lastHighsBias[1].price < lastHighsBias[0].price && lastLowsBias[1].price < lastLowsBias[0].price) trendBias = 'bearish';
  }

  // 7. EMA Stack
  const ema20_bias = calculateEMA(candlesBias.length > 0 ? candlesBias : candlesPrimary, 20);
  const ema50_bias = calculateEMA(candlesBias.length > 0 ? candlesBias : candlesPrimary, 50);
  const ema200_bias = calculateEMA(candlesBias.length > 0 ? candlesBias : candlesPrimary, 200);
  
  const e20b = ema20_bias[ema20_bias.length - 1];
  const e50b = ema50_bias[ema50_bias.length - 1];
  const e200b = ema200_bias[ema200_bias.length - 1];

  const prev20 = ema20_bias[Math.max(0, ema20_bias.length - 6)];
  const prev50 = ema50_bias[Math.max(0, ema50_bias.length - 6)];
  const prev200 = ema200_bias[Math.max(0, ema200_bias.length - 6)];
  
  const indicators = e20b ? {
    ema20: e20b, ema50: e50b, ema200: e200b,
    ema20_slope: prev20 > 0 ? ((e20b - prev20) / prev20) * 100 : 0,
    ema50_slope: prev50 > 0 ? ((e50b - prev50) / prev50) * 100 : 0,
    ema200_slope: prev200 > 0 ? ((e200b - prev200) / prev200) * 100 : 0,
  } : null;

  // 8. Market Regime
  const marketRegime = computeRegime(indicators, currentPrice);

  // 9. EMA Scalp Signal
  let emaSignalActive = false;
  let emaSignalType = null;
  if (profile.isScalping && candlesPrimary.length >= 50) {
    const ema20_p = calculateEMA(candlesPrimary, 20);
    const ema50_p = calculateEMA(candlesPrimary, 50);
    const p20 = ema20_p[ema20_p.length - 2], c20 = ema20_p[ema20_p.length - 1];
    const p50 = ema50_p[ema50_p.length - 2], c50 = ema50_p[ema50_p.length - 1];
    if (p20 <= p50 && c20 > c50) { emaSignalActive = true; emaSignalType = 'Bullish Cross'; }
    else if (p20 >= p50 && c20 < c50) { emaSignalActive = true; emaSignalType = 'Bearish Cross'; }
    else if (c20 > c50 && Math.abs(currentPrice - c20) / c20 < 0.002) { emaSignalActive = true; emaSignalType = 'Bullish Pullback'; }
    else if (c20 < c50 && Math.abs(currentPrice - c20) / c20 < 0.002) { emaSignalActive = true; emaSignalType = 'Bearish Pullback'; }
  }

  // 10. SMC Detection
  const obsPrimary = detectOrderBlocks(candlesPrimary, currentPrice) || [];
  const fvgsPrimary = detectFVGs(candlesPrimary, currentPrice) || [];
  const obsStructure = detectOrderBlocks(candlesStructure, currentPrice) || [];
  const fvgsStructure = detectFVGs(candlesStructure, currentPrice) || [];
  const allOBs = [...obsStructure, ...obsPrimary];
  const allFVGs = [...fvgsStructure, ...fvgsPrimary];
  
  const sweepsPrimary = detectSweeps(candlesPrimary, 0.001) || [];
  const allSweeps = [...sweepsPrimary];
  
  const shiftsPrimary = detectStructureShifts(candlesPrimary, 1) || [];
  const allShifts = [...shiftsPrimary];
  const lastShift = shiftsPrimary.length > 0 ? shiftsPrimary[shiftsPrimary.length - 1] : null;

  // 11. AI Modules
  const candlePatterns = detectCandlePatterns(candlesPrimary.slice(-10)) || [];
  const bollingerBands = calculateBollingerBands(candlesPrimary) || {};
  const macd = calculateMACD(candlesPrimary) || {};
  const stochRSI = calculateStochRSI(candlesPrimary) || {};
  const volumeProfile = calculateVolumeProfile(candlesPrimary.slice(-100)) || null;
  const wyckoffPhase = detectWyckoffPhase(candlesPrimary.slice(-60)) || {};
  const obvDivergence = calculateOBVDivergence(candlesPrimary) || {};
  const weeklyBias = getWeeklyOpenBias(candles1d.length > 7 ? candles1d : candlesPrimary, currentPrice) || {};

  // 12. Funding Rate
  let fundingSentiment = { sentiment: 'neutral', fundingRatePct: 0 };
  try { fundingSentiment = (await getFundingOISentiment(symbol)) || fundingSentiment; } catch (e) {}

  // 13. Institutional Modules
  const volatilityRegime = classifyVolatilityRegime(candlesPrimary) || { regime: 'NORMAL', sizingMultiplier: 1.0 };
  const equalHighsLows = detectEqualHighsLows(candlesPrimary, currentPrice) || { eqh: [], eql: [] };
  const liquidityLevels = classifyLiquidityLevels(candlesStructure, allFVGs, allOBs, currentPrice) || { erl: [], irl: [] };
  
  const dispValidation = lastShift ? validateDisplacement(candlesPrimary, lastShift.candleIndex) : { valid: false, score: 0, reason: 'No shift' };
  const chochQuality = assessChochQuality(candlesPrimary, allSweeps, 'neutral', lastShift ? lastShift.candleIndex : -1) || { quality: 'LOW', score: 0, reasons: [] };
  
  // 14. Session Check
  const session = getCurrentSession(symbol);
  const killZone = getKillZone();

  // 15. Direction Logic
  let direction = null;
  let upProb = 25, downProb = 25;
  
  if (trendBias === 'bullish' && dailyBias === 'bullish') { direction = 'long'; upProb = 75; downProb = 25; }
  else if (trendBias === 'bearish' && dailyBias === 'bearish') { direction = 'short'; upProb = 25; downProb = 75; }
  else if (trendBias === 'bullish') { direction = 'long'; upProb = 62; downProb = 38; }
  else if (trendBias === 'bearish') { direction = 'short'; upProb = 38; downProb = 62; }
  else { upProb = 25; downProb = 25; }

  let aiBullScore = (macd.bullCross ? 1 : 0) + (wyckoffPhase.signal === 'long' ? 1.5 : 0) + (obvDivergence.bullishDivergence ? 1 : 0) + (weeklyBias.bias === 'bullish' ? 1 : 0);
  let aiBearScore = (macd.bearCross ? 1 : 0) + (wyckoffPhase.signal === 'short' ? 1.5 : 0) + (obvDivergence.bearishDivergence ? 1 : 0) + (weeklyBias.bias === 'bearish' ? 1 : 0);
  
  if (!direction) {
    if (aiBullScore >= 2.5 && aiBullScore > aiBearScore * 2) { direction = 'long'; upProb = 55; downProb = 35; }
    else if (aiBearScore >= 2.5 && aiBearScore > aiBullScore * 2) { direction = 'short'; upProb = 35; downProb = 55; }
  }

  if (profile.isScalping && emaSignalActive && !direction) {
    if (emaSignalType?.includes('Bull')) { direction = 'long'; upProb = 58; downProb = 30; }
    else if (emaSignalType?.includes('Bear')) { direction = 'short'; upProb = 30; downProb = 58; }
  }

  // ── Strategy Mode from Regime Engine ─────────────────────────────────
  const strategyMode = regimeContext?.strategy || 'SMC_PURE';
  const regimeDirectionBias = regimeContext?.direction || null;

  // If regime strongly suggests direction and SMC is ranging, honour regime
  if (regimeContext?.allowTrade && regimeDirectionBias && !direction) {
    direction = regimeDirectionBias;
    upProb   = direction === 'long'  ? 58 : 42;
    downProb = direction === 'short' ? 58 : 42;
    steps.push(`🎯 Regime bias: ${direction.toUpperCase()} from ${regimeContext.regime} (confidence ${regimeContext.confidence}%)`);
  }

  // Strategy-specific structural requirements
  const requiresReversalCHoCH   = strategyMode === 'RANGE_REVERSAL';     // CHoCH, not just BOS
  const requiresContinuationBOS  = strategyMode === 'TREND_CONTINUATION'; // BOS in trend direction
  const requiresBreakoutConfirm  = strategyMode === 'BREAKOUT';           // volume + range close
  const requiresMomentumAlign    = strategyMode === 'MOMENTUM';           // CVD aligned
  steps.push(`📊 Strategy: ${strategyMode}`);

  let rangeProbability = !direction ? 50 : Math.max(0, 100 - upProb - downProb);
  const inducement = direction ? detectInducement(candlesPrimary, direction) : { hasInducement: false };
  const drawOnLiquidity = direction ? identifyDrawOnLiquidity(candlesStructure, direction, currentPrice, allFVGs, allOBs) : null;

  // 16. Fibonacci
  const htfHigh = swingsBias.filter(s => s.type === 'high').slice(-1)[0];
  const htfLow = swingsBias.filter(s => s.type === 'low').slice(-1)[0];
  let fibonacciData = null, inGoldenPocket = false;
  if (htfHigh && htfLow && direction) {
    fibonacciData = calculateFibonacci(htfHigh.price, htfLow.price, direction);
    inGoldenPocket = isInGoldenPocket(currentPrice, fibonacciData);
  }

  // 17. CME Gap
  const rawGaps = detectCMEGaps(candles1h.length > 20 ? candles1h : candlesPrimary, currentPrice) || [];
  const cmeGapData = analyzeCMEGaps(rawGaps, direction, trendBias, allOBs, currentPrice) || { hasUnfilledGaps: false };

  // 18. EMA Trend Veto
  let emaVetoActive = false;
  if (direction === 'long' && e50b && e200b && currentPrice < e50b && currentPrice < e200b && (!chochQuality || chochQuality.quality === 'LOW')) emaVetoActive = true;
  if (direction === 'short' && e50b && e200b && currentPrice > e50b && currentPrice > e200b && (!chochQuality || chochQuality.quality === 'LOW')) emaVetoActive = true;

  // 19. OTE Zone
  const swingsStructure = findSwingPoints(candlesStructure.length > 10 ? candlesStructure : candlesPrimary, 3);
  let oteZone = null, inOTEZone = false;
  if (direction === 'long') {
    const lows = swingsStructure.filter(s => s.type === 'low' && s.price < currentPrice).sort((a,b) => b.index - a.index);
    const highs = swingsStructure.filter(s => s.type === 'high' && s.price > (lows[0]?.price || 0)).sort((a,b) => b.index - a.index);
    if (lows[0] && highs[0] && lows[0].index < highs[0].index) oteZone = calculateOTE(highs[0].price, lows[0].price, 'long');
  } else if (direction === 'short') {
    const highs = swingsStructure.filter(s => s.type === 'high' && s.price > currentPrice).sort((a,b) => b.index - a.index);
    const lows = swingsStructure.filter(s => s.type === 'low' && s.price < (highs[0]?.price || Infinity)).sort((a,b) => b.index - a.index);
    if (highs[0] && lows[0] && highs[0].index < lows[0].index) oteZone = calculateOTE(highs[0].price, lows[0].price, 'short');
  }
  inOTEZone = isInOTE(currentPrice, oteZone);

  // 20. Entry/SL Logic
  let entry = currentPrice;
  let slData = null;
  let nearestOB = null;
  let leverage = 0, positionSize = 0, slSideInvalid = false;
  const isAsian = session.name?.toLowerCase().includes('asian');

  if (direction) {
    const activeOBs = allOBs.filter(o => o.status === 'active');
    nearestOB = direction === 'long'
      ? activeOBs.filter(o => o.type === 'demand' && currentPrice >= o.lowerBound).sort((a,b) => b.entryBoundary - a.entryBoundary)[0]
      : activeOBs.filter(o => o.type === 'supply' && currentPrice <= o.upperBound).sort((a,b) => a.entryBoundary - b.entryBoundary)[0];

    if (inOTEZone && oteZone) entry = currentPrice;
    else if (nearestOB && ((direction === 'long' && currentPrice <= nearestOB.entryBoundary) || (direction === 'short' && currentPrice >= nearestOB.entryBoundary))) entry = currentPrice;
    else if (nearestOB) entry = nearestOB.entryBoundary;

    const minSlDist = getMinSlDistance(primaryATR, activeTimeframe, symbol) * (isAsian ? 1.35 : 1.0);
    
    let inv = null;
    const relevantSweeps = direction === 'long'
      ? allSweeps.filter(s => (s.type === 'bearish' || s.direction === 'long') && s.wickExtreme !== undefined && s.wickExtreme < entry).sort((a,b) => b.candleIndex - a.candleIndex)
      : allSweeps.filter(s => (s.type === 'bullish' || s.direction === 'short') && s.wickExtreme !== undefined && s.wickExtreme > entry).sort((a,b) => b.candleIndex - a.candleIndex);
      
    if (relevantSweeps.length > 0) inv = relevantSweeps[0].wickExtreme;
    else if (lastShift && lastShift.candleIndex) {
      const c = candlesPrimary[lastShift.candleIndex];
      inv = direction === 'long' ? c.low : c.high;
    } else if (nearestOB) {
      inv = direction === 'long' ? nearestOB.lowerBound : nearestOB.upperBound;
    } else {
      const nearestSwings = direction === 'long' 
        ? swingsStructure.filter(s => s.type === 'low' && s.price < entry).sort((a,b) => b.price - a.price)
        : swingsStructure.filter(s => s.type === 'high' && s.price > entry).sort((a,b) => a.price - b.price);
      inv = nearestSwings[0]?.price || (direction === 'long' ? entry - minSlDist : entry + minSlDist);
    }

    if (direction === 'long' && inv >= entry) inv = entry - minSlDist;
    if (direction === 'short' && inv <= entry) inv = entry + minSlDist;
    if (direction === 'long' && entry - inv < minSlDist) inv = entry - minSlDist;
    if (direction === 'short' && inv - entry < minSlDist) inv = entry + minSlDist;

    // EMA200 SL Snap
    if (e200b && Math.abs(inv - e200b) / e200b < 0.005) {
      if (direction === 'long' && e200b < entry) inv = e200b * 0.999;
      if (direction === 'short' && e200b > entry) inv = e200b * 1.001;
    }

    slData = calculateSmartSL(inv, direction, allFVGs, symbol, fibonacciData, volumeProfile, primaryATR, 0);
    if (direction === 'long' && slData.value >= entry) slSideInvalid = true;
    if (direction === 'short' && slData.value <= entry) slSideInvalid = true;

    // 21. Risk Sizing
    if (!CHALLENGE_CONFIG.enabled) {
      adjustedRiskAmount *= (volatilityRegime.sizingMultiplier || 1.0);
      adjustedRiskAmount = Math.min(adjustedRiskAmount, RISK_AMOUNT);
    }
    
    if (cmeGapData.nearestGap && cmeGapData.nearestGap.distToGapPct < 3.0) {
      const opposing = (direction === 'long' && cmeGapData.nearestGap.direction === 'up') || (direction === 'short' && cmeGapData.nearestGap.direction === 'down');
      if (opposing) adjustedRiskAmount *= 0.5;
    }

    positionSize = !slSideInvalid ? calculatePositionSize(entry, slData.value, adjustedRiskAmount, symbol) : 0;
    leverage = (positionSize > 0 && entry > 0 && balance > 0) ? (positionSize * entry) / balance : 0;
  }

  // 22. Confluence Scoring
  const trend4HAligned = direction && ((direction === 'long' && trendBias === 'bullish') || (direction === 'short' && trendBias === 'bearish'));
  const dailyAligned = direction && ((direction === 'long' && dailyBias === 'bullish') || (direction === 'short' && dailyBias === 'bearish'));
  const liquidityEvent = allSweeps.some(s => s.direction === direction) || allFVGs.some(f => (direction === 'long' ? f.type === 'bullish' : f.type === 'bearish'));
  
  // Strategy-aware structure requirement
  let structureShift;
  if (requiresReversalCHoCH) {
    const hasChoch = allShifts.some(s =>
      s.type === 'CHOCH' && s.direction === (direction === 'long' ? 'bullish' : 'bearish')
    );
    structureShift = hasChoch;
    if (!hasChoch) steps.push(`⚠️ Range Reversal strategy: CHoCH required, not found`);
  } else {
    structureShift = allShifts.some(s =>
      s.direction === (direction === 'long' ? 'bullish' : 'bearish')
    );
  }

  const rsiDiv = detectRSIDivergence(candlesPrimary, direction || 'long', 14) || {};
  const rsiCross = detectRSISmaCross(candlesPrimary, 14, 14) || {};
  
  const checks = [
    { label: 'HTF Trend Aligned', met: !!trend4HAligned, weight: 1.5 },
    { label: 'Liquidity Sweep / FVG Fill', met: !!liquidityEvent, weight: 1.5 },
    { label: 'BOS/CHOCH Confirmed', met: !!structureShift, weight: 1.5 },
    { label: 'Near Valid Order Block', met: !!nearestOB, weight: 1.25 },
    { label: 'Near Breaker Block', met: detectBreakerBlocks(candlesPrimary, currentPrice).length > 0, weight: 1.25 },
    { label: 'Entry in OTE Zone', met: inOTEZone, weight: 1.0 },
    { label: 'Entry in Discount/Premium Zone', met: (htfHigh && htfLow && ((direction === 'long' && isInDiscount(currentPrice, calculatePremiumDiscount(htfHigh.price, htfLow.price))) || (direction === 'short' && isInPremium(currentPrice, calculatePremiumDiscount(htfHigh.price, htfLow.price))))), weight: 0.5 },
    { label: 'Fibonacci Golden Pocket', met: inGoldenPocket, weight: 1.5 },
    { label: 'Daily Bias Aligned EMA200', met: !!dailyAligned, weight: 1.0 },
    { label: 'EMA200 Acting as S/R', met: !!(e200b && Math.abs(currentPrice - e200b) / e200b < 0.005), weight: 0.75 },
    { label: 'VWAP Aligned', met: !!(direction && calculateVWAP(candlesPrimary) && ((direction === 'long' && currentPrice < calculateVWAP(candlesPrimary)) || (direction === 'short' && currentPrice > calculateVWAP(candlesPrimary)))), weight: 1.0 },
    { label: 'MACD Momentum Aligned', met: !!(direction && ((direction === 'long' && (macd.bullCross || macd.zeroLineBull)) || (direction === 'short' && (macd.bearCross || macd.zeroLineBear)))), weight: 1.25 },
    { label: 'Stochastic RSI Extreme', met: !!(direction && ((direction === 'long' && stochRSI.isOversold) || (direction === 'short' && stochRSI.isOverbought))), weight: 1.0 },
    { label: 'Bollinger Band Signal', met: !!(direction && ((direction === 'long' && bollingerBands.isBullWalk) || (direction === 'short' && bollingerBands.isBearWalk))), weight: 0.75 },
    { label: 'Wyckoff Phase Signal', met: !!(direction && wyckoffPhase.signal === direction), weight: 1.5 },
    { label: 'Volume POC Confluence', met: !!(volumeProfile && volumeProfile.isAtPOC && volumeProfile.isAtPOC(currentPrice)), weight: 1.25 },
    { label: 'Estimated CVD Aligned (Delta Proxy)', met: !!(regimeContext?.cvdAligned), weight: 0.75 },
    { label: 'RSI Divergence', met: !!rsiDiv.hasDivergence, weight: 1.0 },
    { label: 'RSI SMA Crossover', met: !!(direction && ((direction === 'long' && rsiCross.crossUp) || (direction === 'short' && rsiCross.crossDown))), weight: 0.5 },
    { label: 'OBV Smart Money Divergence', met: !!(direction && ((direction === 'long' && obvDivergence.bullishDivergence) || (direction === 'short' && obvDivergence.bearishDivergence))), weight: 1.0 },
    { label: 'Hidden Divergence', met: !!(direction && detectHiddenDivergence(candlesPrimary, direction).hasHiddenDiv), weight: 0.75 },
    { label: 'Candlestick Pattern Confirmed', met: !!(candlePatterns.some(p => p.direction === direction || p.direction === 'neutral')), weight: 1.0 },
    { label: 'Active Trading Session', met: session.status !== 'closed', weight: 0.75 },
    { label: 'Kill Zone Active', met: killZone.inKillZone, weight: 0.75 },
    { label: 'CME Gap Bias Aligned', met: !!(cmeGapData.gapFillBias && cmeGapData.gapFillBias === (direction === 'long' ? 'bullish' : 'bearish')), weight: 0.75 },
    { label: 'Funding Rate Contrarian Signal', met: !!(direction && ((direction === 'long' && fundingSentiment.sentiment === 'overleveraged_shorts') || (direction === 'short' && fundingSentiment.sentiment === 'overleveraged_longs'))), weight: 0.75 },
    { label: 'Weekly Open Bias Aligned', met: !!(weeklyBias.bias && weeklyBias.bias === (direction === 'long' ? 'bullish' : 'bearish')), weight: 0.75 },
    { label: 'Displacement Confirmed BOS/CHOCH', met: dispValidation.valid, weight: 1.5 },
    { label: 'Inducement Detected', met: inducement.hasInducement, weight: 1.25 },
    { label: 'CHOCH Quality HIGH+', met: chochQuality.quality === 'ELITE' || chochQuality.quality === 'HIGH', weight: 1.5 },
    { label: 'Draw on Liquidity Identified', met: !!(drawOnLiquidity && drawOnLiquidity.primary), weight: 1.0 },
    { label: 'Volatility Regime Optimal', met: volatilityRegime.regime === 'CONTRACTING' || volatilityRegime.regime === 'TRANSITIONING', weight: 0.75 },
    { label: 'Equal High/Low Liquidity Pool', met: !!(direction && ((direction === 'long' && equalHighsLows.eqh.length > 0) || (direction === 'short' && equalHighsLows.eql.length > 0))), weight: 1.0 }
  ];

  // 24. TP Calculation
  let tpData = null;
  let trailingTP = null;
  let tp1Rrr = 0;
  
  if (direction && slData && entry) {
    const swings = findSwingPoints(candlesStructure.length > 50 ? candlesStructure : candlesPrimary, 5);
    const tpPool = swings.filter(s => direction === 'long' ? s.type === 'high' && s.price > entry : s.type === 'low' && s.price < entry);
    
    if (cmeGapData.hasUnfilledGaps) {
      cmeGapData.unfilledGaps.forEach(g => {
        if ((direction === 'long' && g.direction === 'down' && g.fridayClose > entry) || (direction === 'short' && g.direction === 'up' && g.fridayClose < entry)) {
          tpPool.push({ price: g.fridayClose, type: direction === 'long' ? 'high' : 'low', reason: 'CME Gap Target' });
        }
      });
    }

    if (direction === 'long') equalHighsLows.eqh.filter(l => l.level > entry).forEach(l => tpPool.push({ price: l.level, type: 'high', reason: 'EQH' }));
    else equalHighsLows.eql.filter(l => l.level < entry).forEach(l => tpPool.push({ price: l.level, type: 'low', reason: 'EQL' }));

    tpData = calculateTPs(entry, slData.value, tpPool, allFVGs, direction, 'HIGH', session.name, 0.05, profile.primaryKey, profile.structureKey, profile.biasKey, profile.minRrr, symbol, fibonacciData, volumeProfile);
    
    if (tpData && tpData.tps && tpData.tps.length > 0) {
      tp1Rrr = tpData.tps[0].rrr;
      const tp1Dist = Math.abs(tpData.tps[0].level - entry);
      const actPrice = direction === 'long' ? entry + tp1Dist * 0.75 : entry - tp1Dist * 0.75;
      const trailAmt = primaryATR ? primaryATR * 1.5 : tp1Dist * 0.25;
      trailingTP = { activationPrice: actPrice, trailingAmount: trailAmt, callbackRate: (trailAmt / actPrice) * 100 };
    }
  }

  checks.push({ label: 'RRR >= 1:3 Structural', met: tp1Rrr >= profile.minRrr, weight: 1.5 });

  const preTotalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const preScoredWeight = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const aiConfidence = Math.round(Math.sqrt(preScoredWeight / preTotalWeight) * 100);

  // 23. PAKA Rules
  const smcPillars = [
    { label: 'BOS / CHoCH Confirmed',     met: !!structureShift },
    { label: 'Liquidity Sweep',            met: !!liquidityEvent },
    { label: 'Valid Order Block',          met: !!nearestOB },
    { label: 'Displacement Confirmed',     met: dispValidation.valid },
    { label: 'Draw on Liquidity',          met: !!(drawOnLiquidity && drawOnLiquidity.primary) },
  ];
  const smcPillarsMet = smcPillars.filter(p => p.met).length;

  const confluenceQualityChecks = [
    { label: 'HTF Trend Aligned',          met: !!trend4HAligned },
    { label: 'Golden Pocket / OTE',        met: inGoldenPocket || inOTEZone },
    { label: 'Momentum (MACD / StochRSI)', met: !!(macd.bullCross || macd.bearCross || stochRSI.isOversold || stochRSI.isOverbought) },
    { label: 'VWAP / Daily Bias',          met: !!(dailyAligned || (calculateVWAP(candlesPrimary) && true)) },
  ];
  const confluenceQualityMet = confluenceQualityChecks.filter(c => c.met).length;


  // 26. Signal Grade
  const signalGrade = calculateSignalGrade({
    chochQuality, displacementScore: dispValidation.score, hasSweep: allSweeps.length > 0, hasInducement: inducement.hasInducement,
    mtfAligned: trend4HAligned && dailyAligned, mtfPartial: trend4HAligned || dailyAligned, drawAligned: !!(drawOnLiquidity && drawOnLiquidity.primary),
    volatilityRegime: volatilityRegime.regime, rrrMet: tp1Rrr >= profile.minRrr, inOTE: inOTEZone, atPOC: !!(volumeProfile && volumeProfile.isAtPOC && volumeProfile.isAtPOC(currentPrice)), rsiCrossAligned: !!(direction && ((direction === 'long' && rsiCross.crossUp) || (direction === 'short' && rsiCross.crossDown)))
  }) || { grade: 'C', score: 50 };

  // 28. Decision Logic
  let decision = 'NO_TRADE', rejectionReason = null, waitCondition = null;
  const slPct = slData && entry ? Math.abs(entry - slData.value) / entry : 0;
  const checksMet = checks.filter(c => c.met).length;
  const checksPct = checks.length > 0 ? checksMet / checks.length : 0;

  let obstacles = [];
  if (direction && slData && entry) {
    const slDist = Math.abs(entry - slData.value);
    const tp3R = direction === 'long' ? entry + slDist * 3 : entry - slDist * 3;
    const htfOBs = obsStructure.filter(o => o.status === 'active');
    for (const ob of htfOBs) {
      const mid = (ob.high + ob.low) / 2;
      if (direction === 'long' && ob.type === 'supply' && mid > entry && mid < tp3R) obstacles.push(mid);
      else if (direction === 'short' && ob.type === 'demand' && mid < entry && mid > tp3R) obstacles.push(mid);
    }
  }

  if (!direction) rejectionReason = 'No direction';
  else if (emaVetoActive) rejectionReason = 'EMA veto active';
  else if (!slData) rejectionReason = 'No SL data';
  else if (slSideInvalid) rejectionReason = 'SL on wrong side';
  else if (requiresReversalCHoCH && !structureShift) rejectionReason = 'Range strategy requires CHoCH reversal';
  else if (smcPillarsMet < 3) rejectionReason = 'SMC pillars < 3/5';
  else if (confluenceQualityMet < 2) rejectionReason = 'Confluence quality < 2/4';
  else if (volatilityRegime && (primaryATR ? Math.abs(candlesPrimary[candlesPrimary.length-1].close - candlesPrimary[candlesPrimary.length-1].open) / primaryATR > 4.5 : false)) rejectionReason = 'Volatility spike';
  else if (slPct > 0.05) rejectionReason = 'SL% too wide';
  else if (leverage > 75) rejectionReason = 'Leverage > 75x';
  else if (tp1Rrr < profile.minRrr) {
    const veto = tpData?.rrrVeto;
    if (veto && veto.vetoed) {
      const nearest = veto.nearestTarget;
      const best    = veto.bestAvailable;
      const f = v => v != null ? Number(v).toFixed(ASSETS[symbol]?.decimals ?? 2) : '—';
      let msg = `✗ TP1 RRR insufficient\n`;
      msg += `  Entry: $${f(veto.entry)}  │  SL: $${f(veto.stopLoss)}  │  Risk: $${f(veto.risk)}\n`;
      if (nearest) msg += `  Nearest target: $${f(nearest.level)} (${nearest.reason}) → ${nearest.rrr}R  [need ${profile.minRrr}R]\n`;
      if (best && best !== nearest) msg += `  Best available: $${f(best.level)} (${best.reason}) → ${best.rrr}R\n`;
      msg += `  Required: ${profile.minRrr}R minimum`;
      rejectionReason = msg;
    } else {
      rejectionReason = `TP1 RRR ${tp1Rrr.toFixed(2)} < ${profile.minRrr} minimum`;
    }
  }
  else if (checksPct < 0.35 && signalGrade.grade !== 'A+' && signalGrade.grade !== 'A') rejectionReason = 'Confluence count < 35%';
  else if (aiConfidence < 40 && signalGrade.grade !== 'A+' && signalGrade.grade !== 'A') rejectionReason = 'AI confidence too low';
  else if (signalGrade.score < 55) rejectionReason = 'Signal grade score < 55';
  else if (obstacles.length > 0) rejectionReason = 'HTF obstacle blocks 1:3 path';
  else if (newsStatus.caution && signalGrade.grade !== 'A+') { decision = 'WAIT'; waitCondition = 'News caution - wait for A+'; }
  else if (direction && Math.abs(currentPrice - entry)/currentPrice > 0.01) { decision = 'WAIT'; waitCondition = 'Entry too far from price'; }
  else decision = 'TAKE_NOW';

  // ── Projected P&L (rounded to 2 dp) ─────────────────────────────────────
  const rawRisk = slData && entry && positionSize ? Math.abs(entry - slData.value) * positionSize : 0;
  const projectedLoss = parseFloat(rawRisk.toFixed(2));

  // Annotate each TP with its projected profit (positionSize × closePercent% × price move)
  const tpDetailsWithProfit = (tpData?.tps || []).map(tp => {
    if (!tp || !tp.level || !entry || !positionSize) return tp;
    const priceMove = Math.abs(tp.level - entry);
    const closeFrac = (tp.closePercent || 0) / 100;
    return { ...tp, projectedProfit: parseFloat((positionSize * closeFrac * priceMove).toFixed(2)) };
  });

  // ── SMC Analysis objects (used by sidebar) ─────────────────────────────
  const bosShift   = allShifts.find(s => s.type !== 'CHOCH' && s.direction === (direction === 'long' ? 'bullish' : 'bearish'));
  const chochShift = allShifts.find(s => s.type === 'CHOCH'  && s.direction === (direction === 'long' ? 'bullish' : 'bearish'));
  const lastSweep  = allSweeps.length > 0 ? allSweeps[allSweeps.length - 1] : null;
  const bestFVG    = allFVGs.find(f => direction === 'long' ? f.type === 'bullish' : f.type === 'bearish') || null;
  const structTarget = drawOnLiquidity?.primary
    ? { level: drawOnLiquidity.primary.level, description: drawOnLiquidity.primary.reason || 'Liquidity Draw' }
    : (tpData?.tps?.[0] ? { level: tpData.tps[0].level, description: 'Structural TP1' } : null);

  return {
    decision,
    strategyMode,
    regimeContext: regimeContext || null,
    direction,
    entry,
    stopLoss: slData,
    tpDetails: tpDetailsWithProfit,
    trailingTP,
    positionSize,
    projectedLoss,
    leverage,
    liquidationPrice: estimateLiquidationPrice(entry, direction, leverage),
    breakevenMove: slData ? calculateBreakevenMove(entry, slData.value, symbol) : 0,
    confluenceScore: { checks, aiConfidence, aiGrade: aiConfidence > 80 ? 'HIGH' : 'LOW' },
    session: session.name,
    upProbability: upProb,
    downProbability: downProb,
    rangeProbability,
    rejectionReason,
    waitCondition,
    newsCaution: !!newsStatus.caution,
    newsCautionReason: newsStatus.reason,
    keyRisk: rejectionReason || 'None',
    invalidationLevel: slData?.rawInvalidation || 0,
    analysisSteps: steps,
    oteZone,
    estimatedDuration: '4h',
    symbol,
    balance,
    timeCap: '12h',
    riskAmount: adjustedRiskAmount,
    analysisMode: profile.label,
    modeColor: profile.modeColor,
    primaryTimeframe: profile.primaryKey,
    isScalping: profile.isScalping,
    emaSignal: emaSignalActive ? emaSignalType : null,
    smcData: { orderBlocks: allOBs, breakerBlocks: detectBreakerBlocks(candlesPrimary, currentPrice), fvgs: allFVGs, sweeps: allSweeps, structureShifts: allShifts, vwap: calculateVWAP(candlesPrimary) },
    aiModules: { candlePatterns, bollingerBands, macd, stochRSI, volumeProfile, wyckoffPhase, obvDivergence, hiddenDivergence: detectHiddenDivergence(candlesPrimary, direction || 'long'), fibonacciData, fundingSentiment, weeklyBias },
    signalGrade,
    volatilityRegime: volatilityRegime.regime,
    inducement: inducement.hasInducement,
    chochQuality: chochQuality.quality,
    drawOnLiquidity: drawOnLiquidity ? drawOnLiquidity.primary : null,
    equalHighsLows,
    displacementScore: dispValidation.score,
    liquidityMap: liquidityLevels,
    premiumDiscountZones: (htfHigh && htfLow) ? calculatePremiumDiscount(htfHigh.price, htfLow.price) : null,
    killZone,
    cmeGapData,
    smcAnalysis: {
      bos:             bosShift   ? { confirmed: true,  level: bosShift.level,   type: bosShift.direction,   tf: profile.structureKey } : { confirmed: false },
      choch:           chochShift ? { confirmed: true,  level: chochShift.level, type: chochShift.direction, tf: profile.primaryKey  } : { confirmed: false },
      liquiditySweep:  lastSweep  ? { confirmed: true,  level: lastSweep.level,  direction: lastSweep.direction || (direction === 'long' ? 'low' : 'high') } : { confirmed: false },
      orderBlock:      nearestOB  ? { confirmed: true,  low: nearestOB.low,      high: nearestOB.high,  type: nearestOB.type || (direction === 'long' ? 'demand' : 'supply') } : { confirmed: false },
      fvg:             bestFVG    ? { confirmed: true,  lower: bestFVG.lower,    upper: bestFVG.upper,   type: bestFVG.type } : { confirmed: false },
      structuralTarget: structTarget,
      tp3R:            tpData?.tps?.[0]?.level || 0,
      tpAchievable:    obstacles.length === 0,
      tp4RAchievable:  obstacles.length === 0,
      obstacles,
      slLevel:         slData?.value,
    },
    marketRegime,
    indicators,
    smcPillars,
    smcPillarsMet,
    confluenceQuality: confluenceQualityChecks,
    confluenceQualityMet,
    challengeStatus: CHALLENGE_CONFIG.enabled ? getChallengeStatus() : null,
  };
}
