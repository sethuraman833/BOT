// ─────────────────────────────────────────────────────────
//  Trade Analyzer v8.0 — Adaptive Multi-Timeframe Engine
//  Dynamically adapts to selected chart timeframe:
//    5m  → Scalping mode  (looser filters, EMA crossover)
//    15m → Intraday mode  (balanced)
//    1h  → Swing mode     (strict)
//    4h  → Position mode  (strictest)
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
import { RISK_AMOUNT } from '../utils/constants.js';

// ─── TIMEFRAME PROFILES ───────────────────────────────────
// Each profile defines how the engine behaves on that timeframe.
const TF_PROFILES = {
  '5m': {
    label:               '5m Scalping',
    modeColor:           '#00d4aa',
    primaryKey:          '5m',
    structureKey:        '15m',
    biasKey:             '1h',
    obKey:               '1h',
    swingLookback:       2,      // tighter swings for faster moves
    minPillars:          3,      // only 3 of 5 pillars required
    minConfluence:       4,      // lower bar for fast scalp entries
    maxSlPct:            0.015,  // max 1.5% SL for tight scalping
    sweepThreshold:      0.0008, // 0.08% min sweep (smaller on 5m)
    hasEmaSignal:        true,   // add EMA crossover/pullback bonus
    sessionAllowNyClose: true,   // allow NY Close session for scalps
    isScalping:          true,
  },
  '15m': {
    label:               '15m Intraday',
    modeColor:           '#3d9cf0',
    primaryKey:          '15m',
    structureKey:        '1h',
    biasKey:             '4h',
    obKey:               '4h',
    swingLookback:       3,
    minPillars:          4,
    minConfluence:       5,
    maxSlPct:            0.020,
    sweepThreshold:      0.0012,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
  },
  '1h': {
    label:               '1H Swing',
    modeColor:           '#f5c842',
    primaryKey:          '1h',
    structureKey:        '4h',
    biasKey:             '1d',
    obKey:               '4h',
    swingLookback:       3,
    minPillars:          4,
    minConfluence:       5,
    maxSlPct:            0.025,
    sweepThreshold:      0.0015,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
  },
  '4h': {
    label:               '4H Position',
    modeColor:           '#9b6dff',
    primaryKey:          '4h',
    structureKey:        '1d',
    biasKey:             '1d',
    obKey:               '1d',
    swingLookback:       5,
    minPillars:          4,
    minConfluence:       6,
    maxSlPct:            0.030,
    sweepThreshold:      0.0015,
    hasEmaSignal:        false,
    sessionAllowNyClose: false,
    isScalping:          false,
  },
};

