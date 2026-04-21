// ─────────────────────────────────────────────────────────
//  Technical Indicators — EMA, RSI, Fibonacci, OTE
// ─────────────────────────────────────────────────────────

import { EMA, RSI } from 'technicalindicators';

/**
 * Calculate EMA values for a candle array.
 */
export function calculateEMA(candles, period) {
  const closes = candles.map(c => c.close);
  const values = EMA.calculate({ period, values: closes });
  // Pad front with nulls so array aligns with candles
  const pad = new Array(candles.length - values.length).fill(null);
  return [...pad, ...values];
}

/**
 * Calculate all three EMAs (20, 50, 200).
 */
export function calculateAllEMAs(candles) {
  return {
    ema20:  calculateEMA(candles, 20),
    ema50:  calculateEMA(candles, 50),
    ema200: calculateEMA(candles, 200),
  };
}

/**
 * Calculate RSI (default period 14).
 */
export function calculateRSI(candles, period = 14) {
  const closes = candles.map(c => c.close);
  const values = RSI.calculate({ period, values: closes });
  const pad = new Array(candles.length - values.length).fill(null);
  return [...pad, ...values];
}

/**
 * Detect RSI divergence.
 * @returns {{ type: string, description: string } | null}
 */
export function detectRSIDivergence(candles, rsiValues, lookback = 20) {
  if (candles.length < lookback || rsiValues.length < lookback) return null;

  const len = candles.length;
  const recentCandles = candles.slice(len - lookback);
  const recentRSI = rsiValues.slice(len - lookback);

  // Find two most recent swing lows in price
  const swingLows = [];
  const swingHighs = [];

  for (let i = 2; i < recentCandles.length - 2; i++) {
    const c = recentCandles[i];
    if (c.low < recentCandles[i-1].low && c.low < recentCandles[i-2].low &&
        c.low < recentCandles[i+1].low && c.low < recentCandles[i+2].low) {
      swingLows.push({ idx: i, price: c.low, rsi: recentRSI[i] });
    }
    if (c.high > recentCandles[i-1].high && c.high > recentCandles[i-2].high &&
        c.high > recentCandles[i+1].high && c.high > recentCandles[i+2].high) {
      swingHighs.push({ idx: i, price: c.high, rsi: recentRSI[i] });
    }
  }

  // Bullish divergence: price lower low, RSI higher low
  if (swingLows.length >= 2) {
    const prev = swingLows[swingLows.length - 2];
    const curr = swingLows[swingLows.length - 1];
    if (curr.price < prev.price && curr.rsi > prev.rsi) {
      return { type: 'bullish', description: 'Price lower low, RSI higher low — bullish divergence' };
    }
    // Hidden bullish: price higher low, RSI lower low
    if (curr.price > prev.price && curr.rsi < prev.rsi) {
      return { type: 'hidden_bullish', description: 'Price higher low, RSI lower low — hidden bullish divergence' };
    }
  }

  // Bearish divergence: price higher high, RSI lower high
  if (swingHighs.length >= 2) {
    const prev = swingHighs[swingHighs.length - 2];
    const curr = swingHighs[swingHighs.length - 1];
    if (curr.price > prev.price && curr.rsi < prev.rsi) {
      return { type: 'bearish', description: 'Price higher high, RSI lower high — bearish divergence' };
    }
    // Hidden bearish: price lower high, RSI higher high
    if (curr.price < prev.price && curr.rsi > prev.rsi) {
      return { type: 'hidden_bearish', description: 'Price lower high, RSI higher high — hidden bearish divergence' };
    }
  }

  return null;
}

// ── Fibonacci ────────────────────────────────────────────

/**
 * Calculate Fibonacci retracement levels.
 * @param {number} swingLow
 * @param {number} swingHigh
 * @returns {Object} key fib levels
 */
export function fibRetracement(swingLow, swingHigh) {
  const diff = swingHigh - swingLow;
  return {
    level_0:     swingHigh,
    level_236:   swingHigh - diff * 0.236,
    level_382:   swingHigh - diff * 0.382,
    level_500:   swingHigh - diff * 0.500,
    level_618:   swingHigh - diff * 0.618,
    level_786:   swingHigh - diff * 0.786,
    level_1:     swingLow,
  };
}

/**
 * Calculate Fibonacci extension levels.
 */
export function fibExtension(swingLow, swingHigh) {
  const diff = swingHigh - swingLow;
  return {
    ext_1:     swingHigh,
    ext_1272:  swingHigh + diff * 0.272,
    ext_1618:  swingHigh + diff * 0.618,
    ext_2:     swingHigh + diff,
    ext_2618:  swingHigh + diff * 1.618,
  };
}

/**
 * OTE Zone — Optimal Trade Entry (61.8% to 78.6% retracement).
 */
export function calculateOTE(swingLow, swingHigh) {
  const diff = swingHigh - swingLow;
  return {
    upper: swingHigh - diff * 0.618,   // 61.8% level
    lower: swingHigh - diff * 0.786,   // 78.6% level
    mid:   swingHigh - diff * 0.702,   // midpoint
  };
}

// ── Swing Detection ──────────────────────────────────────

/**
 * Find swing highs and lows.
 * @param {Array} candles
 * @param {number} leftBars — bars to the left to confirm swing
 * @param {number} rightBars — bars to the right to confirm swing
 */
export function findSwingPoints(candles, leftBars = 3, rightBars = 3) {
  const swingHighs = [];
  const swingLows = [];

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= leftBars; j++) {
      if (candles[i].high <= candles[i - j].high) isSwingHigh = false;
      if (candles[i].low >= candles[i - j].low) isSwingLow = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (candles[i].high <= candles[i + j].high) isSwingHigh = false;
      if (candles[i].low >= candles[i + j].low) isSwingLow = false;
    }

    if (isSwingHigh) {
      swingHighs.push({ index: i, price: candles[i].high, time: candles[i].time });
    }
    if (isSwingLow) {
      swingLows.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
  }

  return { swingHighs, swingLows };
}

/**
 * Average candle range (for volatility / duration estimation).
 */
export function averageCandleRange(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  const sum = recent.reduce((acc, c) => acc + (c.high - c.low), 0);
  return sum / recent.length;
}

/**
 * Check if price has moved more than X% in the last N candles.
 */
export function priceChangePercent(candles, lookbackCandles) {
  if (candles.length < lookbackCandles) return 0;
  const startPrice = candles[candles.length - lookbackCandles].close;
  const endPrice = candles[candles.length - 1].close;
  return Math.abs((endPrice - startPrice) / startPrice) * 100;
}
