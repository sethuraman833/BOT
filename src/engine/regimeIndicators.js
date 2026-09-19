import { percentileRank, linearSlope } from './utils/statistics.js';
import { typicalPrice, bodyStrength, closePositionBias, detectTimeGaps } from './utils/candleUtils.js';

/**
 * Calculates Wilder's ADX using RMA smoothing.
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - Period for ADX calculation.
 * @returns {Object} { adx, pdi, ndi, adxPercentile, trend }
 */
export function calculateADX(candles, period = 14) {
  if (!candles || candles.length < period + 1) {
    return { adx: 0, pdi: 0, ndi: 0, adxPercentile: 0, trend: null };
  }
  
  const tr = [];
  const pdm = [];
  const ndm = [];
  
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevC = candles[i - 1];
    
    const trueRange = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevC.close),
      Math.abs(c.low - prevC.close)
    );
    tr.push(trueRange);
    
    const upMove = c.high - prevC.high;
    const downMove = prevC.low - c.low;
    
    let plusDM = 0;
    let minusDM = 0;
    
    if (upMove > downMove && upMove > 0) plusDM = upMove;
    if (downMove > upMove && downMove > 0) minusDM = downMove;
    
    pdm.push(plusDM);
    ndm.push(minusDM);
  }
  
  // Calculate smoothed TR, +DM, -DM using RMA
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPDM = pdm.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothNDM = ndm.slice(0, period).reduce((a, b) => a + b, 0);
  
  const dx = [];
  for (let i = period; i < tr.length; i++) {
    smoothTR = smoothTR - (smoothTR / period) + tr[i];
    smoothPDM = smoothPDM - (smoothPDM / period) + pdm[i];
    smoothNDM = smoothNDM - (smoothNDM / period) + ndm[i];
    
    const diPlus = smoothTR === 0 ? 0 : (smoothPDM / smoothTR) * 100;
    const diMinus = smoothTR === 0 ? 0 : (smoothNDM / smoothTR) * 100;
    
    const dxValue = (diPlus + diMinus) === 0 ? 0 : (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100;
    dx.push(dxValue);
  }
  
  if (dx.length === 0) return { adx: 0, pdi: 0, ndi: 0, adxPercentile: 0, trend: null };
  
  const adxValues = [];
  let currentADX = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  adxValues.push(currentADX);
  
  for (let i = period; i < dx.length; i++) {
    currentADX = ((currentADX * (period - 1)) + dx[i]) / period;
    adxValues.push(currentADX);
  }
  
  const lastADX = adxValues[adxValues.length - 1];
  const last50 = adxValues.slice(-50);
  const adxPercentile = percentileRank(lastADX, last50);
  
  return { 
    adx: lastADX, 
    pdi: 0, // Simplified, would need storing last DI+ 
    ndi: 0, // Simplified, would need storing last DI-
    adxPercentile, 
    trend: 'CONTEXT_DEPENDENT' 
  };
}

/**
 * Calculates Choppiness Index.
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - Period for calculation.
 * @returns {Object} { chop, chopPercentile }
 */
export function calculateChoppinessIndex(candles, period = 14) {
  if (!candles || candles.length < period + 1) {
    return { chop: 0, chopPercentile: 0 };
  }
  
  const atr1 = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atr1.push(tr);
  }
  
  const chopValues = [];
  for (let i = period - 1; i < atr1.length; i++) {
    const sumATR = atr1.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const windowCandles = candles.slice(i - period + 2, i + 2); // i+1 offset due to atr1
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    
    for (let j = 0; j < windowCandles.length; j++) {
      if (windowCandles[j].high > highestHigh) highestHigh = windowCandles[j].high;
      if (windowCandles[j].low < lowestLow) lowestLow = windowCandles[j].low;
    }
    
    const range = highestHigh - lowestLow;
    if (range === 0) {
      chopValues.push(0);
    } else {
      const chop = 100 * Math.log10(sumATR / range) / Math.log10(period);
      chopValues.push(chop);
    }
  }
  
  if (chopValues.length === 0) return { chop: 0, chopPercentile: 0 };
  
  const lastChop = chopValues[chopValues.length - 1];
  const last50 = chopValues.slice(-50);
  const chopPercentile = percentileRank(lastChop, last50);
  
  return { chop: lastChop, chopPercentile };
}

/**
 * Calculates Bollinger Bandwidth.
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - Moving average period.
 * @param {number} mult - Standard deviation multiplier.
 * @returns {Object} { bandwidth, bandwidthPercentile, upper, lower, mid }
 */
