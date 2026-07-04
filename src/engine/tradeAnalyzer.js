// ─────────────────────────────────────────────────────────
//  Trade Analyzer v10.0 — Premium/Discount, VWAP, Kill Zones,
//                        Breaker Blocks, Volume-Weighted OBs
//
//  Bug fixes in this version:
//  #1  TP spacing: anchors 3x/5x/7x (was 3x/3.5x/4x → near-identical)
//  #2  TP candidates: multi-TF swings (primary+structure+bias) as pool
//  #3  downProbability: was `100-upProb` (wrong for shorts) → `downProb`
//  #4  CANDLE_LIMIT: 500 → 1500 (Binance Futures maximum)
//  #5  maxTpPct: per-TF profile passed to calculateTPs
//  #6  OTE temporal guard: high must precede low in time
//  #7  Ranging probability: properly calculated (not hardcoded 0)
// ─────────────────────────────────────────────────────────

import {
  detectOrderBlocks, detectFVGs, detectSweeps, detectStructureShifts,
  calculateEMA, calculateRSI, detectRSIDivergence, findSwingPoints,
  detectBreakerBlocks, calculateVWAP,
  // ── NEW AI Modules ──────────────────────────────────────────
  detectCandlePatterns, calculateFibonacci, isInGoldenPocket,
  calculateBollingerBands, calculateMACD, calculateStochRSI,
  calculateVolumeProfile, detectWyckoffPhase,
  calculateOBVDivergence, detectHiddenDivergence, getWeeklyOpenBias,
} from './smcDetector.js';
import { calculateOTE, isInOTE, calculatePremiumDiscount, isInDiscount, isInPremium } from './oteCalculator.js';
import {
  calculateSmartSL, calculateTPs, calculatePositionSize,
  calculateRRR, calculateBreakevenMove, calculateLeverage,
  estimateLiquidationPrice
} from './riskManager.js';
import { getCurrentSession, isSessionValid, getKillZone } from './sessionFilter.js';
import { detectCMEGaps, analyzeCMEGaps } from './cmeGapAnalyzer.js';
import { getFundingOISentiment } from './fundingRate.js';
import { RISK_AMOUNT, ASSETS } from '../utils/constants.js';

// ─── ATR-BASED MINIMUM SL DISTANCE ────────────────────────
// Computes the minimum SL distance as a multiple of ATR,
// calibrated per-symbol and per-timeframe for realistic
// volatility-adjusted protection. Never a flat percentage.
//
// atrMultiplier per TF:
//   5m  → 1.0x ATR  (tight scalp — only 1 ATR of breathing room)
//   15m → 1.2x ATR
//   1h  → 1.5x ATR
//   4h  → 2.0x ATR
//   1d  → 2.5x ATR
//
// Symbol category overrides (low-value alts need wider ATR mult):
//   XRP, ADA → ×1.2 scale (wider spread, more erratic moves)
//   LINK     → ×1.1 scale
const ATR_TF_MULT = {
  '5m': 1.0, '15m': 1.2, '1h': 1.5, '4h': 2.0, '1d': 2.5,
};
const ATR_SYMBOL_SCALE = {
  BTCUSDT: 1.0,   // BTC — tight, liquid
  ETHUSDT: 1.05,  // ETH — slightly more volatile than BTC
  XAUUSDT: 1.15,  // Gold — wider spreads, erratic moves
};

function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low  - p.close)
    ));
  }
  // Simple RMA (Wilder) seed
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function formatLimitPrice(price, symbol) {
  const decimals = (symbol && ASSETS[symbol]) ? ASSETS[symbol].decimals : 2;
  return `$${price.toFixed(decimals)}`;
}

/**
 * Compute dynamic minimum SL distance for a symbol+timeframe combination.
 * Returns an absolute price distance (not a percentage).
 */
function computeMinSlDistance(candlesPrimary, entry, activeTimeframe, symbol) {
  const atr = calculateATR(candlesPrimary, 14);
  if (!atr || atr <= 0) {
    // Fallback: 0.25% of entry if no ATR data
    return entry * 0.0025;
  }
  const tfMult     = ATR_TF_MULT[activeTimeframe] ?? 1.2;
  const symScale   = ATR_SYMBOL_SCALE[symbol]     ?? 1.0;
  return atr * tfMult * symScale;
}

// ─── TIMEFRAME PROFILES ────────────────────────────────────────
// Each profile defines the full analysis context for that timeframe.
const TF_PROFILES = {
  '5m': {
    label:               '5m Scalping',
    modeColor:           '#00d4ff',
    primaryKey:          '5m',
    structureKey:        '15m',
    biasKey:             '1h',
    obKey:               '1h',
    swingLookback:       3,     // raised from 2 to filter micro-swing noise (requires 15min confirmation per side)
    minAiConfidence:     40, // AI Confidence % threshold for TAKE_NOW
    maxSlPct:            0.015,  // 1.5% max SL for scalping
    maxTpPct:            0.030,  // 3.0% window — wide enough for minRRR=3.0 with SLs up to ~1% (targets hit in 4-6h)
    maxEntryDist:        0.003,  // 0.3% max entry distance
    sweepThreshold:      0.0008,
    hasEmaSignal:        true,
    sessionAllowNyClose: true,
    isScalping:          true,
    timeCap:             '4H',
    riskAmount:          5,     // Set back to $5 to align with uniform risk rules
    minRrr:              3.0,   // Capped min RRR at 1:3 as explicitly requested
    minShiftAge:         2,     // BOS/CHOCH must hold for 2 closed candles (10min) before counting
  },
  '15m': {
    label:               '15m Intraday',
    modeColor:           '#3b8ef0',
    primaryKey:          '15m',
    structureKey:        '1h',
    biasKey:             '4h',
    obKey:               '4h',
    swingLookback:       3,
    minAiConfidence:     45, // AI Confidence % threshold for TAKE_NOW
    maxSlPct:            0.020,  // 2% max SL
    maxTpPct:            0.07,   // 7% max TP range
    maxEntryDist:        0.005,  // 0.5% max entry distance
    sweepThreshold:      0.0012,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '6H',
    riskAmount:          5,
    minRrr:              3.0,
    minShiftAge:         1,     // BOS/CHOCH confirmation (H6)
  },
  '1h': {
    label:               '1H Swing',
    modeColor:           '#f7c948',
    primaryKey:          '1h',
    structureKey:        '4h',
    biasKey:             '1d',
    obKey:               '4h',
    swingLookback:       3,
    minAiConfidence:     50, // AI Confidence % threshold for TAKE_NOW
    maxSlPct:            0.025,
    maxTpPct:            0.12,   // 12% max TP range
    maxEntryDist:        0.010,  // 1.0% max entry distance
    sweepThreshold:      0.0015,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '24H',
    riskAmount:          5,
    minRrr:              3.0,
    minShiftAge:         1,     // BOS/CHOCH confirmation (H6)
  },
  '4h': {
    label:               '4H Position',
    modeColor:           '#9d6fff',
    primaryKey:          '4h',
    structureKey:        '1d',
    biasKey:             '1w',
    obKey:               '1d',
    swingLookback:       5,
    minAiConfidence:     50, // AI Confidence % threshold for TAKE_NOW
    maxSlPct:            0.030,
    maxTpPct:            0.20,   // 20% max TP range
    maxEntryDist:        0.020,  // 2.0% max entry distance
    sweepThreshold:      0.0015,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '48H',
    riskAmount:          5,
    minRrr:              3.0,
    minShiftAge:         1,     // BOS/CHOCH confirmation (H6)
  },
  '1d': {
    label:               '1D Trend',
    modeColor:           '#ff3f5e',
    primaryKey:          '1d',
    structureKey:        '1w',
    biasKey:             '1w',
    obKey:               '1w',
    swingLookback:       7,
    minAiConfidence:     40, // AI Confidence % threshold for TAKE_NOW
    maxSlPct:            0.050,
    maxTpPct:            0.30,
    maxEntryDist:        0.030,  // 3.0% max entry distance
    sweepThreshold:      0.002,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '5D',
    riskAmount:          5,
    minRrr:              3.0,
    minShiftAge:         1,     // BOS/CHOCH confirmation (H6)
  },
};

