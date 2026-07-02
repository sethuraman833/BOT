// ─────────────────────────────────────────────────────────
//  SMC Detector v9.0 — Breaker Blocks, VWAP, Volume-Weighted OBs
// ─────────────────────────────────────────────────────────

/**
 * Find swing highs and lows using a configurable lookback.
 */
export function findSwingPoints(candles, lookback = 5) {
  if (!candles || candles.length === 0) return []; // L6 null guard
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    // L4: Mutually exclusive swing high/low check
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
 * Detect Order Blocks (v7: breaker blocks, volume weighting).
 * When an OB is mitigated, it becomes a "breaker block" — flipped S/R.
 */
export function detectOrderBlocks(candles, currentPrice) {
  if (!candles || candles.length === 0) return []; // L6 null guard
  const obs = [];
  const recencyCutoff = Math.max(0, candles.length - 50);

  // Pre-calculate average volume for volume weighting
  const recentCandles = candles.slice(-20);
  const avgVolume = recentCandles.reduce((s, c) => s + (c.volume || 0), 0) / recentCandles.length;

  for (let i = 0; i < candles.length - 1; i++) { // start at 0 (M7)
    const ob = candles[i];
    const impulse = candles[i + 1];
    if (!ob || !impulse) continue;
    const obBody = Math.abs(ob.close - ob.open);
    const impulseBody = Math.abs(impulse.close - impulse.open);
    if (obBody === 0) continue; // skip doji

    // Volume weight multiplier (impulse volume vs average)
    const volMult = (avgVolume > 0 && impulse.volume) ? Math.max(0.5, impulse.volume / avgVolume) : 1.0;

    // Demand OB: bearish candle followed by strong bullish impulse
    if (ob.close < ob.open && impulse.close > impulse.open && impulseBody >= obBody * 2.5) {
      // H5: Historical mitigation check (loop from i+2 to now)
      let mitigated = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].low <= ob.low) {
          mitigated = true;
          break;
        }
      }
      const baseStrength = (impulseBody / obBody) * volMult;
      if (!mitigated && i >= recencyCutoff) {
        obs.push({
          type: 'demand',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: ob.high,
          slBoundary: ob.low,
          status: 'active',
          strength: baseStrength,
          candleIndex: i,
          time: ob.time,
        });
      } else if (mitigated && i >= recencyCutoff) {
        // Breaker block: mitigated demand OB becomes supply (resistance)
        obs.push({
          type: 'supply',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: ob.high,
          slBoundary: ob.low,
          status: 'breaker',
          strength: baseStrength * 0.7, // breakers are slightly weaker than fresh OBs
          candleIndex: i,
          time: ob.time,
        });
      }
    }

    // Supply OB: bullish candle followed by strong bearish impulse
    if (ob.close > ob.open && impulse.close < impulse.open && impulseBody >= obBody * 2.5) {
      // H5: Historical mitigation check (loop from i+2 to now)
      let mitigated = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].high >= ob.high) {
          mitigated = true;
          break;
        }
      }
      const baseStrength = (impulseBody / obBody) * volMult;
      if (!mitigated && i >= recencyCutoff) {
        obs.push({
          type: 'supply',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: ob.low,
          slBoundary: ob.high,
          status: 'active',
          strength: baseStrength,
          candleIndex: i,
          time: ob.time,
        });
      } else if (mitigated && i >= recencyCutoff) {
        // Breaker block: mitigated supply OB becomes demand (support)
        obs.push({
          type: 'demand',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: ob.low,
          slBoundary: ob.high,
          status: 'breaker',
          strength: baseStrength * 0.7,
          candleIndex: i,
          time: ob.time,
        });
      }
    }
  }

  // Sort by proximity to price, strongest first, limit to 8 (increased for breakers)
  return obs
    .sort((a, b) => {
      const distA = Math.abs(a.entryBoundary - (currentPrice || 0));
      const distB = Math.abs(b.entryBoundary - (currentPrice || 0));
      return distA - distB;
    })
    .slice(0, 8);
}

/**
 * Detect only Breaker Blocks — mitigated Order Blocks with flipped type.
 * Convenience wrapper around detectOrderBlocks.
 */
