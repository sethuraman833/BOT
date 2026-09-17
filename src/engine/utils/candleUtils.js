/**
 * Candle helper utilities.
 */

/**
 * Returns true if candle is valid OHLCV object
 * @param {Object} c
 * @returns {boolean}
 */
export function isValidCandle(c) {
  return c !== null && typeof c === 'object' && 
         typeof c.open === 'number' && !isNaN(c.open) &&
         typeof c.high === 'number' && !isNaN(c.high) &&
         typeof c.low === 'number' && !isNaN(c.low) &&
         typeof c.close === 'number' && !isNaN(c.close) &&
         typeof c.volume === 'number' && !isNaN(c.volume) &&
         c.high >= c.low;
}

/**
 * Filter array to only valid candles
 * @param {Object[]} candles
 * @returns {Object[]}
 */
export function filterValid(candles) {
  if (!Array.isArray(candles)) return [];
  return candles.filter(isValidCandle);
}

/**
 * Detect time gaps > thresholdMs between candles (for session VWAP reset)
 * Returns array of gap indices
 * @param {Object[]} candles
 * @param {number} thresholdMs
 * @returns {number[]}
 */
// NOTE: lightweight-charts candle times are Unix timestamps in SECONDS, not milliseconds.
export function detectTimeGaps(candles, thresholdSeconds = 12 * 3600) {
  if (!candles || candles.length < 2) return [];
  const gaps = [];
  for (let i = 1; i < candles.length; i++) {
    const prevTime = candles[i - 1].time;
    const currTime = candles[i].time;
    if (prevTime && currTime && (currTime - prevTime > thresholdSeconds)) {
      gaps.push(i);
    }
  }
  return gaps;
}

/**
 * Get slice of candles up to index N (strict, no look-ahead)
 * Used by backtester
 * @param {Object[]} candles
 * @param {number} n
 * @returns {Object[]}
 */
export function candlesUpTo(candles, n) {
  if (!candles || n < 0) return [];
  return candles.slice(0, n + 1);
}

/**
 * Rolling highest high and lowest low over `period` bars
 * Returns array of { high, low } for each candle
 * @param {Object[]} candles
 * @param {number} period
 * @returns {Object[]}
 */
export function rollingHighLow(candles, period) {
  if (!candles || candles.length === 0 || period <= 0) return [];
  const result = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue;
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }
    result[i] = { high: highest, low: lowest };
  }
  return result;
}

/**
 * Typical price = (high + low + close) / 3
 * @param {Object} candle
 * @returns {number}
 */
export function typicalPrice(candle) {
  if (!candle) return 0;
  return (candle.high + candle.low + candle.close) / 3;
}

/**
 * Body strength = (close - open) / (high - low), clamped -1 to 1
 * 0 if range = 0
 * @param {Object} candle
 * @returns {number}
 */
export function bodyStrength(candle) {
  if (!candle) return 0;
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  let strength = (candle.close - candle.open) / range;
  if (strength > 1) strength = 1;
  if (strength < -1) strength = -1;
  return strength;
}

/**
 * Close position bias = (close - low) / (high - low) * 2 - 1, clamped -1 to 1
 * +1 = closed at high, -1 = closed at low
 * @param {Object} candle
 * @returns {number}
 */
export function closePositionBias(candle) {
  if (!candle) return 0;
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  let bias = ((candle.close - candle.low) / range) * 2 - 1;
  if (bias > 1) bias = 1;
  if (bias < -1) bias = -1;
  return bias;
}
