/**
 * SMC Detector - Smart Money Concepts & Institutional Grade Technical Analysis Engine
 * Provides robust detection of liquidity, structure, order blocks, and momentum.
 */

/**
 * Finds swing highs and lows using a configurable lookback period.
 * @param {Array} candles - Array of candle objects.
 * @param {number} lookback - Number of candles to look back and forward.
 * @returns {Array} Array of swing points.
 */
export function findSwingPoints(candles, lookback = 5) {
  if (!candles || candles.length === 0) return [];
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh && isLow) {
      const bodyMid = (candles[i].open + candles[i].close) / 2;
      if (candles[i].high - bodyMid > bodyMid - candles[i].low) {
        isLow = false;
      } else {
        isHigh = false;
      }
    }
    if (isHigh) swings.push({ type: 'high', price: candles[i].high, index: i, time: candles[i].time });
    if (isLow)  swings.push({ type: 'low',  price: candles[i].low,  index: i, time: candles[i].time });
  }
  return swings;
}

/**
 * Detects Order Blocks and Breaker Blocks using volume weighting and mitigation checks.
 * @param {Array} candles - Array of candle objects.
 * @param {number} currentPrice - The current market price.
 * @returns {Array} Sorted array of detected order blocks.
 */
export function detectOrderBlocks(candles, currentPrice) {
  if (!candles || candles.length === 0) return [];
  const obs = [];
  const recencyCutoff = Math.max(0, candles.length - 50);

  const recentCandles = candles.slice(-20);
  const avgVolume = recentCandles.length > 0 ? (recentCandles.reduce((s, c) => s + (c.volume || 0), 0) / recentCandles.length) : 0;

  for (let i = 0; i < candles.length - 1; i++) {
    const ob = candles[i];
    const impulse = candles[i + 1];
    if (!ob || !impulse) continue;
    
    const obBody = Math.abs(ob.close - ob.open);
    const impulseBody = Math.abs(impulse.close - impulse.open);
    if (obBody === 0) continue;

    const volMult = (avgVolume > 0 && impulse.volume) ? Math.max(0.5, impulse.volume / avgVolume) : 1.0;

    // Demand OB
    if (ob.close < ob.open && impulse.close > impulse.open && impulseBody >= obBody * 2.5) {
      let mitigated = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].low <= ob.low) { mitigated = true; break; }
      }
      const baseStrength = (impulseBody / obBody) * volMult;
      if (i >= recencyCutoff) {
        obs.push({
          type: mitigated ? 'supply' : 'demand',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: mitigated ? ob.high : ob.high,
          slBoundary: ob.low,
          status: mitigated ? 'breaker' : 'active',
          strength: baseStrength * (mitigated ? 0.7 : 1.0),
          candleIndex: i,
          time: ob.time,
        });
      }
    }

    // Supply OB
    if (ob.close > ob.open && impulse.close < impulse.open && impulseBody >= obBody * 2.5) {
      let mitigated = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].high >= ob.high) { mitigated = true; break; }
      }
      const baseStrength = (impulseBody / obBody) * volMult;
      if (i >= recencyCutoff) {
        obs.push({
          type: mitigated ? 'demand' : 'supply',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: mitigated ? ob.low : ob.low,
          slBoundary: ob.high,
          status: mitigated ? 'breaker' : 'active',
          strength: baseStrength * (mitigated ? 0.7 : 1.0),
          candleIndex: i,
          time: ob.time,
        });
      }
    }
  }

  return obs
    .sort((a, b) => Math.abs(a.entryBoundary - (currentPrice || 0)) - Math.abs(b.entryBoundary - (currentPrice || 0)))
    .slice(0, 8);
}

/**
 * Detects mitigated Order Blocks (Breaker Blocks).
 * @param {Array} candles - Array of candle objects.
 * @param {number} currentPrice - Current market price.
 * @returns {Array} Array of breaker blocks.
 */
export function detectBreakerBlocks(candles, currentPrice) {
  return detectOrderBlocks(candles, currentPrice).filter(ob => ob.status === 'breaker');
}

/**
 * Detects Fair Value Gaps (FVG) that are unfilled.
 * @param {Array} candles - Array of candle objects.
 * @param {number} currentPrice - Current market price.
 * @returns {Array} Array of FVGs.
 */
export function detectFVGs(candles, currentPrice) {
  if (!candles || candles.length === 0) return [];
  const fvgs = [];
  const recencyCutoff = Math.max(0, candles.length - 60);
  const minGapPct = 0.001;

  for (let i = Math.max(1, recencyCutoff); i < candles.length - 1; i++) {
    const c1 = candles[i - 1];
    const c3 = candles[i + 1];
    if (!c1 || !c3) continue;

    if (c3.low > c1.high && (c3.low - c1.high) / c1.high > minGapPct) {
      const gapSize = c3.low - c1.high;
      const fillThreshold = c3.low - gapSize * 0.5;
      let filled = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].low <= fillThreshold) { filled = true; break; }
      }
      if (!filled) fvgs.push({ type: 'bullish', upper: c3.low, lower: c1.high, midpoint: (c3.low + c1.high) / 2, status: 'unfilled', candleIndex: i, time: candles[i].time });
    }

    if (c1.low > c3.high && (c1.low - c3.high) / c3.high > minGapPct) {
      const gapSize = c1.low - c3.high;
      const fillThreshold = c3.high + gapSize * 0.5;
      let filled = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].high >= fillThreshold) { filled = true; break; }
      }
      if (!filled) fvgs.push({ type: 'bearish', upper: c1.low, lower: c3.high, midpoint: (c1.low + c3.high) / 2, status: 'unfilled', candleIndex: i, time: candles[i].time });
    }
  }

  return fvgs
    .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))
    .slice(0, 5);
}

/**
 * Checks if a candle qualifies as a displacement candle.
 * @param {Object} candle - Candle object.
 * @param {string} direction - Expected direction ('bullish' or 'bearish').
 * @returns {boolean} True if it is a displacement candle.
 */
function isDisplacementCandle(candle, direction) {
  if (!candle) return false;
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  if (range === 0 || body / range < 0.50) return false;
  return direction === 'bullish' ? candle.close > candle.open : candle.close < candle.open;
}

/**
 * Detects liquidity sweeps based on prior swings and displacement.
 * @param {Array} candles - Array of candle objects.
 * @param {number} sweepThreshold - Percentage breach threshold for sweeps.
 * @param {number} scanCount - Number of recent candles to scan.
 * @returns {Array} Array of detected sweeps.
 */