export function detectBreakerBlocks(candles, currentPrice) {
  const allOBs = detectOrderBlocks(candles, currentPrice);
  return allOBs.filter(ob => ob.status === 'breaker');
}

/**
 * Detect Fair Value Gaps. Only unfilled, recent (last 60 bars), with minimum size filter.
 */
export function detectFVGs(candles, currentPrice) {
  if (!candles || candles.length === 0) return []; // L6 null guard
  const fvgs = [];
  const recencyCutoff = Math.max(0, candles.length - 60);
  const minGapPct = 0.001; // 0.1% minimum gap size

  for (let i = 1; i < candles.length - 1; i++) {
    if (i < recencyCutoff) continue;
    const c1 = candles[i - 1];
    const c3 = candles[i + 1];
    if (!c1 || !c3) continue;

    // Bullish FVG: gap up
    if (c3.low > c1.high && (c3.low - c1.high) / c1.high > minGapPct) {
      const gapSize = c3.low - c1.high;
      const fillThreshold = c3.low - gapSize * 0.5; // H4: 50% partial fill
      let filled = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].low <= fillThreshold) {
          filled = true;
          break;
        }
      }
      if (!filled) {
        fvgs.push({ type: 'bullish', upper: c3.low, lower: c1.high, midpoint: (c3.low + c1.high) / 2, status: 'unfilled', candleIndex: i, time: candles[i].time });
      }
    }

    // Bearish FVG: gap down
    if (c1.low > c3.high && (c1.low - c3.high) / c3.high > minGapPct) {
      const gapSize = c1.low - c3.high;
      const fillThreshold = c3.high + gapSize * 0.5; // H4: 50% partial fill
      let filled = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].high >= fillThreshold) {
          filled = true;
          break;
        }
      }
      if (!filled) {
        fvgs.push({ type: 'bearish', upper: c1.low, lower: c3.high, midpoint: (c1.low + c3.high) / 2, status: 'unfilled', candleIndex: i, time: candles[i].time });
      }
    }
  }

  // Sort by proximity to current price
  return fvgs
    .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))
    .slice(0, 5);
}

/**
 * Check if a candle qualifies as a displacement candle (strong directional body).
 * Used as confirmation after a liquidity sweep.
 */
function isDisplacementCandle(candle, direction) {
  if (!candle) return false;
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  if (range === 0) return false;
  const bodyRatio = body / range;
  // Body must be at least 50% of candle range
  if (bodyRatio < 0.50) return false;
  // Must close in the expected direction
  if (direction === 'bullish' && candle.close <= candle.open) return false;
  if (direction === 'bearish' && candle.close >= candle.open) return false;
  return true;
}

/**
 * Detect Liquidity Sweeps — wick extends beyond a prior swing, then closes back inside.
 */
export function detectSweeps(candles, sweepThreshold = 0.0015, lookback = 3) {
  if (!candles || candles.length === 0) return []; // L6 null guard
  const sweeps = [];
  const swings = findSwingPoints(candles, lookback); // L5: standardized lookback
  const recentHighs = swings.filter(s => s.type === 'high').slice(-6);
  const recentLows  = swings.filter(s => s.type === 'low').slice(-6);

  const MIN_SWEEP_PCT = sweepThreshold;

  // Check last 10 candles for sweep events. M8: i < candles.length - 2 to prevent OOB
  const scanLimit = Math.min(10, candles.length - 3);
  for (let i = candles.length - scanLimit; i < candles.length - 2; i++) {
    const c = candles[i];
    if (!c) continue;

    // Bearish sweep: wick above a prior high, then closes below it (bull trap)
    for (const swing of recentHighs) {
      if (swing.index >= i) continue;

      const breachPct = (c.high - swing.price) / swing.price;
      if (breachPct < MIN_SWEEP_PCT) continue;

      // Sweep candle close must be back below the swept level
      if (c.close >= swing.price) continue;

      // Displacement candle within next 1-2 candles
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];
      const hasDisplacement = isDisplacementCandle(next1, 'bearish') ||
                              (next2 && isDisplacementCandle(next2, 'bearish'));

      if (!hasDisplacement) continue;

      sweeps.push({
        type: 'bearish',
        sweptLevel: swing.price,
        wickExtreme: c.high,   // actual high wick of the sweep candle — SL anchor for shorts
        breachPct: (breachPct * 100).toFixed(3) + '%',
        candleIndex: i,
        time: c.time,
        direction: 'short',
      });
      break;
    }

    // Bullish sweep: wick below a prior low, then closes above it (bear trap)
    for (const swing of recentLows) {
      if (swing.index >= i) continue;

      const breachPct = (swing.price - c.low) / swing.price;
      if (breachPct < MIN_SWEEP_PCT) continue;

      // Sweep candle close must be back above the swept level
      if (c.close <= swing.price) continue;

      // Displacement candle within next 1-2 candles
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];
      const hasDisplacement = isDisplacementCandle(next1, 'bullish') ||
                              (next2 && isDisplacementCandle(next2, 'bullish'));

      if (!hasDisplacement) continue;

      sweeps.push({
        type: 'bullish',
        sweptLevel: swing.price,
        wickExtreme: c.low,    // actual low wick of the sweep candle — SL anchor for longs
        breachPct: (breachPct * 100).toFixed(3) + '%',
        candleIndex: i,
        time: c.time,
        direction: 'long',
      });
      break;
    }
  }

  return sweeps.slice(-3);
}

