// ─────────────────────────────────────────────────────────
//  Trade Analyzer v7.0 — Fully Corrected Engine
//  FIXES: MAX_SL 2.5%, ALL 5 pillars required, RRR≥3.0 pillar,
//         dynamic pillarsTotal, max=11, smcData in return,
//         OTE sort fix, swap validated before scoring
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
const MAX_SL_PCT     = 0.025; // FIX: 2.5% max SL (prompt hard-rejection rule)
const MIN_CONFLUENCE = 6;     // minimum score to trade
const MIN_PILLARS    = 5;     // FIX: ALL 5 pillars required (not 3)
const MIN_RRR        = 3.0;   // FIX: minimum RRR 1:3 (not 2.5)

export function runAnalysis(allData, config = {}) {
  const { symbol = 'BTCUSDT', balance = 10000, newsStatus = { veto: false } } = config;
  
  const steps = [];
  steps.push(`Initializing v7.0 Engine for ${symbol}`);

  if (newsStatus.veto) {
    return {
      decision: 'NO_TRADE',
      rejectionReason: `ECONOMIC VETO: ${newsStatus.reason}`,
      confluenceScore: { total: 0, max: 11, checks: [], tier: 'REJECT' },
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
      rejectionReason: 'Insufficient candle data',
      analysisSteps: ['ERROR: Not enough data.'],
      confluenceScore: { total: 0, max: 11, checks: [], pillarsAllMet: false, pillarsMet: 0, pillarsTotal: 5, tier: 'REJECT' },
    };
  }

  const currentPrice = candles15m[candles15m.length - 1].close;

  // Step 1: Daily Bias
  const ema200_1d = calculateEMA(candles1d, 200);
  const lastEma200_1d = ema200_1d[ema200_1d.length - 1];
  const dailyBias = lastEma200_1d ? (currentPrice > lastEma200_1d ? 'bullish' : 'bearish') : 'neutral';
  steps.push(`Daily Bias: ${dailyBias} (EMA200=${lastEma200_1d ? lastEma200_1d.toFixed(2) : 'N/A'})`);

  // Step 2: 4H Trend
  const swings4h = findSwingPoints(candles4h, 3);
  const lastHighs4h = swings4h.filter(s => s.type === 'high').slice(-2);
  const lastLows4h  = swings4h.filter(s => s.type === 'low').slice(-2);
  let trend4h = 'ranging';
  if (lastHighs4h.length >= 2 && lastLows4h.length >= 2) {
    if (lastHighs4h[1].price > lastHighs4h[0].price && lastLows4h[1].price > lastLows4h[0].price) trend4h = 'bullish';
    else if (lastHighs4h[1].price < lastHighs4h[0].price && lastLows4h[1].price < lastLows4h[0].price) trend4h = 'bearish';
  }
  steps.push(`4H Trend: ${trend4h}`);

  // EMA Stack
  const ema20_4h  = calculateEMA(candles4h, 20);
  const ema50_4h  = calculateEMA(candles4h, 50);
  const ema200_4h = calculateEMA(candles4h, 200);
  const e20 = ema20_4h[ema20_4h.length - 1];
  const e50 = ema50_4h[ema50_4h.length - 1];
  const e200 = ema200_4h[ema200_4h.length - 1];
  const emaStackBullish = e20 && e50 && e200 && e20 > e50 && e50 > e200;
  const emaStackBearish = e20 && e50 && e200 && e20 < e50 && e50 < e200;

  // Detection
  const obs4h = detectOrderBlocks(candles4h, currentPrice);
  const obs1h = detectOrderBlocks(candles1h, currentPrice);
  const fvgs4h = detectFVGs(candles4h, currentPrice);
  const fvgs1h = detectFVGs(candles1h, currentPrice);
  const sweeps15m = detectSweeps(candles15m);    // Now uses validated sweeps with 0.15% + displacement check
  const shifts15m = detectStructureShifts(candles15m);
  const shifts1h  = detectStructureShifts(candles1h);
  const allShifts = [...shifts15m, ...shifts1h];
  const session   = getCurrentSession();
  const sessionOk = isSessionValid(session);
  steps.push(`Session: ${session.name} — Valid: ${sessionOk}`);
  steps.push(`Sweeps detected: ${sweeps15m.length}, Structure shifts: ${allShifts.length}`);
  steps.push(`Order Blocks: ${obs4h.length + obs1h.length}, FVGs: ${fvgs4h.length + fvgs1h.length}`);

  // Direction
  let direction = null;
  let upProb = 50, downProb = 50;
  if (trend4h === 'bullish' && dailyBias === 'bullish') { direction = 'long';  upProb = 75; }
  else if (trend4h === 'bearish' && dailyBias === 'bearish') { direction = 'short'; downProb = 75; }
  else if (trend4h === 'bullish') { direction = 'long'; upProb = 60; }
  else if (trend4h === 'bearish') { direction = 'short'; downProb = 60; }
  steps.push(`Direction: ${direction || 'none'} | Up: ${upProb}% Down: ${downProb}%`);

  // FIX BUG 11 — OTE swing sorting: use sorted-by-index array, avoid .pop() mutation
  const swings1h = findSwingPoints(candles1h, 3);
  let oteZone = null;
  if (direction === 'long' && swings1h.length > 2) {
    const lows1h = swings1h.filter(s => s.type === 'low' && s.price < currentPrice).sort((a, b) => b.index - a.index);
    const highs1h = swings1h.filter(s => s.type === 'high' && s.price > currentPrice).sort((a, b) => b.index - a.index);
    const relevantLow  = lows1h[0];
    const relevantHigh = highs1h[0];
    if (relevantLow && relevantHigh) oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'long');
  } else if (direction === 'short' && swings1h.length > 2) {
    const highs1h = swings1h.filter(s => s.type === 'high' && s.price > currentPrice).sort((a, b) => b.index - a.index);
    const lows1h  = swings1h.filter(s => s.type === 'low' && s.price < currentPrice).sort((a, b) => b.index - a.index);
    const relevantHigh = highs1h[0];
    const relevantLow  = lows1h[0];
    if (relevantHigh && relevantLow) oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'short');
  }
  const inOTE = isInOTE(currentPrice, oteZone);
  steps.push(`OTE Zone: ${oteZone ? `${oteZone.lower.toFixed(2)} – ${oteZone.upper.toFixed(2)}` : 'N/A'} | In OTE: ${inOTE}`);

  // Entry / SL
  let entry = currentPrice;
  let slData = null;
  if (direction) {
    const nearestOB = direction === 'long'
      ? obs4h.filter(o => o.type === 'demand').sort((a, b) => b.entryBoundary - a.entryBoundary)[0]
      : obs4h.filter(o => o.type === 'supply').sort((a, b) => a.entryBoundary - b.entryBoundary)[0];
    const inv = nearestOB ? (direction === 'long' ? nearestOB.lowerBound : nearestOB.upperBound) : (direction === 'long' ? currentPrice * 0.97 : currentPrice * 1.03);
    if (inOTE && oteZone) entry = oteZone.midpoint;
    else if (nearestOB) entry = nearestOB.entryBoundary;
    slData = calculateSmartSL(inv, direction, [...fvgs4h, ...fvgs1h]);
    steps.push(`Entry: ${entry.toFixed(2)} | SL: ${slData.value.toFixed(2)} | Distance: ${((Math.abs(entry - slData.value) / entry) * 100).toFixed(2)}%`);
  }

  // Compute TPs first — needed for RRR pillar check
  let tpData = null;
  if (direction && slData) {
    const allSwings = swings4h.filter(s => direction === 'long' ? s.type === 'high' && s.price > entry : s.type === 'low' && s.price < entry);
    tpData = calculateTPs(entry, slData.value, allSwings, fvgs4h, direction, 'HIGH', session.name);

    // Add projected USDT profits to TP details
    tpData.tps.forEach(tp => {
      const fullPnl = Math.abs(tp.level - entry) * (calculatePositionSize(entry, slData.value, balance));
      const partialPnl = fullPnl * (tp.closePercent / 100);
      tp.projectedProfit = partialPnl.toFixed(2);
    });
    steps.push(`TPs: ${tpData.tps.map((t, i) => `TP${i+1}=$${t.level.toFixed(2)} (RRR 1:${t.rrr})`).join(', ')}`);
  }

  // FIX BUG 1 — RRR Pillar: compute actual TP1 RRR and check ≥ 3.0
  const tp1Rrr = (tpData && tpData.tps.length > 0) ? tpData.tps[0].rrr : 0;
  const rrrMeetsMinimum = tp1Rrr >= MIN_RRR;

  // Scoring
  const trend4HAligned  = (direction === 'long' && trend4h === 'bullish') || (direction === 'short' && trend4h === 'bearish');
  const dailyAligned    = (direction === 'long' && dailyBias === 'bullish') || (direction === 'short' && dailyBias === 'bearish');
  const liquidityEvent  = sweeps15m.length > 0 || [...fvgs4h, ...fvgs1h].some(f => currentPrice >= f.lower && currentPrice <= f.upper);
  const structureShift  = allShifts.length > 0;
  const rsiResult       = detectRSIDivergence(candles1h, direction, 14);
  const ema200Acting    = e200 && Math.abs(currentPrice - e200) / e200 < 0.005;
  const slPct           = slData ? Math.abs(entry - slData.value) / entry : 0;

  // FIX BUG 1 + BUG 8 — Add RRR as pillar, max=11
  const checks = [
    { label: '4H Trend Aligned',            met: trend4HAligned,         pillar: true,  weight: 2 },
    { label: 'Liquidity Sweep / FVG Fill',  met: liquidityEvent,         pillar: true,  weight: 2 },
    { label: '15m / 1H BOS or CHOCH',       met: structureShift,         pillar: true,  weight: 2 },
    { label: 'London / NY Session',         met: sessionOk,              pillar: true,  weight: 1 },
    { label: 'RRR ≥ 1:3 (Structural)',      met: rrrMeetsMinimum,        pillar: true,  weight: 2 }, // FIX: 5th pillar
    { label: 'Daily Bias Aligned',          met: dailyAligned,           pillar: false, weight: 1 },
    { label: 'RSI Divergence Present',      met: rsiResult.hasDivergence,pillar: false, weight: 1 },
    { label: 'EMA200 Acting as S/R',        met: ema200Acting,           pillar: false, weight: 1 },
    { label: 'Entry in OTE Zone (Fib)',     met: inOTE,                  pillar: false, weight: 1 },
  ];

  const totalWeight  = checks.reduce((s, c) => s + c.weight, 0);
  const scoredWeight = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const normalizedTotal = Math.round((scoredWeight / totalWeight) * 11); // FIX: scale to 11
  // FIX BUG 2 — pillarsTotal is dynamic
  const pillarsMet   = checks.filter(c => c.pillar && c.met).length;
  const pillarsTotal = checks.filter(c => c.pillar).length; // = 5
  const tier = normalizedTotal >= 8 ? 'EXCEPTIONAL' : normalizedTotal >= 6 ? 'HIGH' : normalizedTotal >= 4 ? 'MEDIUM' : 'REJECT';

  // Position Size
  const positionSize = (direction && slData) ? calculatePositionSize(entry, slData.value, balance) : 0;
  const breakevenMove = (direction && slData) ? calculateBreakevenMove(entry, slData.value) : null;
  const projectedLoss = direction ? '5.00' : '0.00'; // Fixed $5 risk

  // Decision — FIX BUG 3: MIN_PILLARS=5 means ALL pillars required
  let decision = 'NO_TRADE';
  let rejectionReason = null;
  let waitCondition = null;

  if (!direction)                       rejectionReason = 'No clear 4H or daily bias';
  else if (slPct > MAX_SL_PCT)          rejectionReason = `SL too wide: ${(slPct * 100).toFixed(2)}% > 2.5% max`; // FIX BUG 4
  else if (!rrrMeetsMinimum)            rejectionReason = `RRR too low: ${tp1Rrr.toFixed(2)} < 3.0 minimum`;       // FIX BUG 5
  else if (pillarsMet < MIN_PILLARS)    rejectionReason = `Missing pillars: ${pillarsMet}/${pillarsTotal} met`;     // FIX BUG 3
  else if (normalizedTotal < MIN_CONFLUENCE) rejectionReason = `Confluence too low: ${normalizedTotal}/11`;
  else decision = 'TAKE_NOW';

  steps.push(`Decision: ${decision} | Confluence: ${normalizedTotal}/11 | Pillars: ${pillarsMet}/${pillarsTotal}`);
  if (rejectionReason) steps.push(`Rejected: ${rejectionReason}`);

  // Update tier if rejected after pillar checks
  const finalTier = (decision === 'NO_TRADE' && tier !== 'REJECT') ? (pillarsMet < pillarsTotal ? 'REJECT' : tier) : tier;

  return {
    decision,
    direction,
    entry,
    stopLoss: slData,
    tpDetails: tpData?.tps || [],
    positionSize,
    projectedLoss,
    breakevenMove,
    confluenceScore: {
      total: normalizedTotal,
      max: 11,           // FIX BUG 8
      tier: finalTier,
      checks,
      pillarsMet,
      pillarsTotal,      // FIX BUG 2 — dynamic (= 5)
      pillarsAllMet: pillarsMet === pillarsTotal,
    },
    session,
    upProbability: upProb,
    downProbability: 100 - upProb,
    rejectionReason,
    waitCondition,
    keyRisk: ema200Acting ? 'EMA200 Resistance' : slPct > 0.015 ? 'Wide SL — Position Size Small' : 'Market Volatility',
    invalidationLevel: slData ? slData.rawInvalidation.toFixed(2) : 'N/A',
    analysisSteps: steps,
    oteZone,
    symbol,
    balance,
    // FIX BUG 15 — smcData now included so the UI SMC section renders correctly
    smcData: {
      orderBlocks: [...obs4h, ...obs1h],
      fvgs: [...fvgs4h, ...fvgs1h],
      sweeps: sweeps15m,
      structureShifts: allShifts,
    },
  };
}