export function calculateBollingerBandwidth(candles, period = 20, mult = 2) {
  if (!candles || candles.length < period) {
    return { bandwidth: 0, bandwidthPercentile: 0, upper: 0, lower: 0, mid: 0 };
  }
  
  const bandwidthValues = [];
  let upper = 0;
  let lower = 0;
  let mid = 0;
  
  for (let i = period - 1; i < candles.length; i++) {
    const windowSlice = candles.slice(i - period + 1, i + 1);
    const sum = windowSlice.reduce((a, c) => a + c.close, 0);
    const mean = sum / period;
    const variance = windowSlice.reduce((a, c) => a + Math.pow(c.close - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    const currentUpper = mean + mult * stdDev;
    const currentLower = mean - mult * stdDev;
    const currentMid = mean;
    
    const currentBandwidth = currentMid === 0 ? 0 : ((currentUpper - currentLower) / currentMid) * 100;
    bandwidthValues.push(currentBandwidth);
    
    if (i === candles.length - 1) {
      upper = currentUpper;
      lower = currentLower;
      mid = currentMid;
    }
  }
  
  const lastBandwidth = bandwidthValues[bandwidthValues.length - 1];
  const last50 = bandwidthValues.slice(-50);
  const bandwidthPercentile = percentileRank(lastBandwidth, last50);
  
  return { bandwidth: lastBandwidth, bandwidthPercentile, upper, lower, mid };
}

/**
 * Calculates ATR Data.
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - ATR period.
 * @param {number} lookback - Percentile lookback.
 * @returns {Object} { atr, atrPercentile, isLow, isHigh, isExtreme }
 */
export function calculateATRData(candles, period = 14, lookback = 50) {
  if (!candles || candles.length < period + 1) {
    return { atr: 0, atrPercentile: 0, isLow: false, isHigh: false, isExtreme: false };
  }
  
  const atrValues = [];
  const tr = [];
  
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevC = candles[i - 1];
    const trueRange = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevC.close),
      Math.abs(c.low - prevC.close)
    );
    tr.push(trueRange);
  }
  
  let currentATR = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atrValues.push(currentATR);
  
  for (let i = period; i < tr.length; i++) {
    currentATR = (currentATR * (period - 1) + tr[i]) / period;
    atrValues.push(currentATR);
  }
  
  const lastATR = atrValues[atrValues.length - 1];
  const lastN = atrValues.slice(-lookback);
  const atrPercentile = percentileRank(lastATR, lastN);
  
  return {
    atr: lastATR,
    atrPercentile,
    isLow: atrPercentile < 25,
    isHigh: atrPercentile > 75,
    isExtreme: atrPercentile > 95
  };
}

/**
 * Calculates EMA slope.
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - EMA period.
 * @param {number} lookback - Slope calculation lookback.
 * @returns {Object} { ema, slope, slopePercentile, isPositive, isStrong }
 */
export function calculateEMASlope(candles, period = 20, lookback = 5) {
  if (!candles || candles.length < period) {
    return { ema: 0, slope: 0, slopePercentile: 0, isPositive: false, isStrong: false };
  }
  
  const emaValues = [];
  const multiplier = 2 / (period + 1);
  let currentEMA = candles.slice(0, period).reduce((a, c) => a + c.close, 0) / period;
  emaValues.push(currentEMA);
  
  for (let i = period; i < candles.length; i++) {
    currentEMA = (candles[i].close - currentEMA) * multiplier + currentEMA;
    emaValues.push(currentEMA);
  }
  
  const slopes = [];
  for (let i = lookback; i < emaValues.length; i++) {
    const prev = emaValues[i - lookback];
    const slope = prev === 0 ? 0 : ((emaValues[i] - prev) / prev) * 100;
    slopes.push(slope);
  }
  
  if (slopes.length === 0) return { ema: currentEMA, slope: 0, slopePercentile: 0, isPositive: false, isStrong: false };
  
  const lastSlope = slopes[slopes.length - 1];
  const absSlopes = slopes.map(Math.abs);
  const last50 = absSlopes.slice(-50);
  const slopePercentile = percentileRank(Math.abs(lastSlope), last50);
  
  return {
    ema: currentEMA,
    slope: lastSlope,
    slopePercentile,
    isPositive: lastSlope > 0,
    isStrong: slopePercentile > 60
  };
}

/**
 * Calculates Estimated CVD (Cumulative Volume Delta).
 * @param {Object[]} candles - Array of candle objects.
 * @returns {Object} { values, current, slope, momentum, divergence, label }
 */