export function detectSweeps(candles, sweepThreshold, scanCount = 15) {
  if (!candles || candles.length === 0) return [];
  const sweeps = [];
  const swings = findSwingPoints(candles, 3);
  const recentHighs = swings.filter(s => s.type === 'high').slice(-8);
  const recentLows  = swings.filter(s => s.type === 'low').slice(-8);

  const scanLimit = Math.min(scanCount, candles.length - 3);
  for (let i = candles.length - scanLimit; i < candles.length - 2; i++) {
    const c = candles[i];
    if (!c) continue;

    for (const swing of recentHighs) {
      if (swing.index >= i) continue;
      const breachPct = (c.high - swing.price) / swing.price;
      if (breachPct < sweepThreshold || c.close >= swing.price) continue;
      
      const hasDisplacement = [1, 2, 3].some(offset => isDisplacementCandle(candles[i + offset], 'bearish'));
      sweeps.push({
        type: 'bearish', sweptLevel: swing.price, wickExtreme: c.high,
        breachPct: (breachPct * 100).toFixed(3) + '%', candleIndex: i, time: c.time,
        direction: 'short', strength: hasDisplacement ? 'strong' : 'weak',
      });
      break;
    }

    for (const swing of recentLows) {
      if (swing.index >= i) continue;
      const breachPct = (swing.price - c.low) / swing.price;
      if (breachPct < sweepThreshold || c.close <= swing.price) continue;

      const hasDisplacement = [1, 2, 3].some(offset => isDisplacementCandle(candles[i + offset], 'bullish'));
      sweeps.push({
        type: 'bullish', sweptLevel: swing.price, wickExtreme: c.low,
        breachPct: (breachPct * 100).toFixed(3) + '%', candleIndex: i, time: c.time,
        direction: 'long', strength: hasDisplacement ? 'strong' : 'weak',
      });
      break;
    }
  }

  return sweeps.slice(-3);
}

/**
 * Detects Break of Structure (BOS) and Change of Character (CHOCH).
 * @param {Array} candles - Array of candle objects.
 * @param {number} minAge - Minimum age for a structure shift.
 * @param {number} lookback - Lookback for swing point calculation.
 * @returns {Array} Array of detected structure shifts.
 */
export function detectStructureShifts(candles, minAge = 0, lookback = 3) {
  if (!candles || candles.length === 0) return [];
  const shifts = [];
  const swings = findSwingPoints(candles, lookback);
  const highs = swings.filter(s => s.type === 'high').slice(-5);
  const lows  = swings.filter(s => s.type === 'low').slice(-5);
  const scanCount = Math.min(20, candles.length);

  if (highs.length >= 2) {
    const prevHigh = highs[highs.length - 2], lastHigh = highs[highs.length - 1];
    for (let s = candles.length - scanCount; s < candles.length; s++) {
      if (candles[s] && candles[s].close > prevHigh.price && (candles.length - 1 - s >= minAge)) {
        shifts.push({ type: 'BOS', direction: 'bullish', level: prevHigh.price, time: candles[s].time, candleIndex: s });
        break;
      }
    }
    if (lows.length >= 2 && lastHigh.price > prevHigh.price) {
      const lastLow = lows[lows.length - 1];
      for (let s = candles.length - scanCount; s < candles.length; s++) {
        if (candles[s] && candles[s].close < lastLow.price && (candles.length - 1 - s >= minAge)) {
          shifts.push({ type: 'CHOCH', direction: 'bearish', level: lastLow.price, time: candles[s].time, candleIndex: s });
          break;
        }
      }
    }
  }

  if (lows.length >= 2) {
    const prevLow = lows[lows.length - 2], lastLow = lows[lows.length - 1];
    for (let s = candles.length - scanCount; s < candles.length; s++) {
      if (candles[s] && candles[s].close < prevLow.price && (candles.length - 1 - s >= minAge)) {
        shifts.push({ type: 'BOS', direction: 'bearish', level: prevLow.price, time: candles[s].time, candleIndex: s });
        break;
      }
    }
    if (highs.length >= 2 && lastLow.price < prevLow.price) {
      const lastHigh = highs[highs.length - 1];
      for (let s = candles.length - scanCount; s < candles.length; s++) {
        if (candles[s] && candles[s].close > lastHigh.price && (candles.length - 1 - s >= minAge)) {
          shifts.push({ type: 'CHOCH', direction: 'bullish', level: lastHigh.price, time: candles[s].time, candleIndex: s });
          break;
        }
      }
    }
  }

  if (shifts.length > 1) {
    const chochs = shifts.filter(s => s.type === 'CHOCH');
    if (chochs.length > 0) {
      if (chochs.some(s => s.direction === 'bullish') && chochs.some(s => s.direction === 'bearish')) {
        return [chochs[chochs.length - 1]];
      }
      return chochs;
    }
    const bullBOS = shifts.filter(s => s.type === 'BOS' && s.direction === 'bullish');
    const bearBOS = shifts.filter(s => s.type === 'BOS' && s.direction === 'bearish');
    if (bullBOS.length > 0 && bearBOS.length > 0) return [shifts[shifts.length - 1]];
  }

  return shifts;
}

/**
 * Calculates Exponential Moving Average.
 * @param {Array} candles - Array of candle objects.
 * @param {number} period - EMA period.
 * @returns {Array} Array of EMA values.
 */
export function calculateEMA(candles, period) {
  if (!candles || candles.length < period) return [];
  const k = 2 / (period + 1);
  const closes = candles.map(c => c.close);
  const ema = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

/**
 * Calculates Simple Moving Average.
 * @param {Array} data - Array of numerical values.
 * @param {number} period - SMA period.
 * @returns {Array} Array of SMA values.
 */
export function calculateSMA(data, period) {
  if (!data || data.length < period) return [];
  const sma = Array(period - 1).fill(null);
  let sum = data.slice(0, period).reduce((a, b) => a + b, 0);
  sma.push(sum / period);
  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    sma.push(sum / period);
  }
  return sma;
}

/**
 * Calculates Relative Strength Index (RSI).
 * @param {Array} candles - Array of candle objects.
 * @param {number} period - RSI period.
 * @returns {Array} Array of RSI values.
 */
export function calculateRSI(candles, period = 14) {
  if (!candles || candles.length < period + 1) return [];
  const closes = candles.map(c => c.close);
  const rsis = [];
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;

  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const diff = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    }
    rsis.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
  }
  return rsis;
}

/**
 * Detects RSI and SMA crossovers.
 * @param {Array} candles - Array of candle objects.
 * @param {number} rsiPeriod - Period for RSI.
 * @param {number} smaPeriod - Period for SMA.
 * @returns {Object} Crossover detection details.
 */
export function detectRSISmaCross(candles, rsiPeriod = 14, smaPeriod = 14) {
  const rsiValues = calculateRSI(candles, rsiPeriod);
  const smaValues = calculateSMA(rsiValues, smaPeriod);
  if (rsiValues.length < 2 || smaValues.length < 2) return { crossUp: false, crossDown: false, rsi: 50, sma: 50 };
  
  const currentRsi = rsiValues[rsiValues.length - 1], currentSma = smaValues[smaValues.length - 1];
  const prevRsi = rsiValues[rsiValues.length - 2], prevSma = smaValues[smaValues.length - 2];
  
  if (currentRsi === null || currentSma === null || prevRsi === null || prevSma === null) {
    return { crossUp: false, crossDown: false, rsi: currentRsi || 50, sma: currentSma || 50 };
  }
  return {
    crossUp: prevRsi <= prevSma && currentRsi > currentSma,
    crossDown: prevRsi >= prevSma && currentRsi < currentSma,
    rsi: currentRsi,
    sma: currentSma
  };
}

