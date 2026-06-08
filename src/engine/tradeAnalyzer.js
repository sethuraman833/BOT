// ─────────────────────────────────────────────────────────
//  Trade Analyzer v9.0 — All-Bug-Fixed Adaptive Engine
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
  calculateEMA, calculateRSI, detectRSIDivergence, findSwingPoints
} from './smcDetector.js';
import { calculateOTE, isInOTE } from './oteCalculator.js';
import {
  calculateSmartSL, calculateTPs, calculatePositionSize,
  calculateRRR, calculateBreakevenMove
} from './riskManager.js';
import { getCurrentSession, isSessionValid } from './sessionFilter.js';
import { RISK_AMOUNT, ASSETS } from '../utils/constants.js';

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
    swingLookback:       2,
    minPillars:          4, // raised from 3 for quality
    minConfluence:       6, // raised from 4 for quality
    maxSlPct:            0.015,  // 1.5% max SL for scalping
    maxTpPct:            0.015,  // Tightened to 1.5% to ensure trades close in 4-5 hours
    maxEntryDist:        0.003,  // 0.3% max entry distance
    sweepThreshold:      0.0008,
    hasEmaSignal:        true,
    sessionAllowNyClose: true,
    isScalping:          true,
    timeCap:             '4H',
    riskAmount:          10,    // Increased size/risk for short duration scalps
  },
  '15m': {
    label:               '15m Intraday',
    modeColor:           '#3b8ef0',
    primaryKey:          '15m',
    structureKey:        '1h',
    biasKey:             '4h',
    obKey:               '4h',
    swingLookback:       3,
    minPillars:          5, // raised from 4 for quality
    minConfluence:       7, // raised from 5 for quality
    maxSlPct:            0.020,  // 2% max SL
    maxTpPct:            0.07,   // 7% max TP range
    maxEntryDist:        0.005,  // 0.5% max entry distance
    sweepThreshold:      0.0012,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '6H',
    riskAmount:          5,
  },
  '1h': {
    label:               '1H Swing',
    modeColor:           '#f7c948',
    primaryKey:          '1h',
    structureKey:        '4h',
    biasKey:             '1d',
    obKey:               '4h',
    swingLookback:       3,
    minPillars:          5, // raised from 4 for quality
    minConfluence:       8, // raised from 5 for quality
    maxSlPct:            0.025,
    maxTpPct:            0.12,   // 12% max TP range
    maxEntryDist:        0.010,  // 1.0% max entry distance
    sweepThreshold:      0.0015,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '24H',
    riskAmount:          5,
  },
  '4h': {
    label:               '4H Position',
    modeColor:           '#9d6fff',
    primaryKey:          '4h',
    structureKey:        '1d',
    biasKey:             '1d',
    obKey:               '1d',
    swingLookback:       5,
    minPillars:          5, // raised from 4 for quality
    minConfluence:       8, // raised from 6 for quality
    maxSlPct:            0.030,
    maxTpPct:            0.20,   // 20% max TP range
    maxEntryDist:        0.020,  // 2.0% max entry distance
    sweepThreshold:      0.0015,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '48H',
    riskAmount:          5,
  },
  '1d': {
    label:               '1D Trend',
    modeColor:           '#ff3f5e',
    primaryKey:          '1d',
    structureKey:        '1d',
    biasKey:             '1d',
    obKey:               '1d',
    swingLookback:       7,
    minPillars:          5, // raised from 4 for quality
    minConfluence:       8, // raised from 6 for quality
    maxSlPct:            0.050,
    maxTpPct:            0.30,
    maxEntryDist:        0.030,  // 3.0% max entry distance
    sweepThreshold:      0.002,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
    timeCap:             '5D',
    riskAmount:          5,
  },
};

/**
 * Tag swing points with the timeframe they came from,
 * so the TP engine can label them properly.
 */
function tagSwings(swings, tfLabel) {
  return swings.map(s => ({ ...s, tfLabel }));
}