/**
 * Detect BOS (Break of Structure) and CHOCH (Change of Character).
 * BOS = trend continuation. CHOCH = potential reversal.
 */
export function detectStructureShifts(candles, minAge = 1, lookback = 3) {
  if (!candles || candles.length === 0) return []; // L6 null guard
  const shifts = [];
  const swings = findSwingPoints(candles, lookback); // L5: standardized lookback
  const highs = swings.filter(s => s.type === 'high').slice(-5);
  const lows  = swings.filter(s => s.type === 'low').slice(-5);
  const last = candles[candles.length - 1];
  if (!last) return [];

  // H8: Scan last 5 candles backwards for structure breaks
  const scanCount = Math.min(5, candles.length);

  if (highs.length >= 2) {
    const prevHigh = highs[highs.length - 2];
    const lastHigh = highs[highs.length - 1];

    // BOS Bullish: price closes above previous HH
    for (let s = candles.length - scanCount; s < candles.length; s++) {
      const c = candles[s];
      if (c && c.close > prevHigh.price) {
        shifts.push({ type: 'BOS', direction: 'bullish', level: prevHigh.price, time: c.time });
        break;
      }
    }
    // CHOCH Bearish: price closes below a recent HL after uptrend
    if (lows.length >= 2) {
      const lastLow = lows[lows.length - 1];
      if (lastHigh.price > prevHigh.price) {
        for (let s = candles.length - scanCount; s < candles.length; s++) {
          const c = candles[s];
          if (c && c.close < lastLow.price) {
            shifts.push({ type: 'CHOCH', direction: 'bearish', level: lastLow.price, time: c.time });
            break;
          }
        }
      }
    }
  }

  if (lows.length >= 2) {
    const prevLow = lows[lows.length - 2];
    const lastLow = lows[lows.length - 1];

    // BOS Bearish: price closes below previous LL
    for (let s = candles.length - scanCount; s < candles.length; s++) {
      const c = candles[s];
      if (c && c.close < prevLow.price) {
        shifts.push({ type: 'BOS', direction: 'bearish', level: prevLow.price, time: c.time });
        break;
      }
    }
    // CHOCH Bullish: price closes above a recent LH after downtrend
    if (highs.length >= 2) {
      const lastHigh = highs[highs.length - 1];
      if (lastLow.price < prevLow.price) {
        for (let s = candles.length - scanCount; s < candles.length; s++) {
          const c = candles[s];
          if (c && c.close > lastHigh.price) {
            shifts.push({ type: 'CHOCH', direction: 'bullish', level: lastHigh.price, time: c.time });
            break;
          }
        }
      }
    }
  }

  // M6: Priority and contradiction resolution:
  // If we have both bullish and bearish shifts, prioritize CHOCH over BOS,
  // and keep only the latest shift if contradictory.
  if (shifts.length > 1) {
    const chochs = shifts.filter(s => s.type === 'CHOCH');
    if (chochs.length > 0) {
      const bullChoch = chochs.filter(s => s.direction === 'bullish');
      const bearChoch = chochs.filter(s => s.direction === 'bearish');
      if (bullChoch.length > 0 && bearChoch.length > 0) {
        return [chochs[chochs.length - 1]];
      }
      return chochs;
    }
    const bullBOS = shifts.filter(s => s.type === 'BOS' && s.direction === 'bullish');
    const bearBOS = shifts.filter(s => s.type === 'BOS' && s.direction === 'bearish');
    if (bullBOS.length > 0 && bearBOS.length > 0) {
      return [shifts[shifts.length - 1]];
    }
  }

  return shifts;
}