/**
 * Detects RSI divergence against price action.
 * @param {Array} candles - Array of candle objects.
 * @param {string} direction - Direction to test ('long' or 'short').
 * @param {number} period - RSI period.
 * @returns {Object} Divergence detection details.
 */
export function detectRSIDivergence(candles, direction, period = 14) {
  const defaultRes = { rsiValue: 50, hasDivergence: false, detail: '', isOverbought: false, isOversold: false };
  if (!candles || candles.length === 0) return defaultRes;
  const rsiValues = calculateRSI(candles, period);
  if (rsiValues.length === 0) return defaultRes;
  
  const rsiValue = rsiValues[rsiValues.length - 1];
  const startIndex = Math.max(0, candles.length - 50);
  const swings = findSwingPoints(candles.slice(-50), 3);
  let hasDivergence = false, detail = '';

  const getRsiForSwing = (swing) => {
    const rsiIndex = startIndex + swing.index - period;
    return (rsiIndex >= 0 && rsiIndex < rsiValues.length) ? rsiValues[rsiIndex] : null;
  };

  if (direction === 'short') {
    const priceHighs = swings.filter(s => s.type === 'high').slice(-3);
    if (priceHighs.length >= 2) {
      const ph1 = priceHighs[priceHighs.length - 2], ph2 = priceHighs[priceHighs.length - 1];
      const ri1 = getRsiForSwing(ph1), ri2 = getRsiForSwing(ph2);
      if (ri1 !== null && ri2 !== null && ph2.price > ph1.price && ri2 < ri1) {
        hasDivergence = true; detail = `Bearish divergence: price HH (${ph2.price.toFixed(0)}) but RSI LH (${ri2.toFixed(1)})`;
      }
    }
  } else if (direction === 'long') {
    const priceLows = swings.filter(s => s.type === 'low').slice(-3);
    if (priceLows.length >= 2) {
      const pl1 = priceLows[priceLows.length - 2], pl2 = priceLows[priceLows.length - 1];
      const ri1 = getRsiForSwing(pl1), ri2 = getRsiForSwing(pl2);
      if (ri1 !== null && ri2 !== null && pl2.price < pl1.price && ri2 > ri1) {
        hasDivergence = true; detail = `Bullish divergence: price LL (${pl2.price.toFixed(0)}) but RSI HL (${ri2.toFixed(1)})`;
      }
    }
  }
  
  return { rsiValue, hasDivergence, detail, isOverbought: rsiValue > 70, isOversold: rsiValue < 30 };
}

/**
 * Calculates Volume-Weighted Average Price (VWAP).
 * @param {Array} candles - Array of candle objects.
 * @returns {number|null} VWAP value.
 */
export function calculateVWAP(candles) {
  if (!candles || candles.length === 0) return null;
  let cumTypVolume = 0, cumVolume = 0;
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumTypVolume += typicalPrice * (c.volume || 0);
    cumVolume += (c.volume || 0);
  }
  return cumVolume === 0 ? null : cumTypVolume / cumVolume;
}

/**
 * Detects common candlestick patterns.
 * @param {Array} candles - Array of candle objects.
 * @returns {Array} Array of detected patterns.
 */
export function detectCandlePatterns(candles) {
  if (!candles || candles.length < 3) return [];
  const patterns = [], n = candles.length;

  for (let i = 2; i < n; i++) {
    const c0 = candles[i - 2], c1 = candles[i - 1], c2 = candles[i];
    const body2 = Math.abs(c2.close - c2.open), range2 = c2.high - c2.low;
    const body1 = Math.abs(c1.close - c1.open), range1 = c1.high - c1.low;
    const body0 = Math.abs(c0.close - c0.open);
    const isBull2 = c2.close > c2.open, isBear2 = c2.close < c2.open;
    const isBull1 = c1.close > c1.open, isBear1 = c1.close < c1.open;
    const isBear0 = c0.close < c0.open, isBull0 = c0.close > c0.open;
    const upperWick2 = c2.high - Math.max(c2.open, c2.close), lowerWick2 = Math.min(c2.open, c2.close) - c2.low;

    if (range2 > 0 && body2 / range2 < 0.1) patterns.push({ index: i, name: 'Doji', direction: 'neutral', strength: 0.5, time: c2.time });
    if (range2 > 0 && lowerWick2 >= body2 * 2 && upperWick2 <= body2 * 0.3 && body2 / range2 < 0.4) patterns.push({ index: i, name: 'Hammer', direction: 'bullish', strength: 1.0, time: c2.time });
    if (range2 > 0 && upperWick2 >= body2 * 2 && lowerWick2 <= body2 * 0.3 && body2 / range2 < 0.4) patterns.push({ index: i, name: 'Shooting Star', direction: 'bearish', strength: 1.0, time: c2.time });
    if (range2 > 0 && body2 / range2 >= 0.85) patterns.push({ index: i, name: isBull2 ? 'Bullish Marubozu' : 'Bearish Marubozu', direction: isBull2 ? 'bullish' : 'bearish', strength: 1.5, time: c2.time });

    if (isBear1 && isBull2 && c2.open <= c1.close && c2.close >= c1.open && body2 > body1) patterns.push({ index: i, name: 'Bullish Engulfing', direction: 'bullish', strength: 1.5, time: c2.time });
    if (isBull1 && isBear2 && c2.open >= c1.close && c2.close <= c1.open && body2 > body1) patterns.push({ index: i, name: 'Bearish Engulfing', direction: 'bearish', strength: 1.5, time: c2.time });
    
    if (isBear1 && isBull2 && c2.open > c1.close && c2.close < c1.open && body2 < body1 * 0.5) patterns.push({ index: i, name: 'Bullish Harami', direction: 'bullish', strength: 0.75, time: c2.time });
    if (isBull1 && isBear2 && c2.open < c1.close && c2.close > c1.open && body2 < body1 * 0.5) patterns.push({ index: i, name: 'Bearish Harami', direction: 'bearish', strength: 0.75, time: c2.time });

    const c1Mid = (c1.open + c1.close) / 2;
    if (isBear1 && isBull2 && c2.open < c1.low && c2.close > c1Mid && c2.close < c1.open) patterns.push({ index: i, name: 'Piercing Line', direction: 'bullish', strength: 1.0, time: c2.time });
    if (isBull1 && isBear2 && c2.open > c1.high && c2.close < c1Mid && c2.close > c1.close) patterns.push({ index: i, name: 'Dark Cloud Cover', direction: 'bearish', strength: 1.0, time: c2.time });

    if (Math.abs(c1.low - c2.low) / c2.low < 0.001 && isBear1 && isBull2) patterns.push({ index: i, name: 'Tweezer Bottom', direction: 'bullish', strength: 1.0, time: c2.time });
    if (Math.abs(c1.high - c2.high) / c2.high < 0.001 && isBull1 && isBear2) patterns.push({ index: i, name: 'Tweezer Top', direction: 'bearish', strength: 1.0, time: c2.time });

    const c0Mid = (c0.open + c0.close) / 2;
    if (isBear0 && body1 < body0 * 0.5 && isBull2 && c2.close > c0Mid) patterns.push({ index: i, name: 'Morning Star', direction: 'bullish', strength: 2.0, time: c2.time });
    if (isBull0 && body1 < body0 * 0.5 && isBear2 && c2.close < c0Mid) patterns.push({ index: i, name: 'Evening Star', direction: 'bearish', strength: 2.0, time: c2.time });
  }

  const last3 = candles.slice(-3);
  if (last3.length === 3) {
    if (last3.every(c => c.close > c.open) && last3[1].close > last3[0].close && last3[2].close > last3[1].close && last3.every(c => Math.abs(c.close - c.open) / (c.high - c.low) > 0.6)) {
      patterns.push({ index: n - 1, name: 'Three White Soldiers', direction: 'bullish', strength: 2.0, time: candles[n-1].time });
    }
    if (last3.every(c => c.close < c.open) && last3[1].close < last3[0].close && last3[2].close < last3[1].close && last3.every(c => Math.abs(c.close - c.open) / (c.high - c.low) > 0.6)) {
      patterns.push({ index: n - 1, name: 'Three Black Crows', direction: 'bearish', strength: 2.0, time: candles[n-1].time });
    }
  }

  return patterns.slice(-5);
}

