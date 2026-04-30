// ─────────────────────────────────────────────────────────
//  Trade Analyzer — Master 17-Step Orchestrator
//  Pure logic — no React dependencies
// ─────────────────────────────────────────────────────────

import { detectOrderBlocks, detectFVGs, detectSweeps, detectStructureShifts, calculateEMA, calculateRSI, detectRSIDivergence, findSwingPoints } from './smcDetector.js';
import { calculateOTE, isInOTE } from './oteCalculator.js';
import { calculateSmartSL, calculateTPs, calculatePositionSize, calculateRRR, calculateBreakevenMove } from './riskManager.js';
import { scoreConfluence } from './confluenceScorer.js';
import { getCurrentSession, isSessionValid } from './sessionFilter.js';
import { RISK_AMOUNT } from '../utils/constants.js';

export function runAnalysis(data, config = {}) {
  const { symbol = 'BTCUSDT' } = config;
  const steps = [];
  const candles15m = data['15m'] || [];
  const candles1h = data['1h'] || [];
  const candles4h = data['4h'] || [];
  const candles1d = data['1d'] || [];

  if (candles15m.length < 50 || candles4h.length < 50) {
    return {
      decision: 'NO_TRADE',
      direction: null,
      rejectionReason: 'Insufficient candle data for analysis',
      analysisSteps: ['ERROR: Not enough data loaded. Need at least 50 candles per timeframe.'],
      confluenceScore: { total: 0, max: 11, checks: [], pillarsAllMet: false },
    };
  }

  const currentPrice = candles15m[candles15m.length - 1].close;

  // ═══════════════════════════════════════════════
  // STEP 1 — DAILY BIAS
  // ═══════════════════════════════════════════════
  const ema20_1d = calculateEMA(candles1d, 20);
  const lastEma20_1d = ema20_1d[ema20_1d.length - 1];
  const dailyBias = currentPrice > (lastEma20_1d || currentPrice) ? 'bullish' : 'bearish';
  steps.push(`Step 1 — Daily Bias: ${dailyBias.toUpperCase()} (Price ${dailyBias === 'bullish' ? 'above' : 'below'} Daily EMA20)`);

  // ═══════════════════════════════════════════════
  // STEP 2 — 4H TREND STRUCTURE
  // ═══════════════════════════════════════════════
  const swings4h = findSwingPoints(candles4h, 3);
  const lastHighs4h = swings4h.filter(s => s.type === 'high').slice(-3);
  const lastLows4h = swings4h.filter(s => s.type === 'low').slice(-3);

  let trend4h = 'ranging';
  if (lastHighs4h.length >= 2 && lastLows4h.length >= 2) {
    const hh = lastHighs4h[lastHighs4h.length - 1].price > lastHighs4h[lastHighs4h.length - 2].price;
    const hl = lastLows4h[lastLows4h.length - 1].price > lastLows4h[lastLows4h.length - 2].price;
    if (hh && hl) trend4h = 'bullish';
    else if (!hh && !hl) trend4h = 'bearish';
  }
  steps.push(`Step 2 — 4H Trend: ${trend4h.toUpperCase()} (${trend4h === 'bullish' ? 'HH/HL' : trend4h === 'bearish' ? 'LH/LL' : 'No clear structure'})`);

  // ═══════════════════════════════════════════════
  // STEP 3 — EMA STACK (4H)
  // ═══════════════════════════════════════════════
  const ema20_4h = calculateEMA(candles4h, 20);
  const ema50_4h = calculateEMA(candles4h, 50);
  const ema200_4h = calculateEMA(candles4h, 200);
  const lastEma20 = ema20_4h[ema20_4h.length - 1];
  const lastEma50 = ema50_4h[ema50_4h.length - 1];
  const lastEma200 = ema200_4h[ema200_4h.length - 1];

  const emaStackBullish = lastEma20 && lastEma50 && lastEma200 && lastEma20 > lastEma50 && lastEma50 > lastEma200;
  const emaStackBearish = lastEma20 && lastEma50 && lastEma200 && lastEma20 < lastEma50 && lastEma50 < lastEma200;
  steps.push(`Step 3 — EMA Stack: ${emaStackBullish ? 'Bullish (20>50>200)' : emaStackBearish ? 'Bearish (20<50<200)' : 'Mixed'}`);

  // ═══════════════════════════════════════════════
  // STEP 4 — SMC DETECTION (Order Blocks)
  // ═══════════════════════════════════════════════
  const obs4h = detectOrderBlocks(candles4h, currentPrice);
  const obs1h = detectOrderBlocks(candles1h, currentPrice);
  steps.push(`Step 4 — Order Blocks: ${obs4h.length} active on 4H, ${obs1h.length} active on 1H`);

  // ═══════════════════════════════════════════════
  // STEP 5 — FVG DETECTION
  // ═══════════════════════════════════════════════
  const fvgs4h = detectFVGs(candles4h, currentPrice);
  const fvgs1h = detectFVGs(candles1h, currentPrice);
  steps.push(`Step 5 — Fair Value Gaps: ${fvgs4h.length} unfilled on 4H, ${fvgs1h.length} on 1H`);

  // ═══════════════════════════════════════════════
  // STEP 6 — LIQUIDITY SWEEPS
  // ═══════════════════════════════════════════════
  const sweeps = detectSweeps(candles15m);
  steps.push(`Step 6 — Liquidity Sweeps: ${sweeps.length} confirmed (${sweeps.length > 0 ? sweeps.map(s => s.type).join(', ') : 'none'})`);

  // ═══════════════════════════════════════════════
  // STEP 7 — STRUCTURE SHIFTS (15m)
  // ═══════════════════════════════════════════════
  const shifts15m = detectStructureShifts(candles15m);
  steps.push(`Step 7 — 15m Structure: ${shifts15m.length > 0 ? shifts15m.map(s => `${s.type} ${s.direction}`).join(', ') : 'No confirmed shifts'}`);

  // ═══════════════════════════════════════════════
  // STEP 8 — SESSION FILTER
  // ═══════════════════════════════════════════════
  const session = getCurrentSession();
  const sessionOk = isSessionValid(session);
  steps.push(`Step 8 — Session: ${session.name} (${session.status})`);

  // ═══════════════════════════════════════════════
  // STEP 9 — DIRECTION DETERMINATION
  // ═══════════════════════════════════════════════
  let direction = null;
  let upProb = 50, downProb = 50, rangeProb = 0;

  if (trend4h === 'bullish' && emaStackBullish) { direction = 'long'; upProb = 70; downProb = 20; rangeProb = 10; }
  else if (trend4h === 'bearish' && emaStackBearish) { direction = 'short'; upProb = 20; downProb = 70; rangeProb = 10; }
  else if (trend4h === 'bullish') { direction = 'long'; upProb = 60; downProb = 25; rangeProb = 15; }
  else if (trend4h === 'bearish') { direction = 'short'; upProb = 25; downProb = 60; rangeProb = 15; }
  else { rangeProb = 50; upProb = 25; downProb = 25; }

  // Sweep confirmation boosts
  if (sweeps.some(s => s.type === 'bullish') && direction === 'long') upProb += 5;
  if (sweeps.some(s => s.type === 'bearish') && direction === 'short') downProb += 5;

  steps.push(`Step 9 — Direction: ${direction ? direction.toUpperCase() : 'NEUTRAL'} (↑${upProb}% ↓${downProb}% ◼${rangeProb}%)`);

  // ═══════════════════════════════════════════════
  // STEP 10 — OTE ZONE CALCULATION
  // ═══════════════════════════════════════════════
  const swings1h = findSwingPoints(candles1h, 3);
  const recentHighs1h = swings1h.filter(s => s.type === 'high').slice(-2);
  const recentLows1h = swings1h.filter(s => s.type === 'low').slice(-2);

  // Find the correct impulse leg that brackets current price
  let oteZone = null;
  if (direction === 'long' && recentHighs1h.length > 0 && recentLows1h.length > 0) {
    // For long: find the most recent swing low BELOW price and swing high ABOVE price
    const relevantLow = [...swings1h.filter(s => s.type === 'low' && s.price < currentPrice)].pop();
    const relevantHigh = [...swings1h.filter(s => s.type === 'high' && s.price > currentPrice)].pop()
      || recentHighs1h[recentHighs1h.length - 1];
    if (relevantLow && relevantHigh) {
      oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'long');
    }
  } else if (direction === 'short' && recentHighs1h.length > 0 && recentLows1h.length > 0) {
    // For short: find the most recent swing high ABOVE price and swing low BELOW price
    const relevantHigh = [...swings1h.filter(s => s.type === 'high' && s.price > currentPrice)].pop();
    const relevantLow = [...swings1h.filter(s => s.type === 'low' && s.price < currentPrice)].pop()
      || recentLows1h[recentLows1h.length - 1];
    if (relevantHigh && relevantLow) {
      oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'short');
    }
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
    // Find nearest OB for invalidation
    const nearestOB = direction === 'long'
      ? obs4h.filter(o => o.type === 'demand').sort((a, b) => b.entryBoundary - a.entryBoundary)[0]
      : obs4h.filter(o => o.type === 'supply').sort((a, b) => a.entryBoundary - b.entryBoundary)[0];

    const invalidationLevel = nearestOB
      ? (direction === 'long' ? nearestOB.lowerBound : nearestOB.upperBound)
      : (direction === 'long' ? currentPrice * 0.98 : currentPrice * 1.02);

    // Refine entry with OTE if available
    if (inOTE && oteZone) {
      entry = oteZone.midpoint;
    }

    slData = calculateSmartSL(invalidationLevel, direction, [...fvgs4h, ...fvgs1h]);

    // Calculate TPs using 4H swing targets
    const allSwings = [...swings4h.filter(s =>
      direction === 'long' ? s.type === 'high' && s.price > entry : s.type === 'low' && s.price < entry
    )];
    tpData = calculateTPs(entry, slData.value, allSwings, fvgs4h, direction);

    positionSize = calculatePositionSize(entry, slData.value);
    breakevenMove = calculateBreakevenMove(entry, slData.value);
  }

  steps.push(`Step 11 — Trade Levels: Entry ${entry.toFixed(2)} | SL ${slData ? slData.value.toFixed(2) : 'N/A'} | TPs ${tpData ? tpData.tps.map(t => t.level.toFixed(2)).join(' / ') : 'N/A'}`);

  // ═══════════════════════════════════════════════
  // STEP 12 — RSI CHECK
  // ═══════════════════════════════════════════════
  // True RSI divergence detection (not just overbought/oversold)
  const rsiResult = detectRSIDivergence(candles1h, direction, 14);
  const rsi1h = rsiResult.rsiValue;
  const rsiDivergence = rsiResult.hasDivergence;
  const rsiDetail = rsiDivergence
    ? rsiResult.detail
    : rsiResult.isOverbought ? 'Overbought (not divergence)'
    : rsiResult.isOversold ? 'Oversold (not divergence)'
    : 'Neutral';
  steps.push(`Step 12 — RSI (1H): ${rsi1h ? rsi1h.toFixed(1) : 'N/A'} | Divergence: ${rsiDivergence ? 'YES — ' + rsiDetail : 'NO — ' + rsiDetail}`);

  // ═══════════════════════════════════════════════
  // STEP 13 — EMA200 SUPPORT/RESISTANCE
  // ═══════════════════════════════════════════════
  const ema200Acting = lastEma200 && Math.abs(currentPrice - lastEma200) / lastEma200 < 0.005;
  steps.push(`Step 13 — EMA200 S/R: ${ema200Acting ? 'Price near EMA200 — acting as support/resistance' : 'Not a factor'}`);

  // ═══════════════════════════════════════════════
  // STEP 14 — RRR EVALUATION
  // ═══════════════════════════════════════════════
  // Use the BEST RRR across all TPs, not just TP1
  const bestRRR = tpData && tpData.tps.length > 0 ? Math.max(...tpData.tps.map(t => t.rrr)) : 0;
  const rrrMeetsMinimum = bestRRR >= 3.0;
  const rrrCaution = bestRRR >= 1.5 && bestRRR < 3.0;
  steps.push(`Step 14 — RRR: ${bestRRR.toFixed(1)} (${rrrMeetsMinimum ? 'MEETS MINIMUM' : rrrCaution ? 'CAUTION — below 1:3' : 'INSUFFICIENT'})`);

  // ═══════════════════════════════════════════════
  // STEP 15 — CONFLUENCE SCORING
  // ═══════════════════════════════════════════════
  // Liquidity event = actual sweep confirmed OR price is currently filling an FVG
  const priceInFVG = [...fvgs4h, ...fvgs1h].some(f => currentPrice >= f.lower && currentPrice <= f.upper);
  const liquidityEvent = sweeps.length > 0 || priceInFVG;
  const structureShift15m = shifts15m.length > 0;

  const confluenceScore = scoreConfluence({
    trend4HAligned,
    liquidityEvent,
    structureShift15m,
    sessionActive: sessionOk,
    rrrMeetsMinimum,
    dailyAligned: (direction === 'long' && dailyBias === 'bullish') || (direction === 'short' && dailyBias === 'bearish'),
    rsiDivergence,
    patternAligned: shifts15m.some(s => s.type === 'BOS'),
    ema200Support: ema200Acting,
    orderFlowAligned: emaStackBullish || emaStackBearish,
    oteEntry: inOTE,
  });

  steps.push(`Step 15 — Confluence: ${confluenceScore.total} / ${confluenceScore.max} (${confluenceScore.tier}) | Pillars: ${confluenceScore.pillarsMet}/${confluenceScore.pillarsTotal}`);

  // ═══════════════════════════════════════════════
  // STEP 16 — REJECTION CHECKS
  // ═══════════════════════════════════════════════
  let rejectionReason = null;
  let waitCondition = null;

  if (!direction) {
    rejectionReason = 'No clear directional bias — market is ranging';
  } else if (!confluenceScore.pillarsAllMet) {
    const missingPillars = confluenceScore.checks.filter(c => c.pillar && !c.met).map(c => c.label);
    rejectionReason = `Missing pillars: ${missingPillars.join(', ')}`;
  } else if (confluenceScore.total <= 4) {
    rejectionReason = `Confluence too low: ${confluenceScore.total}/11`;
  } else if (slData && Math.abs(entry - slData.value) / entry > 0.025) {
    rejectionReason = `SL distance exceeds 2.5% (${(Math.abs(entry - slData.value) / entry * 100).toFixed(1)}%)`;
  } else if (Math.max(upProb, downProb) < 55) {
    rejectionReason = `Directional probability too low (${Math.max(upProb, downProb)}%)`;
  }

  if (!rejectionReason && rrrCaution && !rrrMeetsMinimum) {
    waitCondition = 'RRR is between 1:1.5 and 1:3 — proceed with caution';
  }

  steps.push(`Step 16 — Rejection: ${rejectionReason || 'NONE'}`);

  // ═══════════════════════════════════════════════
  // STEP 17 — FINAL DECISION
  // ═══════════════════════════════════════════════
  let decision;
  if (rejectionReason) {
    decision = 'NO_TRADE';
  } else if (waitCondition) {
    decision = 'WAIT';
  } else {
    decision = 'TAKE_NOW';
  }

  steps.push(`Step 17 — Decision: ${decision}`);

  // Build key risk and invalidation descriptions
  const keyRisk = lastEma200
    ? `EMA200 ${direction === 'long' ? 'overhead resistance' : 'support'} at ${lastEma200.toFixed(2)}`
    : 'Monitor higher timeframe structure';

  const invalidationLevel = slData
    ? `Close ${direction === 'long' ? 'below' : 'above'} ${slData.rawInvalidation.toFixed(2)} (${direction === 'long' ? 'demand' : 'supply'} OB boundary)`
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
    upProbability: upProb,
    downProbability: downProb,
    rangeProbability: rangeProb,
    rejectionReason,
    waitCondition,
    keyRisk,
    invalidationLevel,
    analysisSteps: steps,
    smcData: {
      orderBlocks: [...obs4h, ...obs1h],
      fvgs: [...fvgs4h, ...fvgs1h],
      sweeps,
      structureShifts: shifts15m,
    },
    oteZone,
    ema200_4h: lastEma200,
    symbol,
  };
}
