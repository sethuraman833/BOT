// ─────────────────────────────────────────────────────────
//  Trade Analyzer v6.0 — High-Conviction Institutional Engine
//  Multi-timeframe alignment + weighted confluence scoring
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

// ─── CONSTANTS ───────────────────────────────────────────
const MAX_SL_PCT     = 0.030; // 3.0% max SL (slightly wider for crypto volatility)
const MIN_CONFLUENCE = 6;     // minimum score to trade
const MIN_PILLARS    = 3;     // minimum pillars out of 5 to trade
const MIN_RRR        = 2.5;   // minimum RRR (was 3.0, lowered for more opportunities)

export function runAnalysis(allData, config = {}) {
  const { symbol = 'BTCUSDT', balance = 10000, newsStatus = { veto: false } } = config;
  
  const steps = [];
  steps.push(`Initializing v6.2 Engine for ${symbol}`);
  steps.push(`Account Balance: $${balance.toLocaleString()}`);

  if (newsStatus.veto) {
    return {
      decision: 'NO_TRADE',
      rejectionReason: `ECONOMIC VETO: ${newsStatus.reason}`,
      confluenceScore: { total: 0, max: 10, checks: [], tier: 'REJECT' },
      analysisSteps: [`Vetoed by Economic Calendar: ${newsStatus.reason}`]
    };
  }

  const candles15m = allData['15m'] || [];
  const candles1h  = allData['1h']  || [];
  const candles4h  = allData['4h']  || [];
  const candles1d  = allData['1d']  || [];

  if (candles15m.length < 50 || candles4h.length < 50) {
    return {
      decision: 'NO_TRADE',
      direction: null,
      rejectionReason: 'Insufficient candle data for analysis',
      analysisSteps: ['ERROR: Not enough data. Need at least 50 candles per timeframe.'],
      confluenceScore: { total: 0, max: 10, checks: [], pillarsAllMet: false, pillarsMet: 0, pillarsTotal: 5, tier: 'REJECT' },
    };
  }

  const currentPrice = candles15m[candles15m.length - 1].close;

  // ═══════════════════════════════════════════════
  // STEP 1 — MACRO DAILY BIAS (EMA 200)
  // ═══════════════════════════════════════════════
  const ema200_1d = calculateEMA(candles1d, 200);
  const lastEma200_1d = ema200_1d[ema200_1d.length - 1];

  // Also check short-term daily trend via 50 EMA
  const ema50_1d = calculateEMA(candles1d, 50);
  const lastEma50_1d = ema50_1d[ema50_1d.length - 1];

  const dailyBias = lastEma200_1d
    ? (currentPrice > lastEma200_1d ? 'bullish' : 'bearish')
    : 'neutral';
  const dailyTrendStrong = lastEma200_1d && lastEma50_1d
    ? (dailyBias === 'bullish' ? lastEma50_1d > lastEma200_1d : lastEma50_1d < lastEma200_1d)
    : false;

  steps.push(`Step 1 — Daily Bias: ${dailyBias.toUpperCase()} (Price ${dailyBias === 'bullish' ? 'above' : 'below'} Daily EMA200${dailyTrendStrong ? ' — Strong' : ''})`);

  // ═══════════════════════════════════════════════
  // STEP 2 — 4H TREND STRUCTURE (HH/HL or LH/LL)
  // ═══════════════════════════════════════════════
  const swings4h = findSwingPoints(candles4h, 3);
  const lastHighs4h = swings4h.filter(s => s.type === 'high').slice(-3);
  const lastLows4h  = swings4h.filter(s => s.type === 'low').slice(-3);

  let trend4h = 'ranging';
  if (lastHighs4h.length >= 2 && lastLows4h.length >= 2) {
    const hh = lastHighs4h[lastHighs4h.length - 1].price > lastHighs4h[lastHighs4h.length - 2].price;
    const hl = lastLows4h[lastLows4h.length - 1].price > lastLows4h[lastLows4h.length - 2].price;
    const lh = !hh;
    const ll = !hl;
    if (hh && hl) trend4h = 'bullish';
    else if (lh && ll) trend4h = 'bearish';
  }
  steps.push(`Step 2 — 4H Trend: ${trend4h.toUpperCase()} (${trend4h === 'bullish' ? 'HH/HL' : trend4h === 'bearish' ? 'LH/LL' : 'Ranging'})`);

  // ═══════════════════════════════════════════════
  // STEP 3 — EMA STACK ALIGNMENT (4H)
  // ═══════════════════════════════════════════════
  const ema20_4h  = calculateEMA(candles4h, 20);
  const ema50_4h  = calculateEMA(candles4h, 50);
  const ema200_4h = calculateEMA(candles4h, 200);
  const e20 = ema20_4h[ema20_4h.length - 1];
  const e50 = ema50_4h[ema50_4h.length - 1];
  const e200 = ema200_4h[ema200_4h.length - 1];

  const emaStackBullish = e20 && e50 && e200 && e20 > e50 && e50 > e200;
  const emaStackBearish = e20 && e50 && e200 && e20 < e50 && e50 < e200;
  const emaStackLabel   = emaStackBullish ? 'Bullish (20>50>200)' : emaStackBearish ? 'Bearish (20<50<200)' : 'Mixed';
  steps.push(`Step 3 — EMA Stack: ${emaStackLabel}`);

  // ═══════════════════════════════════════════════
  // STEP 4 — ORDER BLOCK DETECTION
  // ═══════════════════════════════════════════════
  const obs4h = detectOrderBlocks(candles4h, currentPrice);
  const obs1h = detectOrderBlocks(candles1h, currentPrice);
  steps.push(`Step 4 — Order Blocks: ${obs4h.length} on 4H, ${obs1h.length} on 1H`);

  // ═══════════════════════════════════════════════
  // STEP 5 — FAIR VALUE GAPS
  // ═══════════════════════════════════════════════
  const fvgs4h = detectFVGs(candles4h, currentPrice);
  const fvgs1h = detectFVGs(candles1h, currentPrice);
  steps.push(`Step 5 — Fair Value Gaps: ${fvgs4h.length} unfilled on 4H, ${fvgs1h.length} on 1H`);

  // ═══════════════════════════════════════════════
  // STEP 6 — LIQUIDITY SWEEPS (15m)
  // ═══════════════════════════════════════════════
  const sweeps15m = detectSweeps(candles15m);
  const sweeps1h  = detectSweeps(candles1h);
  const allSweeps = [...sweeps15m, ...sweeps1h];
  steps.push(`Step 6 — Liquidity Sweeps: ${allSweeps.length} confirmed (${allSweeps.length > 0 ? allSweeps.map(s => s.type).join(', ') : 'none'})`);

  // ═══════════════════════════════════════════════
  // STEP 7 — 15m / 1H STRUCTURE SHIFTS (BOS / CHOCH)
  // ═══════════════════════════════════════════════
  const shifts15m = detectStructureShifts(candles15m);
  const shifts1h  = detectStructureShifts(candles1h);
  const allShifts = [...shifts15m, ...shifts1h];
  steps.push(`Step 7 — Structure Shifts: ${allShifts.length > 0 ? allShifts.map(s => `${s.type} ${s.direction}`).join(', ') : 'None'}`);

  // ═══════════════════════════════════════════════
  // STEP 8 — SESSION FILTER
  // ═══════════════════════════════════════════════
  const session   = getCurrentSession();
  const sessionOk = isSessionValid(session);
  steps.push(`Step 8 — Session: ${session.name} (${session.status})`);

  // ═══════════════════════════════════════════════
  // STEP 9 — DIRECTION DETERMINATION
  // ═══════════════════════════════════════════════
  let direction = null;
  let upProb = 50, downProb = 50, rangeProb = 0;

  // Primary: 4H trend aligned with macro daily bias
  if (trend4h === 'bullish' && dailyBias === 'bullish') { direction = 'long';  upProb = 75; downProb = 15; rangeProb = 10; }
  else if (trend4h === 'bearish' && dailyBias === 'bearish') { direction = 'short'; upProb = 15; downProb = 75; rangeProb = 10; }
  // Secondary: 4H trend alone (counter-daily is lower probability)
  else if (trend4h === 'bullish') { direction = 'long';  upProb = 60; downProb = 25; rangeProb = 15; }
  else if (trend4h === 'bearish') { direction = 'short'; upProb = 25; downProb = 60; rangeProb = 15; }
  else { rangeProb = 50; upProb = 25; downProb = 25; }

  // Boosts from EMA stack alignment
  if (emaStackBullish && direction === 'long')  upProb   = Math.min(upProb + 5, 90);
  if (emaStackBearish && direction === 'short') downProb = Math.min(downProb + 5, 90);

  // Boost from sweep confirmation
  if (allSweeps.some(s => s.type === 'bullish') && direction === 'long')  upProb   = Math.min(upProb + 5, 90);
  if (allSweeps.some(s => s.type === 'bearish') && direction === 'short') downProb = Math.min(downProb + 5, 90);

  steps.push(`Step 9 — Direction: ${direction ? direction.toUpperCase() : 'NEUTRAL'} (↑${upProb}% ↓${downProb}% ◼${rangeProb}%)`);

  // ═══════════════════════════════════════════════
  // STEP 10 — OTE ZONE (Optimal Trade Entry, 61.8–79%)
  // ═══════════════════════════════════════════════
  const swings1h = findSwingPoints(candles1h, 3);
  const recentHighs1h = swings1h.filter(s => s.type === 'high').slice(-3);
  const recentLows1h  = swings1h.filter(s => s.type === 'low').slice(-3);

  let oteZone = null;
  if (direction === 'long' && recentHighs1h.length > 0 && recentLows1h.length > 0) {
    const relevantLow  = [...swings1h.filter(s => s.type === 'low'  && s.price < currentPrice)].pop();
    const relevantHigh = [...swings1h.filter(s => s.type === 'high' && s.price > currentPrice)].pop() || recentHighs1h[recentHighs1h.length - 1];
    if (relevantLow && relevantHigh) oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'long');
  } else if (direction === 'short' && recentHighs1h.length > 0 && recentLows1h.length > 0) {
    const relevantHigh = [...swings1h.filter(s => s.type === 'high' && s.price > currentPrice)].pop();
    const relevantLow  = [...swings1h.filter(s => s.type === 'low'  && s.price < currentPrice)].pop() || recentLows1h[recentLows1h.length - 1];
    if (relevantHigh && relevantLow) oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'short');
  }

  const inOTE = isInOTE(currentPrice, oteZone);
  steps.push(`Step 10 — OTE Zone: ${oteZone ? `${oteZone.lower.toFixed(2)} – ${oteZone.upper.toFixed(2)}` : 'N/A'} | Price in OTE: ${inOTE ? 'YES' : 'NO'}`);

  // ═══════════════════════════════════════════════
  // STEP 11 — ENTRY / SL / TP CALCULATION
  // ═══════════════════════════════════════════════
  let entry = currentPrice;
  let slData = null;
  let tpData = null;
  let positionSize = 0;
  let breakevenMove = null;

  if (direction) {
    // Identify nearest OB for invalidation boundary
    const nearestOB = direction === 'long'
      ? obs4h.filter(o => o.type === 'demand').sort((a, b) => b.entryBoundary - a.entryBoundary)[0]
      : obs4h.filter(o => o.type === 'supply').sort((a, b) => a.entryBoundary - b.entryBoundary)[0];

    const invalidationLevel = nearestOB
      ? (direction === 'long' ? nearestOB.lowerBound : nearestOB.upperBound)
      : (direction === 'long' ? currentPrice * 0.97 : currentPrice * 1.03);

    // Refine entry: if in OTE, use midpoint. Otherwise, use OB entry boundary if price is near one.
    if (inOTE && oteZone) {
      entry = oteZone.midpoint;
    } else if (nearestOB) {
      entry = nearestOB.entryBoundary;
    }

    slData = calculateSmartSL(invalidationLevel, direction, [...fvgs4h, ...fvgs1h]);

    const allSwings = [...swings4h.filter(s =>
      direction === 'long' ? s.type === 'high' && s.price > entry : s.type === 'low' && s.price < entry
    )];
    tpData = calculateTPs(entry, slData.value, allSwings, fvgs4h, direction);

    positionSize  = calculatePositionSize(entry, slData.value, balance);
    breakevenMove = calculateBreakevenMove(entry, slData.value);
  }

  const slPct = slData ? Math.abs(entry - slData.value) / entry : 0;
  steps.push(`Step 11 — Entry: ${entry.toFixed(2)} | SL: ${slData ? slData.value.toFixed(2) : 'N/A'} (${(slPct * 100).toFixed(2)}%) | TPs: ${tpData ? tpData.tps.map(t => t.level.toFixed(2)).join(' / ') : 'N/A'}`);

  // ═══════════════════════════════════════════════
  // STEP 12 — RSI DIVERGENCE CHECK (1H)
  // ═══════════════════════════════════════════════
  const rsiResult     = detectRSIDivergence(candles1h, direction, 14);
  const rsi1h         = rsiResult.rsiValue;
  const rsiDivergence = rsiResult.hasDivergence;
  const rsiDetail     = rsiDivergence
    ? rsiResult.detail
    : rsiResult.isOverbought ? 'Overbought (not divergence)'
    : rsiResult.isOversold   ? 'Oversold (not divergence)'
    : 'Neutral';

  steps.push(`Step 12 — RSI (1H): ${rsi1h ? rsi1h.toFixed(1) : 'N/A'} | Divergence: ${rsiDivergence ? 'YES — ' + rsiDetail : 'NO — ' + rsiDetail}`);

  // ═══════════════════════════════════════════════
  // STEP 13 — EMA200 S/R CHECK
  // ═══════════════════════════════════════════════
  const ema200Acting = e200 && Math.abs(currentPrice - e200) / e200 < 0.005;
  steps.push(`Step 13 — EMA200 S/R: ${ema200Acting ? `Price near EMA200 (${e200 ? e200.toFixed(2) : 'N/A'}) — acting as ${direction === 'long' ? 'support' : 'resistance'}` : 'Not a factor'}`);

  // ═══════════════════════════════════════════════
  // STEP 14 — RRR EVALUATION
  // ═══════════════════════════════════════════════
  const bestRRR       = tpData && tpData.tps.length > 0 ? Math.max(...tpData.tps.map(t => t.rrr)) : 0;
  const rrrMeetsMin   = bestRRR >= MIN_RRR;
  const rrrCaution    = bestRRR >= 1.5 && bestRRR < MIN_RRR;
  steps.push(`Step 14 — RRR: ${bestRRR.toFixed(1)} (${rrrMeetsMin ? `MEETS MINIMUM ≥ ${MIN_RRR}` : rrrCaution ? 'CAUTION — below minimum' : 'INSUFFICIENT'})`);

  // ═══════════════════════════════════════════════
  // STEP 15 — CONFLUENCE SCORING (10-point weighted system)
  // ═══════════════════════════════════════════════
  const trend4HAligned  = (direction === 'long' && trend4h === 'bullish') || (direction === 'short' && trend4h === 'bearish');
  const dailyAligned    = (direction === 'long' && dailyBias === 'bullish') || (direction === 'short' && dailyBias === 'bearish');
  const priceInFVG      = [...fvgs4h, ...fvgs1h].some(f => currentPrice >= f.lower && currentPrice <= f.upper);
  const liquidityEvent  = allSweeps.length > 0 || priceInFVG;
  const structureShift  = allShifts.length > 0;
  const hasBOS          = allShifts.some(s => s.type === 'BOS');
  const hasCHOCH        = allShifts.some(s => s.type === 'CHOCH');
  const orderFlowAligned = emaStackBullish && direction === 'long' || emaStackBearish && direction === 'short';

  // 10 weighted checks (5 pillars marked as critical)
  const checks = [
    // PILLARS (critical)
    { label: '4H Trend Aligned',            met: trend4HAligned,   pillar: true,  weight: 2 },
    { label: 'Liquidity Sweep / FVG Fill',  met: liquidityEvent,   pillar: true,  weight: 2 },
    { label: '15m / 1H BOS or CHOCH',       met: structureShift,   pillar: true,  weight: 2 },
    { label: 'London / NY Session',         met: sessionOk,        pillar: true,  weight: 1 },
    { label: 'RRR ≥ 1:2.5',                met: rrrMeetsMin,      pillar: true,  weight: 1 },
    // SUPPORTING
    { label: 'Daily Bias Aligned',          met: dailyAligned,     pillar: false, weight: 1 },
    { label: 'RSI Divergence Present',      met: rsiDivergence,    pillar: false, weight: 1 },
    { label: 'BOS Confirmed (not just CHOCH)', met: hasBOS,        pillar: false, weight: 1 },
    { label: 'EMA200 Acting as S/R',        met: ema200Acting,     pillar: false, weight: 1 },
    { label: 'Entry in OTE Zone (Fib)',     met: inOTE,            pillar: false, weight: 1 },
  ];

  const totalWeight  = checks.reduce((s, c) => s + c.weight, 0); // 13 weighted
  const scoredWeight = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const pillarsMet   = checks.filter(c => c.pillar && c.met).length;
  const pillarsTotal = checks.filter(c => c.pillar).length; // 5

  // Normalize to /10 for display
  const normalizedTotal = Math.round((scoredWeight / totalWeight) * 10);
  const pillarsAllMet   = pillarsMet >= MIN_PILLARS;
  const tier = normalizedTotal >= 8 ? 'EXCEPTIONAL'
    : normalizedTotal >= 6 ? 'HIGH'
    : normalizedTotal >= 4 ? 'MEDIUM'
    : 'REJECT';

  const confluenceScore = {
    total: normalizedTotal,
    max: 10,
    rawScore: scoredWeight,
    rawMax: totalWeight,
    pillarsMet,
    pillarsTotal,
    pillarsAllMet,
    tier,
    checks,
  };

  steps.push(`Step 15 — Confluence: ${normalizedTotal}/10 (${tier}) | Pillars: ${pillarsMet}/${pillarsTotal}`);

  // ═══════════════════════════════════════════════
  // STEP 16 — REJECTION / WAIT / APPROVE
  // ═══════════════════════════════════════════════
  let rejectionReason = null;
  let waitCondition   = null;

  if (!direction) {
    rejectionReason = 'No clear directional bias — market is ranging';
  } else if (!sessionOk && normalizedTotal < 8) {
    rejectionReason = 'Outside London / NY session window (low-probability time)';
  } else if (slPct > MAX_SL_PCT) {
    rejectionReason = `SL distance exceeds ${MAX_SL_PCT * 100}% (${(slPct * 100).toFixed(1)}%) — too wide`;
  } else if (pillarsMet < MIN_PILLARS) {
    const missingPillars = checks.filter(c => c.pillar && !c.met).map(c => c.label);

    // Is ONLY the entry trigger (Sweep/BOS) missing while everything else is aligned?
    const entryTriggerPillars = ['Liquidity Sweep / FVG Fill', '15m / 1H BOS or CHOCH'];
    const onlyEntryMissing = missingPillars.every(p => entryTriggerPillars.includes(p));

    if (onlyEntryMissing && normalizedTotal >= 5) {
      const targets = [];
      if (!liquidityEvent) {
        const targetSwing = direction === 'long'
          ? recentLows1h[recentLows1h.length - 1]?.price
          : recentHighs1h[recentHighs1h.length - 1]?.price;
        targets.push(`Sweep at ~$${targetSwing ? targetSwing.toFixed(2) : 'zone boundary'}`);
      }
      if (!structureShift) targets.push('15m BOS / CHOCH close');
      waitCondition = `Setup is aligned — waiting for: ${targets.join(' or ')}`;
    } else {
      rejectionReason = `Missing critical pillars: ${missingPillars.join(', ')}`;
    }
  } else if (normalizedTotal < MIN_CONFLUENCE) {
    rejectionReason = `Confluence too low: ${normalizedTotal}/10 (minimum ${MIN_CONFLUENCE})`;
  } else if (!rrrMeetsMin && !rrrCaution) {
    rejectionReason = `RRR insufficient: ${bestRRR.toFixed(1)} (minimum ${MIN_RRR})`;
  }

  if (!rejectionReason && !waitCondition && rrrCaution) {
    waitCondition = `RRR is ${bestRRR.toFixed(1)} — acceptable but tighten entry if possible`;
  }

  if (waitCondition && !rejectionReason) {
    steps.push(`Step 16 — Status: PENDING — ${waitCondition}`);
  } else if (rejectionReason) {
    steps.push(`Step 16 — Rejection: ${rejectionReason}`);
  } else {
    steps.push(`Step 16 — Approved: All filters passed`);
  }

  // ═══════════════════════════════════════════════
  // STEP 17 — FINAL DECISION
  // ═══════════════════════════════════════════════
  let decision;
  if (rejectionReason)  decision = 'NO_TRADE';
  else if (waitCondition) decision = 'WAIT';
  else                  decision = 'TAKE_NOW';

  steps.push(`Step 17 — Decision: ${decision}`);

  // Key risk and invalidation text
  const keyRisk = e200
    ? `EMA200 ${direction === 'long' ? 'overhead resistance' : 'support'} at ${e200.toFixed(2)}`
    : 'Monitor higher timeframe structure';

  const invalidationLevel = slData
    ? `Close ${direction === 'long' ? 'below' : 'above'} ${slData.rawInvalidation.toFixed(2)}`
    : 'N/A';

  return {
    decision,
    direction,
    entry: direction ? entry : null,
    stopLoss: slData,
    tp1: tpData?.tps[0]?.level || null,
    tp2: tpData?.tps[1]?.level || null,
    tp3: tpData?.tps[2]?.level || null,
    tpDetails: tpData?.tps || [],
    rrr: {
      tp1: tpData?.tps[0]?.rrr || 0,
      tp2: tpData?.tps[1]?.rrr || 0,
      tp3: tpData?.tps[2]?.rrr || 0,
    },
    positionSize,
    tpStructure: tpData?.tpStructure || 'single',
    breakevenMove,
    confluenceScore,
    session,
    upProbability:   upProb,
    downProbability: downProb,
    rangeProbability: rangeProb,
    rejectionReason,
    waitCondition,
    keyRisk,
    invalidationLevel,
    analysisSteps: steps,
    smcData: {
      orderBlocks:     [...obs4h, ...obs1h],
      fvgs:            [...fvgs4h, ...fvgs1h],
      sweeps:          allSweeps,
      structureShifts: allShifts,
    },
    oteZone,
    ema200_4h: e200,
    symbol,
  };
}