/**
 * Calculates Fibonacci retracement and extension levels.
 * @param {number} swingHigh - Highest point of the swing.
 * @param {number} swingLow - Lowest point of the swing.
 * @param {string} direction - Direction of the trade.
 * @returns {Object|null} Fibonacci levels and golden pocket coordinates.
 */
export function calculateFibonacci(swingHigh, swingLow, direction) {
  if (!swingHigh || !swingLow || swingHigh <= swingLow) return null;
  const range = swingHigh - swingLow, levels = {};
  
  if (direction === 'long') {
    levels['0.0'] = swingHigh; levels['0.236'] = swingHigh - range * 0.236;
    levels['0.382'] = swingHigh - range * 0.382; levels['0.5'] = swingHigh - range * 0.5;
    levels['0.618'] = swingHigh - range * 0.618; levels['0.705'] = swingHigh - range * 0.705;
    levels['0.786'] = swingHigh - range * 0.786; levels['1.0'] = swingLow;
    levels['1.272'] = swingLow - range * 0.272; levels['1.618'] = swingLow - range * 0.618;
    levels['2.0'] = swingLow - range; levels['2.618'] = swingLow - range * 1.618;
  } else {
    levels['0.0'] = swingLow; levels['0.236'] = swingLow + range * 0.236;
    levels['0.382'] = swingLow + range * 0.382; levels['0.5'] = swingLow + range * 0.5;
    levels['0.618'] = swingLow + range * 0.618; levels['0.705'] = swingLow + range * 0.705;
    levels['0.786'] = swingLow + range * 0.786; levels['1.0'] = swingHigh;
    levels['1.272'] = swingHigh + range * 0.272; levels['1.618'] = swingHigh + range * 0.618;
    levels['2.0'] = swingHigh + range; levels['2.618'] = swingHigh + range * 1.618;
  }

  return {
    levels,
    goldenPocket: { high: Math.max(levels['0.618'], levels['0.705']), low: Math.min(levels['0.618'], levels['0.705']) },
    swingHigh, swingLow, direction, range,
  };
}

/**
 * Checks if a given price falls within the Golden Pocket.
 * @param {number} price - The price to check.
 * @param {Object} fibData - Fibonacci data object.
 * @returns {boolean} True if price is inside the golden pocket.
 */
export function isInGoldenPocket(price, fibData) {
  return fibData?.goldenPocket ? (price >= fibData.goldenPocket.low && price <= fibData.goldenPocket.high) : false;
}

/**
 * Calculates Bollinger Bands and Keltner Channels for squeeze detection.
 * @param {Array} candles - Array of candle objects.
 * @param {number} period - Calculation period.
 * @param {number} stdDevMult - Standard deviation multiplier.
 * @returns {Object|null} Bands and squeeze metrics.
 */
export function calculateBollingerBands(candles, period = 20, stdDevMult = 2.0) {
  if (!candles || candles.length < period) return null;
  const closes = candles.map(c => c.close), results = [];

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    results.push({ middle: mean, upper: mean + std * stdDevMult, lower: mean - std * stdDevMult, bandwidth: (std * stdDevMult * 2) / mean, std });
  }

  if (!results.length) return null;

  const ema20 = calculateEMA(candles.slice(-period * 2), period);
  const lastEma = ema20[ema20.length - 1];
  const atrPeriod = Math.min(period, candles.length - 1);
  const atr = candles.slice(-atrPeriod).reduce((s, c, i, arr) => {
    if (i === 0) return s;
    return s + Math.max(c.high - c.low, Math.abs(c.high - arr[i-1].close), Math.abs(c.low - arr[i-1].close));
  }, 0) / (atrPeriod - 1);

  const kcUpper = lastEma + atr * 1.5, kcLower = lastEma - atr * 1.5;
  const last = results[results.length - 1], prev = results[results.length - 2];
  const isSqueeze = last.upper < kcUpper && last.lower > kcLower;
  const currentPrice = candles[candles.length - 1].close;

  return {
    current: last, previous: prev,
    isSqueeze, isSqueezeRelease: (prev && prev.upper < kcUpper && prev.lower > kcLower) && !isSqueeze,
    isBullWalk: currentPrice >= last.upper, isBearWalk: currentPrice <= last.lower,
    bandwidthExpanding: prev && last.bandwidth > prev.bandwidth * 1.05,
    keltner: { upper: kcUpper, lower: kcLower, mid: lastEma },
    allBands: results,
  };
}

/**
 * Calculates MACD (Moving Average Convergence Divergence).
 * @param {Array} candles - Array of candle objects.
 * @param {number} fastPeriod - Fast EMA period.
 * @param {number} slowPeriod - Slow EMA period.
 * @param {number} signalPeriod - Signal line EMA period.
 * @returns {Object|null} MACD line, signal, and histogram indicators.
 */
export function calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!candles || candles.length < slowPeriod + signalPeriod) return null;

  const fastEMA = calculateEMA(candles, fastPeriod);
  const slowEMA = calculateEMA(candles, slowPeriod);
  const macdLine = [];
  const diff = slowPeriod - fastPeriod;

  for (let i = 0; i < slowEMA.length; i++) {
    if (fastEMA[i + diff] != null && slowEMA[i] != null) macdLine.push(fastEMA[i + diff] - slowEMA[i]);
  }

  if (macdLine.length < signalPeriod) return null;

  const signalArr = calculateEMA(macdLine.map(v => ({ close: v })), signalPeriod);
  const macdNow = macdLine[macdLine.length - 1], macdPrev = macdLine[macdLine.length - 2];
  const sigNow = signalArr[signalArr.length - 1], sigPrev = signalArr[signalArr.length - 2];
  const histNow = macdNow - sigNow, histPrev = macdPrev - (sigPrev ?? 0);

  return {
    macd: macdNow, signal: sigNow, histogram: histNow,
    bullCross: macdPrev <= sigPrev && macdNow > sigNow, bearCross: macdPrev >= sigPrev && macdNow < sigNow,
    zeroLineBull: macdPrev <= 0 && macdNow > 0, zeroLineBear: macdPrev >= 0 && macdNow < 0,
    histGrowing: histNow > histPrev, histShrinking: histNow < histPrev,
    isAboveZero: macdNow > 0, isBelowZero: macdNow < 0,
  };
}

