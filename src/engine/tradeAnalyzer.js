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
  calculateEMA, calculateRSI, detectRSIDivergence, findSwingPoints, detectRSISmaCross,
  detectBreakerBlocks, calculateVWAP,
  // ── AI Modules ──────────────────────────────────────────────
  detectCandlePatterns, calculateFibonacci, isInGoldenPocket,
  calculateBollingerBands, calculateMACD, calculateStochRSI,
  calculateVolumeProfile, detectWyckoffPhase,
  calculateOBVDivergence, detectHiddenDivergence, getWeeklyOpenBias,
  // ── Institutional Logic Modules (v11) ───────────────────────
  validateDisplacement, classifyLiquidityLevels, detectInducement,
  assessChochQuality, classifyVolatilityRegime, identifyDrawOnLiquidity,
  detectEqualHighsLows, calculateSignalGrade,
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
import { RISK_AMOUNT, ASSETS, CHALLENGE_CONFIG } from '../utils/constants.js';
import { canTrade as challengeCanTrade, getChallengeStatus } from './challengeTracker.js';

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
    riskAmount:          50,    // $50 risk per trade (funding challenge)
    minRrr:              2.0,   // Capped min RRR at 1:2 for scalps
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
    riskAmount:          50,
    minRrr:              2.5,   // Capped min RRR at 1:2.5 for intraday
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
    riskAmount:          50,
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
    riskAmount:          50,
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
    riskAmount:          50,
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
  steps.push(`Engine v11.0 (Inst Logic) | ${profile.label} | ${symbol}`);
  
  let smcAnalysis = null;
  let slSideInvalid = false; // H2 validation flag declared early
  let adjustedRiskAmount = riskAmount; // C5: hoisted to outer scope for return object

  // ── Challenge Mode DD Guard ──────────────────────────────────
  if (CHALLENGE_CONFIG.enabled) {
    const tradeAllowed = challengeCanTrade();
    if (!tradeAllowed.allowed) {
      return {
        decision: 'NO_TRADE',
        rejectionReason: `🛡️ CHALLENGE GUARD: ${tradeAllowed.reason}`,
        confluenceScore: { total: 0, max: 10, checks: [], tier: 'REJECT' },
        analysisSteps:   [`🛡️ Challenge DD Guard: ${tradeAllowed.reason}`],
        analysisMode:    profile.label,
        primaryTimeframe: profile.primaryKey,
        challengeStatus: getChallengeStatus(),
      };
    }
    steps.push(`🏆 Challenge Mode: DD budget $${tradeAllowed.budget.toFixed(0)} remaining`);
  }

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

  // ── Filter D: Extreme Volatility Spike Guard ──────────────────
  // Only trigger on non-directional parabolic blow-off (>4.5x ATR) without displacement
  const primaryATR = calculateATR(candlesPrimary, 14);
  const lastCandle = candlesPrimary[candlesPrimary.length - 1];
  const lastCandleBody = Math.abs(lastCandle.close - lastCandle.open);
  const volSpikeRatio = primaryATR && primaryATR > 0 ? lastCandleBody / primaryATR : 0;
  const isVolatilitySpike = volSpikeRatio > 4.5 && (!dispValidation || !dispValidation.valid);

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

  // ── EMA Slopes (% deviation over last 5 candles) — for regime detection ─
  const SLOPE_LOOKBACK = 5;
  const prev20 = ema20_bias[ema20_bias.length - 1 - SLOPE_LOOKBACK];
  const prev50 = ema50_bias[ema50_bias.length - 1 - SLOPE_LOOKBACK];
  const prev200 = ema200_bias[ema200_bias.length - 1 - SLOPE_LOOKBACK];
  const ema20_slope  = prev20  > 0 ? ((e20b  - prev20)  / prev20)  * 100 : 0;
  const ema50_slope  = prev50  > 0 ? ((e50b  - prev50)  / prev50)  * 100 : 0;
  const ema200_slope = prev200 > 0 ? ((e200b - prev200) / prev200) * 100 : 0;

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

  // ── Institutional Logic (v11) ──────────────────────────────────
  // 1. Volatility Regime — classify before direction to use in sizing
  const volRegime = classifyVolatilityRegime(candlesPrimary);
  steps.push(`📊 Vol Regime: ${volRegime.description}`);

  // 2. Equal Highs/Lows — detect clustered retail stop levels
  const allFVGs = [...fvgsOB, ...fvgsPrimary];
  const allOBs  = [...obsOB, ...obsPrimary];
  const eqHiLo  = detectEqualHighsLows(candlesPrimary, currentPrice);
  if (eqHiLo.eqh.length > 0) steps.push(`🎯 EQH: ${eqHiLo.eqh[0].label} @ $${eqHiLo.eqh[0].level.toFixed(2)}`);
  if (eqHiLo.eql.length > 0) steps.push(`🎯 EQL: ${eqHiLo.eql[0].label} @ $${eqHiLo.eql[0].level.toFixed(2)}`);

  // 3. ERL/IRL Liquidity Classification
  const liquidityMap = classifyLiquidityLevels(candlesStructure, allFVGs, allOBs, currentPrice);
  steps.push(`Liquidity: ${liquidityMap.erl.length} ERL levels | ${liquidityMap.irl.length} IRL levels`);

  // 4. Displacement validation on the most recent BOS/CHOCH candle
  const lastPrimaryShift = shiftsPrimary.length > 0 ? shiftsPrimary[shiftsPrimary.length - 1] : null;
  const lastShiftIdx = lastPrimaryShift ? lastPrimaryShift.candleIndex : -1;
  const dispValidation = lastShiftIdx >= 0
    ? validateDisplacement(closedPrimary, lastShiftIdx)
    : { valid: false, score: 0, reason: 'No recent BOS/CHOCH' };
  if (dispValidation.valid) steps.push(`✅ Displacement confirmed: ${dispValidation.reason}`);
  else steps.push(`⚠️ Weak displacement: ${dispValidation.reason}`);

  // ── Session ────────────────────────────────────────────────────
  const session   = getCurrentSession(symbol);
  const isHigherTF = activeTimeframe === '1h' || activeTimeframe === '4h' || activeTimeframe === '1d';
  const sessionOk = session.status === 'closed' ? false : (isHigherTF ? true : (session.status === 'optimal' || session.status === 'valid' ||
                    (profile.sessionAllowNyClose && session.status === 'caution')));
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
  if (weeklyBias?.bias === 'bullish') aiBullScore++;
  if (weeklyBias?.bias === 'bearish') aiBearScore++;
  if (fundingSentiment) {
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

  // Update funding sentiment alignment once direction is known
  if (direction && fundingSentiment) {
    let aligned = false;
    let confluenceWeight = 0.5;
    if (direction === 'long' && fundingSentiment.sentiment === 'overleveraged_shorts') {
      aligned = true;
      confluenceWeight = 1.0;
    } else if (direction === 'short' && fundingSentiment.sentiment === 'overleveraged_longs') {
      aligned = true;
      confluenceWeight = 1.0;
    } else if (
      (direction === 'long' && fundingSentiment.sentiment === 'overleveraged_longs') ||
      (direction === 'short' && fundingSentiment.sentiment === 'overleveraged_shorts')
    ) {
      aligned = false;
      confluenceWeight = -0.5;
    }
    fundingSentiment.aligned = aligned;
    fundingSentiment.confluenceWeight = confluenceWeight;
  }

  steps.push(`Direction: ${direction || 'RANGING'} | Bull: ${upProb}% Bear: ${downProb}%`);

  // ── Direction-dependent Institutional Logic ────────────────────
  let inducementData   = { hasInducement: false };
  let chochQuality     = { quality: 'LOW', score: 0, reasons: [] };
  let drawOnLiquidity  = null;

  if (direction) {
    // 5. Inducement detection — did price trap retail before the real move?
    inducementData = detectInducement(candlesPrimary, direction);
    if (inducementData.hasInducement)
      steps.push(`🪤 Inducement: ${inducementData.description}`);

    // 6. CHOCH quality — was it preceded by an ERL sweep + displacement?
    chochQuality = assessChochQuality(candlesPrimary, allSweeps, direction, lastShiftIdx);
    steps.push(`CHOCH Quality: ${chochQuality.quality} (${chochQuality.score}/100) — ${chochQuality.reasons.join(', ') || 'No sweep'}`);

    // 7. Draw on Liquidity — what is price targeting?
    drawOnLiquidity = identifyDrawOnLiquidity(candlesStructure, direction, currentPrice, allFVGs, allOBs);
    if (drawOnLiquidity?.description) steps.push(`📍 ${drawOnLiquidity.description}`);
  }

  // Apply ATR sizing multiplier to risk amount
  // In challenge mode, clamp risk to exactly the configured amount — no volatility scaling
  if (CHALLENGE_CONFIG.enabled) {
    adjustedRiskAmount = CHALLENGE_CONFIG.riskPerTrade;
  } else {
    adjustedRiskAmount = (adjustedRiskAmount || riskAmount) * (volRegime.sizingMultiplier || 1.0);
  }

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
      const isEliteSetup = chochQuality.quality === 'ELITE' || chochQuality.quality === 'HIGH' || inducementData.hasInducement;
      const rsiCross = detectRSISmaCross(candlesPrimary, 14, 14);
      const isOverride = isEliteSetup || rsiCross.crossUp || rsiDivResult.isOversold;
      
      if (isBearishCascade && !isOverride) {
        emaVetoActive = true;
        emaVetoReason = `Strict Long Veto: Price in strong Bearish EMA Cascade (20 < 50 < 200) without reversal confirmation`;
      } else if (!isOverride && (!hasRecentBullishChoch || !rsiDivResult.hasDivergence)) {
        emaVetoActive = true;
        emaVetoReason = `Long Veto: Price is below major EMAs without strong institutional setup, RSI Divergence, or RSI SMA Crossover`;
      }
    }
  } else if (direction === 'short' && primE50 && primE200) {
    const isBullishCascade = primE20 && primE20 > primE50 && primE50 > primE200;
    const aboveBothMajor   = currentPrice > primE50 && currentPrice > primE200;
    
    if (aboveBothMajor) {
      const hasRecentBearishChoch = allShifts.some(s => s.type === 'CHOCH' && s.direction === 'bearish');
      const rsiDivResult = detectRSIDivergence(candlesPrimary, 'short', 14);
      const isEliteSetup = chochQuality.quality === 'ELITE' || chochQuality.quality === 'HIGH' || inducementData.hasInducement;
      const rsiCross = detectRSISmaCross(candlesPrimary, 14, 14);
      const isOverride = isEliteSetup || rsiCross.crossDown || rsiDivResult.isOverbought;
      
      if (isBullishCascade && !isOverride) {
        emaVetoActive = true;
        emaVetoReason = `Strict Short Veto: Price in strong Bullish EMA Cascade (20 > 50 > 200) without reversal confirmation`;
      } else if (!isOverride && (!hasRecentBearishChoch || !rsiDivResult.hasDivergence)) {
        emaVetoActive = true;
        emaVetoReason = `Short Veto: Price is above major EMAs without strong institutional setup, RSI Divergence, or RSI SMA Crossover`;
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
  let earlyLeverage = 0;
  const MAX_LEVERAGE = 75;
  let leverageExceeded = false;

  if (direction) {
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

    // ── ATR & Wick Variance helpers (shared across SL logic) ──────
    const slAtr = primaryATR; // already computed above (calculateATR on primary candles)
    const minDistance = computeMinSlDistance(candlesPrimary, entry, activeTimeframe, symbol);

    // Average upper/lower wick size over last 20 candles — used as stop-hunt buffer
    const wickSample = candlesPrimary.slice(-20);
    const avgWickSize = wickSample.length > 0
      ? wickSample.reduce((sum, c) => {
          const upperWick = c.high - Math.max(c.open, c.close);
          const lowerWick = Math.min(c.open, c.close) - c.low;
          return sum + (direction === 'long' ? lowerWick : upperWick);
        }, 0) / wickSample.length
      : 0;

    // ── Sweep recency window (TF-based) ──────────────────────────
    // Only honour sweep wicks that are recent enough to be structurally relevant.
    // 5m → 12 candles (1 hr), 15m → 8 candles (2 hrs), 1h → 5 candles (5 hrs),
    // 4h → 4 candles (16 hrs), 1d → 3 candles (3 days)
    const SWEEP_RECENCY_CANDLES = { '5m': 12, '15m': 8, '1h': 5, '4h': 4, '1d': 3 };
    const maxSweepAge = SWEEP_RECENCY_CANDLES[activeTimeframe] ?? 8;
    const totalPrimary = candlesPrimary.length;
    const isRecentSweep = (s) => (totalPrimary - 1 - (s.candleIndex ?? 0)) <= maxSweepAge;

    // Find true structural swing points (confirmed swing highs/lows, not raw min/max)
    const primarySwings = findSwingPoints(candlesPrimary.slice(-50), profile.swingLookback);
    const nearestSwingLows  = primarySwings.filter(s => s.type === 'low'  && s.price < entry).sort((a, b) => b.price - a.price);
    const nearestSwingHighs = primarySwings.filter(s => s.type === 'high' && s.price > entry).sort((a, b) => a.price - b.price);

    // ── HTF Structure Fallback ─────────────────────────────────
    // If primary swing fails, look at structure TF for a better anchor.
    const structureSwings = findSwingPoints(
      candlesStructure.length > 20 ? candlesStructure.slice(-30) : candlesPrimary.slice(-50),
      profile.swingLookback
    );
    const htfSwingLows  = structureSwings.filter(s => s.type === 'low'  && s.price < entry).sort((a, b) => b.price - a.price);
    const htfSwingHighs = structureSwings.filter(s => s.type === 'high' && s.price > entry).sort((a, b) => a.price - b.price);

    // Pick the tightest valid level — primary preferred, HTF as fallback
    const bestSwingLow  = nearestSwingLows.length  > 0 ? nearestSwingLows[0].price
                        : htfSwingLows.length       > 0 ? htfSwingLows[0].price
                        : entry - minDistance;
    const bestSwingHigh = nearestSwingHighs.length > 0 ? nearestSwingHighs[0].price
                        : htfSwingHighs.length      > 0 ? htfSwingHighs[0].price
                        : entry + minDistance;

    // ── Asian Session SL Widening ────────────────────────────────
    // London Open expansions frequently blow through Asian session structural
    // levels. Widen the minimum distance by 1.35× when trading in Asian hours.
    const isAsianSession = session.name?.toLowerCase().includes('asian');
    const sessionSlMult  = isAsianSession ? 1.35 : 1.0;
    const effectiveMinDistance = minDistance * sessionSlMult;
    if (isAsianSession) steps.push(`🌏 Asian Session: SL minimum widened ×1.35 for London Open expansion`);

    // ── PRIMARY: SL beyond sweep/displacement candle wick (ICT correct) ──
    // The wickExtreme of the sweep candle is the TRUE invalidation level.
    // The BOS candle can be several candles after the actual sweep — using it
    // gives a misplaced SL that doesn't reflect the real structural swing.
    let inv = null;

    const relevantSweeps = direction === 'long'
      ? allSweeps.filter(s => s.type === 'bearish' && s.wickExtreme != null && s.wickExtreme < entry)
          .sort((a, b) => b.candleIndex - a.candleIndex)
      : allSweeps.filter(s => s.type === 'bullish' && s.wickExtreme != null && s.wickExtreme > entry)
          .sort((a, b) => b.candleIndex - a.candleIndex);

    if (relevantSweeps.length > 0) {
      inv = relevantSweeps[0].wickExtreme;
      steps.push(`📌 SL anchored to sweep wick extreme @ $${inv?.toFixed(ASSETS[symbol]?.decimals ?? 2)} (displacement candle)`);
    } else if (lastPrimaryShift && lastPrimaryShift.candleIndex != null) {
      // Fallback 1: BOS/CHoCH candle
      const shiftCandle = candlesPrimary[lastPrimaryShift.candleIndex];
      if (shiftCandle) {
        inv = direction === 'long' ? shiftCandle.low : shiftCandle.high;
        steps.push(`📌 SL fallback → BOS/CHoCH candle [${lastPrimaryShift.candleIndex}]: ${direction === 'long' ? 'low' : 'high'} = ${inv?.toFixed(2)}`);
      }
    }

    // FALLBACK: No BOS/CHoCH candle — use most recent swing high/low
    if (inv === null || (direction === 'long' && inv >= entry) || (direction === 'short' && inv <= entry)) {
      inv = null; // reset to let existing logic run
      if (direction === 'long') {
        // SL anchor priority for LONG:
        // 1) Demand OB lowerBound — the structural floor the OB is built on
        // 2) Most-recent RECENT bullish sweep wick low (time-filtered)
        // 3) Best swing low (primary → HTF fallback)
        if (nearestOB && nearestOB.lowerBound < entry) {
          inv = nearestOB.lowerBound;
          // Override with recent sweep wick only if it swept deeper than OB floor
          const recentBullSweeps = sweepsPrimary
            .filter(s => (s.direction === 'long' || s.type === 'bullish') && s.wickExtreme !== undefined && s.wickExtreme < entry && isRecentSweep(s))
            .sort((a, b) => b.candleIndex - a.candleIndex);
          if (recentBullSweeps.length > 0 && recentBullSweeps[0].wickExtreme < inv) {
            inv = recentBullSweeps[0].wickExtreme;
            steps.push(`🪤 SL anchored to recent sweep wick low @ $${inv.toFixed(ASSETS[symbol]?.decimals ?? 2)} (within ${maxSweepAge} candles)`);
          }
        } else {
          // No OB: anchor to most recent (time-filtered) sweep wick low, then HTF swing
          const recentBullSweeps = [
            ...sweepsPrimary.filter(s => (s.direction === 'long' || s.type === 'bullish') && s.wickExtreme !== undefined && s.wickExtreme < entry && isRecentSweep(s)),
            ...sweepsStructure.filter(s => (s.direction === 'long' || s.type === 'bullish') && s.wickExtreme !== undefined && s.wickExtreme < entry && isRecentSweep(s)),
          ].sort((a, b) => b.candleIndex - a.candleIndex);
          if (recentBullSweeps.length > 0) {
            inv = recentBullSweeps[0].wickExtreme;
            steps.push(`🪤 SL anchored to recent sweep wick low @ $${inv.toFixed(ASSETS[symbol]?.decimals ?? 2)}`);
          } else {
            inv = bestSwingLow;
            const anchor = nearestSwingLows.length > 0 ? 'Primary' : 'HTF';
            steps.push(`📌 SL anchored to ${anchor} swing low @ $${inv.toFixed(ASSETS[symbol]?.decimals ?? 2)}`);
          }
        }

        // Safety guard: SL must be below entry
        if (inv >= entry) inv = bestSwingLow;
        // Enforce session-aware minimum distance
        if (entry - inv < effectiveMinDistance) inv = entry - effectiveMinDistance;
      } else {
        // SL anchor priority for SHORT:
        // 1) Supply OB upperBound — structural ceiling
        // 2) Most-recent RECENT bearish sweep wick high (time-filtered)
        // 3) Best swing high (primary → HTF fallback)
        if (nearestOB && nearestOB.upperBound > entry) {
          inv = nearestOB.upperBound;
          const recentBearSweeps = sweepsPrimary
            .filter(s => (s.direction === 'short' || s.type === 'bearish') && s.wickExtreme !== undefined && s.wickExtreme > entry && isRecentSweep(s))
            .sort((a, b) => b.candleIndex - a.candleIndex);
          if (recentBearSweeps.length > 0 && recentBearSweeps[0].wickExtreme > inv) {
            inv = recentBearSweeps[0].wickExtreme;
            steps.push(`🪤 SL anchored to recent sweep wick high @ $${inv.toFixed(ASSETS[symbol]?.decimals ?? 2)} (within ${maxSweepAge} candles)`);
          }
        } else {
          const recentBearSweeps = [
            ...sweepsPrimary.filter(s => (s.direction === 'short' || s.type === 'bearish') && s.wickExtreme !== undefined && s.wickExtreme > entry && isRecentSweep(s)),
            ...sweepsStructure.filter(s => (s.direction === 'short' || s.type === 'bearish') && s.wickExtreme !== undefined && s.wickExtreme > entry && isRecentSweep(s)),
          ].sort((a, b) => b.candleIndex - a.candleIndex);
          if (recentBearSweeps.length > 0) {
            inv = recentBearSweeps[0].wickExtreme;
            steps.push(`🪤 SL anchored to recent sweep wick high @ $${inv.toFixed(ASSETS[symbol]?.decimals ?? 2)}`);
          } else {
            inv = bestSwingHigh;
            const anchor = nearestSwingHighs.length > 0 ? 'Primary' : 'HTF';
            steps.push(`📌 SL anchored to ${anchor} swing high @ $${inv.toFixed(ASSETS[symbol]?.decimals ?? 2)}`);
          }
        }

        // Safety guard: SL must be above entry
        if (inv <= entry) inv = bestSwingHigh;
        // Enforce session-aware minimum distance
        if (inv - entry < effectiveMinDistance) inv = entry + effectiveMinDistance;
      }
      
      // If still null after all that, use most recent swing
      if (inv === null) {
        if (direction === 'long' && nearestSwingLows?.length > 0) {
          inv = nearestSwingLows[0].price;
          steps.push(`SL fallback: most recent swing low = ${inv?.toFixed(2)}`);
        } else if (direction === 'short' && nearestSwingHighs?.length > 0) {
          inv = nearestSwingHighs[0].price;
          steps.push(`SL fallback: most recent swing high = ${inv?.toFixed(2)}`);
        }
      }
    }

    // ── Thesis Invalidation Cross-Check ─────────────────────────
    // If the BOS/CHOCH structural level has been violated by recent closed
    // candles, the setup is no longer valid.
    //
    // Two-part guard against false vetoes:
    // 1. PULLBACK EXCEPTION: If entry is on the far side of BOS (e.g. short
    //    entry ABOVE BOS level) → skip entirely. That is a normal pullback
    //    entry — the SL handles invalidation.
    // 2. LOOKBACK LIMIT: Only check the last 10 candles, not the full history
    //    since the BOS. A temporary cross that happened 30 candles ago and
    //    since re-established structure should NOT veto a valid current setup.
    const THESIS_LOOKBACK = 10;
    const thesisBroken = (() => {
      if (!lastPrimaryShift) return false;
      const triggerIdx   = lastPrimaryShift.candleIndex;
      const allSince     = candlesPrimary.slice(triggerIdx + 1);
      if (allSince.length === 0) return false;
      // Only inspect last 10 candles — older violations are stale
      const recentClosed = allSince.slice(-THESIS_LOOKBACK);
      const shiftLevel   = lastPrimaryShift.price ?? lastPrimaryShift.level;
      if (!shiftLevel) return false;

      if (direction === 'long') {
        // Pullback LONG: entry below BOS (demand zone) is normal — skip
        if (entry < shiftLevel) return false;
        return recentClosed.some(c => c.close < shiftLevel);
      } else {
        // Pullback SHORT: entry above BOS (supply zone) is normal — skip
        if (entry > shiftLevel) return false;
        return recentClosed.some(c => c.close > shiftLevel);
      }
    })();
    if (thesisBroken) {
      slSideInvalid = true;
      steps.push(`⚠️ THESIS INVALIDATED: BOS/CHOCH level recently closed through — structural edge lost`);
    }


    // ── EMA200 Confluence SL Snap ────────────────────────────────────────
    // If the structural inv is within 0.5% of the HTF EMA200, snap SL just
    // beyond EMA200. When structure AND EMA200 converge, EMA200 is the
    // stronger institutional level — price respects it more cleanly.
    if (inv && e200b && e200b > 0) {
      const pctDiff = Math.abs(inv - e200b) / e200b;
      if (pctDiff < 0.005) { // within 0.5% of EMA200
        const dec = ASSETS[symbol]?.decimals ?? 2;
        if (direction === 'long' && e200b < entry) {
          // EMA200 is below entry (acting as support) → SL just below it
          const snapped = e200b * 0.9990; // 0.1% below EMA200
          if (snapped < entry) {
            inv = snapped;
            steps.push(`📌 SL snapped below EMA200 @ $${e200b.toFixed(dec)} (structure + EMA200 confluence)`);
          }
        } else if (direction === 'short' && e200b > entry) {
          // EMA200 is above entry (acting as resistance) → SL just above it
          const snapped = e200b * 1.0010; // 0.1% above EMA200
          if (snapped > entry) {
            inv = snapped;
            steps.push(`📌 SL snapped above EMA200 @ $${e200b.toFixed(dec)} (structure + EMA200 confluence)`);
          }
        }
      }
    }

    // Pass ATR and avgWickSize to calculateSmartSL for improved capping
    slData = calculateSmartSL(inv, direction, allFVGs, symbol, fibData, volumeProfile, slAtr, avgWickSize);

    
    // Stop Loss side validation (H2)
    if (slData) {
      if (direction === 'long' && slData.value >= entry) slSideInvalid = true;
      if (direction === 'short' && slData.value <= entry) slSideInvalid = true;
    }

    // ── CME Gap Risk Shield ──────────────────────────────────
    let cmeRiskShieldActive = false;
    if (cmeGapData.hasUnfilledGaps && cmeGapData.nearestGap) {
      const nearest = cmeGapData.nearestGap;
      const opposing = (direction === 'long' && nearest.direction === 'up') ||
                       (direction === 'short' && nearest.direction === 'down');
      if (opposing && nearest.distToGapPct < 3.0) {
        adjustedRiskAmount = adjustedRiskAmount * 0.5; // Cut risk by 50%
        cmeRiskShieldActive = true;
      }
    }

    const decimals = ASSETS[symbol]?.decimals ?? 2;
    // Compute position size once (L1) and pass symbol for step rounding (C6)
    posSize = (slData && !slSideInvalid) ? calculatePositionSize(entry, slData.value, adjustedRiskAmount, symbol) : 0;
    
    // ── Filter A: Pre-calculate leverage for max leverage gate ──
    earlyLeverage = (posSize > 0 && entry > 0 && balance > 0)
      ? (posSize * entry) / balance
      : 0;
    leverageExceeded = earlyLeverage > MAX_LEVERAGE;

    steps.push(`Entry: ${entry.toFixed(decimals)} | SL: ${slData ? slData.value.toFixed(decimals) : 'N/A'} | SL%: ${slData ? ((Math.abs(entry - slData.value) / entry) * 100).toFixed(2) + '%' : 'N/A'} | Size: ${posSize} units | Leverage: ${earlyLeverage.toFixed(1)}x`);
    
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
  const rsiCross       = detectRSISmaCross(candlesPrimary, 14, 14);
  const rsiCrossAligned = direction === 'long' ? rsiCross.crossUp : rsiCross.crossDown;
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
  const fundingAligned = direction && (
    (direction === 'long'  && fundingSentiment.sentiment === 'overleveraged_shorts') ||
    (direction === 'short' && fundingSentiment.sentiment === 'overleveraged_longs')
  );
  if (fundingAligned) steps.push(`✓ Funding Rate: ${fundingSentiment.fundingRatePct} — Crowd ${fundingSentiment.sentiment === 'overleveraged_longs' ? 'long' : 'short'} (Contrarian ${direction})`);

  // Weekly Open bias
  const weeklyBiasAligned = weeklyBias && direction && (
    (direction === 'long' && weeklyBias.bias === 'bullish') ||
    (direction === 'short' && weeklyBias.bias === 'bearish')
  );

  const preRrrChecks = [
    // ── SMC Structure (High Weight) ───────────────────────────────
    { label: `${profile.biasKey.toUpperCase()} Trend Aligned`,                   met: trend4HAligned,          weight: 1.5  },
    { label: 'Liquidity Sweep / FVG Fill',                                        met: liquidityEvent,          weight: 1.5  },
    { label: `${profile.primaryKey.toUpperCase()}/${profile.structureKey.toUpperCase()} BOS/CHOCH`, met: structureShift, weight: 1.5  },
    { label: 'Near Valid Order Block',                                            met: nearOB,                  weight: 1.25 },
    { label: 'Near Breaker Block (Flipped S/R)',                                  met: nearBreaker,             weight: 1.25 },
    // ── Price Position ────────────────────────────────────────────
    { label: 'Entry in OTE Zone (61.8–78.6%)',                                   met: inOTE,                   weight: 1.0  },
    { label: `Entry in ${direction === 'long' ? 'Discount' : 'Premium'} Zone`,  met: inCorrectZone,           weight: 0.5  },
    { label: 'Fibonacci Golden Pocket (0.618–0.705)',                             met: inGoldenPocket,          weight: 1.5  },
    // ── Trend Confirmation ────────────────────────────────────────
    { label: 'Daily Bias Aligned (EMA200)',                                      met: dailyAligned,            weight: 1.0  },
    { label: 'EMA200 Acting as S/R',                                             met: ema200Acting,            weight: 0.75 },
    { label: 'VWAP Aligned',                                                      met: vwapAligned,             weight: 1.0  },
    // ── AI Momentum ──────────────────────────────────────────────
    { label: 'MACD Momentum Aligned',                                            met: !!macdAligned,           weight: 1.25 },
    { label: 'Stochastic RSI Extreme (OS/OB)',                                   met: !!stochAligned,          weight: 1.0  },
    { label: 'Bollinger Band Signal',                                             met: !!bbAligned,             weight: 0.75 },
    { label: `Wyckoff ${wyckoffPhase?.phase || ''} Signal`,                     met: !!wyckoffAligned,        weight: 1.5  },
    // ── Volume & Divergence ──────────────────────────────────────
    { label: 'Volume POC Confluence',                                             met: atPOC,                   weight: 1.25 },
    { label: 'RSI Divergence',                                                    met: rsiResult.hasDivergence, weight: 1.0  },
    { label: 'RSI SMA Crossover (Trend Change)',                                  met: rsiCrossAligned,         weight: 0.5  },
    { label: 'OBV Smart Money Divergence',                                        met: !!obvAligned,            weight: 1.0  },
    { label: 'Hidden Divergence (Trend Continuation)',                            met: hiddenDiv.hasHiddenDiv,  weight: 0.75 },
    { label: 'Candlestick Pattern Confirmed',                                     met: hasCandlePattern,        weight: 1.0  },
    // ── Session & Sentiment ──────────────────────────────────────
    { label: 'Active Trading Session',                                            met: sessionOk,               weight: 0.75 },
    { label: 'Kill Zone Active',                                                  met: killZone.inKillZone,     weight: 0.75 },
    { label: 'CME Gap Bias Aligned',                                              met: cmeGapAligned,           weight: 0.75 },
    { label: 'Funding Rate Contrarian Signal',                                    met: fundingAligned,          weight: 0.75 },
    { label: 'Weekly Open Bias Aligned',                                          met: !!weeklyBiasAligned,     weight: 0.75 },
    // ── Institutional Quality (v11) ──────────────────────────────
    { label: 'Displacement Confirmed (BOS/CHOCH)',                                met: dispValidation.valid,    weight: 1.5  },
    { label: 'Inducement Detected (Stop Hunt)',                                   met: inducementData.hasInducement, weight: 1.25 },
    { label: 'CHOCH Quality: HIGH+ (ERL Sweep + Disp)',                          met: chochQuality.quality === 'ELITE' || chochQuality.quality === 'HIGH', weight: 1.5 },
    { label: 'Draw on Liquidity Identified',                                      met: !!(drawOnLiquidity?.primary), weight: 1.0 },
    { label: 'Volatility Regime: Optimal (Contracting/Transitioning)',            met: volRegime.regime === 'CONTRACTING' || volRegime.regime === 'TRANSITIONING', weight: 0.75 },
    { label: 'Equal High/Low Liquidity Pool Above/Below',                        met: direction === 'long' ? eqHiLo.eqh.length > 0 : eqHiLo.eql.length > 0, weight: 1.0 },
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

    // ── Inject EQH/EQL as high-priority TP targets ─────────────
    if (direction === 'long') {
      (eqHiLo.eqh || []).filter(l => l.level > entry).forEach(l => {
        tpSwingPool.push({ price: l.level, type: 'high', reason: l.label + ' — Liquidity Target', tf: 'EQH', priority: l.priority });
      });
    } else {
      (eqHiLo.eql || []).filter(l => l.level < entry).forEach(l => {
        tpSwingPool.push({ price: l.level, type: 'low', reason: l.label + ' — Liquidity Target', tf: 'EQL', priority: l.priority });
      });
    }

    // ── Inject Draw on Liquidity as TP pool targets ─────────────
    if (drawOnLiquidity) {
      [drawOnLiquidity.primary, drawOnLiquidity.secondary, drawOnLiquidity.tertiary].forEach(draw => {
        if (!draw) return;
        if ((direction === 'long' && draw.level > entry) || (direction === 'short' && draw.level < entry)) {
          tpSwingPool.push({ price: draw.level, type: direction === 'long' ? 'high' : 'low',
            reason: `Draw: ${draw.label}`, tf: 'DRAW', priority: draw.priority });
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

  // ── Trailing TP Calculation (Bybit-Compatible) ──────────────────
  // Activation Price: 75% of the distance from entry to TP1 — trailing
  // only activates after a meaningful move to avoid premature exits.
  // Trailing Amount: 1.5× ATR — rides momentum but exits on genuine reversal.
  // Callback Rate: trailing amount as % of activation price (for Bybit UI).
  let trailingTP = null;
  if (direction && tpData?.tps?.[0] && slData && primaryATR && primaryATR > 0) {
    const tp1Level    = tpData.tps[0].level;
    const entryToTp1  = Math.abs(tp1Level - entry);
    const isLong      = direction === 'long';
    const priceDecimals = ASSETS[symbol]?.decimals ?? 2;

    // Activation at 75% of the way to TP1
    const activationPrice = isLong
      ? entry + entryToTp1 * 0.75
      : entry - entryToTp1 * 0.75;

    // Trailing amount = 1.5× ATR (volatility-calibrated callback)
    const trailingAmount = primaryATR * 1.5;

    // Callback rate as percentage (what Bybit uses)
    const callbackRate = (trailingAmount / activationPrice) * 100;

    // Minimum profit if trailing triggers at activation = activation - trailing - entry
    const minProfitIfTrailed = isLong
      ? (activationPrice - trailingAmount) - entry
      : entry - (activationPrice + trailingAmount);
    const minProfitDollar = Math.max(0, minProfitIfTrailed * posSize);

    trailingTP = {
      activationPrice:  parseFloat(activationPrice.toFixed(priceDecimals)),
      trailingAmount:   parseFloat(trailingAmount.toFixed(priceDecimals)),
      callbackRate:     parseFloat(callbackRate.toFixed(2)),
      tp1Level:         tp1Level,
      minProfitIfTrailed: parseFloat(minProfitDollar.toFixed(2)),
      explanation:      `Trail activates at ${((entryToTp1 * 0.75 / entry) * 100).toFixed(2)}% move (75% of TP1). Callback: ${callbackRate.toFixed(2)}% (1.5× ATR).`,
    };

    steps.push(`📈 Trailing TP: Activate @ $${trailingTP.activationPrice.toFixed(priceDecimals)} | Trail: $${trailingTP.trailingAmount.toFixed(priceDecimals)} (${trailingTP.callbackRate}%) | Min Profit: $${trailingTP.minProfitIfTrailed}`);
  }

  // ── Final Score ────────────────────────────────────────────────
  const tp1Rrr      = tpData?.tps?.[0]?.rrr ?? 0;

  // ── RRR Filters ──────────────────────────────────────────────
  const effectiveMinRrr = profile.minRrr || 2.0;
  const rrrMeetsMin = tp1Rrr >= effectiveMinRrr;

  // Full check list including RRR
  const checks = [
    ...preRrrChecks,
    { label: `RRR ≥ 1:${effectiveMinRrr.toFixed(0)} (Structural)`, met: rrrMeetsMin, weight: 1.5 },
  ];

  const totalWeight     = checks.reduce((s, c) => s + c.weight, 0);
  const scoredWeight    = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const rawPct          = scoredWeight / totalWeight;
  // Confidence curve: sqrt maps 30% raw → 55%, 50% raw → 71%, 70% raw → 84%
  const aiConfidence    = Math.round(Math.sqrt(rawPct) * 100);
  const aiGrade         = aiConfidence >= 90 ? 'ELITE'
                        : aiConfidence >= 75 ? 'STRONG'
                        : aiConfidence >= 55 ? 'MODERATE'
                        : aiConfidence >= 40 ? 'MARGINAL'
                        : 'SKIP';

  // ── Filter B: Min Confluence Count Gate ─────────────────────
  // Require at least 25% of checks (or 6 checks) to be met.
  // Bypass if signal grade is A/A+ or AI confidence is sufficient.
  const checksMetCount = preRrrChecks.filter(c => c.met).length;
  const checksTotalCount = preRrrChecks.length;
  const checksMetPct = checksTotalCount > 0 ? checksMetCount / checksTotalCount : 0;
  const minConfluenceCountOk = checksMetPct >= 0.25 || checksMetCount >= 6;

  // ── Signal Grade (A+ / A / B / C / D) ─────────────────────────
  const inOTECheck = checks.find(c => c.label.includes('OTE Zone'));
  const atPOCCheck = checks.find(c => c.label.includes('Volume POC'));
  const signalGrade = calculateSignalGrade({
    chochQuality,
    displacementScore:  dispValidation.score,
    hasSweep:           allSweeps.length > 0,
    hasInducement:      inducementData.hasInducement,
    mtfAligned:         trend4HAligned && dailyAligned,
    mtfPartial:         trend4HAligned || dailyAligned,
    drawAligned:        !!(drawOnLiquidity?.primary),
    volatilityRegime:   volRegime.regime,
    rrrMet:             rrrMeetsMin,
    inOTE:              inOTECheck?.met || false,
    atPOC:              atPOCCheck?.met || false,
    rsiCrossAligned,
  });
  steps.push(`🏆 Signal Grade: ${signalGrade.grade} — ${signalGrade.label} (${signalGrade.score}/100)`);

  // ── Decision (AI Confidence-driven) ────────────────────────────
  let decision        = 'NO_TRADE';
  let rejectionReason = null;

  // Compute entry distance percentage (divided by currentPrice - L2)
  const entryDistPct = direction ? Math.abs(currentPrice - entry) / currentPrice : 0;

  if (!direction) {
    rejectionReason = `Market ranging — no ${profile.biasKey.toUpperCase()} directional bias & AI consensus insufficient`;
  } else if (emaVetoActive) {
    rejectionReason = emaVetoReason;
  } else if (!slData) {
    rejectionReason = `No valid Stop Loss level found for this structure`;
  } else if (slSideInvalid) {
    // Distinguish thesis broken vs truly wrong SL side
    const shiftLevel = lastPrimaryShift ? (lastPrimaryShift.price ?? lastPrimaryShift.level) : null;
    rejectionReason = `⚠️ THESIS INVALIDATED — Structure closed against signal level (${direction === 'long' ? 'bearish' : 'bullish'} close through ${shiftLevel?.toFixed(2) ?? slData?.rawInvalidation?.toFixed(2) ?? 'key level'}). Wait for re-establishment.`;
  } else if (entryDistPct > profile.maxEntryDist) {
    if (aiConfidence >= profile.minAiConfidence && rrrMeetsMin) {
      decision = 'WAIT';
      const limitOrderPrice = oteZone?.midpoint || entry;
      const limitLabel = oteZone ? `Limit @ OTE ${formatLimitPrice(limitOrderPrice, symbol)}` : `Limit @ ${formatLimitPrice(entry, symbol)}`;
      rejectionReason = `Price ${(entryDistPct * 100).toFixed(2)}% from entry — ${limitLabel}`;
    } else {
      rejectionReason = `Price too far from entry zone: ${(entryDistPct * 100).toFixed(2)}% > ${(profile.maxEntryDist * 100).toFixed(2)}% max for ${profile.label}`;
    }
  } else if (isVolatilitySpike) {
    // Filter D: Reject during extreme parabolic non-directional volatility spikes
    rejectionReason = `Volatility spike: current candle body (${(volSpikeRatio).toFixed(1)}x ATR) exceeds 4.5x ATR — wait for pullback`;
  } else if (slPct > profile.maxSlPct) {
    rejectionReason = `SL too wide: ${(slPct * 100).toFixed(2)}% > ${(profile.maxSlPct * 100).toFixed(2)}% max for ${profile.label}`;
  } else if (leverageExceeded) {
    // Filter A: Reject if effective leverage exceeds 75x
    rejectionReason = `Leverage too high: ${earlyLeverage.toFixed(1)}x > ${MAX_LEVERAGE}x cap — SL too tight for account size`;
  } else if (!rrrMeetsMin) {
    rejectionReason = `RRR too low: ${tp1Rrr.toFixed(2)} < ${effectiveMinRrr.toFixed(1)} minimum`;
  } else if (!minConfluenceCountOk && signalGrade.grade !== 'A+' && signalGrade.grade !== 'A') {
    // Filter B: Reject if too few confluence checks are met (by count)
    rejectionReason = `Low confluence: only ${checksMetCount}/${checksTotalCount} checks met (${(checksMetPct * 100).toFixed(0)}% < 25% min)`;
  } else if (aiConfidence < profile.minAiConfidence && signalGrade.grade !== 'A+' && signalGrade.grade !== 'A') {
    rejectionReason = `AI Confidence too low: ${aiConfidence}% < ${profile.minAiConfidence}% min for ${profile.label} (Inst Grade: ${signalGrade.grade})`;
  } else {
    decision = 'TAKE_NOW';
  }

  // ── SMC Rule: Validate 1:4 TP is structurally clear ────────────────
  if (direction && slData && entry) {
    const slDist = Math.abs(entry - slData.value);
    const tp4R = direction === 'long' ? entry + slDist * 4 : entry - slDist * 4;
  
    // ── Obstacle Filter: HTF OBs + EQH/EQL only (correct SMC filter) ─────
    // Rationale: 5m micro-OBs and individual swing highs are NOT obstacles for
    // a 4R move. Only HTF institutional OBs and equal highs/lows (liquidity
    // pools with multiple touches) are real reversal magnets that block price.
    const obstacles = [];

    // HTF OBs only (obsOB = bias/structure timeframe, NOT obsPrimary = 5m)
    for (const ob of (obsOB || [])) {
      if (ob.status !== 'active') continue;
      const obMid = (ob.high + ob.low) / 2;
      if (direction === 'long' && ob.type === 'supply' && obMid > entry && obMid < tp4R) {
        obstacles.push({ reason: `HTF Supply OB`, level: obMid });
      } else if (direction === 'short' && ob.type === 'demand' && obMid < entry && obMid > tp4R) {
        obstacles.push({ reason: `HTF Demand OB`, level: obMid });
      }
    }

    // EQH and EQL are NOT obstacles — they are DRAW ON LIQUIDITY targets.
    // For LONG: Equal Highs above price = where price is going (target, not blocker)
    // For SHORT: Equal Lows below price = where price is going (target, not blocker)
    // Only HTF OBs (supply/demand) are real institutional obstacles.
  
    // Build smcAnalysis object for UI
    const bos = allShifts?.find(s => !s.isChoch);
    const choch = allShifts?.find(s => s.isChoch);
    const recentSweep = allSweeps?.length > 0 ? allSweeps[allSweeps.length - 1] : null;
    const nearActiveOB = direction === 'long'
      ? [...(obsOB || []), ...(obsPrimary || [])].find(o => o.type === 'demand' && o.status === 'active')
      : [...(obsOB || []), ...(obsPrimary || [])].find(o => o.type === 'supply' && o.status === 'active');
    const nearActiveFVG = direction === 'long'
      ? allFVGs?.find(f => !f.filled && f.type === 'bullish')
      : allFVGs?.find(f => !f.filled && f.type === 'bearish');
    // eqHiLo fields: { eqh: [...], eql: [...] } — each has .level, .label, .priority
    const structTarget = direction === 'long'
      ? (eqHiLo?.eqh?.[0] || drawOnLiquidity)
      : (eqHiLo?.eql?.[0] || drawOnLiquidity);
  
    const tp4RAchievable = obstacles.length === 0;
  
    smcAnalysis = {
      bos: bos ? { confirmed: true, level: bos.price ?? bos.level, tf: profile.primaryKey } : { confirmed: false },
      choch: choch ? { confirmed: true, level: choch.price ?? choch.level } : { confirmed: false },
      liquiditySweep: recentSweep ? { confirmed: true, level: recentSweep.sweptLevel ?? recentSweep.level, direction: recentSweep.direction } : { confirmed: false },
      orderBlock: nearActiveOB ? { confirmed: true, high: nearActiveOB.high, low: nearActiveOB.low, type: nearActiveOB.type } : { confirmed: false },
      fvg: nearActiveFVG ? { confirmed: true, upper: nearActiveFVG.upper, lower: nearActiveFVG.lower, type: nearActiveFVG.type } : { confirmed: false },
      structuralTarget: structTarget ? { level: structTarget.price ?? structTarget.level ?? structTarget.eqPrice, description: structTarget.description ?? structTarget.type ?? 'Liquidity Draw' } : null,
      tp4R,
      tp4RAchievable,
      obstacles,
      slLevel: slData?.value,
    };
  
    // Price-magnitude-aware formatter for rejection messages
    const fmtP = (v) => {
      if (!v) return '?';
      if (v < 0.01)  return v.toFixed(6);
      if (v < 1)     return v.toFixed(5);
      if (v < 100)   return v.toFixed(4);
      if (v < 10000) return v.toFixed(2);
      return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    };

    // HYBRID REJECTION: Only reject if obstacle blocks path to TP1 (40% close level)
    // If obstacle is only between TP1→4R, allow — partial at TP1 protects capital
    const tp1Level = tpData?.tps?.[0]?.level; // first partial exit level (~1.5R)
    const criticalObstacles = obstacles.filter(o =>
      direction === 'long'
        ? (tp1Level ? o.level < tp1Level : true)   // obstacle before TP1
        : (tp1Level ? o.level > tp1Level : true)    // obstacle before TP1 (shorts: TP1 is below entry)
    );
    const warningObstacles = obstacles.filter(o =>
      direction === 'long'
        ? (tp1Level ? o.level >= tp1Level : false)
        : (tp1Level ? o.level <= tp1Level : false)
    );

    if (criticalObstacles.length > 0 && decision === 'TAKE_NOW') {
      // Obstacle before TP1 — can't even get first partial → reject
      decision = 'NO_TRADE';
      rejectionReason = `🚧 Trade skipped — ${criticalObstacles[0].reason} at $${fmtP(criticalObstacles[0].level)} blocks path before TP1 ($${fmtP(tp1Level)}). No partial exit achievable.`;
      steps.push(`1:4 PATH BLOCKED before TP1: ${criticalObstacles.map(o => `${o.reason} @ $${fmtP(o.level)}`).join(', ')}`);
    } else if (warningObstacles.length > 0) {
      // Obstacle between TP1 and 4R — partial at TP1 protects capital, allow trade
      steps.push(`⚠️ ${warningObstacles[0].reason} at $${fmtP(warningObstacles[0].level)} between TP1→4R — TP1 partial (40%) protects capital`);
    } else {
      steps.push(`✅ Path clear: No HTF obstacles between entry and 1:4 target ($${fmtP(tp4R)})`);
    }

    // Update smcAnalysis achievability based on critical obstacles only
    if (smcAnalysis) {
      smcAnalysis.tp4RAchievable = criticalObstacles.length === 0;
      smcAnalysis.obstacles = criticalObstacles;
    }
  }

  // ── Filter C: News Caution Downgrade ──────────────────────────
  // During NY Economic Release window (12:30-15:00 UTC), downgrade TAKE_NOW to WAIT
  // unless Signal Grade is A+ or AI Confidence >= 75%.
  let newsCaution = false;
  let newsCautionReason = null;
  if (newsStatus.caution) {
    newsCaution = true;
    newsCautionReason = newsStatus.reason || 'Economic release window active';
    if (decision === 'TAKE_NOW' && signalGrade.grade !== 'A+' && aiConfidence < 75) {
      decision = 'WAIT';
      rejectionReason = `News Caution: ${newsCautionReason} — wait for post-event BOS confirmation`;
      steps.push(`⚠️ News Caution Downgrade: TAKE_NOW → WAIT (${newsCautionReason})`);
    }
  }

  steps.push(`→ ${decision} | AI: ${aiConfidence}% ${aiGrade}`);
  if (rejectionReason) steps.push(`Rejected: ${rejectionReason}`);

  // ── Smart Trade Duration Engine ────────────────────────────────
  // Multi-factor model accounting for:
  //   1. ATR-based candle velocity (base)
  //   2. Volatility regime (expanding vs contracting)
  //   3. Market structure quality (CHOCH / displacement)
  //   4. Session type (kill zone vs normal vs off-hours)
  //   5. Volume profile (POC confluence = faster fills)
  //   6. Liquidity sweep presence (price already induced = faster)
  //   7. Draw on Liquidity clarity (clear target = faster)
  //   8. OTE entry quality (deep OTE = faster reaction)
  //   9. RRR magnitude (higher RRR = longer hold)
  //  10. Wyckoff phase alignment
  // ────────────────────────────────────────────────────────────────
  const tfMinutesMap = { '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
  const tfMins = tfMinutesMap[activeTimeframe] || 15;
  const tp1Price = tpData?.tps?.[0]?.level || (direction === 'long' ? entry * 1.01 : entry * 0.99);
  const distToTp1 = Math.abs(entry - tp1Price);
  const currentAtr = primaryATR || (entry * 0.005);

  // 1. Base: ATR velocity — how many candles to cover TP1 distance
  //    Institutional moves fill ~0.7 ATR per candle directionally
  const baseCandlesToTp1 = currentAtr > 0 ? Math.ceil(distToTp1 / (currentAtr * 0.7)) : 4;

  // 2. Volatility Regime Multiplier
  //    EXPANDING = fast momentum; CONTRACTING = slow build-up before pop
  //    TRANSITIONING = moderate; EXTREME = erratic, slower reliable fill
  const volMultiplier =
    volRegime.regime === 'EXPANDING'      ? 0.65  // fast directional
    : volRegime.regime === 'TRANSITIONING'  ? 0.85  // building
    : volRegime.regime === 'CONTRACTING'    ? 1.25  // tight — takes longer for price to pop
    : volRegime.regime === 'EXTREME'        ? 1.45  // erratic — harder to fill cleanly
    : 1.0;

  // 3. Structure Quality Multiplier (CHOCH + displacement strength)
  //    Elite setup with confirmed displacement fills faster
  const structQuality = chochQuality.quality === 'ELITE' ? 0.70
    : chochQuality.quality === 'HIGH'   ? 0.82
    : chochQuality.quality === 'MEDIUM' ? 1.00
    : 1.20;  // LOW or no CHOCH quality = slower drift

  // 4. Session Speed Multiplier
  //    Kill zone = peak institutional, very fast fills
  //    London-NY Overlap = optimal; Asian = slow drift
  const sessionSpeed =
    killZone.inKillZone                              ? 0.65  // peak institutional activity
    : session.name.includes('London–NY')             ? 0.75  // optimal overlap
    : session.name.includes('London Open')           ? 0.80  // strong London flow
    : session.name.includes('NY Session')            ? 0.85  // NY flow
    : session.name.includes('London Session')        ? 0.90  // standard
    : session.name.includes('NY Close')              ? 1.30  // winding down, slow
    : session.name.includes('Asian')                 ? 1.50  // low volume, drift
    : 1.10;  // pre-market or unknown

  // 5. Volume Profile bonus — if at POC, orders fill faster
  const pocBonus = atPOC ? 0.88 : 1.0;

  // 6. Liquidity Sweep bonus — price already swept inducement, clean path
  const sweepBonus = allSweeps.length > 0 ? 0.90 : 1.05;

  // 7. Draw on Liquidity clarity
  const drawBonus = drawOnLiquidity?.primary ? 0.85 : 1.0;

  // 8. OTE entry quality — deep OTE = spring-loaded, fills very fast
  const oteBonus = inOTE ? 0.80 : 1.0;

  // 9. RRR magnitude — higher RRR means TP1 is further, takes longer
  const rrrFactor = tp1Rrr > 0 ? Math.max(0.8, Math.min(1.6, tp1Rrr / 3.0)) : 1.0;

  // 10. Wyckoff phase — Markup / Markdown = fast; Accumulation = slow; Spring = very fast
  const wyckoffSpeed =
    wyckoffPhase?.phase === 'Markup'     ? 0.72
    : wyckoffPhase?.phase === 'Markdown' ? 0.72
    : wyckoffPhase?.phase === 'Spring'   ? 0.60  // spring is explosive
    : wyckoffPhase?.phase === 'Accumulation' ? 1.35
    : wyckoffPhase?.phase === 'Distribution' ? 1.35
    : 1.0;

  // 11. Inducement presence — stop hunt already done, move is clean
  const inducementBonus = inducementData.hasInducement ? 0.82 : 1.0;

  // Composite multiplier (product of all factors)
  const compositeMultiplier =
    volMultiplier * structQuality * sessionSpeed *
    pocBonus * sweepBonus * drawBonus * oteBonus *
    rrrFactor * wyckoffSpeed * inducementBonus;

  // Final estimated candles, clamp to sensible range
  const estCandles = Math.max(1, Math.round(baseCandlesToTp1 * compositeMultiplier));

  // Convert to minutes with min/max spread
  const avgEstMins  = Math.max(tfMins, estCandles * tfMins);
  const minEstMins  = Math.max(tfMins,    Math.round(avgEstMins * 0.55));
  const maxEstMins  = Math.max(tfMins * 2, Math.round(avgEstMins * 1.55));

  // Format helper
  const formatDurationLabel = (mins) => {
    if (mins < 60) return `${Math.round(mins)} min${Math.round(mins) !== 1 ? 's' : ''}`;
    const hours = mins / 60;
    if (hours < 24) {
      const h = Math.round(hours * 2) / 2; // round to nearest 0.5h
      return h === Math.floor(h) ? `${h} hr${h !== 1 ? 's' : ''}` : `${h} hrs`;
    }
    const days = Math.round(hours / 24 * 10) / 10;
    return `${days} day${days !== 1 ? 's' : ''}`;
  };

  // Build the factor summary for UI display
  const durationFactors = [];
  if (volRegime.regime === 'EXPANDING')   durationFactors.push('⚡ Expanding volatility — fast move');
  if (volRegime.regime === 'CONTRACTING') durationFactors.push('🌀 Contracting volatility — slow build');
  if (volRegime.regime === 'EXTREME')     durationFactors.push('⚠️ Extreme volatility — erratic');
  if (killZone.inKillZone)               durationFactors.push(`⚡ ${killZone.killZoneName} — peak activity`);
  if (chochQuality.quality === 'ELITE')  durationFactors.push('💎 Elite CHOCH — fast fill');
  if (inOTE)                             durationFactors.push('🎯 OTE Entry — spring-loaded reaction');
  if (inducementData.hasInducement)      durationFactors.push('🪤 Inducement done — clean move');
  if (atPOC)                             durationFactors.push('📊 At Volume POC — quick order fill');
  if (allSweeps.length > 0)             durationFactors.push('💧 Liquidity swept — path clear');
  if (drawOnLiquidity?.primary)         durationFactors.push(`🎯 Draw: ${drawOnLiquidity.primary.label || 'Target identified'} @ $${drawOnLiquidity.primary.level?.toFixed(2) || '—'}`);
  if (wyckoffPhase?.phase === 'Spring') durationFactors.push('🚀 Wyckoff Spring — explosive');
  if (session.name.includes('Asian'))   durationFactors.push('😴 Asian session — slow drift');
  if (session.name.includes('NY Close')) durationFactors.push('🔔 NY Close — slowing down');

  const estimatedDuration = {
    minMins:        minEstMins,
    maxMins:        maxEstMins,
    avgMins:        Math.round(avgEstMins),
    formattedRange: `${formatDurationLabel(minEstMins)} – ${formatDurationLabel(maxEstMins)}`,
    typicalLabel:   formatDurationLabel(Math.round(avgEstMins)),
    maxCap:         profile.timeCap || '4H',
    factors:        durationFactors,
    compositeScore: compositeMultiplier.toFixed(2),
    basedOn: `${estCandles} candle${estCandles !== 1 ? 's' : ''} × ${tfMins}m (${activeTimeframe})`,
  };

  // ── Return ─────────────────────────────────────────────────────
  return {
    decision,
    direction,
    entry,
    stopLoss:     slData,
    tpDetails:    tpData?.tps || [],
    trailingTP,
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
    rejectionReason:  decision === 'WAIT' ? null : rejectionReason,
    waitCondition:    decision === 'WAIT' ? rejectionReason : null,
    newsCaution,
    newsCautionReason,
    keyRisk: ema200Acting ? 'EMA200 Resistance / Support' : slPct > 0.012 ? 'Wide SL — size reduced automatically' : 'Market Volatility',
    invalidationLevel: slData ? slData.rawInvalidation.toFixed(ASSETS[symbol]?.decimals ?? 2) : 'N/A',
    analysisSteps:  steps,
    oteZone,
    estimatedDuration,
    symbol,
    balance,
    timeCap:          profile.timeCap,
    riskAmount:       adjustedRiskAmount,
    // Mode metadata
    analysisMode:     profile.label,
    modeColor:        profile.modeColor,
    primaryTimeframe: profile.primaryKey,
    isScalping:       profile.isScalping,
    emaSignal:        emaSignalActive ? { active: true, type: emaSignalType, aligned: emaSignalAligned } : null,
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
    // ── Institutional Intelligence (v11) ───────────────────────────
    signalGrade,
    volatilityRegime:  volRegime,
    inducement:        inducementData,
    chochQuality,
    drawOnLiquidity,
    equalHighsLows:    eqHiLo,
    displacementScore: dispValidation,
    liquidityMap,
    // ──
    premiumDiscountZones,
    killZone,
    cmeGapData,
    smcAnalysis,
    // ── EMA Indicators (for MarketRegime component) ────────────────
    indicators: e20b ? {
      ema20:        parseFloat(e20b.toFixed(4)),
      ema50:        parseFloat(e50b.toFixed(4)),
      ema200:       parseFloat(e200b.toFixed(4)),
      ema20_slope:  parseFloat(ema20_slope.toFixed(5)),
      ema50_slope:  parseFloat(ema50_slope.toFixed(5)),
      ema200_slope: parseFloat(ema200_slope.toFixed(5)),
    } : null,
  };
}
