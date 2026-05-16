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
const MAX_SL_PCT     = 0.030; // 3.0% max SL
const MIN_CONFLUENCE = 6;     // minimum score to trade
const MIN_PILLARS    = 3;     // minimum pillars out of 5 to trade
const MIN_RRR        = 2.5;   // minimum RRR

export function runAnalysis(allData, config = {}) {
  const { symbol = 'BTCUSDT', balance = 10000, newsStatus = { veto: false } } = config;
  
  const steps = [];
  steps.push(`Initializing v6.2 Engine for ${symbol}`);

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
      rejectionReason: 'Insufficient candle data',
      analysisSteps: ['ERROR: Not enough data.'],
      confluenceScore: { total: 0, max: 10, checks: [], pillarsAllMet: false, pillarsMet: 0, pillarsTotal: 5, tier: 'REJECT' },
    };
  }

  const currentPrice = candles15m[candles15m.length - 1].close;

  // Step 1: Daily Bias
  const ema200_1d = calculateEMA(candles1d, 200);
  const lastEma200_1d = ema200_1d[ema200_1d.length - 1];
  const dailyBias = lastEma200_1d ? (currentPrice > lastEma200_1d ? 'bullish' : 'bearish') : 'neutral';

  // Step 2: 4H Trend
  const swings4h = findSwingPoints(candles4h, 3);
  const lastHighs4h = swings4h.filter(s => s.type === 'high').slice(-2);
  const lastLows4h  = swings4h.filter(s => s.type === 'low').slice(-2);
  let trend4h = 'ranging';
  if (lastHighs4h.length >= 2 && lastLows4h.length >= 2) {
    if (lastHighs4h[1].price > lastHighs4h[0].price && lastLows4h[1].price > lastLows4h[0].price) trend4h = 'bullish';
    else if (lastHighs4h[1].price < lastHighs4h[0].price && lastLows4h[1].price < lastLows4h[0].price) trend4h = 'bearish';
  }

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
  const sweeps15m = detectSweeps(candles15m);
  const shifts15m = detectStructureShifts(candles15m);
  const shifts1h  = detectStructureShifts(candles1h);
  const allShifts = [...shifts15m, ...shifts1h];
  const session   = getCurrentSession();
  const sessionOk = isSessionValid(session);

  // Direction
  let direction = null;
  let upProb = 50, downProb = 50;
  if (trend4h === 'bullish' && dailyBias === 'bullish') { direction = 'long';  upProb = 75; }
  else if (trend4h === 'bearish' && dailyBias === 'bearish') { direction = 'short'; downProb = 75; }
  else if (trend4h === 'bullish') { direction = 'long'; upProb = 60; }
  else if (trend4h === 'bearish') { direction = 'short'; downProb = 60; }

  // OTE
  const swings1h = findSwingPoints(candles1h, 3);
  let oteZone = null;
  if (direction === 'long' && swings1h.length > 2) {
    const relevantLow  = [...swings1h.filter(s => s.type === 'low'  && s.price < currentPrice)].pop();
    const relevantHigh = [...swings1h.filter(s => s.type === 'high' && s.price > currentPrice)].pop();
    if (relevantLow && relevantHigh) oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'long');
  } else if (direction === 'short' && swings1h.length > 2) {
    const relevantHigh = [...swings1h.filter(s => s.type === 'high' && s.price > currentPrice)].pop();
    const relevantLow  = [...swings1h.filter(s => s.type === 'low'  && s.price < currentPrice)].pop();
    if (relevantHigh && relevantLow) oteZone = calculateOTE(relevantHigh.price, relevantLow.price, 'short');
  }
  const inOTE = isInOTE(currentPrice, oteZone);

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
  }

  // Scoring
  const trend4HAligned  = (direction === 'long' && trend4h === 'bullish') || (direction === 'short' && trend4h === 'bearish');
  const dailyAligned    = (direction === 'long' && dailyBias === 'bullish') || (direction === 'short' && dailyBias === 'bearish');
  const liquidityEvent  = sweeps15m.length > 0 || [...fvgs4h, ...fvgs1h].some(f => currentPrice >= f.lower && currentPrice <= f.upper);
  const structureShift  = allShifts.length > 0;
  const rsiResult       = detectRSIDivergence(candles1h, direction, 14);
  const ema200Acting    = e200 && Math.abs(currentPrice - e200) / e200 < 0.005;

  const checks = [
    { label: '4H Trend Aligned',            met: trend4HAligned,   pillar: true,  weight: 2 },
    { label: 'Liquidity Sweep / FVG Fill',  met: liquidityEvent,   pillar: true,  weight: 2 },
    { label: '15m / 1H BOS or CHOCH',       met: structureShift,   pillar: true,  weight: 2 },
    { label: 'London / NY Session',         met: sessionOk,        pillar: true,  weight: 1 },
    { label: 'Daily Bias Aligned',          met: dailyAligned,     pillar: false, weight: 1 },
    { label: 'RSI Divergence Present',      met: rsiResult.hasDivergence, pillar: false, weight: 1 },
    { label: 'EMA200 Acting as S/R',        met: ema200Acting,     pillar: false, weight: 1 },
    { label: 'Entry in OTE Zone (Fib)',     met: inOTE,            pillar: false, weight: 1 },
  ];

  const totalWeight  = checks.reduce((s, c) => s + c.weight, 0);
  const scoredWeight = checks.reduce((s, c) => s + (c.met ? c.weight : 0), 0);
  const normalizedTotal = Math.round((scoredWeight / totalWeight) * 10);
  const pillarsMet   = checks.filter(c => c.pillar && c.met).length;
  const tier = normalizedTotal >= 8 ? 'EXCEPTIONAL' : normalizedTotal >= 6 ? 'HIGH' : normalizedTotal >= 4 ? 'MEDIUM' : 'REJECT';

  // TPs with Dynamic Scaling
  let tpData = null;
  if (direction && slData) {
    const allSwings = swings4h.filter(s => direction === 'long' ? s.type === 'high' && s.price > entry : s.type === 'low' && s.price < entry);
    tpData = calculateTPs(entry, slData.value, allSwings, fvgs4h, direction, tier, session.name);
    
    // Add projected USDT profits to TP details
    tpData.tps.forEach(tp => {
      const pnl = Math.abs(tp.level - entry) * (calculatePositionSize(entry, slData.value, balance));
      tp.projectedProfit = pnl.toFixed(2);
    });
  }

  // Position Size
  const positionSize = (direction && slData) ? calculatePositionSize(entry, slData.value, balance) : 0;
  const breakevenMove = (direction && slData) ? calculateBreakevenMove(entry, slData.value) : null;
  const slPct = slData ? Math.abs(entry - slData.value) / entry : 0;
  const projectedLoss = direction ? '5.00' : '0.00'; // Fixed $5 risk

  // Decision
  let decision = 'NO_TRADE';
  let rejectionReason = null;
  let waitCondition = null;

  if (!direction) rejectionReason = 'No clear bias';
  else if (slPct > MAX_SL_PCT) rejectionReason = 'SL too wide';
  else if (pillarsMet < MIN_PILLARS) rejectionReason = 'Missing critical pillars';
  else if (normalizedTotal < MIN_CONFLUENCE) rejectionReason = 'Confluence too low';
  else decision = 'TAKE_NOW';

  return {
    decision,
    direction,
    entry,
    stopLoss: slData,
    tpDetails: tpData?.tps || [],
    positionSize,
    projectedLoss,
    breakevenMove,
    confluenceScore: { total: normalizedTotal, max: 10, tier, checks, pillarsMet, pillarsTotal: 4 },
    session,
    upProbability: upProb,
    downProbability: 100 - upProb,
    rejectionReason,
    waitCondition,
    keyRisk: ema200Acting ? 'EMA200 Resistance' : 'Market Volatility',
    invalidationLevel: slData ? slData.rawInvalidation.toFixed(2) : 'N/A',
    analysisSteps: steps,
    oteZone,
    symbol,
    balance
  };
}