/**
 * Calculates Stochastic RSI for precise momentum timing.
 * @param {Array} candles - Array of candle objects.
 * @param {number} rsiPeriod - RSI period.
 * @param {number} stochPeriod - Stochastic period.
 * @param {number} smoothK - K line smoothing period.
 * @param {number} smoothD - D line smoothing period.
 * @returns {Object|null} StochRSI values and signals.
 */
export function calculateStochRSI(candles, rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3) {
  if (!candles || candles.length < rsiPeriod + stochPeriod + smoothK + smoothD) return null;
  const rsiValues = calculateRSI(candles, rsiPeriod);
  if (rsiValues.length < stochPeriod) return null;

  const stochK = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const slice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const minRsi = Math.min(...slice), maxRsi = Math.max(...slice);
    stochK.push(maxRsi === minRsi ? 50 : ((rsiValues[i] - minRsi) / (maxRsi - minRsi)) * 100);
  }

  const smoothKline = stochK.slice(smoothK - 1).map((_, i) => stochK.slice(i, i + smoothK).reduce((a, b) => a + b) / smoothK);
  const smoothDline = smoothKline.slice(smoothD - 1).map((_, i) => smoothKline.slice(i, i + smoothD).reduce((a, b) => a + b) / smoothD);

  if (!smoothKline.length || !smoothDline.length) return null;

  const kNow = smoothKline[smoothKline.length - 1], dNow = smoothDline[smoothDline.length - 1];
  const kPrev = smoothKline[smoothKline.length - 2] ?? kNow, dPrev = smoothDline[smoothDline.length - 2] ?? dNow;

  return {
    k: kNow, d: dNow,
    isOversold: kNow < 20, isOverbought: kNow > 80,
    bullCrossOversold: kPrev <= dPrev && kNow > dNow && kNow < 40,
    bearCrossOverbought: kPrev >= dPrev && kNow < dNow && kNow > 60,
    bullCross: kPrev <= dPrev && kNow > dNow, bearCross: kPrev >= dPrev && kNow < dNow,
  };
}

/**
 * Calculates Volume Profile to identify Point of Control (POC) and Value Areas.
 * @param {Array} candles - Array of candle objects.
 * @param {number} numBins - Number of price bins.
 * @returns {Object|null} Volume profile metrics.
 */
export function calculateVolumeProfile(candles, numBins = 30) {
  if (!candles || candles.length < 10) return null;
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const priceHigh = Math.max(...highs), priceLow = Math.min(...lows);
  const range = priceHigh - priceLow;
  if (range === 0) return null;

  const binSize = range / numBins;
  const bins = Array.from({ length: numBins }, (_, i) => ({
    low: priceLow + i * binSize, high: priceLow + (i + 1) * binSize,
    mid: priceLow + (i + 0.5) * binSize, volume: 0,
  }));

  for (const c of candles) {
    if (!c.volume) continue;
    const candleRange = c.high - c.low;
    if (candleRange === 0) continue;
    for (const bin of bins) {
      const overlap = Math.max(0, Math.min(c.high, bin.high) - Math.max(c.low, bin.low));
      bin.volume += c.volume * (overlap / candleRange);
    }
  }

  const poc = bins.reduce((a, b) => (b.volume > a.volume ? b : a), bins[0]);
  const targetVol = bins.reduce((s, b) => s + b.volume, 0) * 0.70;
  let accumulated = poc.volume, vaLow = poc.low, vaHigh = poc.high;
  let lo = bins.indexOf(poc) - 1, hi = bins.indexOf(poc) + 1;

  while (accumulated < targetVol && (lo >= 0 || hi < bins.length)) {
    const addLow = lo >= 0 ? bins[lo].volume : 0, addHigh = hi < bins.length ? bins[hi].volume : 0;
    if (addLow >= addHigh && lo >= 0) { accumulated += addLow; vaLow = bins[lo].low; lo--; }
    else if (hi < bins.length) { accumulated += addHigh; vaHigh = bins[hi].high; hi++; }
    else break;
  }

  return {
    poc: poc.mid, valueAreaHigh: vaHigh, valueAreaLow: vaLow, priceHigh, priceLow, bins,
    isAtPOC: (price) => Math.abs(price - poc.mid) / poc.mid < 0.003,
    isInValueArea: (price) => price >= vaLow && price <= vaHigh,
  };
}

/**
 * Detects Wyckoff Accumulation/Distribution phases (Springs and Upthrusts).
 * @param {Array} candles - Array of candle objects.
 * @param {number} lookback - Lookback window size.
 * @returns {Object|null} Phase analysis details.
 */
export function detectWyckoffPhase(candles, lookback = 50) {
  if (!candles || candles.length < lookback) return null;
  const slice = candles.slice(-lookback), n = slice.length;
  const rangeHigh = Math.max(...slice.map(c => c.high)), rangeLow = Math.min(...slice.map(c => c.low));
  const rangeSize = rangeHigh - rangeLow, midPrice = (rangeHigh + rangeLow) / 2;

  const firstRange = Math.max(...slice.slice(0, Math.floor(n/2)).map(c => c.high)) - Math.min(...slice.slice(0, Math.floor(n/2)).map(c => c.low));
  const secondRange = Math.max(...slice.slice(Math.floor(n/2)).map(c => c.high)) - Math.min(...slice.slice(Math.floor(n/2)).map(c => c.low));
  const isConsolidating = secondRange < firstRange * 0.65;
  const currentPrice = slice[n - 1].close;

  const recentLow = slice.slice(-5).reduce((min, c) => Math.min(min, c.low), Infinity);
  const springDetected = recentLow < rangeLow && currentPrice > rangeLow + rangeSize * 0.05;
  const recentHigh = slice.slice(-5).reduce((max, c) => Math.max(max, c.high), -Infinity);
  const upthrustDetected = recentHigh > rangeHigh && currentPrice < rangeHigh - rangeSize * 0.05;

  const avgVol = slice.reduce((s, c) => s + (c.volume || 0), 0) / n;
  const recentVol = slice.slice(-3).reduce((s, c) => s + (c.volume || 0), 0) / 3;
  const highVolumeEvent = recentVol > avgVol * 1.3;

  let phase = 'RANGING', signal = null, description = 'Consolidating inside range \u2014 no clear Wyckoff signal yet';
  if (springDetected && isConsolidating) {
    phase = 'ACCUMULATION'; signal = 'long';
    description = highVolumeEvent ? '\uD83D\uDD25 High-Volume Spring: Institutional Accumulation \u2014 Strong Bullish Signal' : 'Spring Detected: False breakdown below range \u2014 Potential accumulation';
  } else if (upthrustDetected && isConsolidating) {
    phase = 'DISTRIBUTION'; signal = 'short';
    description = highVolumeEvent ? '\uD83D\uDD25 High-Volume Upthrust: Institutional Distribution \u2014 Strong Bearish Signal' : 'Upthrust Detected: False breakout above range \u2014 Potential distribution';
  } else if (currentPrice > rangeHigh * 1.005) { phase = 'MARKUP'; signal = 'long'; description = 'Markup Phase: Price escaping range to the upside';
  } else if (currentPrice < rangeLow * 0.995) { phase = 'MARKDOWN'; signal = 'short'; description = 'Markdown Phase: Price escaping range to the downside'; }

  return { phase, signal, description, springDetected, upthrustDetected, rangeHigh, rangeLow, midPrice, isConsolidating, highVolumeEvent, strength: (springDetected || upthrustDetected) && highVolumeEvent ? 2.0 : 1.0 };
}

