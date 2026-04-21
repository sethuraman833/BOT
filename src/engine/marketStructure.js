// ─────────────────────────────────────────────────────────
//  Market Structure Analyzer — Steps 1, 2, 5
//  Daily Bias, 4H Bias (Pillar 1), 1H Structure
// ─────────────────────────────────────────────────────────

import { calculateAllEMAs, calculateRSI, findSwingPoints, detectRSIDivergence } from './indicators.js';

/**
 * Analyze daily bias (Step 1) — preference filter, not hard gate.
 */
export function analyzeDailyBias(candles) {
  if (!candles || candles.length < 200) {
    return { bias: 'neutral', description: 'Insufficient daily data', confidence: 'low' };
  }

  const emas = calculateAllEMAs(candles);
  const last = candles.length - 1;
  const price = candles[last].close;
  const ema20 = emas.ema20[last];
  const ema50 = emas.ema50[last];
  const ema200 = emas.ema200[last];

  const { swingHighs, swingLows } = findSwingPoints(candles, 5, 5);

  // Trend from swing structure
  let structureBias = 'neutral';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastH = swingHighs[swingHighs.length - 1];
    const prevH = swingHighs[swingHighs.length - 2];
    const lastL = swingLows[swingLows.length - 1];
    const prevL = swingLows[swingLows.length - 2];

    if (lastH.price > prevH.price && lastL.price > prevL.price) {
      structureBias = 'bullish';
    } else if (lastH.price < prevH.price && lastL.price < prevL.price) {
      structureBias = 'bearish';
    }
  }

  // EMA alignment
  let emaBias = 'neutral';
  if (price > ema200 && ema20 > ema50 && ema50 > ema200) {
    emaBias = 'bullish';
  } else if (price < ema200 && ema20 < ema50 && ema50 < ema200) {
    emaBias = 'bearish';
  }

  // Combined
  if (structureBias === 'bullish' && emaBias === 'bullish') {
    return { bias: 'bullish', description: 'Daily trend bullish — HH/HL + price above EMA200', confidence: 'high' };
  }
  if (structureBias === 'bearish' && emaBias === 'bearish') {
    return { bias: 'bearish', description: 'Daily trend bearish — LH/LL + price below EMA200', confidence: 'high' };
  }
  if (structureBias === emaBias) {
    return { bias: structureBias, description: `Daily trend ${structureBias}`, confidence: 'medium' };
  }

  return { bias: 'neutral', description: 'Daily consolidating — mixed signals', confidence: 'low' };
}

/**
 * Analyze 4H bias (Step 2 / Pillar 1).
 */
export function analyze4HBias(candles) {
  if (!candles || candles.length < 200) {
    return {
      bias: 'neutral', trend: 'ranging', strength: 'weak',
      emaAlignment: 'mixed', description: 'Insufficient 4H data',
      supportResistance: [], swingHighs: [], swingLows: [],
      emas: null,
    };
  }

  const emas = calculateAllEMAs(candles);
  const last = candles.length - 1;
  const price = candles[last].close;
  const ema20 = emas.ema20[last];
  const ema50 = emas.ema50[last];
  const ema200 = emas.ema200[last];

  const { swingHighs, swingLows } = findSwingPoints(candles, 3, 3);

  // Market structure
  let structure = 'ranging';
  let structureBias = 'neutral';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const recentHighs = swingHighs.slice(-3);
    const recentLows = swingLows.slice(-3);
    const hhCount = recentHighs.filter((h, i) => i > 0 && h.price > recentHighs[i-1].price).length;
    const llCount = recentLows.filter((l, i) => i > 0 && l.price < recentLows[i-1].price).length;
    const hlCount = recentLows.filter((l, i) => i > 0 && l.price > recentLows[i-1].price).length;
    const lhCount = recentHighs.filter((h, i) => i > 0 && h.price < recentHighs[i-1].price).length;

    if (hhCount > 0 && hlCount > 0) {
      structure = 'trending';
      structureBias = 'bullish';
    } else if (llCount > 0 && lhCount > 0) {
      structure = 'trending';
      structureBias = 'bearish';
    }
  }

  // EMA alignment
  let emaAlignment = 'mixed';
  if (ema20 > ema50 && ema50 > ema200) emaAlignment = 'bullish';
  else if (ema20 < ema50 && ema50 < ema200) emaAlignment = 'bearish';

  // Combined bias
  let bias = 'neutral';
  let strength = 'weak';
  if (structureBias === 'bullish' && price > ema200) {
    bias = 'bullish';
    strength = emaAlignment === 'bullish' ? 'strong' : 'moderate';
  } else if (structureBias === 'bearish' && price < ema200) {
    bias = 'bearish';
    strength = emaAlignment === 'bearish' ? 'strong' : 'moderate';
  } else if (structureBias !== 'neutral') {
    bias = structureBias;
    strength = 'moderate';
  }

  // Major S/R zones
  const supportResistance = [
    ...swingHighs.slice(-5).map(s => ({ level: s.price, type: 'resistance', time: s.time })),
    ...swingLows.slice(-5).map(s => ({ level: s.price, type: 'support', time: s.time })),
  ];

  return {
    bias, trend: structure, strength, emaAlignment,
    description: `4H ${bias} — ${structure} (${strength})`,
    supportResistance, swingHighs, swingLows, emas,
    priceVsEma200: price > ema200 ? 'above' : 'below',
  };
}

/**
 * Analyze 1H structure (Step 5).
 */
export function analyze1HStructure(candles) {
  if (!candles || candles.length < 50) {
    return { structure: 'unknown', rsiContext: null, divergence: null };
  }

  const emas = calculateAllEMAs(candles);
  const rsi = calculateRSI(candles);
  const { swingHighs, swingLows } = findSwingPoints(candles, 2, 2);
  const divergence = detectRSIDivergence(candles, rsi);

  const last = candles.length - 1;
  const lastRSI = rsi[last];

  // RSI context
  let rsiContext = 'neutral';
  if (lastRSI > 55) rsiContext = 'bullish';
  else if (lastRSI < 45) rsiContext = 'bearish';
  else rsiContext = 'low_conviction';

  // Structure classification
  let setupType = 'consolidation';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastH = swingHighs[swingHighs.length - 1];
    const prevH = swingHighs[swingHighs.length - 2];
    const lastL = swingLows[swingLows.length - 1];
    const prevL = swingLows[swingLows.length - 2];

    if (lastH.price > prevH.price && lastL.price > prevL.price) {
      setupType = 'trending_continuation_bullish';
    } else if (lastH.price < prevH.price && lastL.price < prevL.price) {
      setupType = 'trending_continuation_bearish';
    } else if (lastH.price < prevH.price && lastL.price > prevL.price) {
      setupType = 'converging'; // possible reversal
    }
  }

  return {
    setupType,
    rsiContext,
    lastRSI,
    divergence,
    swingHighs,
    swingLows,
    emas,
    rsi,
    description: `1H ${setupType} | RSI: ${lastRSI?.toFixed(1)} (${rsiContext})`,
  };
}