export function calculateEstimatedCVD(candles) {
  if (!candles || candles.length === 0) {
    return { values: [], current: 0, slope: 0, momentum: 0, divergence: { type: 'NONE', description: '' }, label: 'Estimated CVD (OHLCV proxy)' };
  }
  
  const values = [];
  let cumSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const bs = bodyStrength(c);
    const cpb = closePositionBias(c);
    const delta = (c.volume || 0) * (0.7 * bs + 0.3 * cpb);
    cumSum += delta;
    values.push(cumSum);
  }
  
  const current = values[values.length - 1];
  const slopeValues = values.slice(-10);
  const slope = linearSlope(slopeValues);
  
  const slopeHistory = [];
  for (let i = Math.max(0, values.length - 15); i < values.length - 9; i++) {
    slopeHistory.push(linearSlope(values.slice(i, i + 10)));
  }
  const momentum = linearSlope(slopeHistory.slice(-5));
  
  const priceValues = candles.slice(-10).map(c => c.close);
  const priceSlope = linearSlope(priceValues);
  
  let divergenceType = 'NONE';
  let description = '';
  if (priceSlope > 0 && slope < 0) {
    divergenceType = 'BEARISH';
    description = 'Price up, CVD down';
  } else if (priceSlope < 0 && slope > 0) {
    divergenceType = 'BULLISH';
    description = 'Price down, CVD up';
  }
  
  return {
    values,
    current,
    slope,
    momentum,
    divergence: { type: divergenceType, description },
    label: 'Estimated CVD (OHLCV proxy)'
  };
}

/**
 * Calculates Relative Volume.
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - Calculation period.
 * @returns {Object} { relVol, relVolPercentile, isHigh, isLow, avgVol, currentVol }
 */
export function calculateRelativeVolume(candles, period = 20) {
  if (!candles || candles.length < period) {
    return { relVol: 0, relVolPercentile: 0, isHigh: false, isLow: false, avgVol: 0, currentVol: 0 };
  }
  
  const relVolValues = [];
  for (let i = period - 1; i < candles.length; i++) {
    const windowSlice = candles.slice(i - period + 1, i + 1);
    const avgVolume = windowSlice.reduce((a, c) => a + (c.volume || 0), 0) / period;
    const currentVolume = candles[i].volume || 0;
    const relVol = avgVolume === 0 ? 0 : currentVolume / avgVolume;
    relVolValues.push(relVol);
  }
  
  const lastRelVol = relVolValues[relVolValues.length - 1];
  const last50 = relVolValues.slice(-50);
  const relVolPercentile = percentileRank(lastRelVol, last50);
  
  const avgVol = candles.slice(-period).reduce((a, c) => a + (c.volume || 0), 0) / period;
  const currentVol = candles[candles.length - 1].volume || 0;
  
  return {
    relVol: lastRelVol,
    relVolPercentile,
    isHigh: relVolPercentile > 75,
    isLow: relVolPercentile < 25,
    avgVol,
    currentVol
  };
}

/**
 * Calculates Session VWAP resetting on time gaps.
 * @param {Object[]} candles - Array of candle objects.
 * @returns {Object} { vwap, isAbove, isBelow }
 */
export function calculateSessionVWAP(candles) {
  if (!candles || candles.length === 0) {
    return { vwap: 0, currentPrice: 0, isAbove: false, isBelow: false };
  }
  
  const gaps = detectTimeGaps(candles);
  const resetIndex = gaps.length > 0 ? gaps[gaps.length - 1] : 0;
  
  const sessionCandles = candles.slice(resetIndex);
  let cumVP = 0;
  let cumV = 0;
  
  for (let i = 0; i < sessionCandles.length; i++) {
    const c = sessionCandles[i];
    const tp = typicalPrice(c);
    const vol = c.volume || 0;
    cumVP += tp * vol;
    cumV += vol;
  }
  
  const currentPrice = candles[candles.length - 1].close;
  const vwap = cumV === 0 ? currentPrice : cumVP / cumV;
  
  return {
    vwap,
    currentPrice,
    isAbove: currentPrice > vwap,
    isBelow: currentPrice < vwap
  };
}

/**
 * Calculates Value Area (POC, VAH, VAL).
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - Number of past candles to include.
 * @returns {Object} { poc, vah, val, isInValueArea }
 */