/**
 * Calculates On-Balance Volume (OBV) divergence against price.
 * @param {Array} candles - Array of candle objects.
 * @param {number} lookback - Lookback window size.
 * @returns {Object|null} OBV divergence information.
 */
export function calculateOBVDivergence(candles, lookback = 30) {
  if (!candles || candles.length < lookback + 5) return null;
  const slice = candles.slice(-lookback), obv = [0];
  for (let i = 1; i < slice.length; i++) {
    const prev = obv[i - 1], vol = slice[i].volume || 0;
    obv.push(slice[i].close > slice[i-1].close ? prev + vol : (slice[i].close < slice[i-1].close ? prev - vol : prev));
  }
  
  const priceRising = slice[slice.length - 1].close > slice[0].close, priceFalling = slice[slice.length - 1].close < slice[0].close;
  const obvRising = obv[obv.length - 1] > obv[0], obvFalling = obv[obv.length - 1] < obv[0];
  const bearishDivergence = priceRising && obvFalling, bullishDivergence = priceFalling && obvRising;

  return {
    obv: obv[obv.length - 1], obvTrend: obvRising ? 'rising' : (obvFalling ? 'falling' : 'flat'),
    bullishDivergence, bearishDivergence, hasDivergence: bullishDivergence || bearishDivergence,
    divergenceType: bullishDivergence ? 'bullish' : (bearishDivergence ? 'bearish' : null),
    description: bullishDivergence ? '\uD83D\uDCC8 OBV Bullish Divergence: Smart money accumulating' : (bearishDivergence ? '\uD83D\uDCC9 OBV Bearish Divergence: Distribution detected' : 'OBV confirming price trend'),
  };
}

/**
 * Detects hidden divergence for trend continuation.
 * @param {Array} candles - Array of candle objects.
 * @param {string} direction - Target direction.
 * @param {number} period - RSI period.
 * @returns {Object} Hidden divergence detection results.
 */
export function detectHiddenDivergence(candles, direction, period = 14) {
  if (!candles || candles.length < period * 3) return { hasHiddenDiv: false };
  const rsiValues = calculateRSI(candles, period);
  if (!rsiValues || rsiValues.length < 10) return { hasHiddenDiv: false };

  const slice = candles.slice(-40), rsiSlice = rsiValues.slice(-40);
  const n = Math.min(slice.length, rsiSlice.length);
  let hasHiddenDiv = false, divType = null, description = '';

  if (direction === 'long') {
    let s1 = -1, s2 = -1;
    for (let i = n - 2; i >= 2; i--) {
      if (slice[i].low < slice[i-1].low && slice[i].low < slice[i+1].low) {
        if (s2 === -1) s2 = i; else if (s1 === -1) { s1 = i; break; }
      }
    }
    if (s1 >= 0 && s2 >= 0 && slice[s2].low > slice[s1].low && rsiSlice[s2] < rsiSlice[s1]) {
      hasHiddenDiv = true; divType = 'bullish'; description = '\uD83D\uDD2E Hidden Bullish Divergence: Price HL + RSI LL \u2192 Trend continuation UP';
    }
  } else if (direction === 'short') {
    let s1 = -1, s2 = -1;
    for (let i = n - 2; i >= 2; i--) {
      if (slice[i].high > slice[i-1].high && slice[i].high > slice[i+1].high) {
        if (s2 === -1) s2 = i; else if (s1 === -1) { s1 = i; break; }
      }
    }
    if (s1 >= 0 && s2 >= 0 && slice[s2].high < slice[s1].high && rsiSlice[s2] > rsiSlice[s1]) {
      hasHiddenDiv = true; divType = 'bearish'; description = '\uD83D\uDD2E Hidden Bearish Divergence: Price LH + RSI HH \u2192 Trend continuation DOWN';
    }
  }

  return { hasHiddenDiv, divType, description };
}

/**
 * Computes weekly open bias based on recent Monday price levels.
 * @param {Array} candles - Array of candle objects.
 * @param {number} currentPrice - Current market price.
 * @returns {Object|null} Bias assessment.
 */
export function getWeeklyOpenBias(candles, currentPrice) {
  if (!candles || candles.length < 7) return null;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 2500); i--) {
    if (new Date(candles[i].time * 1000).getUTCDay() === 1) {
      const weeklyOpen = candles[i].open;
      return {
        weeklyOpen, bias: currentPrice > weeklyOpen ? 'bullish' : 'bearish',
        distancePct: ((currentPrice - weeklyOpen) / weeklyOpen) * 100,
        description: currentPrice > weeklyOpen ? `\u2191 Price above Weekly Open ($${weeklyOpen.toFixed(2)}) \u2014 Bullish week bias` : `\u2193 Price below Weekly Open ($${weeklyOpen.toFixed(2)}) \u2014 Bearish week bias`,
      };
    }
  }
  return null;
}

/**
 * Validates the quality of displacement around a specified breakout candle.
 * @param {Array} candles - Array of candle objects.
 * @param {number} breakCandleIndex - Index of the candidate breakout candle.
 * @returns {Object} Displacement quality score and validity.
 */
export function validateDisplacement(candles, breakCandleIndex) {
  if (!candles || breakCandleIndex < 0 || breakCandleIndex >= candles.length) return { valid: false, score: 0, reason: 'Invalid arguments' };
  const c = candles[breakCandleIndex];
  const range = c.high - c.low;
  if (range === 0) return { valid: false, score: 0, reason: 'Doji' };

  const bodyRatio = Math.abs(c.close - c.open) / range;
  const isBull = c.close > c.open;
  const wickRatio = isBull ? ((Math.min(c.open, c.close) - c.low) / range) : ((c.high - Math.max(c.open, c.close)) / range);
  
  const lookbackStart = Math.max(0, breakCandleIndex - 20);
  const avgVol = candles.slice(lookbackStart, breakCandleIndex).reduce((s, x) => s + (x.volume || 0), 0) / Math.max(1, breakCandleIndex - lookbackStart);
  const volMult = avgVol > 0 ? (c.volume || 0) / avgVol : 1;

  let score = 0; const reasons = [];
  if (bodyRatio >= 0.60) { score += 35; reasons.push(`Body ${(bodyRatio*100).toFixed(0)}%`); } else if (bodyRatio >= 0.45) { score += 20; reasons.push('Moderate body'); }
  if (wickRatio <= 0.20) { score += 25; reasons.push('Closes at extreme'); } else if (wickRatio <= 0.35) score += 12;
  if (volMult >= 1.5) { score += 25; reasons.push(`Vol ${volMult.toFixed(1)}x`); } else if (volMult >= 1.0) score += 12;
  
  if (breakCandleIndex > 0) {
    const prev = candles[breakCandleIndex - 1];
    if (prev && ((isBull && c.close > prev.high) || (!isBull && c.close < prev.low))) { score += 15; reasons.push('Engulfs'); }
  }

  score = Math.min(100, score);
  return { valid: score >= 50, score, bodyRatio, volMultiplier: volMult, reason: reasons.join(' | ') || 'Weak' };
}