/**
 * Calculate EMA (Exponential Moving Average).
 */
export function calculateEMA(candles, period) {
  if (!candles || candles.length < period) return []; // L6 null guard
  const k = 2 / (period + 1);
  const closes = candles.map(c => c.close);
  const ema = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

/**
 * Calculate RSI.
 */
export function calculateRSI(candles, period = 14) {
  if (!candles || candles.length < period + 1) return []; // L6 null guard
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
    if (avgLoss === 0) { // M9: Return 100 instead of 99.01
      rsis.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsis.push(100 - 100 / (1 + rs));
    }
  }
  return rsis;
}

/**
 * Detect RSI divergence by comparing price swings vs RSI swings.
 */
export function detectRSIDivergence(candles, direction, period = 14) {
  if (!candles || candles.length === 0) return { rsiValue: 50, hasDivergence: false, detail: '', isOverbought: false, isOversold: false }; // L6 null guard
  const rsiValues = calculateRSI(candles, period);
  if (rsiValues.length === 0) return { rsiValue: 50, hasDivergence: false, detail: '', isOverbought: false, isOversold: false };
  const rsiValue = rsiValues[rsiValues.length - 1];
  const isOverbought = rsiValue > 70;
  const isOversold = rsiValue < 30;
  let hasDivergence = false;
  let detail = '';

  const startIndex = Math.max(0, candles.length - 50);
  const swings = findSwingPoints(candles.slice(-50), 3);

  // Helper to get RSI value for a swing point relative to the slice
  const getRsiForSwing = (swing) => {
    const originalIndex = startIndex + swing.index;
    const rsiIndex = originalIndex - period;
    if (rsiIndex < 0 || rsiIndex >= rsiValues.length) return null;
    return rsiValues[rsiIndex];
  };

  if (direction === 'short') {
    const priceHighs = swings.filter(s => s.type === 'high').slice(-3);
    if (priceHighs.length >= 2) {
      const ph1 = priceHighs[priceHighs.length - 2];
      const ph2 = priceHighs[priceHighs.length - 1];
      const ri1 = getRsiForSwing(ph1);
      const ri2 = getRsiForSwing(ph2);
      if (ri1 !== null && ri2 !== null && ph2.price > ph1.price && ri2 < ri1) {
        hasDivergence = true;
        detail = `Bearish divergence: price HH (${ph2.price.toFixed(0)}) but RSI LH (${ri2.toFixed(1)})`;
      }
    }
  } else if (direction === 'long') {
    const priceLows = swings.filter(s => s.type === 'low').slice(-3);
    if (priceLows.length >= 2) {
      const pl1 = priceLows[priceLows.length - 2];
      const pl2 = priceLows[priceLows.length - 1];
      const ri1 = getRsiForSwing(pl1);
      const ri2 = getRsiForSwing(pl2);
      if (ri1 !== null && ri2 !== null && pl2.price < pl1.price && ri2 > ri1) {
        hasDivergence = true;
        detail = `Bullish divergence: price LL (${pl2.price.toFixed(0)}) but RSI HL (${ri2.toFixed(1)})`;
      }
    }
  }

  return { rsiValue, hasDivergence, detail, isOverbought, isOversold };
}

/**
 * Calculate VWAP (Volume-Weighted Average Price).
 * VWAP = Σ(typical_price × volume) / Σ(volume)
 * Used as an institutional reference level for premium/discount.
 */
export function calculateVWAP(candles) {
  if (!candles || candles.length === 0) return null;
  let cumTypVolume = 0;
  let cumVolume = 0;
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 0;
    cumTypVolume += typicalPrice * vol;
    cumVolume += vol;
  }
  if (cumVolume === 0) return null;
  return cumTypVolume / cumVolume;
}
