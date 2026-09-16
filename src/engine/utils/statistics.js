/**
 * Pure math utilities for the trading engine.
 */

/**
 * Calculate percentile rank of `value` within `array` (0-100).
 * Uses linear interpolation. Returns 0 if array empty.
 * @param {number} value
 * @param {number[]} array
 * @returns {number}
 */
export function percentileRank(value, array) {
  if (!array || array.length === 0) return 0;
  let countBelow = 0;
  let countEqual = 0;
  for (let i = 0; i < array.length; i++) {
    if (array[i] < value) countBelow++;
    else if (array[i] === value) countEqual++;
  }
  return ((countBelow + 0.5 * countEqual) / array.length) * 100;
}

/**
 * Rolling percentile rank: for each element in `values`,
 * compute its percentile within the preceding `window` elements.
 * Returns array of same length (first `window` elements = null).
 * @param {number[]} values
 * @param {number} window
 * @returns {(number|null)[]}
 */
export function rollingPercentileRank(values, window = 50) {
  if (!values || values.length === 0) return [];
  const result = new Array(values.length).fill(null);
  for (let i = window; i < values.length; i++) {
    const windowSlice = values.slice(i - window, i);
    result[i] = percentileRank(values[i], windowSlice);
  }
  return result;
}

/**
 * Simple linear regression slope over an array of numbers.
 * Returns slope per index unit.
 * @param {number[]} values
 * @returns {number}
 */
export function linearSlope(values) {
  if (!values || values.length < 2) return 0;
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denominator = (n * sumX2 - sumX * sumX);
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Expectancy = (winRate × avgWin) - (lossRate × avgLoss)
 * All inputs are numbers (winRate 0-1, avgWin/avgLoss in R-multiples)
 * @param {number} winRate
 * @param {number} avgWin
 * @param {number} avgLoss
 * @returns {number}
 */
export function calculateExpectancy(winRate, avgWin, avgLoss) {
  const lossRate = 1 - winRate;
  return (winRate * avgWin) - (lossRate * avgLoss);
}

/**
 * Given array of R-multiples (positive=win, negative=loss),
 * return { winRate, avgWin, avgLoss, expectancy, profitFactor,
 *          maxDrawdown, maxConsecLosses, medianRR }
 * @param {number[]} rMultiples
 * @returns {Object}
 */
export function tradeStats(rMultiples) {
  if (!rMultiples || rMultiples.length === 0) {
    return { winRate: 0, avgWin: 0, avgLoss: 0, expectancy: 0, profitFactor: 0, maxDrawdown: 0, maxConsecLosses: 0, medianRR: 0 };
  }
  let wins = [];
  let losses = [];
  let currentConsecLosses = 0;
  let maxConsecLosses = 0;
  let peakCumulative = 0;
  let currentCumulative = 0;
  let maxDrawdown = 0;

  for (let i = 0; i < rMultiples.length; i++) {
    const r = rMultiples[i];
    currentCumulative += r;
    if (currentCumulative > peakCumulative) {
      peakCumulative = currentCumulative;
    }
    const drawdown = peakCumulative - currentCumulative;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    if (r > 0) {
      wins.push(r);
      currentConsecLosses = 0;
    } else {
      losses.push(Math.abs(r));
      currentConsecLosses++;
      if (currentConsecLosses > maxConsecLosses) {
        maxConsecLosses = currentConsecLosses;
      }
    }
  }

  const winRate = wins.length / rMultiples.length;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const expectancy = calculateExpectancy(winRate, avgWin, avgLoss);
  
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = losses.reduce((a, b) => a + b, 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  const sortedR = [...rMultiples].sort((a, b) => a - b);
  const mid = Math.floor(sortedR.length / 2);
  const medianRR = sortedR.length % 2 !== 0 ? sortedR[mid] : (sortedR[mid - 1] + sortedR[mid]) / 2;

  return { winRate, avgWin, avgLoss, expectancy, profitFactor, maxDrawdown, maxConsecLosses, medianRR };
}

/**
 * Standard deviation of an array
 * @param {number[]} values
 * @returns {number}
 */
export function stdDev(values) {
  if (!values || values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Simple moving average
 * @param {number[]} values
 * @param {number} period
 * @returns {number[]}
 */
export function sma(values, period) {
  if (!values || values.length === 0 || period <= 0) return [];
  const result = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}