/**
 * Classifies liquidity pools as External (ERL) or Internal Range Liquidity (IRL).
 * @param {Array} candles - Array of candle objects.
 * @param {Array} fvgs - Array of detected FVGs.
 * @param {Array} orderBlocks - Array of detected Order Blocks.
 * @param {number} currentPrice - Current market price.
 * @returns {Object} ERL and IRL classification objects.
 */
export function classifyLiquidityLevels(candles, fvgs, orderBlocks, currentPrice) {
  if (!candles || candles.length < 10) return { erl: [], irl: [] };
  const erl = [], irl = [];
  const swings = findSwingPoints(candles, 5);
  
  swings.filter(s => s.type === 'high').slice(-10).forEach((h, i, arr) => {
    const isEq = arr.some((h2, j) => j !== i && Math.abs(h2.price - h.price) / h.price < 0.0005);
    erl.push({ level: h.price, type: 'high', subtype: isEq ? 'EQH' : 'swing_high', label: isEq ? 'Equal High (EQH)' : 'Swing High', priority: isEq ? 'HIGH' : 'MEDIUM', distPct: ((h.price - currentPrice) / currentPrice) * 100 });
  });

  swings.filter(s => s.type === 'low').slice(-10).forEach((l, i, arr) => {
    const isEq = arr.some((l2, j) => j !== i && Math.abs(l2.price - l.price) / l.price < 0.0005);
    erl.push({ level: l.price, type: 'low', subtype: isEq ? 'EQL' : 'swing_low', label: isEq ? 'Equal Low (EQL)' : 'Swing Low', priority: isEq ? 'HIGH' : 'MEDIUM', distPct: ((l.price - currentPrice) / currentPrice) * 100 });
  });

  (fvgs || []).forEach(f => irl.push({ level: f.midpoint, type: f.type === 'bullish' ? 'low' : 'high', subtype: 'fvg', label: `${f.type === 'bullish' ? 'Bull' : 'Bear'} FVG`, priority: 'MEDIUM', distPct: ((f.midpoint - currentPrice) / currentPrice) * 100 }));
  (orderBlocks || []).filter(ob => ob.status === 'active').forEach(ob => {
    const mid = (ob.upperBound + ob.lowerBound) / 2;
    irl.push({ level: mid, type: ob.type === 'demand' ? 'low' : 'high', subtype: 'ob', label: `${ob.type === 'demand' ? 'Demand' : 'Supply'} OB`, priority: ob.strength > 3 ? 'HIGH' : 'MEDIUM', distPct: ((mid - currentPrice) / currentPrice) * 100 });
  });

  return { erl, irl };
}

/**
 * Detects liquidity inducement events.
 * @param {Array} candles - Array of candle objects.
 * @param {string} direction - Analysis direction.
 * @returns {Object} Inducement details.
 */
export function detectInducement(candles, direction) {
  if (!candles || candles.length < 20) return { hasInducement: false };
  const recent = candles.slice(-Math.min(30, candles.length - 2));
  const swings = findSwingPoints(recent, 2);

  if (direction === 'long') {
    const minorHighs = swings.filter(s => s.type === 'high').slice(-4);
    for (let i = 1; i < minorHighs.length; i++) {
      const mh = minorHighs[i];
      for (let k = mh.index + 1; k < recent.length - 2; k++) {
        if (recent[k] && recent[k].high > mh.price && recent[k].close < mh.price && isDisplacementCandle(recent[k+1], 'bullish')) return { hasInducement: true, inducementLevel: mh.price, description: `Bull inducement swept $${mh.price.toFixed(2)}` };
      }
    }
  } else {
    const minorLows = swings.filter(s => s.type === 'low').slice(-4);
    for (let i = 1; i < minorLows.length; i++) {
      const ml = minorLows[i];
      for (let k = ml.index + 1; k < recent.length - 2; k++) {
        if (recent[k] && recent[k].low < ml.price && recent[k].close > ml.price && isDisplacementCandle(recent[k+1], 'bearish')) return { hasInducement: true, inducementLevel: ml.price, description: `Bear inducement swept $${ml.price.toFixed(2)}` };
      }
    }
  }
  return { hasInducement: false };
}

/**
 * Assesses the quality of a Change of Character (CHOCH) setup.
 * @param {Array} candles - Array of candle objects.
 * @param {Array} sweeps - Detected sweep events.
 * @param {string} direction - Market direction.
 * @param {number} lastShiftIdx - Candle index of the shift.
 * @returns {Object} CHOCH quality metrics.
 */
export function assessChochQuality(candles, sweeps, direction, lastShiftIdx = -1) {
  if (!candles || candles.length < 10) return { quality: 'LOW', score: 0, reasons: [] };
  let score = 0; const reasons = [];
  
  const recentSweep = (sweeps || []).some(s => {
    const age = candles.length - 1 - (s.candleIndex || 0);
    return age <= 10 && s.strength !== 'weak' && ((direction === 'long' && (s.type === 'bullish' || s.direction === 'long')) || (direction === 'short' && (s.type === 'bearish' || s.direction === 'short')));
  });

  if (recentSweep) { score += 40; reasons.push('ERL swept before CHOCH'); }
  const checkIdx = lastShiftIdx >= 0 ? lastShiftIdx : candles.length - 2;
  const disp = validateDisplacement(candles, checkIdx);
  if (disp.valid) { score += Math.round(disp.score * 0.4); reasons.push(`Disp: ${disp.reason}`); }

  const rel = findSwingPoints(candles.slice(-20), 3).filter(s => s.type === (direction === 'long' ? 'high' : 'low'));
  if (rel.length >= 2) { score += 20; reasons.push('Multi-swing'); }

  score = Math.min(100, score);
  return { quality: score >= 70 ? 'ELITE' : score >= 45 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW', score, reasons };
}

/**
 * Classifies current volatility regime using ATR.
 * @param {Array} candles - Array of candle objects.
 * @param {number} period - ATR period.
 * @returns {Object} Volatility classification data.
 */
export function classifyVolatilityRegime(candles, period = 14) {
  if (!candles || candles.length < period * 2) return { regime: 'UNKNOWN', atr: 0, atrPct: 0, trend: 'flat', sizingMultiplier: 1.0, description: 'Insufficient data' };
  
  const atrs = [];
  for (let i = 1; i < candles.length; i++) {
    atrs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i-1].close), Math.abs(candles[i].low - candles[i-1].close)));
  }

  const k = 2 / (period + 1);
  let atr = atrs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const sm = [atr];
  for (let i = period; i < atrs.length; i++) { atr = atrs[i] * k + sm[sm.length - 1] * (1 - k); sm.push(atr); }

  const cur = sm[sm.length - 1], p5 = sm[sm.length - 6] || cur, p14 = sm[Math.max(0, sm.length - 15)] || cur;
  const atrPct = (cur / candles[candles.length - 1].close) * 100;
  const c5 = (cur - p5) / p5, c14 = (cur - p14) / p14;

  let regime = 'NORMAL', trend = 'flat';
  if (c5 > 0.10 && c14 > 0.05) { regime = 'EXPANDING'; trend = 'rising'; }
  else if (c5 < -0.10 && c14 < -0.05) { regime = 'CONTRACTING'; trend = 'falling'; }
  else if (Math.abs(c14) < 0.03 && atrPct < 0.5) { regime = 'CONTRACTING'; trend = 'compressed'; }
  else if (c5 > 0.05 && c14 < 0) { regime = 'TRANSITIONING'; trend = 'inflecting'; }

  return {
    regime, atr: parseFloat(cur.toFixed(4)), atrPct: parseFloat(atrPct.toFixed(3)), trend,
    description: `${regime} | ATR ${atrPct.toFixed(2)}% | ${trend}`,
    sizingMultiplier: regime === 'EXPANDING' ? 0.75 : (regime === 'CONTRACTING' ? 1.25 : (regime === 'TRANSITIONING' ? 1.1 : 1.0)),
  };
}