export function runAnalysis(allData, config = {}) {
  const {
    symbol          = 'BTCUSDT',
    balance         = 10000,
    newsStatus      = { veto: false },
    activeTimeframe = '15m',
  } = config;

  const profile = TF_PROFILES[activeTimeframe] || TF_PROFILES['15m'];
  const steps   = [];
  steps.push(`Engine v8.0 | ${profile.label} | ${symbol}`);

  // ── News veto ──────────────────────────────────────────
  if (newsStatus.veto) {
    return {
      decision: 'NO_TRADE',
      rejectionReason: `ECONOMIC VETO: ${newsStatus.reason}`,
      confluenceScore: { total: 0, max: 11, checks: [], tier: 'REJECT' },
      analysisSteps: [`Vetoed: ${newsStatus.reason}`],
      analysisMode: profile.label,
      primaryTimeframe: profile.primaryKey,
    };
  }

  // ── Candle sets ────────────────────────────────────────
  const candlesPrimary   = allData[profile.primaryKey]   || [];
  const candlesStructure = allData[profile.structureKey] || [];
  const candlesBias      = allData[profile.biasKey]      || [];
  const candlesOB        = allData[profile.obKey]        || [];
  const candles1d        = allData['1d']                 || [];
  // Fallbacks: if structure/bias data is missing, use what we have
  const candlesForBias = candlesBias.length > 20 ? candlesBias : (candlesStructure.length > 20 ? candlesStructure : candlesPrimary);
  const candlesForOB   = candlesOB.length  > 20 ? candlesOB   : candlesStructure;

  if (candlesPrimary.length < 30) {
    return {
      decision: 'NO_TRADE',
      direction: null,
      rejectionReason: `Insufficient ${profile.primaryKey} data (${candlesPrimary.length} candles)`,
      analysisSteps: ['ERROR: Not enough primary candle data.'],
      confluenceScore: { total: 0, max: 11, checks: [], pillarsAllMet: false, pillarsMet: 0, pillarsTotal: 5, tier: 'REJECT' },
      analysisMode: profile.label,
      primaryTimeframe: profile.primaryKey,
    };
  }

  const currentPrice = candlesPrimary[candlesPrimary.length - 1].close;

  // ── Step 1: Daily Bias ─────────────────────────────────
  const ema200_1d    = calculateEMA(candles1d.length > 20 ? candles1d : candlesForBias, 200);
  const lastEma200_1d = ema200_1d[ema200_1d.length - 1];
  const dailyBias = lastEma200_1d
    ? (currentPrice > lastEma200_1d ? 'bullish' : 'bearish')
    : 'neutral';
  steps.push(`Daily Bias: ${dailyBias}`);

  // ── Step 2: Higher-TF Trend (bias candles) ─────────────
  const swingsBias     = findSwingPoints(candlesForBias, profile.swingLookback + 2);
  const lastHighsBias  = swingsBias.filter(s => s.type === 'high').slice(-2);
  const lastLowsBias   = swingsBias.filter(s => s.type === 'low').slice(-2);
  let trendBias = 'ranging';
  if (lastHighsBias.length >= 2 && lastLowsBias.length >= 2) {
    if (lastHighsBias[1].price > lastHighsBias[0].price && lastLowsBias[1].price > lastLowsBias[0].price)
      trendBias = 'bullish';
    else if (lastHighsBias[1].price < lastHighsBias[0].price && lastLowsBias[1].price < lastLowsBias[0].price)
      trendBias = 'bearish';
  }
  steps.push(`${profile.biasKey.toUpperCase()} Trend: ${trendBias}`);

  // ── EMA stack on bias timeframe ────────────────────────
  const ema20_bias  = calculateEMA(candlesForBias, 20);
  const ema50_bias  = calculateEMA(candlesForBias, 50);
  const ema200_bias = calculateEMA(candlesForBias, 200);
  const e20b  = ema20_bias[ema20_bias.length - 1];
  const e50b  = ema50_bias[ema50_bias.length - 1];
  const e200b = ema200_bias[ema200_bias.length - 1];

  // ── EMA crossover/pullback on PRIMARY timeframe (for scalping) ──
  let emaSignalActive = false;
  let emaSignalType   = null;
  if (profile.hasEmaSignal && candlesPrimary.length >= 52) {
    const ema20_p  = calculateEMA(candlesPrimary, 20);
    const ema50_p  = calculateEMA(candlesPrimary, 50);
    const n = ema20_p.length;
    const prevE20 = ema20_p[n - 2];
    const currE20 = ema20_p[n - 1];
    const prevE50 = ema50_p[n - 2];
    const currE50 = ema50_p[n - 1];

    // Bullish cross: EMA20 just crossed above EMA50 (within last 3 bars)
    const bullCross = prevE20 != null && prevE50 != null && prevE20 <= prevE50 && currE20 > currE50;
    // Bearish cross
    const bearCross = prevE20 != null && prevE50 != null && prevE20 >= prevE50 && currE20 < currE50;
    // Pullback to EMA20 while trending
    const bullPull  = currE20 > currE50 && Math.abs(currentPrice - currE20) / currE20 < 0.003;
    const bearPull  = currE20 < currE50 && Math.abs(currentPrice - currE20) / currE20 < 0.003;

    if (bullCross) { emaSignalActive = true; emaSignalType = 'EMA Bullish Cross'; }
    else if (bearCross) { emaSignalActive = true; emaSignalType = 'EMA Bearish Cross'; }
    else if (bullPull) { emaSignalActive = true; emaSignalType = 'EMA20 Bullish Pullback'; }
    else if (bearPull) { emaSignalActive = true; emaSignalType = 'EMA20 Bearish Pullback'; }
    if (emaSignalType) steps.push(`EMA Signal: ${emaSignalType}`);
  }

  // ── Step 3: SMC Detection ──────────────────────────────
  const obsOB      = detectOrderBlocks(candlesForOB, currentPrice);
  const obsPrimary = detectOrderBlocks(candlesPrimary, currentPrice);
  const fvgsOB     = detectFVGs(candlesForOB, currentPrice);
  const fvgsPrimary= detectFVGs(candlesPrimary, currentPrice);

  const sweepsPrimary   = detectSweeps(candlesPrimary,   profile.sweepThreshold);
  const sweepsStructure = detectSweeps(candlesStructure, profile.sweepThreshold);
  const allSweeps       = [...sweepsPrimary, ...sweepsStructure];

  const shiftsPrimary   = detectStructureShifts(candlesPrimary);
  const shiftsStructure = detectStructureShifts(candlesStructure);
  const allShifts       = [...shiftsPrimary, ...shiftsStructure];

  steps.push(`OBs: ${obsOB.length + obsPrimary.length} | FVGs: ${fvgsOB.length + fvgsPrimary.length} | Sweeps: ${allSweeps.length} | Shifts: ${allShifts.length}`);

  // ── Session ────────────────────────────────────────────
  const session   = getCurrentSession();
  const sessionOk = session.status === 'optimal' || session.status === 'valid' ||
                    (profile.sessionAllowNyClose && session.status === 'caution');
  steps.push(`Session: ${session.name} | Valid: ${sessionOk}`);

  // ── Direction ──────────────────────────────────────────
  let direction = null;
  let upProb = 50, downProb = 50;

  if (trendBias === 'bullish' && dailyBias === 'bullish') { direction = 'long';  upProb = 75; }
  else if (trendBias === 'bearish' && dailyBias === 'bearish') { direction = 'short'; downProb = 75; }
  else if (trendBias === 'bullish') { direction = 'long';  upProb = 62; }
  else if (trendBias === 'bearish') { direction = 'short'; downProb = 62; }

  // For 5m scalping: EMA signal on primary TF can override ranging bias
  if (profile.isScalping && emaSignalActive && direction === null) {
    if (emaSignalType?.includes('Bullish') && currentPrice > (e200b || 0)) {
      direction = 'long';  upProb = 58;
      steps.push('5m EMA signal providing direction (Bullish) — bias override');
    } else if (emaSignalType?.includes('Bearish') && currentPrice < (e200b || Infinity)) {
      direction = 'short'; downProb = 58;
      steps.push('5m EMA signal providing direction (Bearish) — bias override');
    }
  }

  steps.push(`Direction: ${direction || 'none'} | Up: ${upProb}% Down: ${downProb}%`);

  // ── OTE Zone ───────────────────────────────────────────
  const swingsStructure = findSwingPoints(candlesStructure.length > 20 ? candlesStructure : candlesPrimary, profile.swingLookback);
  let oteZone = null;
  if (direction === 'long') {
    const lows  = swingsStructure.filter(s => s.type === 'low'  && s.price < currentPrice).sort((a, b) => b.index - a.index);
    const highs = swingsStructure.filter(s => s.type === 'high' && s.price > currentPrice).sort((a, b) => b.index - a.index);
    if (lows[0] && highs[0]) oteZone = calculateOTE(highs[0].price, lows[0].price, 'long');
  } else if (direction === 'short') {
    const highs = swingsStructure.filter(s => s.type === 'high' && s.price > currentPrice).sort((a, b) => b.index - a.index);
    const lows  = swingsStructure.filter(s => s.type === 'low'  && s.price < currentPrice).sort((a, b) => b.index - a.index);
    if (highs[0] && lows[0]) oteZone = calculateOTE(highs[0].price, lows[0].price, 'short');
  }
  const inOTE = isInOTE(currentPrice, oteZone);
  steps.push(`OTE: ${oteZone ? `${oteZone.lower.toFixed(2)}–${oteZone.upper.toFixed(2)}` : 'N/A'} | In OTE: ${inOTE}`);

  // ── Entry / SL ─────────────────────────────────────────
  let entry  = currentPrice;
  let slData = null;

  if (direction) {
    const allOBs = [...obsOB, ...obsPrimary];
    const nearestOB = direction === 'long'
      ? allOBs.filter(o => o.type === 'demand').sort((a, b) => b.entryBoundary - a.entryBoundary)[0]
      : allOBs.filter(o => o.type === 'supply').sort((a, b) => a.entryBoundary - b.entryBoundary)[0];

    const inv = nearestOB
      ? (direction === 'long' ? nearestOB.lowerBound : nearestOB.upperBound)
      : (direction === 'long' ? currentPrice * (1 - profile.maxSlPct * 0.8) : currentPrice * (1 + profile.maxSlPct * 0.8));

    if (inOTE && oteZone) entry = oteZone.midpoint;
    else if (nearestOB) entry = nearestOB.entryBoundary;

    const allFVGs = [...fvgsOB, ...fvgsPrimary];
    slData = calculateSmartSL(inv, direction, allFVGs);
    steps.push(`Entry: ${entry.toFixed(2)} | SL: ${slData.value.toFixed(2)} | Dist: ${((Math.abs(entry - slData.value) / entry) * 100).toFixed(2)}%`);
  }

  // ── TPs ────────────────────────────────────────────────
  const swingsBiasAll = findSwingPoints(candlesForBias, profile.swingLookback + 2);
  let tpData = null;
  if (direction && slData) {
    const tpSwings = swingsBiasAll.filter(s =>
      direction === 'long' ? s.type === 'high' && s.price > entry : s.type === 'low' && s.price < entry
    );
    const allFVGs = [...fvgsOB, ...fvgsPrimary];
    tpData = calculateTPs(entry, slData.value, tpSwings, allFVGs, direction, 'HIGH', session.name);
    tpData.tps.forEach(tp => {
      const fullPnl   = Math.abs(tp.level - entry) * calculatePositionSize(entry, slData.value);
      tp.projectedProfit = (fullPnl * (tp.closePercent / 100)).toFixed(2);
    });
    steps.push(`TPs: ${tpData.tps.map((t, i) => `TP${i + 1}=$${t.level.toFixed(2)} (1:${t.rrr})`).join(', ')}`);
  }

  // ── RRR pillar ─────────────────────────────────────────
  const tp1Rrr        = tpData?.tps?.[0]?.rrr ?? 0;
  const rrrMeetsMin   = tp1Rrr >= 3.0;

  // ── Scoring ────────────────────────────────────────────
  const trend4HAligned = (direction === 'long'  && trendBias === 'bullish') ||
                         (direction === 'short' && trendBias === 'bearish');
  const dailyAligned   = (direction === 'long'  && dailyBias === 'bullish') ||
                         (direction === 'short' && dailyBias === 'bearish');
  const liquidityEvent = allSweeps.length > 0 ||
                         [...fvgsOB, ...fvgsPrimary].some(f => currentPrice >= f.lower && currentPrice <= f.upper);
  const structureShift = allShifts.length > 0;
  const rsiResult      = detectRSIDivergence(candlesStructure.length > 20 ? candlesStructure : candlesPrimary, direction, 14);
  const ema200Acting   = e200b && Math.abs(currentPrice - e200b) / e200b < 0.005;
  const slPct          = slData ? Math.abs(entry - slData.value) / entry : 0;

  // Align EMA signal to direction
  const emaSignalAligned = emaSignalActive &&
    ((direction === 'long'  && emaSignalType?.includes('Bullish')) ||
     (direction === 'short' && emaSignalType?.includes('Bearish')));

  const checks = [
    { label: `${profile.biasKey.toUpperCase()} Trend Aligned`,  met: trend4HAligned,              pillar: true,  weight: 2 },
    { label: 'Liquidity Sweep / FVG Fill',                       met: liquidityEvent,               pillar: true,  weight: 2 },
    { label: `${profile.primaryKey}/${profile.structureKey} BOS/CHOCH`, met: structureShift,       pillar: true,  weight: 2 },
    { label: 'Active Trading Session',                           met: sessionOk,                    pillar: true,  weight: 1 },
    { label: 'RRR ≥ 1:3 (Structural)',                          met: rrrMeetsMin,                  pillar: true,  weight: 2 },
    { label: 'Daily Bias Aligned',                               met: dailyAligned,                 pillar: false, weight: 1 },
    { label: 'RSI Divergence Present',                           met: rsiResult.hasDivergence,      pillar: false, weight: 1 },
    { label: 'EMA200 Acting as S/R',                            met: ema200Acting,                 pillar: false, weight: 1 },
    { label: 'Entry in OTE Zone (Fib)',                         met: inOTE,                        pillar: false, weight: 1 },
    ...(profile.hasEmaSignal
      ? [{ label: `EMA Signal (${emaSignalType || 'N/A'})`,     met: emaSignalAligned,             pillar: false, weight: 1 }]
      : []),
  ];

  const totalWeight     = checks.reduce((s, c) => s + c.weight, 0);
  const scoredWeight    = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const max             = 11;
  const normalizedTotal = Math.min(max, Math.round((scoredWeight / totalWeight) * max));
  const pillarsMet      = checks.filter(c => c.pillar && c.met).length;
  const pillarsTotal    = checks.filter(c => c.pillar).length;
  const tier = normalizedTotal >= 8 ? 'EXCEPTIONAL' : normalizedTotal >= 6 ? 'HIGH' : normalizedTotal >= 4 ? 'MEDIUM' : 'REJECT';

  // ── Decision ───────────────────────────────────────────
  let decision        = 'NO_TRADE';
  let rejectionReason = null;

  if (!direction) {
    rejectionReason = `No directional bias on ${profile.biasKey.toUpperCase()} — market ranging`;
  } else if (slPct > profile.maxSlPct) {
    rejectionReason = `SL too wide: ${(slPct * 100).toFixed(2)}% > ${(profile.maxSlPct * 100).toFixed(1)}% max for ${profile.label}`;
  } else if (!rrrMeetsMin) {
    rejectionReason = `RRR too low: ${tp1Rrr.toFixed(2)} < 3.0 minimum`;
  } else if (pillarsMet < profile.minPillars) {
    rejectionReason = `Pillars: ${pillarsMet}/${pillarsTotal} met, need ${profile.minPillars} for ${profile.label}`;
  } else if (normalizedTotal < profile.minConfluence) {
    rejectionReason = `Confluence: ${normalizedTotal}/${max} — need ${profile.minConfluence} for ${profile.label}`;
  } else {
    decision = 'TAKE_NOW';
  }

  steps.push(`→ ${decision} | Confluence: ${normalizedTotal}/${max} | Pillars: ${pillarsMet}/${pillarsTotal}`);
  if (rejectionReason) steps.push(`Rejected: ${rejectionReason}`);

  const finalTier = (decision === 'NO_TRADE' && pillarsMet < pillarsTotal) ? 'REJECT' : tier;

  // ── Final Return ───────────────────────────────────────
  return {
    decision,
    direction,
    entry,
    stopLoss:     slData,
    tpDetails:    tpData?.tps || [],
    positionSize: (direction && slData) ? calculatePositionSize(entry, slData.value) : 0,
    projectedLoss: direction ? '5.00' : '0.00',
    breakevenMove: (direction && slData) ? calculateBreakevenMove(entry, slData.value) : null,
    confluenceScore: {
      total: normalizedTotal,
      max,
      tier: finalTier,
      checks,
      pillarsMet,
      pillarsTotal,
      pillarsAllMet: pillarsMet === pillarsTotal,
    },
    session,
    upProbability:   upProb,
    downProbability: 100 - upProb,
    rangeProbability: 0,
    rejectionReason,
    waitCondition:   null,
    keyRisk: ema200Acting ? 'EMA200 Resistance' : slPct > 0.012 ? 'Wide SL — reduced position size' : 'Market Volatility',
    invalidationLevel: slData ? slData.rawInvalidation.toFixed(2) : 'N/A',
    analysisSteps:  steps,
    oteZone,
    symbol,
    balance,
    // Mode metadata for UI display
    analysisMode:     profile.label,
    modeColor:        profile.modeColor,
    primaryTimeframe: profile.primaryKey,
    isScalping:       profile.isScalping,
    emaSignal:        emaSignalActive ? { active: true, type: emaSignalType } : null,
    // SMC counts for UI
    smcData: {
      orderBlocks:    [...obsOB, ...obsPrimary],
      fvgs:           [...fvgsOB, ...fvgsPrimary],
      sweeps:         allSweeps,
      structureShifts: allShifts,
    },
  };
}