export function calculateValueArea(candles, period = 100) {
  if (!candles || candles.length === 0) {
    return { poc: 0, vah: 0, val: 0, isInValueArea: () => false };
  }
  
  const slice = candles.slice(-period);
  let highest = -Infinity;
  let lowest = Infinity;
  let totalVolume = 0;
  
  for (let i = 0; i < slice.length; i++) {
    if (slice[i].high > highest) highest = slice[i].high;
    if (slice[i].low < lowest) lowest = slice[i].low;
    totalVolume += (slice[i].volume || 0);
  }
  
  if (totalVolume === 0 || highest === lowest) {
    const lastPrice = candles[candles.length - 1].close;
    return { poc: lastPrice, vah: lastPrice, val: lastPrice, isInValueArea: (p) => p === lastPrice };
  }
  
  const numBuckets = 50;
  const bucketSize = (highest - lowest) / numBuckets;
  const profile = new Array(numBuckets).fill(0);
  
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const vol = c.volume || 0;
    const tp = typicalPrice(c);
    let bucketIndex = Math.floor((tp - lowest) / bucketSize);
    if (bucketIndex >= numBuckets) bucketIndex = numBuckets - 1;
    profile[bucketIndex] += vol;
  }
  
  let pocIndex = 0;
  let maxVol = -1;
  for (let i = 0; i < numBuckets; i++) {
    if (profile[i] > maxVol) {
      maxVol = profile[i];
      pocIndex = i;
    }
  }
  
  const poc = lowest + pocIndex * bucketSize + bucketSize / 2;
  
  let volSum = profile[pocIndex];
  let upIndex = pocIndex + 1;
  let downIndex = pocIndex - 1;
  const targetVol = totalVolume * 0.7;
  
  while (volSum < targetVol && (upIndex < numBuckets || downIndex >= 0)) {
    const volUp = upIndex < numBuckets ? profile[upIndex] : -1;
    const volDown = downIndex >= 0 ? profile[downIndex] : -1;
    
    if (volUp >= volDown && volUp !== -1) {
      volSum += volUp;
      upIndex++;
    } else if (volDown !== -1) {
      volSum += volDown;
      downIndex--;
    } else {
      break;
    }
  }
  
  const vah = lowest + (upIndex > 0 ? upIndex - 1 : 0) * bucketSize + bucketSize;
  const val = lowest + (downIndex < numBuckets - 1 ? downIndex + 1 : numBuckets - 1) * bucketSize;
  
  return {
    poc,
    vah,
    val,
    isInValueArea: (price) => price >= val && price <= vah
  };
}

/**
 * Calculates price location relative to VWAP and Value Area.
 * @param {number} price
 * @param {number} vwap
 * @param {number} vah
 * @param {number} val
 * @param {number} prevHigh
 * @param {number} prevLow
 * @returns {Object} { location, score }
 */
export function calculatePriceLocation(price, vwap, vah, val, prevHigh, prevLow) {
  let location = 'FAIR_VALUE';
  let score = 50;
  
  if (price > prevHigh) {
    location = 'EXTENDED_HIGH';
    score = 10;
  } else if (price < prevLow) {
    location = 'EXTENDED_LOW';
    score = 90;
  } else if (price > vah) {
    location = 'PREMIUM';
    score = 30;
  } else if (price < val) {
    location = 'DISCOUNT';
    score = 70;
  } else {
    location = 'FAIR_VALUE';
    score = 50;
  }
  
  // Refine score with VWAP
  if (price > vwap) {
    score -= 10;
  } else if (price < vwap) {
    score += 10;
  }
  
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  
  return { location, score };
}

/**
 * Calculates range width.
 * @param {Object[]} candles - Array of candle objects.
 * @param {number} period - Period for width calculation.
 * @returns {Object} { rangeWidth, rangeWidthPercentile }
 */
export function calculateRangeWidth(candles, period = 20) {
  if (!candles || candles.length < period) {
    return { rangeWidth: 0, rangeWidthPercentile: 0 };
  }
  
  const widths = [];
  for (let i = period - 1; i < candles.length; i++) {
    const windowSlice = candles.slice(i - period + 1, i + 1);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = 0; j < windowSlice.length; j++) {
      if (windowSlice[j].high > highest) highest = windowSlice[j].high;
      if (windowSlice[j].low < lowest) lowest = windowSlice[j].low;
    }
    widths.push(highest - lowest);
  }
  
  const lastWidth = widths[widths.length - 1];
  const last50 = widths.slice(-50);
  const rangeWidthPercentile = percentileRank(lastWidth, last50);
  
  return { rangeWidth: lastWidth, rangeWidthPercentile };
}