export function runAnalysis(allData, config = {}) {
  const {
    symbol          = 'BTCUSDT',
    balance         = 10000,
    newsStatus      = { veto: false },
    activeTimeframe = '15m',
  } = config;

  const profile = TF_PROFILES[activeTimeframe] || TF_PROFILES['15m'];
  const riskAmount = profile.riskAmount || RISK_AMOUNT;
  const steps   = [];
  steps.push(`Engine v9.0 | ${profile.label} | ${symbol}`);

  // ── News veto ──────────────────────────────────────────────────
  if (newsStatus.veto) {
    return {
      decision: 'NO_TRADE',
      rejectionReason: `ECONOMIC VETO: ${newsStatus.reason}`,
      confluenceScore: { total: 0, max: 11, checks: [], tier: 'REJECT' },
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

  const candlesForBias = candlesBias.length > 20   ? candlesBias
    : candlesStructure.length > 20                 ? candlesStructure
    : candlesPrimary;
  const candlesForOB   = candlesOB.length  > 20   ? candlesOB : candlesStructure;

  if (candlesPrimary.length < 30) {
    return {
      decision: 'NO_TRADE', direction: null,
      rejectionReason: `Insufficient ${profile.primaryKey} data (${candlesPrimary.length} candles)`,
      analysisSteps:   ['ERROR: Not enough primary candle data.'],
      confluenceScore: { total: 0, max: 11, checks: [], pillarsAllMet: false, pillarsMet: 0, pillarsTotal: 5, tier: 'REJECT' },
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
    const n = ema20_p.length;
    const prevE20 = ema20_p[n - 2], currE20 = ema20_p[n - 1];
    const prevE50 = ema50_p[n - 2], currE50 = ema50_p[n - 1];

    const bullCross = prevE20 != null && prevE50 != null && prevE20 <= prevE50 && currE20 > currE50;
    const bearCross = prevE20 != null && prevE50 != null && prevE20 >= prevE50 && currE20 < currE50;
    const bullPull  = currE20 > currE50 && Math.abs(currentPrice - currE20) / currE20 < 0.003;
    const bearPull  = currE20 < currE50 && Math.abs(currentPrice - currE20) / currE20 < 0.003;

    if      (bullCross) { emaSignalActive = true; emaSignalType = 'EMA Bullish Cross'; }
    else if (bearCross) { emaSignalActive = true; emaSignalType = 'EMA Bearish Cross'; }
    else if (bullPull)  { emaSignalActive = true; emaSignalType = 'EMA20 Bullish Pullback'; }
    else if (bearPull)  { emaSignalActive = true; emaSignalType = 'EMA20 Bearish Pullback'; }
    if (emaSignalType) steps.push(`EMA Signal: ${emaSignalType}`);
  }

  // ── Step 3: SMC Detection ──────────────────────────────────────
  const obsOB       = detectOrderBlocks(candlesForOB, currentPrice);
  const obsPrimary  = detectOrderBlocks(candlesPrimary, currentPrice);
  const fvgsOB      = detectFVGs(candlesForOB, currentPrice);
  const fvgsPrimary = detectFVGs(candlesPrimary, currentPrice);

  const sweepsPrimary   = detectSweeps(candlesPrimary,   profile.sweepThreshold);
  const sweepsStructure = detectSweeps(candlesStructure, profile.sweepThreshold);
  const allSweeps       = [...sweepsPrimary, ...sweepsStructure];

  const shiftsPrimary   = detectStructureShifts(candlesPrimary);
  const shiftsStructure = detectStructureShifts(candlesStructure);
  const allShifts       = [...shiftsPrimary, ...shiftsStructure];

  steps.push(`OBs: ${obsOB.length + obsPrimary.length} | FVGs: ${fvgsOB.length + fvgsPrimary.length} | Sweeps: ${allSweeps.length} | Shifts: ${allShifts.length}`);

  // ── Session ────────────────────────────────────────────────────
  const session   = getCurrentSession();
  const sessionOk = session.status === 'optimal' || session.status === 'valid' ||
                    (profile.sessionAllowNyClose && session.status === 'caution');
  steps.push(`Session: ${session.name} | Valid: ${sessionOk}`);

  // ── Direction ──────────────────────────────────────────────────
  let direction = null;
  let upProb = 50, downProb = 50;

  if      (trendBias === 'bullish' && dailyBias === 'bullish') { direction = 'long';  upProb = 75; downProb = 25; }
  else if (trendBias === 'bearish' && dailyBias === 'bearish') { direction = 'short'; downProb = 75; upProb = 25; }
  else if (trendBias === 'bullish')                             { direction = 'long';  upProb = 62; downProb = 38; }
  else if (trendBias === 'bearish')                             { direction = 'short'; downProb = 62; upProb = 38; }
  // Ranging — probabilities stay equal (50/50)

  // FIX #7: calculate actual ranging probability
  const rangeProbability = direction === null ? 50 : Math.max(0, 100 - upProb - downProb);

  // 5m: EMA signal can provide direction when bias is ranging
  if (profile.isScalping && emaSignalActive && direction === null) {
    if (emaSignalType?.includes('Bullish') && currentPrice > (e200b || 0)) {
      direction = 'long';  upProb = 58; downProb = 30;
      steps.push('5m EMA override: direction = LONG (EMA signal above EMA200)');
    } else if (emaSignalType?.includes('Bearish') && currentPrice < (e200b || Infinity)) {
      direction = 'short'; downProb = 58; upProb = 30;
      steps.push('5m EMA override: direction = SHORT (EMA signal below EMA200)');
    }
  }

  steps.push(`Direction: ${direction || 'RANGING'} | Bull: ${upProb}% Bear: ${downProb}%`);

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
    // Guard: high must have occurred BEFORE the recent low (impulse down → OTE on pullback)
    if (lows[0] && highs[0] && highs[0].index < lows[0].index)
      oteZone = calculateOTE(highs[0].price, lows[0].price, 'long');
  } else if (direction === 'short') {
    const highs = swingsStructure.filter(s => s.type === 'high' && s.price > currentPrice).sort((a,b) => b.index - a.index);
    const lows  = swingsStructure.filter(s => s.type === 'low'  && s.price < highs[0]?.price).sort((a,b) => b.index - a.index);
    // Guard: high must have occurred BEFORE the recent low (impulse up → OTE on pullback)
    if (highs[0] && lows[0] && highs[0].index > lows[0].index)
      oteZone = calculateOTE(highs[0].price, lows[0].price, 'short');
  }
  const inOTE = isInOTE(currentPrice, oteZone);
  steps.push(`OTE: ${oteZone ? `${oteZone.lower.toFixed(0)}–${oteZone.upper.toFixed(0)}` : 'N/A'} | In OTE: ${inOTE}`);

  // ── Entry / SL ──────────────────────────────────────────────────
  let entry  = currentPrice;
  let slData = null;

  if (direction) {
    const allOBs    = [...obsOB, ...obsPrimary];
    const nearestOB = direction === 'long'
      ? allOBs.filter(o => o.type === 'demand').sort((a,b) => b.entryBoundary - a.entryBoundary)[0]
      : allOBs.filter(o => o.type === 'supply').sort((a,b) => a.entryBoundary - b.entryBoundary)[0];

    if (inOTE && oteZone)   entry = oteZone.midpoint;
    else if (nearestOB)     entry = nearestOB.entryBoundary;

    // Find the true structural swing points within the last 35 candles on primary timeframe
    const primaryCandleSegment = candlesPrimary.slice(-35);
    const primaryLows  = primaryCandleSegment.map(c => c.low);
    const primaryHighs = primaryCandleSegment.map(c => c.high);
    
    const trueSwingLow  = primaryLows.length > 0 ? Math.min(...primaryLows) : currentPrice * 0.99;
    const trueSwingHigh = primaryHighs.length > 0 ? Math.max(...primaryHighs) : currentPrice * 1.01;

    let inv;
    if (direction === 'long') {
      const obInv = nearestOB ? nearestOB.lowerBound : trueSwingLow;
      const sweepLow = allSweeps.length > 0 
        ? Math.min(...allSweeps.filter(s => s.direction === 'long' || s.type === 'bullish').map(s => s.sweptLevel))
        : Infinity;
      // Layer 1: lowest point of demand OB or lowest wick of sweep candle (whichever is lower)
      inv = Math.min(obInv, sweepLow);
      if (inv === Infinity) inv = trueSwingLow;
    } else {
      const obInv = nearestOB ? nearestOB.upperBound : trueSwingHigh;
      const sweepHigh = allSweeps.length > 0
        ? Math.max(...allSweeps.filter(s => s.direction === 'short' || s.type === 'bearish').map(s => s.sweptLevel))
        : -Infinity;
      // Layer 1: highest point of supply OB or highest wick of sweep candle (whichever is higher)
      inv = Math.max(obInv, sweepHigh);
      if (inv === -Infinity) inv = trueSwingHigh;
    }

    // Enforce a minimum risk distance of 0.25% to prevent ultra-tight micro-SLs
    const minDistance = entry * 0.0025;
    if (direction === 'long') {
      if (Math.abs(entry - inv) < minDistance) {
        inv = entry - minDistance;
      }
    } else {
      if (Math.abs(entry - inv) < minDistance) {
        inv = entry + minDistance;
      }
    }

    const allFVGs = [...fvgsOB, ...fvgsPrimary];
    slData = calculateSmartSL(inv, direction, allFVGs);
    const decimals = ASSETS[symbol]?.decimals ?? 2;
    const posSize = calculatePositionSize(entry, slData.value, riskAmount);
    steps.push(`Entry: ${entry.toFixed(decimals)} | SL: ${slData.value.toFixed(decimals)} | SL%: ${((Math.abs(entry - slData.value) / entry) * 100).toFixed(2)}% | Size: ${posSize} units`);
  }

  // ── TPs — Multi-TF Swing Pool ──────────────────────────────────
  // FIX #1 & #2: Use swings from ALL available timeframes as TP candidates.
  // Tag each with its TF label so the UI can show "1H Swing @ 74,500" etc.
  // Structural levels from primary (nearest) and structure/bias (further out)
  // give the engine real chart levels to target instead of arithmetic multiples.
  let tpData = null;
  if (direction && slData) {
    const allFVGs = [...fvgsOB, ...fvgsPrimary];

    const tpSwingPool = [
      ...tagSwings(findSwingPoints(candlesPrimary,   profile.swingLookback    ), profile.primaryKey.toUpperCase()),
      ...tagSwings(findSwingPoints(candlesStructure, profile.swingLookback + 1), profile.structureKey.toUpperCase()),
      ...tagSwings(swingsBias,                                                   profile.biasKey.toUpperCase()),
    ].filter(s => {
      if (direction === 'long') {
        return (s.type === 'high' && s.price > entry) || (s.type === 'low' && s.price < entry);
      } else {
        return (s.type === 'low' && s.price < entry) || (s.type === 'high' && s.price > entry);
      }
    });

    tpData = calculateTPs(
      entry, slData.value,
      tpSwingPool, allFVGs,
      direction,
      'HIGH',
      session.name,
      profile.maxTpPct,
      profile.primaryKey.toUpperCase(),
      profile.structureKey.toUpperCase(),
      profile.biasKey.toUpperCase()
    );

    // Attach projected P&L to each TP
    const posSize = calculatePositionSize(entry, slData.value, riskAmount);
    tpData.tps.forEach(tp => {
      const fullPnl       = Math.abs(tp.level - entry) * posSize;
      tp.projectedProfit  = (fullPnl * ((tp.closePercent || 0) / 100)).toFixed(2);
    });

    const decimals = ASSETS[symbol]?.decimals ?? 2;
    steps.push(`TPs: ${tpData.tps.map((t, i) =>
      `TP${i+1}=$${t.level.toFixed(decimals)} (1:${t.rrr}) ${t.isStructural ? '★' : '⚡'}`
    ).join(' | ')}`);
    steps.push(`TP source: ${tpData.tps.map(t => t.reason).join(' → ')}`);
  }

  // ── Pillar: RRR ────────────────────────────────────────────────
  const tp1Rrr      = tpData?.tps?.[0]?.rrr ?? 0;
  const rrrMeetsMin = tp1Rrr >= 3.0;

  // ── Confluence Checks ──────────────────────────────────────────
  const trend4HAligned = (direction === 'long'  && trendBias === 'bullish') ||
                         (direction === 'short' && trendBias === 'bearish');
  const dailyAligned   = (direction === 'long'  && dailyBias === 'bullish') ||
                         (direction === 'short' && dailyBias === 'bearish');
  const liquidityEvent = allSweeps.length > 0 ||
                         [...fvgsOB, ...fvgsPrimary].some(f => currentPrice >= f.lower && currentPrice <= f.upper);
  const structureShift = allShifts.length > 0;
  const rsiResult      = detectRSIDivergence(
    candlesStructure.length > 20 ? candlesStructure : candlesPrimary,
    direction, 14
  );
  const ema200Acting   = e200b && Math.abs(currentPrice - e200b) / e200b < 0.005;
  const slPct          = slData ? Math.abs(entry - slData.value) / entry : 0;
  const emaSignalAligned = emaSignalActive &&
    ((direction === 'long'  && emaSignalType?.includes('Bullish')) ||
     (direction === 'short' && emaSignalType?.includes('Bearish')));

  const checks = [
    { label: `${profile.biasKey.toUpperCase()} Trend Aligned`, met: trend4HAligned,         pillar: true,  weight: 1.5 },
    { label: 'Liquidity Sweep / FVG Fill',                     met: liquidityEvent,           pillar: true,  weight: 1.5 },
    { label: `${profile.primaryKey.toUpperCase()}/${profile.structureKey.toUpperCase()} BOS/CHOCH`, met: structureShift, pillar: true, weight: 1.5 },
    { label: 'Active Trading Session',                         met: sessionOk,                pillar: true,  weight: 1.0 },
    { label: 'RRR ≥ 1:3 (Structural)',                        met: rrrMeetsMin,              pillar: true,  weight: 1.5 },
    { label: 'Daily Bias Aligned (EMA200)',                    met: dailyAligned,             pillar: false, weight: profile.hasEmaSignal ? 0.5 : 1.0 },
    { label: 'RSI Divergence',                                 met: rsiResult.hasDivergence,  pillar: false, weight: 1.0 },
    { label: 'EMA200 Acting as S/R',                          met: ema200Acting,             pillar: false, weight: 1.0 },
    { label: 'Entry in OTE Zone (61.8–78.6%)',                met: inOTE,                    pillar: false, weight: profile.hasEmaSignal ? 0.5 : 1.0 },
    ...(profile.hasEmaSignal
      ? [{ label: `EMA Signal: ${emaSignalType || 'None'}`,   met: emaSignalAligned,         pillar: false, weight: 1.0 }]
      : []),
  ];

  const totalWeight     = checks.reduce((s, c) => s + c.weight, 0); // Always exactly 11.0
  const scoredWeight    = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const max             = 11;
  const normalizedTotal = Math.min(max, Math.round(scoredWeight));
  const pillarsMet      = checks.filter(c => c.pillar && c.met).length;
  const pillarsTotal    = checks.filter(c => c.pillar).length;
  const tier            = normalizedTotal >= 8 ? 'EXCEPTIONAL' : normalizedTotal >= 6 ? 'HIGH' : normalizedTotal >= 4 ? 'MEDIUM' : 'REJECT';

  // ── Decision ───────────────────────────────────────────────────
  let decision        = 'NO_TRADE';
  let rejectionReason = null;

  // Compute entry distance percentage
  const entryDistPct = direction ? Math.abs(currentPrice - entry) / entry : 0;

  if (!direction) {
    rejectionReason = `Market ranging — no ${profile.biasKey.toUpperCase()} directional bias`;
  } else if (emaVetoActive) {
    rejectionReason = emaVetoReason;
  } else if (entryDistPct > profile.maxEntryDist) {
    rejectionReason = `Price too far from entry zone: ${(entryDistPct * 100).toFixed(2)}% > ${(profile.maxEntryDist * 100).toFixed(2)}% max for ${profile.label}`;
  } else if (slPct > profile.maxSlPct) {
    rejectionReason = `SL too wide: ${(slPct * 100).toFixed(2)}% > ${(profile.maxSlPct * 100).toFixed(2)}% max for ${profile.label}`;
  } else if (!rrrMeetsMin) {
    rejectionReason = `RRR too low: ${tp1Rrr.toFixed(2)} < 3.0 minimum`;
  } else if (pillarsMet < profile.minPillars) {
    rejectionReason = `Pillars: ${pillarsMet}/${pillarsTotal} (need ${profile.minPillars} for ${profile.label})`;
  } else if (normalizedTotal < profile.minConfluence) {
    rejectionReason = `Confluence: ${normalizedTotal}/${max} (need ${profile.minConfluence} for ${profile.label})`;
  } else {
    decision = 'TAKE_NOW';
  }

  steps.push(`→ ${decision} | Score: ${normalizedTotal}/${max} | Pillars: ${pillarsMet}/${pillarsTotal}`);
  if (rejectionReason) steps.push(`Rejected: ${rejectionReason}`);

  const finalTier = (decision === 'NO_TRADE' && pillarsMet < pillarsTotal) ? 'REJECT' : tier;

  // ── Return ─────────────────────────────────────────────────────
  return {
    decision,
    direction,
    entry,
    stopLoss:     slData,
    tpDetails:    tpData?.tps || [],
    positionSize: (direction && slData) ? calculatePositionSize(entry, slData.value, riskAmount) : 0,
    projectedLoss: (direction && slData)
      ? (Math.abs(entry - slData.value) * calculatePositionSize(entry, slData.value, riskAmount)).toFixed(2)
      : '0.00',
    breakevenMove: (direction && slData) ? calculateBreakevenMove(entry, slData.value) : null,
    confluenceScore: {
      total: normalizedTotal, max, tier: finalTier,
      checks, pillarsMet, pillarsTotal,
      pillarsAllMet: pillarsMet === pillarsTotal,
    },
    session,
    // FIX #3: downProbability was `100-upProb` (wrong for shorts) — now uses downProb
    upProbability:    upProb,
    downProbability:  downProb,
    rangeProbability, // FIX #7: was always hardcoded 0
    rejectionReason,
    waitCondition:    null,
    keyRisk: ema200Acting ? 'EMA200 Resistance / Support' : slPct > 0.012 ? 'Wide SL — size reduced automatically' : 'Market Volatility',
    invalidationLevel: slData ? slData.rawInvalidation.toFixed(ASSETS[symbol]?.decimals ?? 2) : 'N/A',
    analysisSteps:  steps,
    oteZone,
    symbol,
    balance,
    timeCap:          profile.timeCap,
    riskAmount:       riskAmount,
    // Mode metadata
    analysisMode:     profile.label,
    modeColor:        profile.modeColor,
    primaryTimeframe: profile.primaryKey,
    isScalping:       profile.isScalping,
    emaSignal:        emaSignalActive ? { active: true, type: emaSignalType } : null,
    smcData: {
      orderBlocks:     [...obsOB, ...obsPrimary],
      fvgs:            [...fvgsOB, ...fvgsPrimary],
      sweeps:          allSweeps,
      structureShifts: allShifts,
    },
  };
}