/**
 * Tag swing points with the timeframe they came from,
 * so the TP engine can label them properly.
 */
function tagSwings(swings, tfLabel) {
  return swings.map(s => ({ ...s, tfLabel }));
}

export async function runAnalysis(allData, config = {}) {
  const {
    symbol          = 'BTCUSDT',
    balance         = 10000,
    newsStatus      = { veto: false },
    activeTimeframe = '15m',
  } = config;

  const profile = TF_PROFILES[activeTimeframe] || TF_PROFILES['15m'];
  const riskAmount = profile.riskAmount || RISK_AMOUNT;
  const steps   = [];
  steps.push(`Engine v10.0 | ${profile.label} | ${symbol}`);
  
  let slSideInvalid = false; // H2 validation flag declared early
  let adjustedRiskAmount = riskAmount; // C5: hoisted to outer scope for return object

  // ── Kill Zone detection ────────────────────────────────────────────
  const killZone = getKillZone();
  if (killZone.inKillZone) {
    steps.push(`⚡ Active Kill Zone: ${killZone.killZoneName}`);
  }

  // ── News veto ──────────────────────────────────────────────────
  if (newsStatus.veto) {
    return {
      decision: 'NO_TRADE',
      rejectionReason: `ECONOMIC VETO: ${newsStatus.reason}`,
      confluenceScore: { total: 0, max: 10, checks: [], tier: 'REJECT' },
      analysisSteps:   [`Vetoed: ${newsStatus.reason}`],
      analysisMode:    profile.label,
      primaryTimeframe: profile.primaryKey,
    };
  }

  // ── Candle sets ────────────────────────────────────────────────
  const candlesPrimary   = allData[profile.primaryKey]   || [];
  const candlesStructure = allData[profile.structureKey] || [];
  const candlesBias      = allData[profile.biasKey]      || [];
  const candlesOB        = allData[profile.obKey]        || [];
  const candles1d        = allData['1d']                 || [];
  const candles1h        = allData['1h']                 || [];

  const candlesForBias = candlesBias.length > 20   ? candlesBias
    : candlesStructure.length > 20                 ? candlesStructure
    : candlesPrimary;
  const candlesForOB   = candlesOB.length  > 20   ? candlesOB : candlesStructure;

  if (candlesPrimary.length < 30) {
    return {
      decision: 'NO_TRADE', direction: null,
      rejectionReason: `Insufficient ${profile.primaryKey} data (${candlesPrimary.length} candles)`,
      analysisSteps:   ['ERROR: Not enough primary candle data.'],
      confluenceScore: { total: 0, max: 10, checks: [], pillarsAllMet: false, pillarsMet: 0, pillarsTotal: 5, tier: 'REJECT' },
      analysisMode:    profile.label,
      primaryTimeframe: profile.primaryKey,
    };
  }

  const currentPrice = candlesPrimary[candlesPrimary.length - 1].close;

  // ── Step 1: Daily Bias (EMA200 on 1D) ──────────────────────────
  const ema200_1d      = calculateEMA(candles1d.length > 20 ? candles1d : candlesForBias, 200);
  const lastEma200_1d  = ema200_1d[ema200_1d.length - 1];
  const dailyBias      = lastEma200_1d
    ? (currentPrice > lastEma200_1d ? 'bullish' : 'bearish')
    : 'neutral';
  steps.push(`Daily Bias: ${dailyBias} (EMA200 1D = ${lastEma200_1d?.toFixed(0) || 'N/A'})`);

  // ── Step 2: Higher-TF Trend ────────────────────────────────────
  const swingsBias    = findSwingPoints(candlesForBias, profile.swingLookback + 2);
  const lastHighsBias = swingsBias.filter(s => s.type === 'high').slice(-2);
  const lastLowsBias  = swingsBias.filter(s => s.type === 'low').slice(-2);
  let trendBias = 'ranging';
  if (lastHighsBias.length >= 2 && lastLowsBias.length >= 2) {
    if (lastHighsBias[1].price > lastHighsBias[0].price && lastLowsBias[1].price > lastLowsBias[0].price)
      trendBias = 'bullish';
    else if (lastHighsBias[1].price < lastHighsBias[0].price && lastLowsBias[1].price < lastLowsBias[0].price)
      trendBias = 'bearish';
  }
  steps.push(`${profile.biasKey.toUpperCase()} Trend: ${trendBias}`);

  // ── EMA stack on bias TF ───────────────────────────────────────
  const ema20_bias  = calculateEMA(candlesForBias, 20);
  const ema50_bias  = calculateEMA(candlesForBias, 50);
  const ema200_bias = calculateEMA(candlesForBias, 200);
  const e20b  = ema20_bias[ema20_bias.length - 1];
  const e50b  = ema50_bias[ema50_bias.length - 1];
  const e200b = ema200_bias[ema200_bias.length - 1];

  // ── EMA crossover / pullback signal (5m scalping only) ────────
  let emaSignalActive = false;
  let emaSignalType   = null;
  if (profile.hasEmaSignal && candlesPrimary.length >= 52) {
    const ema20_p = calculateEMA(candlesPrimary, 20);
    const ema50_p = calculateEMA(candlesPrimary, 50);
    const n20 = ema20_p.length;
    const n50 = ema50_p.length;
    const prevE20 = ema20_p[n20 - 2], currE20 = ema20_p[n20 - 1];
    const prevE50 = ema50_p[n50 - 2], currE50 = ema50_p[n50 - 1];

    const bullCross = prevE20 != null && prevE50 != null && prevE20 <= prevE50 && currE20 > currE50;
    const bearCross = prevE20 != null && prevE50 != null && prevE20 >= prevE50 && currE20 < currE50;
    const pullThreshold = profile.isScalping ? 0.0015 : 0.003; // Tighter for 5m to reduce noise
    const bullPull  = currE20 > currE50 && Math.abs(currentPrice - currE20) / currE20 < pullThreshold;
    const bearPull  = currE20 < currE50 && Math.abs(currentPrice - currE20) / currE20 < pullThreshold;

    if      (bullCross) { emaSignalActive = true; emaSignalType = 'EMA Bullish Cross'; }
    else if (bearCross) { emaSignalActive = true; emaSignalType = 'EMA Bearish Cross'; }
    else if (bullPull)  { emaSignalActive = true; emaSignalType = 'EMA20 Bullish Pullback'; }
    else if (bearPull)  { emaSignalActive = true; emaSignalType = 'EMA20 Bearish Pullback'; }
    if (emaSignalType) steps.push(`EMA Signal: ${emaSignalType}`);
  }

  // ── Step 3: SMC Detection ──────────────────────────────────────
  // For scalping: exclude the current unclosed candle to prevent wick-based signal flickering (H3)
  const closedPrimary = profile.isScalping ? candlesPrimary.slice(0, -1) : candlesPrimary;

  const obsOB       = detectOrderBlocks(candlesForOB, currentPrice);
  const obsPrimary  = detectOrderBlocks(closedPrimary, currentPrice);
  const fvgsOB      = detectFVGs(candlesForOB, currentPrice);
  const fvgsPrimary = detectFVGs(closedPrimary, currentPrice);

  const sweepsPrimary   = detectSweeps(closedPrimary,    profile.sweepThreshold);
  const sweepsStructure = detectSweeps(candlesStructure, profile.sweepThreshold * 1.5); // M4: wider structure threshold
  const allSweeps       = [...sweepsPrimary, ...sweepsStructure];

  const minShiftAge     = profile.minShiftAge || 0;
  const shiftsPrimary   = detectStructureShifts(closedPrimary,    minShiftAge);
  const shiftsStructure = detectStructureShifts(candlesStructure, 0);
  const allShifts       = [...shiftsPrimary, ...shiftsStructure];

  steps.push(`OBs: ${obsOB.length + obsPrimary.length} | FVGs: ${fvgsOB.length + fvgsPrimary.length} | Sweeps: ${allSweeps.length} | Shifts: ${allShifts.length}`);

  // ── AI Module Detections ───────────────────────────────────────
  const candlePatterns  = detectCandlePatterns(candlesPrimary.slice(-10));
  const bollingerBands  = calculateBollingerBands(candlesPrimary);
  const macdData        = calculateMACD(candlesPrimary);
  const stochRSI        = calculateStochRSI(candlesPrimary);
  const volumeProfile   = calculateVolumeProfile(candlesPrimary.slice(-100));
  const wyckoffPhase    = detectWyckoffPhase(candlesPrimary.slice(-60));
  const obvDivergence   = calculateOBVDivergence(candlesPrimary);
  const weeklyBias      = getWeeklyOpenBias(candles1d.length > 7 ? candles1d : candlesPrimary, currentPrice);

  // Fetch funding rate and OI (non-blocking — default to neutral if network fails)
  let fundingSentiment = { aligned: false, confluenceWeight: 0, sentiment: 'neutral', fundingRatePct: 0 };
  try {
    fundingSentiment = await getFundingOISentiment(symbol) ?? fundingSentiment;
  } catch (_) {}

  if (candlePatterns.length > 0) {
    steps.push(`Candle Patterns: ${candlePatterns.map(p => p.name).join(', ')}`);
  }
  if (bollingerBands?.isSqueeze)        steps.push(`🟡 BB Squeeze: Explosive move imminent`);
  if (bollingerBands?.isSqueezeRelease) steps.push(`🚀 BB Squeeze Release: Move started!`);
  if (macdData?.bullCross)              steps.push(`📈 MACD Bullish Crossover`);
  if (macdData?.bearCross)              steps.push(`📉 MACD Bearish Crossover`);
  if (macdData?.zeroLineBull)           steps.push(`📈 MACD Zero-Line Bull Cross (strong)`);
  if (macdData?.zeroLineBear)           steps.push(`📉 MACD Zero-Line Bear Cross (strong)`);
  if (wyckoffPhase?.signal)             steps.push(`Wyckoff: ${wyckoffPhase.description}`);
  if (obvDivergence?.hasDivergence)     steps.push(obvDivergence.description);
  if (weeklyBias)                       steps.push(`Weekly: ${weeklyBias.description}`);

  // ── Session ────────────────────────────────────────────────────
  const session   = getCurrentSession();
  const isHigherTF = activeTimeframe === '1h' || activeTimeframe === '4h' || activeTimeframe === '1d';
  const sessionOk = isHigherTF ? true : (session.status === 'optimal' || session.status === 'valid' ||
                    (profile.sessionAllowNyClose && session.status === 'caution'));
  steps.push(`Session: ${session.name} | Valid: ${sessionOk}`);

  // ── Direction ──────────────────────────────────────────────────
  let direction = null;
  let upProb = 25, downProb = 25; // default to ranging 25/25 (M1)

  if      (trendBias === 'bullish' && dailyBias === 'bullish') { direction = 'long';  upProb = 75; downProb = 25; }
  else if (trendBias === 'bearish' && dailyBias === 'bearish') { direction = 'short'; downProb = 75; upProb = 25; }
  else if (trendBias === 'bullish')                             { direction = 'long';  upProb = 62; downProb = 38; }
  else if (trendBias === 'bearish')                             { direction = 'short'; downProb = 62; upProb = 38; }
  else {
    // direction === null (ranging)
    upProb = 25;
    downProb = 25;
  }

  // ── AI Consensus Override (Forces direction if SMC is ranging/conflicted) ──
  let isAiOverride = false;
  let aiBullScore = 0;
  let aiBearScore = 0;

  if (macdData?.bullCross || macdData?.zeroLineBull || (macdData?.isAboveZero && macdData?.histGrowing)) aiBullScore++;
  if (macdData?.bearCross || macdData?.zeroLineBear || (macdData?.isBelowZero && macdData?.histGrowing)) aiBearScore++;
  if (wyckoffPhase?.signal === 'long') aiBullScore += 1.5;
  if (wyckoffPhase?.signal === 'short') aiBearScore += 1.5;
  if (obvDivergence?.bullishDivergence) aiBullScore++;
  if (obvDivergence?.bearishDivergence) aiBearScore++;
  if (weeklyBias?.bias === 'long') aiBullScore++;
  if (weeklyBias?.bias === 'short') aiBearScore++;
  if (fundingSentiment?.aligned) {
    if (fundingSentiment.sentiment === 'overleveraged_shorts') aiBullScore++;
    if (fundingSentiment.sentiment === 'overleveraged_longs') aiBearScore++;
  }

  if (direction === null) {
    if (aiBullScore >= 2.5 && aiBullScore > aiBearScore * 2) {
      direction = 'long'; upProb = 55; downProb = 35; isAiOverride = true;
      steps.push(`🤖 AI Consensus Override: direction = LONG (AI Bull Score: ${aiBullScore.toFixed(1)})`);
    } else if (aiBearScore >= 2.5 && aiBearScore > aiBullScore * 2) {
      direction = 'short'; downProb = 55; upProb = 35; isAiOverride = true;
      steps.push(`🤖 AI Consensus Override: direction = SHORT (AI Bear Score: ${aiBearScore.toFixed(1)})`);
    }
  }

  // FIX #7: calculate actual ranging probability
  let rangeProbability = direction === null ? 50 : Math.max(0, 100 - upProb - downProb);

  // 5m: EMA signal can provide direction when bias is ranging
  if (profile.isScalping && emaSignalActive && direction === null) {
    if (emaSignalType?.includes('Bullish') && currentPrice > (e200b || 0)) {
      direction = 'long';  upProb = 58; downProb = 30;
      steps.push('5m EMA override: direction = LONG (EMA signal above EMA200)');
    } else if (emaSignalType?.includes('Bearish') && currentPrice < (e200b || Infinity)) {
      direction = 'short'; downProb = 58; upProb = 30;
      steps.push('5m EMA override: direction = SHORT (EMA signal below EMA200)');
    }
    // Recalculate rangeProbability after EMA override changes probabilities
    rangeProbability = direction === null ? 50 : Math.max(0, 100 - upProb - downProb);
  }

  steps.push(`Direction: ${direction || 'RANGING'} | Bull: ${upProb}% Bear: ${downProb}%`);

  // Fibonacci Golden Pocket (Calculated here for SL/TP anchoring)
  const htfSwingH = swingsBias.filter(s => s.type === 'high').slice(-1)[0];
  const htfSwingL = swingsBias.filter(s => s.type === 'low').slice(-1)[0];
  let fibData = null;
  let inGoldenPocket = false;
  if (htfSwingH && htfSwingL) {
    fibData = calculateFibonacci(htfSwingH.price, htfSwingL.price, direction);
    inGoldenPocket = isInGoldenPocket(currentPrice, fibData);
    if (inGoldenPocket) steps.push(`✓ Entry in Fibonacci Golden Pocket (0.618–0.705)`);
  }

  // ── CME Gap detection (Run early for Risk Shield and TP Target injection) ──
  const gapCandles = candles1h.length > 48 ? candles1h : candlesPrimary;
  const rawGaps = detectCMEGaps(gapCandles, currentPrice);
  const cmeGapData = analyzeCMEGaps(rawGaps, direction, trendBias, [...obsOB, ...obsPrimary], currentPrice);
  if (cmeGapData.hasUnfilledGaps) {
    steps.push(`CME Gap Draw: ${cmeGapData.summary}`);
  }

  // ── Primary Timeframe EMA Trend Veto ───────────────────────────
  const primEma20_arr  = calculateEMA(candlesPrimary, 20);
  const primEma50_arr  = calculateEMA(candlesPrimary, 50);
  const primEma200_arr = calculateEMA(candlesPrimary, 200);
  const primE20  = primEma20_arr[primEma20_arr.length - 1];
  const primE50  = primEma50_arr[primEma50_arr.length - 1];
  const primE200 = primEma200_arr[primEma200_arr.length - 1];

  let emaVetoActive = false;
  let emaVetoReason = null;

  if (direction === 'long' && primE50 && primE200) {
    const isBearishCascade = primE20 && primE20 < primE50 && primE50 < primE200;
    const belowBothMajor   = currentPrice < primE50 && currentPrice < primE200;
    
    if (belowBothMajor) {
      const hasRecentBullishChoch = allShifts.some(s => s.type === 'CHOCH' && s.direction === 'bullish');
      const rsiDivResult = detectRSIDivergence(candlesPrimary, 'long', 14);
      
      if (isBearishCascade) {
        emaVetoActive = true;
        emaVetoReason = `Strict Long Veto: Price in strong Bearish EMA Cascade (20 < 50 < 200)`;
      } else if (!hasRecentBullishChoch || !rsiDivResult.hasDivergence) {
        emaVetoActive = true;
        emaVetoReason = `Long Veto: Price is below major EMAs without combined Bullish CHOCH and RSI Divergence confirmation`;
      }
    }
  } else if (direction === 'short' && primE50 && primE200) {
    const isBullishCascade = primE20 && primE20 > primE50 && primE50 > primE200;
    const aboveBothMajor   = currentPrice > primE50 && currentPrice > primE200;
    
    if (aboveBothMajor) {
      const hasRecentBearishChoch = allShifts.some(s => s.type === 'CHOCH' && s.direction === 'bearish');
      const rsiDivResult = detectRSIDivergence(candlesPrimary, 'short', 14);
      
      if (isBullishCascade) {
        emaVetoActive = true;
        emaVetoReason = `Strict Short Veto: Price in strong Bullish EMA Cascade (20 > 50 > 200)`;
      } else if (!hasRecentBearishChoch || !rsiDivResult.hasDivergence) {
        emaVetoActive = true;
        emaVetoReason = `Short Veto: Price is above major EMAs without combined Bearish CHOCH and RSI Divergence confirmation`;
      }
    }
  }

  if (emaVetoActive) {
    steps.push(`Trend Veto: ${emaVetoReason}`);
  }

  // ── OTE Zone ───────────────────────────────────────────────────
  // FIX #6: verify temporal order (high must precede low for long, vice versa for short)
  const swingsStructure = findSwingPoints(
    candlesStructure.length > 20 ? candlesStructure : candlesPrimary,
    profile.swingLookback
  );
  let oteZone = null;
  if (direction === 'long') {
    const lows  = swingsStructure.filter(s => s.type === 'low'  && s.price < currentPrice).sort((a,b) => b.index - a.index);
    const highs = swingsStructure.filter(s => s.type === 'high' && s.price > lows[0]?.price).sort((a,b) => b.index - a.index);
    // Guard: low must have occurred before the recent high in time (L3)
    if (lows[0] && highs[0] && lows[0].index < highs[0].index)
      oteZone = calculateOTE(highs[0].price, lows[0].price, 'long');
  } else if (direction === 'short') {
    const highs = swingsStructure.filter(s => s.type === 'high' && s.price > currentPrice).sort((a,b) => b.index - a.index);
    const lows  = swingsStructure.filter(s => s.type === 'low'  && s.price < highs[0]?.price).sort((a,b) => b.index - a.index);
    // Guard: high must have occurred before the recent low in time (L3)
    if (highs[0] && lows[0] && highs[0].index < lows[0].index)
      oteZone = calculateOTE(highs[0].price, lows[0].price, 'short');
  }
  const inOTE = isInOTE(currentPrice, oteZone);
  steps.push(`OTE: ${oteZone ? `${oteZone.lower.toFixed(0)}–${oteZone.upper.toFixed(0)}` : 'N/A'} | In OTE: ${inOTE}`);

  // ── Entry / SL ──────────────────────────────────────────────────
  let entry  = currentPrice;
  let slData = null;
  let posSize = 0;
  let nearestOB = null;
  const allFVGs = [...fvgsOB, ...fvgsPrimary];

  if (direction) {
    const allOBs    = [...obsOB, ...obsPrimary];
    const activeOBs = allOBs.filter(o => o.status === 'active');

    nearestOB = direction === 'long'
      ? activeOBs.filter(o => o.type === 'demand' && currentPrice >= o.lowerBound).sort((a,b) => b.entryBoundary - a.entryBoundary)[0]
      : activeOBs.filter(o => o.type === 'supply' && currentPrice <= o.upperBound).sort((a,b) => a.entryBoundary - b.entryBoundary)[0];

    const insideOB = nearestOB && (
      direction === 'long'
        ? (currentPrice <= nearestOB.entryBoundary && currentPrice >= nearestOB.lowerBound)
        : (currentPrice >= nearestOB.entryBoundary && currentPrice <= nearestOB.upperBound)
    );

    if (inOTE && oteZone) {
      entry = currentPrice;
    } else if (insideOB) {
      entry = currentPrice;
    } else if (nearestOB) {
      entry = nearestOB.entryBoundary;
    }

    // Compute ATR-based minimum SL distance for this symbol+timeframe
    const minDistance = computeMinSlDistance(candlesPrimary, entry, activeTimeframe, symbol);

    // Find true structural swing points (confirmed swing highs/lows, not raw min/max)
    const primarySwings = findSwingPoints(candlesPrimary.slice(-50), profile.swingLookback);
    const nearestSwingLows  = primarySwings.filter(s => s.type === 'low'  && s.price < entry).sort((a, b) => b.price - a.price);
    const nearestSwingHighs = primarySwings.filter(s => s.type === 'high' && s.price > entry).sort((a, b) => a.price - b.price);

    const trueSwingLow  = nearestSwingLows.length  > 0 ? nearestSwingLows[0].price  : entry - minDistance;
    const trueSwingHigh = nearestSwingHighs.length > 0 ? nearestSwingHighs[0].price : entry + minDistance;

    let inv;
    if (direction === 'long') {
      // SL anchor priority for LONG:
      // 1) Demand OB lowerBound — the structural floor the OB is built on
      // 2) Most-recent bullish sweep wick low — the actual extreme price swept below
      // 3) Nearest true swing low — last resort fallback
      if (nearestOB && nearestOB.lowerBound < entry) {
        inv = nearestOB.lowerBound;
        // If the most recent sweep went deeper than the OB floor, honour that wick
        const recentBullSweeps = sweepsPrimary
          .filter(s => (s.direction === 'long' || s.type === 'bullish') && s.wickExtreme !== undefined && s.wickExtreme < entry)
          .sort((a, b) => b.candleIndex - a.candleIndex);
        if (recentBullSweeps.length > 0 && recentBullSweeps[0].wickExtreme < inv) {
          inv = recentBullSweeps[0].wickExtreme;
        }
      } else {
        // No OB: anchor to the most recent sweep wick low, else swing low
        const recentBullSweeps = [
          ...sweepsPrimary.filter(s => (s.direction === 'long' || s.type === 'bullish') && s.wickExtreme !== undefined && s.wickExtreme < entry),
          ...sweepsStructure.filter(s => (s.direction === 'long' || s.type === 'bullish') && s.wickExtreme !== undefined && s.wickExtreme < entry),
        ].sort((a, b) => b.candleIndex - a.candleIndex);
        inv = recentBullSweeps.length > 0 ? recentBullSweeps[0].wickExtreme : trueSwingLow;
      }

      // Safety guard: if for some reason inv is still not below entry, fall back to trueSwingLow
      if (inv >= entry) {
        inv = trueSwingLow;
      }
      // Enforce minimum distance
      if (entry - inv < minDistance) {
        inv = entry - minDistance;
      }
    } else {
      // SL anchor priority for SHORT:
      // 1) Supply OB upperBound — the structural ceiling the OB is built on
      // 2) Most-recent bearish sweep wick high — the actual extreme price swept above
      // 3) Nearest true swing high — last resort fallback
      if (nearestOB && nearestOB.upperBound > entry) {
        inv = nearestOB.upperBound;
        // If the most recent sweep went higher than the OB ceiling, honour that wick
        const recentBearSweeps = sweepsPrimary
          .filter(s => (s.direction === 'short' || s.type === 'bearish') && s.wickExtreme !== undefined && s.wickExtreme > entry)
          .sort((a, b) => b.candleIndex - a.candleIndex);
        if (recentBearSweeps.length > 0 && recentBearSweeps[0].wickExtreme > inv) {
          inv = recentBearSweeps[0].wickExtreme;
        }
      } else {
        // No OB: anchor to the most recent sweep wick high, else swing high
        const recentBearSweeps = [
          ...sweepsPrimary.filter(s => (s.direction === 'short' || s.type === 'bearish') && s.wickExtreme !== undefined && s.wickExtreme > entry),
          ...sweepsStructure.filter(s => (s.direction === 'short' || s.type === 'bearish') && s.wickExtreme !== undefined && s.wickExtreme > entry),
        ].sort((a, b) => b.candleIndex - a.candleIndex);
        inv = recentBearSweeps.length > 0 ? recentBearSweeps[0].wickExtreme : trueSwingHigh;
      }

      // Safety guard: if for some reason inv is still not above entry, fall back to trueSwingHigh
      if (inv <= entry) {
        inv = trueSwingHigh;
      }
      // Enforce minimum distance
      if (inv - entry < minDistance) {
        inv = entry + minDistance;
      }
    }

      slData = calculateSmartSL(inv, direction, allFVGs, symbol, fibData, volumeProfile); // pass symbol for decimals (M11)
    
    // Stop Loss side validation (H2)
    if (slData) {
      if (direction === 'long' && slData.value >= entry) slSideInvalid = true;
      if (direction === 'short' && slData.value <= entry) slSideInvalid = true;
    }

    // ── CME Gap Risk Shield ──────────────────────────────────
    adjustedRiskAmount = riskAmount;
    let cmeRiskShieldActive = false;
    if (cmeGapData.hasUnfilledGaps && cmeGapData.nearestGap) {
      const nearest = cmeGapData.nearestGap;
      const opposing = (direction === 'long' && nearest.direction === 'up') ||
                       (direction === 'short' && nearest.direction === 'down');
      if (opposing && nearest.distToGapPct < 3.0) {
        adjustedRiskAmount = riskAmount * 0.5; // Cut risk by 50%
        cmeRiskShieldActive = true;
      }
    }

    const decimals = ASSETS[symbol]?.decimals ?? 2;
    // Compute position size once (L1) and pass symbol for step rounding (C6)
    posSize = (slData && !slSideInvalid) ? calculatePositionSize(entry, slData.value, adjustedRiskAmount, symbol) : 0;
    
    steps.push(`Entry: ${entry.toFixed(decimals)} | SL: ${slData ? slData.value.toFixed(decimals) : 'N/A'} | SL%: ${slData ? ((Math.abs(entry - slData.value) / entry) * 100).toFixed(2) + '%' : 'N/A'} | Size: ${posSize} units`);
    
    if (cmeRiskShieldActive) {
      steps.push(`⚠️ CME Risk Shield Active: Opposing gap sits within 3%. Reducing risk by 50% ($${adjustedRiskAmount.toFixed(2)}).`);
    }
  }

  // ── Confluence Checks (pre-RRR) ─────────────────────────────────
  // Calculate tier BEFORE TPs so we can pass the real tier for scaling.
  // RRR pillar is added after TPs are computed.
  const trend4HAligned = isAiOverride || (direction === 'long'  && trendBias === 'bullish') ||
                         (direction === 'short' && trendBias === 'bearish');
  const dailyAligned   = (direction === 'long'  && dailyBias === 'bullish') ||
                         (direction === 'short' && dailyBias === 'bearish');
  // C2: Liquidity sweeps filtered by direction; FVG fill checks also direction-aligned
  const liquidityEvent = allSweeps.some(s => s.direction === direction) ||
                         [...fvgsOB, ...fvgsPrimary].some(f => {
                           const isFvgBullish = f.type === 'bullish';
                           const isFvgAligned = direction === 'long' ? isFvgBullish : !isFvgBullish;
                           return isFvgAligned && currentPrice >= f.lower && currentPrice <= f.upper;
                         });
  // C3: Structure shifts filtered by direction (bypassed if AI strongly overrides)
  const structureShift = isAiOverride || allShifts.some(s => s.direction === (direction === 'long' ? 'bullish' : 'bearish'));
  const rsiResult      = detectRSIDivergence(
    candlesStructure.length > 20 ? candlesStructure : candlesPrimary,
    direction, 14
  );
  const ema200Acting   = e200b && Math.abs(currentPrice - e200b) / e200b < 0.005;
  const slPct          = slData ? Math.abs(entry - slData.value) / entry : 0;
  const emaSignalAligned = emaSignalActive &&
    ((direction === 'long'  && emaSignalType?.includes('Bullish')) ||
     (direction === 'short' && emaSignalType?.includes('Bearish')));

  // OB proximity: is entry near or inside a valid unmitigated Order Block?
  const nearOB = nearestOB !== null;

  // ── NEW: Premium/Discount Zone Check ─────────────────────────
  const swingH = swingsBias.filter(s => s.type === 'high').slice(-1)[0];
  const swingL = swingsBias.filter(s => s.type === 'low').slice(-1)[0];
  let premiumDiscountZones = null;
  let inCorrectZone = false;
  if (swingH && swingL) {
    premiumDiscountZones = calculatePremiumDiscount(swingH.price, swingL.price);
    if (direction === 'long') {
      inCorrectZone = isInDiscount(currentPrice, premiumDiscountZones);
    } else if (direction === 'short') {
      inCorrectZone = isInPremium(currentPrice, premiumDiscountZones);
    }
    if (inCorrectZone) steps.push(`✓ Entry in ${direction === 'long' ? 'Discount' : 'Premium'} zone`);
  }

  // ── NEW: VWAP Check ────────────────────────────────────────
  const vwap = calculateVWAP(candlesPrimary.slice(-100));
  const vwapAligned = vwap != null && direction && (
    (direction === 'long' && currentPrice < vwap) ||
    (direction === 'short' && currentPrice > vwap)
  );
  if (vwapAligned) steps.push(`✓ Price on correct side of VWAP ($${vwap?.toFixed(2)})`);

  // ── NEW: Breaker Block Check ───────────────────────────────
  const breakerBlocks = detectBreakerBlocks(candlesPrimary, currentPrice);
  const nearBreaker = breakerBlocks.some(bb => {
    const dist = Math.abs(currentPrice - bb.entryBoundary) / currentPrice;
    return dist < 0.008; // within 0.8% of a breaker block
  });
  if (nearBreaker) steps.push(`✓ Near a Breaker Block (flipped S/R)`);

  // Pre-RRR checks (all except the RRR pillar — added after TP calc)
  const cmeGapAligned = !cmeGapData.hasUnfilledGaps || 
                        !cmeGapData.gapFillBias || 
                        direction === null ||
                        (direction && cmeGapData.gapFillBias === (direction === 'long' ? 'bullish' : 'bearish'));

  // ── NEW AI Confluence Calculations ─────────────────────────────
  // Fibonacci Golden Pocket (Calculated earlier)

  // Hidden Divergence
  const hiddenDiv = direction ? detectHiddenDivergence(candlesPrimary, direction) : { hasHiddenDiv: false };
  if (hiddenDiv.hasHiddenDiv) steps.push(hiddenDiv.description);

  // Candlestick pattern at key level
  const alignedPatterns = candlePatterns.filter(p =>
    p.direction === direction || p.direction === 'neutral'
  );
  const hasBullishPattern = alignedPatterns.some(p => p.direction === 'bullish') && direction === 'long';
  const hasBearishPattern = alignedPatterns.some(p => p.direction === 'bearish') && direction === 'short';
  const hasCandlePattern  = hasBullishPattern || hasBearishPattern;

  // MACD confluence
  const macdAligned = macdData && direction && (
    (direction === 'long'  && (macdData.bullCross || macdData.zeroLineBull || (macdData.isAboveZero && macdData.histGrowing))) ||
    (direction === 'short' && (macdData.bearCross || macdData.zeroLineBear || (macdData.isBelowZero && macdData.histGrowing)))
  );

  // Stochastic RSI confluence
  const stochAligned = stochRSI && direction && (
    (direction === 'long'  && (stochRSI.bullCrossOversold || stochRSI.isOversold)) ||
    (direction === 'short' && (stochRSI.bearCrossOverbought || stochRSI.isOverbought))
  );

  // Bollinger Bands confluence
  const bbAligned = bollingerBands && direction && (
    (direction === 'long'  && (bollingerBands.isSqueezeRelease || bollingerBands.isBullWalk)) ||
    (direction === 'short' && (bollingerBands.isSqueezeRelease || bollingerBands.isBearWalk))
  );

  // Volume Profile / POC
  const atPOC = volumeProfile ? volumeProfile.isAtPOC(currentPrice) : false;
  if (atPOC) steps.push(`✓ Price at Volume POC ($${volumeProfile.poc.toFixed(2)}) — High-volume node`);

  // Wyckoff phase alignment
  const wyckoffAligned = wyckoffPhase && direction &&
    wyckoffPhase.signal === direction;

  // OBV divergence alignment
  const obvAligned = obvDivergence && direction && (
    (direction === 'long'  && obvDivergence.bullishDivergence) ||
    (direction === 'short' && obvDivergence.bearishDivergence)
  );

  // Funding rate aligned (contrarian: overleveraged longs → short, overleveraged shorts → long)
  const fundingAligned = fundingSentiment.aligned && direction && (
    (direction === 'long'  && fundingSentiment.sentiment === 'overleveraged_shorts') ||
    (direction === 'short' && fundingSentiment.sentiment === 'overleveraged_longs')
  );
  if (fundingAligned) steps.push(`✓ Funding Rate: ${fundingSentiment.fundingRatePct} — Crowd ${fundingSentiment.sentiment === 'overleveraged_longs' ? 'long' : 'short'} (Contrarian ${direction})`);

  // Weekly Open bias
  const weeklyBiasAligned = weeklyBias && direction &&
    weeklyBias.bias === direction;

  const preRrrChecks = [
    // ── SMC Structure (High Weight) ───────────────────────────────
    { label: `${profile.biasKey.toUpperCase()} Trend Aligned`,                   met: trend4HAligned,          weight: 1.5  },
    { label: 'Liquidity Sweep / FVG Fill',                                        met: liquidityEvent,          weight: 1.5  },
    { label: `${profile.primaryKey.toUpperCase()}/${profile.structureKey.toUpperCase()} BOS/CHOCH`, met: structureShift, weight: 1.5  },
    { label: 'Near Valid Order Block',                                            met: nearOB,                  weight: 1.25 },
    { label: 'Near Breaker Block (Flipped S/R)',                                  met: nearBreaker,             weight: 1.0  },
    // ── Price Position ────────────────────────────────────────────
    { label: 'Entry in OTE Zone (61.8–78.6%)',                                   met: inOTE,                   weight: 1.25 },
    { label: `Entry in ${direction === 'long' ? 'Discount' : 'Premium'} Zone`,  met: inCorrectZone,           weight: 1.0  },
    { label: 'Fibonacci Golden Pocket (0.618–0.705)',                             met: inGoldenPocket,          weight: 1.5  },
    // ── Trend Confirmation ────────────────────────────────────────
    { label: 'Daily Bias Aligned (EMA200)',                                      met: dailyAligned,            weight: 1.0  },
    { label: 'EMA200 Acting as S/R',                                             met: ema200Acting,            weight: 0.75 },
    { label: 'VWAP Aligned',                                                      met: vwapAligned,             weight: 0.75 },
    // ── AI Momentum ──────────────────────────────────────────────
    { label: 'MACD Momentum Aligned',                                            met: !!macdAligned,           weight: 1.25 },
    { label: 'Stochastic RSI Extreme (OS/OB)',                                   met: !!stochAligned,          weight: 1.0  },
    { label: 'Bollinger Band Signal',                                             met: !!bbAligned,             weight: 0.75 },
    { label: `Wyckoff ${wyckoffPhase?.phase || ''} Signal`,                     met: !!wyckoffAligned,        weight: 1.5  },
    // ── Volume & Divergence ──────────────────────────────────────
    { label: 'Volume POC Confluence',                                             met: atPOC,                   weight: 1.25 },
    { label: 'RSI Divergence',                                                    met: rsiResult.hasDivergence, weight: 1.0  },
    { label: 'OBV Smart Money Divergence',                                        met: !!obvAligned,            weight: 1.0  },
    { label: 'Hidden Divergence (Trend Continuation)',                            met: hiddenDiv.hasHiddenDiv,  weight: 1.0  },
    { label: 'Candlestick Pattern Confirmed',                                     met: hasCandlePattern,        weight: 1.0  },
    // ── Session & Sentiment ──────────────────────────────────────
    { label: 'Active Trading Session',                                            met: sessionOk,               weight: 0.75 },
    { label: 'Kill Zone Active',                                                  met: killZone.inKillZone,     weight: 0.75 },
    { label: 'CME Gap Bias Aligned',                                              met: cmeGapAligned,           weight: 0.75 },
    { label: 'Funding Rate Contrarian Signal',                                    met: fundingAligned,          weight: 0.75 },
    { label: 'Weekly Open Bias Aligned',                                          met: !!weeklyBiasAligned,     weight: 0.75 },
    ...(profile.hasEmaSignal
      ? [{ label: `EMA Signal: ${emaSignalType || 'None'}`,                     met: emaSignalAligned,        weight: 1.0  }]
      : []),
  ];

  // Estimate tier without RRR pillar (for TP scaling)
  const preRrrTotalWeight  = preRrrChecks.reduce((s, c) => s + c.weight, 0);
  const preRrrScoredWeight = preRrrChecks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const preRrrMax          = preRrrChecks.length;
  const preRrrNorm         = Math.min(preRrrMax, Math.round((preRrrScoredWeight / preRrrTotalWeight) * preRrrMax));
  const preRrrTier         = preRrrNorm >= Math.ceil(preRrrMax * 0.73) ? 'EXCEPTIONAL'
                           : preRrrNorm >= Math.ceil(preRrrMax * 0.55) ? 'HIGH'
                           : preRrrNorm >= Math.ceil(preRrrMax * 0.36) ? 'MEDIUM'
                           : 'REJECT';

  // ── TPs — Multi-TF Swing Pool ──────────────────────────────────
  // FIX #1 & #2: Use swings from ALL available timeframes as TP candidates.
  // Tag each with its TF label so the UI can show "1H Swing @ 74,500" etc.
  let tpData = null;
  if (direction && slData) {

    const rawSwings = [
      ...tagSwings(findSwingPoints(candlesPrimary,   profile.swingLookback    ), profile.primaryKey.toUpperCase()),
      ...tagSwings(findSwingPoints(candlesStructure, profile.swingLookback + 1), profile.structureKey.toUpperCase()),
      ...tagSwings(swingsBias,                                                   profile.biasKey.toUpperCase()),
    ];

    const tpSwingPool = rawSwings.filter(s => {
      if (direction === 'long') {
        return (s.type === 'high' && s.price > entry) || (s.type === 'low' && s.price < entry);
      } else {
        return (s.type === 'low' && s.price < entry) || (s.type === 'high' && s.price > entry);
      }
    });

    // Inject CME Gap Targets
    if (cmeGapData.hasUnfilledGaps) {
      cmeGapData.unfilledGaps.forEach(gap => {
        const gapAligned = (direction === 'long' && gap.direction === 'down') ||
                           (direction === 'short' && gap.direction === 'up');
        if (gapAligned) {
          const isValidTarget = (direction === 'long' && gap.fridayClose > entry) ||
                                (direction === 'short' && gap.fridayClose < entry);
          if (isValidTarget) {
            tpSwingPool.push({
              price: gap.fridayClose,
              type: direction === 'long' ? 'high' : 'low',
              reason: `CME Gap Target (${gap.gapPct.toFixed(1)}%)`,
              tf: 'CME'
            });
            steps.push(`CME Target Injected: $${gap.fridayClose.toFixed(2)} (${gap.gapPct.toFixed(1)}% gap)`);
          }
        }
      });
    }

    tpData = calculateTPs(
      entry, slData.value,
      tpSwingPool, allFVGs,
      direction,
      preRrrTier,
      session.name,
      profile.maxTpPct,
      profile.primaryKey.toUpperCase(),
      profile.structureKey.toUpperCase(),
      profile.biasKey.toUpperCase(),
      profile.minRrr || 3.0,
      symbol,
      fibData,
      volumeProfile
    );

    // Attach projected P&L to each TP (reuses outer posSize - L1)
    tpData.tps.forEach(tp => {
      const fullPnl       = Math.abs(tp.level - entry) * posSize;
      tp.projectedProfit  = (fullPnl * ((tp.closePercent || 0) / 100)).toFixed(2);
    });

    const tpDecimals = ASSETS[symbol]?.decimals ?? 2;
    steps.push(`TPs: ${tpData.tps.map((t, i) =>
      `TP${i+1}=$${t.level.toFixed(tpDecimals)} (1:${t.rrr}) ${t.isStructural ? '★' : '⚡'}`
    ).join(' | ')}`);
    steps.push(`TP source: ${tpData.tps.map(t => t.reason).join(' → ')}`);
  }

  // ── Final Score ────────────────────────────────────────────────
  const tp1Rrr      = tpData?.tps?.[0]?.rrr ?? 0;
  const rrrMeetsMin = tp1Rrr >= (profile.minRrr || 3.0);

  // Full check list including RRR
  const checks = [
    ...preRrrChecks,
    { label: `RRR ≥ 1:${(profile.minRrr || 3.0).toFixed(0)} (Structural)`, met: rrrMeetsMin, weight: 1.5 },
  ];

  const totalWeight     = checks.reduce((s, c) => s + c.weight, 0);
  const scoredWeight    = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const rawPct          = scoredWeight / totalWeight;
  // Confidence curve: sqrt maps 30% raw → 55%, 50% raw → 71%, 70% raw → 84%
  // This compensates for the ~26 checks where most are rare/situational signals
  const aiConfidence    = Math.round(Math.sqrt(rawPct) * 100);
  const aiGrade         = aiConfidence >= 90 ? 'ELITE'
                        : aiConfidence >= 75 ? 'STRONG'
                        : aiConfidence >= 55 ? 'MODERATE'
                        : aiConfidence >= 40 ? 'MARGINAL'
                        : 'SKIP';

  // ── Decision (AI Confidence-driven) ────────────────────────────
  let decision        = 'NO_TRADE';
  let rejectionReason = null;

  // Compute entry distance percentage (divided by currentPrice - L2)
  const entryDistPct = direction ? Math.abs(currentPrice - entry) / currentPrice : 0;

  if (!direction) {
    rejectionReason = `Market ranging — no ${profile.biasKey.toUpperCase()} directional bias & AI consensus insufficient`;
  } else if (emaVetoActive) {
    rejectionReason = emaVetoReason;
  } else if (slSideInvalid || !slData) {
    rejectionReason = `Invalid Stop Loss placement relative to entry`;
  } else if (entryDistPct > profile.maxEntryDist) {
    if (aiConfidence >= profile.minAiConfidence && rrrMeetsMin) {
      decision = 'WAIT';
      const limitOrderPrice = oteZone?.midpoint || entry;
      const limitLabel = oteZone ? `Limit @ OTE ${formatLimitPrice(limitOrderPrice, symbol)}` : `Limit @ ${formatLimitPrice(entry, symbol)}`;
      rejectionReason = `Price ${(entryDistPct * 100).toFixed(2)}% from entry — ${limitLabel}`;
    } else {
      rejectionReason = `Price too far from entry zone: ${(entryDistPct * 100).toFixed(2)}% > ${(profile.maxEntryDist * 100).toFixed(2)}% max for ${profile.label}`;
    }
  } else if (slPct > profile.maxSlPct) {
    rejectionReason = `SL too wide: ${(slPct * 100).toFixed(2)}% > ${(profile.maxSlPct * 100).toFixed(2)}% max for ${profile.label}`;
  } else if (!rrrMeetsMin) {
    rejectionReason = `RRR too low: ${tp1Rrr.toFixed(2)} < ${(profile.minRrr || 3.0).toFixed(1)} minimum`;
  } else if (aiConfidence < profile.minAiConfidence) {
    rejectionReason = `AI Confidence too low: ${aiConfidence}% < ${profile.minAiConfidence}% min for ${profile.label}`;
  } else {
    decision = 'TAKE_NOW';
  }

  steps.push(`→ ${decision} | AI: ${aiConfidence}% ${aiGrade}`);
  if (rejectionReason) steps.push(`Rejected: ${rejectionReason}`);

  // ── Return ─────────────────────────────────────────────────────
  return {
    decision,
    direction,
    entry,
    stopLoss:     slData,
    tpDetails:    tpData?.tps || [],
    positionSize: (direction && slData && !slSideInvalid) ? posSize : 0, // Reuse calculated posSize (L1)
    projectedLoss: (direction && slData && !slSideInvalid)
      ? (Math.abs(entry - slData.value) * posSize).toFixed(2)
      : '0.00',
    leverage: (direction && slData && !slSideInvalid) ? calculateLeverage(posSize, entry, balance) : 0,
    liquidationPrice: (direction && slData && !slSideInvalid) ? estimateLiquidationPrice(entry, direction, calculateLeverage(posSize, entry, balance)) : 0,
    breakevenMove: (direction && slData && !slSideInvalid) ? calculateBreakevenMove(entry, slData.value, symbol) : null,
    confluenceScore: {
      checks,
      aiConfidence,
      aiGrade,
    },
    session,
    upProbability:    upProb,
    downProbability:  downProb,
    rangeProbability,
    rejectionReason,
    waitCondition:    null,
    keyRisk: ema200Acting ? 'EMA200 Resistance / Support' : slPct > 0.012 ? 'Wide SL — size reduced automatically' : 'Market Volatility',
    invalidationLevel: slData ? slData.rawInvalidation.toFixed(ASSETS[symbol]?.decimals ?? 2) : 'N/A',
    analysisSteps:  steps,
    oteZone,
    symbol,
    balance,
    timeCap:          profile.timeCap,
    riskAmount:       adjustedRiskAmount,
    // Mode metadata
    analysisMode:     profile.label,
    modeColor:        profile.modeColor,
    primaryTimeframe: profile.primaryKey,
    isScalping:       profile.isScalping,
    emaSignal:        emaSignalActive ? { active: true, type: emaSignalType } : null,
    smcData: {
      orderBlocks:     [...obsOB, ...obsPrimary],
      breakerBlocks:   breakerBlocks,
      fvgs:            [...fvgsOB, ...fvgsPrimary],
      sweeps:          allSweeps,
      structureShifts: allShifts,
      vwap:            vwap,
    },
    // AI Intelligence Data
    aiModules: {
      candlePatterns,
      bollingerBands:  bollingerBands ? { isSqueeze: bollingerBands.isSqueeze, isSqueezeRelease: bollingerBands.isSqueezeRelease, isBullWalk: bollingerBands.isBullWalk, isBearWalk: bollingerBands.isBearWalk, current: bollingerBands.current } : null,
      macd:            macdData ? { macd: macdData.macd, signal: macdData.signal, histogram: macdData.histogram, bullCross: macdData.bullCross, bearCross: macdData.bearCross } : null,
      stochRSI:        stochRSI ? { k: stochRSI.k, d: stochRSI.d, isOversold: stochRSI.isOversold, isOverbought: stochRSI.isOverbought } : null,
      volumeProfile:   volumeProfile ? { poc: volumeProfile.poc, valueAreaHigh: volumeProfile.valueAreaHigh, valueAreaLow: volumeProfile.valueAreaLow } : null,
      wyckoffPhase,
      obvDivergence,
      hiddenDivergence: hiddenDiv,
      fibonacciData:   fibData ? { goldenPocket: fibData.goldenPocket, levels: fibData.levels } : null,
      fundingSentiment,
      weeklyBias,
    },
    premiumDiscountZones,
    killZone,
    cmeGapData,
  };
}