/**
 * Identifies the primary liquidity draw target for a given direction.
 * @param {Array} candles - Array of candle objects.
 * @param {string} direction - Direction of the target hunt.
 * @param {number} currentPrice - Current market price.
 * @param {Array} fvgs - Detected FVGs.
 * @param {Array} orderBlocks - Detected Order Blocks.
 * @returns {Object|null} Liquidity draw targets.
 */
export function identifyDrawOnLiquidity(candles, direction, currentPrice, fvgs, orderBlocks) {
  if (!candles || candles.length < 20) return null;
  const { erl } = classifyLiquidityLevels(candles, fvgs, orderBlocks, currentPrice);
  const targets = direction === 'long'
    ? erl.filter(l => l.level > currentPrice && l.type === 'high').sort((a, b) => a.level - b.level)
    : erl.filter(l => l.level < currentPrice && l.type === 'low').sort((a, b) => b.level - a.level);

  if (!targets.length) return null;
  return {
    primary: targets[0] ? { ...targets[0], distPct: Math.abs(targets[0].distPct) } : null,
    secondary: targets[1] ? { ...targets[1], distPct: Math.abs(targets[1].distPct) } : null,
    tertiary: targets[2] ? { ...targets[2], distPct: Math.abs(targets[2].distPct) } : null,
    description: targets[0] ? `Draw \u2192 ${targets[0].label} @ $${targets[0].level.toFixed(2)}` : 'No draw',
  };
}

/**
 * Detects equal highs and equal lows based on dynamic tolerances.
 * @param {Array} candles - Array of candle objects.
 * @param {number} currentPrice - Current market price.
 * @param {number} tolerance - Allowed deviation tolerance.
 * @returns {Object} Arrays of EQH and EQL objects.
 */
export function detectEqualHighsLows(candles, currentPrice, tolerance = 0.0005) {
  if (!candles || candles.length < 10) return { eqh: [], eql: [] };
  const adjTol = currentPrice < 1 ? 0.003 : (currentPrice < 100 ? 0.0015 : tolerance);
  const eqh = [], eql = [], recent = candles.slice(-Math.min(60, candles.length));

  const procH = new Set();
  for (let i = 0; i < recent.length - 1; i++) {
    if (procH.has(i)) continue;
    const grp = [i];
    for (let j = i + 1; j < recent.length; j++) {
      if (Math.abs(recent[j].high - recent[i].high) / recent[i].high <= adjTol) { grp.push(j); procH.add(j); }
    }
    if (grp.length >= 2) {
      const lvl = grp.reduce((s, idx) => s + recent[idx].high, 0) / grp.length;
      if (lvl > currentPrice) eqh.push({ level: lvl, count: grp.length, label: `EQH (${grp.length}x)`, priority: grp.length >= 3 ? 'HIGH' : 'MEDIUM', distPct: ((lvl - currentPrice) / currentPrice) * 100 });
    }
  }

  const procL = new Set();
  for (let i = 0; i < recent.length - 1; i++) {
    if (procL.has(i)) continue;
    const grp = [i];
    for (let j = i + 1; j < recent.length; j++) {
      if (Math.abs(recent[j].low - recent[i].low) / recent[i].low <= adjTol) { grp.push(j); procL.add(j); }
    }
    if (grp.length >= 2) {
      const lvl = grp.reduce((s, idx) => s + recent[idx].low, 0) / grp.length;
      if (lvl < currentPrice) eql.push({ level: lvl, count: grp.length, label: `EQL (${grp.length}x)`, priority: grp.length >= 3 ? 'HIGH' : 'MEDIUM', distPct: ((lvl - currentPrice) / currentPrice) * 100 });
    }
  }

  return { eqh: eqh.sort((a, b) => a.distPct - b.distPct), eql: eql.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct)) };
}

/**
 * Calculates a comprehensive setup score and assigns a letter grade.
 * @param {Object} params - Metrics for signal grade computation.
 * @returns {Object} Score, grade, and label.
 */
export function calculateSignalGrade({ chochQuality, displacementScore, hasSweep, hasInducement, mtfAligned, mtfPartial, drawAligned, volatilityRegime, rrrMet, inOTE, atPOC, rsiCrossAligned }) {
  let s = 0;
  if (hasSweep) s += 15;
  if (hasInducement) s += 10;
  if (chochQuality?.quality === 'ELITE') s += 15; else if (chochQuality?.quality === 'HIGH') s += 10; else if (chochQuality?.quality === 'MEDIUM') s += 5;
  if ((displacementScore || 0) >= 70) s += 10; else if ((displacementScore || 0) >= 50) s += 5;
  
  if (mtfAligned) s += 15; else if (mtfPartial) s += 8;
  if (drawAligned) s += 10;
  if (inOTE) s += 5;
  if (rrrMet) s += 8;
  if (atPOC) s += 5;
  if (rsiCrossAligned) s += 5;
  
  if (volatilityRegime === 'TRANSITIONING') s += 7;
  else if (volatilityRegime === 'CONTRACTING') s += 5;
  else if (volatilityRegime === 'EXPANDING') s += 2;

  s = Math.min(100, s);
  return {
    grade: s >= 80 ? 'A+' : (s >= 70 ? 'A' : (s >= 55 ? 'B' : (s >= 40 ? 'C' : 'D'))),
    score: s,
    label: s >= 80 ? 'ELITE SETUP' : (s >= 70 ? 'HIGH CONVICTION' : (s >= 55 ? 'MODERATE' : (s >= 40 ? 'LOW CONVICTION' : 'AVOID')))
  };
}