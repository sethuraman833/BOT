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
        if (candles[k].close <= ob.low) {
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
        if (candles[k].close >= ob.high) {
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

      // Displacement candle within next 1-3 candles
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];
      const next3 = candles[i + 3];
      const hasDisplacement = isDisplacementCandle(next1, 'bearish') ||
                              (next2 && isDisplacementCandle(next2, 'bearish')) ||
                              (next3 && isDisplacementCandle(next3, 'bearish'));

      sweeps.push({
        type: 'bearish',
        sweptLevel: swing.price,
        wickExtreme: c.high,   // actual high wick of the sweep candle — SL anchor for shorts
        breachPct: (breachPct * 100).toFixed(3) + '%',
        candleIndex: i,
        time: c.time,
        direction: 'short',
        strength: hasDisplacement ? 'strong' : 'weak',
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

      // Displacement candle within next 1-3 candles
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];
      const next3 = candles[i + 3];
      const hasDisplacement = isDisplacementCandle(next1, 'bullish') ||
                              (next2 && isDisplacementCandle(next2, 'bullish')) ||
                              (next3 && isDisplacementCandle(next3, 'bullish'));

      sweeps.push({
        type: 'bullish',
        sweptLevel: swing.price,
        wickExtreme: c.low,    // actual low wick of the sweep candle — SL anchor for longs
        breachPct: (breachPct * 100).toFixed(3) + '%',
        candleIndex: i,
        time: c.time,
        direction: 'long',
        strength: hasDisplacement ? 'strong' : 'weak',
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

  // H8: Scan last 20 candles backwards for structure breaks
  const scanCount = Math.min(20, candles.length);

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

export function calculateSMA(data, period) {
  if (!data || data.length < period) return [];
  const sma = [];
  for (let i = 0; i < period - 1; i++) sma.push(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  sma.push(sum / period);
  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    sma.push(sum / period);
  }
  return sma;
}

export function detectRSISmaCross(candles, rsiPeriod = 14, smaPeriod = 14) {
  const rsiValues = calculateRSI(candles, rsiPeriod);
  const smaValues = calculateSMA(rsiValues, smaPeriod);
  if (rsiValues.length < 2 || smaValues.length < 2) return { crossUp: false, crossDown: false, rsi: 50, sma: 50 };
  const currentRsi = rsiValues[rsiValues.length - 1];
  const currentSma = smaValues[smaValues.length - 1];
  const prevRsi    = rsiValues[rsiValues.length - 2];
  const prevSma    = smaValues[smaValues.length - 2];
  if (currentRsi === null || currentSma === null || prevRsi === null || prevSma === null) return { crossUp: false, crossDown: false, rsi: currentRsi || 50, sma: currentSma || 50 };
  return {
    crossUp: prevRsi <= prevSma && currentRsi > currentSma,
    crossDown: prevRsi >= prevSma && currentRsi < currentSma,
    rsi: currentRsi,
    sma: currentSma
  };
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

// ═══════════════════════════════════════════════════════════════
//  MODULE 1 — CANDLESTICK PATTERN RECOGNITION
//  Detects 18 high-probability reversal & continuation patterns.
//  Call at key levels (OB/FVG/swing) for maximum confluence.
// ═══════════════════════════════════════════════════════════════
export function detectCandlePatterns(candles) {
  if (!candles || candles.length < 3) return [];
  const patterns = [];
  const n = candles.length;

  for (let i = 2; i < n; i++) {
    const c0 = candles[i - 2]; // 3 candles ago
    const c1 = candles[i - 1]; // previous candle
    const c2 = candles[i];     // current / signal candle

    const body2    = Math.abs(c2.close - c2.open);
    const range2   = c2.high - c2.low;
    const body1    = Math.abs(c1.close - c1.open);
    const range1   = c1.high - c1.low;
    const body0    = Math.abs(c0.close - c0.open);
    const isBull2  = c2.close > c2.open;
    const isBear2  = c2.close < c2.open;
    const isBull1  = c1.close > c1.open;
    const isBear1  = c1.close < c1.open;
    const upperWick2 = c2.high - Math.max(c2.open, c2.close);
    const lowerWick2 = Math.min(c2.open, c2.close) - c2.low;
    const upperWick1 = c1.high - Math.max(c1.open, c1.close);
    const lowerWick1 = Math.min(c1.open, c1.close) - c1.low;

    // DOJI — body ≤ 10% of range, indecision
    if (range2 > 0 && body2 / range2 < 0.1) {
      patterns.push({ index: i, name: 'Doji', direction: 'neutral', strength: 0.5, time: c2.time });
    }

    // HAMMER — bullish reversal: small body at top, long lower wick ≥ 2× body, tiny upper wick
    if (range2 > 0 && lowerWick2 >= body2 * 2 && upperWick2 <= body2 * 0.3 && body2 / range2 < 0.4) {
      patterns.push({ index: i, name: 'Hammer', direction: 'bullish', strength: 1.0, time: c2.time });
    }

    // SHOOTING STAR — bearish reversal: small body at bottom, long upper wick ≥ 2× body
    if (range2 > 0 && upperWick2 >= body2 * 2 && lowerWick2 <= body2 * 0.3 && body2 / range2 < 0.4) {
      patterns.push({ index: i, name: 'Shooting Star', direction: 'bearish', strength: 1.0, time: c2.time });
    }

    // MARUBOZU — full momentum candle, no wicks (body ≥ 85% of range)
    if (range2 > 0 && body2 / range2 >= 0.85) {
      patterns.push({ index: i, name: isBull2 ? 'Bullish Marubozu' : 'Bearish Marubozu',
        direction: isBull2 ? 'bullish' : 'bearish', strength: 1.5, time: c2.time });
    }

    // BULLISH ENGULFING — bearish c1 engulfed by larger bullish c2
    if (isBear1 && isBull2 && c2.open <= c1.close && c2.close >= c1.open && body2 > body1) {
      patterns.push({ index: i, name: 'Bullish Engulfing', direction: 'bullish', strength: 1.5, time: c2.time });
    }

    // BEARISH ENGULFING — bullish c1 engulfed by larger bearish c2
    if (isBull1 && isBear2 && c2.open >= c1.close && c2.close <= c1.open && body2 > body1) {
      patterns.push({ index: i, name: 'Bearish Engulfing', direction: 'bearish', strength: 1.5, time: c2.time });
    }

    // BULLISH HARAMI — large bearish c1 contains small bullish c2 (indecision after sell-off)
    if (isBear1 && isBull2 && c2.open > c1.close && c2.close < c1.open && body2 < body1 * 0.5) {
      patterns.push({ index: i, name: 'Bullish Harami', direction: 'bullish', strength: 0.75, time: c2.time });
    }

    // BEARISH HARAMI — large bullish c1 contains small bearish c2
    if (isBull1 && isBear2 && c2.open < c1.close && c2.close > c1.open && body2 < body1 * 0.5) {
      patterns.push({ index: i, name: 'Bearish Harami', direction: 'bearish', strength: 0.75, time: c2.time });
    }

    // PIERCING LINE — bearish c1, bullish c2 opens below c1.low, closes above c1 midpoint
    const c1Mid = (c1.open + c1.close) / 2;
    if (isBear1 && isBull2 && c2.open < c1.low && c2.close > c1Mid && c2.close < c1.open) {
      patterns.push({ index: i, name: 'Piercing Line', direction: 'bullish', strength: 1.0, time: c2.time });
    }

    // DARK CLOUD COVER — bullish c1, bearish c2 opens above c1.high, closes below c1 midpoint
    if (isBull1 && isBear2 && c2.open > c1.high && c2.close < c1Mid && c2.close > c1.close) {
      patterns.push({ index: i, name: 'Dark Cloud Cover', direction: 'bearish', strength: 1.0, time: c2.time });
    }

    // TWEEZER BOTTOM — two candles with same/near-same low (within 0.1%) → bullish reversal
    if (Math.abs(c1.low - c2.low) / c2.low < 0.001 && isBear1 && isBull2) {
      patterns.push({ index: i, name: 'Tweezer Bottom', direction: 'bullish', strength: 1.0, time: c2.time });
    }

    // TWEEZER TOP — two candles with same/near-same high → bearish reversal
    if (Math.abs(c1.high - c2.high) / c2.high < 0.001 && isBull1 && isBear2) {
      patterns.push({ index: i, name: 'Tweezer Top', direction: 'bearish', strength: 1.0, time: c2.time });
    }

    // MORNING STAR — 3-candle bullish reversal: bearish c0, small/doji c1, bullish c2 above c0 midpoint
    const c0Mid = (c0.open + c0.close) / 2;
    if (isBear1 === false && i >= 2) {
      const isBear0 = c0.close < c0.open;
      const isBull3 = c2.close > c2.open;
      const smallBody1 = body1 < body0 * 0.5;
      if (isBear0 && smallBody1 && isBull3 && c2.close > c0Mid) {
        patterns.push({ index: i, name: 'Morning Star', direction: 'bullish', strength: 2.0, time: c2.time });
      }
    }

    // EVENING STAR — 3-candle bearish reversal: bullish c0, small c1, bearish c2 below c0 midpoint
    if (i >= 2) {
      const isBull0 = c0.close > c0.open;
      const isBear3 = c2.close < c2.open;
      const smallBody1 = body1 < body0 * 0.5;
      if (isBull0 && smallBody1 && isBear3 && c2.close < c0Mid) {
        patterns.push({ index: i, name: 'Evening Star', direction: 'bearish', strength: 2.0, time: c2.time });
      }
    }
  }

  // THREE WHITE SOLDIERS — 3 consecutive strong bullish candles
  if (n >= 3) {
    const last3 = candles.slice(-3);
    const allBull = last3.every(c => c.close > c.open);
    const consecutive = last3[1].close > last3[0].close && last3[2].close > last3[1].close;
    const strongBodies = last3.every(c => Math.abs(c.close - c.open) / (c.high - c.low) > 0.6);
    if (allBull && consecutive && strongBodies) {
      patterns.push({ index: n - 1, name: 'Three White Soldiers', direction: 'bullish', strength: 2.0, time: candles[n-1].time });
    }
  }

  // THREE BLACK CROWS — 3 consecutive strong bearish candles
  if (n >= 3) {
    const last3 = candles.slice(-3);
    const allBear = last3.every(c => c.close < c.open);
    const consecutive = last3[1].close < last3[0].close && last3[2].close < last3[1].close;
    const strongBodies = last3.every(c => Math.abs(c.close - c.open) / (c.high - c.low) > 0.6);
    if (allBear && consecutive && strongBodies) {
      patterns.push({ index: n - 1, name: 'Three Black Crows', direction: 'bearish', strength: 2.0, time: candles[n-1].time });
    }
  }

  // Return only the last 5 recent patterns (most relevant)
  return patterns.slice(-5);
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 2 — FIBONACCI RETRACEMENT & GOLDEN POCKET
//  Computes key fib levels from the most recent significant swing.
//  Golden Pocket (0.618–0.705) is the highest-probability reversal zone.
// ═══════════════════════════════════════════════════════════════
export function calculateFibonacci(swingHigh, swingLow, direction) {
  if (!swingHigh || !swingLow || swingHigh <= swingLow) return null;
  const range = swingHigh - swingLow;
  const levels = {};
  
  if (direction === 'long') {
    // For longs: retrace DOWN from high to low, then bounce
    levels['0.0']   = swingHigh;
    levels['0.236'] = swingHigh - range * 0.236;
    levels['0.382'] = swingHigh - range * 0.382;
    levels['0.5']   = swingHigh - range * 0.5;
    levels['0.618'] = swingHigh - range * 0.618; // Golden ratio
    levels['0.705'] = swingHigh - range * 0.705; // OTE zone top
    levels['0.786'] = swingHigh - range * 0.786;
    levels['1.0']   = swingLow;
    // Extensions (TP targets)
    levels['1.272'] = swingLow - range * 0.272;
    levels['1.618'] = swingLow - range * 0.618;
    levels['2.0']   = swingLow - range;
    levels['2.618'] = swingLow - range * 1.618;
  } else {
    // For shorts: retrace UP from low to high, then fall
    levels['0.0']   = swingLow;
    levels['0.236'] = swingLow + range * 0.236;
    levels['0.382'] = swingLow + range * 0.382;
    levels['0.5']   = swingLow + range * 0.5;
    levels['0.618'] = swingLow + range * 0.618;
    levels['0.705'] = swingLow + range * 0.705;
    levels['0.786'] = swingLow + range * 0.786;
    levels['1.0']   = swingHigh;
    levels['1.272'] = swingHigh + range * 0.272;
    levels['1.618'] = swingHigh + range * 0.618;
    levels['2.0']   = swingHigh + range;
    levels['2.618'] = swingHigh + range * 1.618;
  }

  // Golden Pocket = 0.618 to 0.705
  const gpHigh = Math.max(levels['0.618'], levels['0.705']);
  const gpLow  = Math.min(levels['0.618'], levels['0.705']);

  return {
    levels,
    goldenPocket: { high: gpHigh, low: gpLow },
    swingHigh, swingLow, direction,
    range,
  };
}

export function isInGoldenPocket(price, fibData) {
  if (!fibData || !fibData.goldenPocket) return false;
  return price >= fibData.goldenPocket.low && price <= fibData.goldenPocket.high;
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 3 — BOLLINGER BANDS + KELTNER SQUEEZE DETECTION
//  Squeeze = explosive move imminent; Band walk = strong trend
// ═══════════════════════════════════════════════════════════════
export function calculateBollingerBands(candles, period = 20, stdDevMult = 2.0) {
  if (!candles || candles.length < period) return null;
  const closes = candles.map(c => c.close);
  const results = [];

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    results.push({
      middle: mean,
      upper: mean + std * stdDevMult,
      lower: mean - std * stdDevMult,
      bandwidth: (std * stdDevMult * 2) / mean, // normalized bandwidth
      std,
    });
  }

  if (results.length === 0) return null;

  // Keltner Channel for squeeze detection
  const lastIdx = candles.length - 1;
  const ema20 = calculateEMA(candles.slice(-period * 2), period);
  const lastEma = ema20[ema20.length - 1];
  let atrSum = 0;
  const atrPeriod = Math.min(period, candles.length - 1);
  for (let i = lastIdx - atrPeriod + 1; i <= lastIdx; i++) {
    if (i <= 0) continue;
    atrSum += Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low  - candles[i-1].close)
    );
  }
  const atr = atrSum / atrPeriod;
  const kcUpper = lastEma + atr * 1.5;
  const kcLower = lastEma - atr * 1.5;

  const last = results[results.length - 1];
  const prev = results[results.length - 2];

  // Squeeze: BB inside Keltner Channel = compressed volatility, explosive move coming
  const isSqueeze = last.upper < kcUpper && last.lower > kcLower;
  // Squeeze release: was squeezing, now expanding
  const wasSqueezing = prev && prev.upper < kcUpper && prev.lower > kcLower;
  const isSqueezeRelease = wasSqueezing && !isSqueeze;
  
  const currentPrice = candles[lastIdx].close;
  // BB walk = price touching/outside the band on successive candles
  const isBullWalk = currentPrice >= last.upper;
  const isBearWalk = currentPrice <= last.lower;
  // Bandwidth expanding vs contracting
  const bandwidthExpanding = prev && last.bandwidth > prev.bandwidth * 1.05;

  return {
    current: last,
    previous: prev,
    isSqueeze,
    isSqueezeRelease,
    isBullWalk,
    isBearWalk,
    bandwidthExpanding,
    keltner: { upper: kcUpper, lower: kcLower, mid: lastEma },
    allBands: results,
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 4 — MACD (Moving Average Convergence Divergence)
//  Standard (12, 26, 9). Most powerful momentum indicator.
// ═══════════════════════════════════════════════════════════════
export function calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!candles || candles.length < slowPeriod + signalPeriod) return null;

  const fastEMA  = calculateEMA(candles, fastPeriod);
  const slowEMA  = calculateEMA(candles, slowPeriod);

  // MACD line = fast EMA - slow EMA (aligned to slow length)
  const diff = slowPeriod - fastPeriod;
  const macdLine = [];
  for (let i = 0; i < slowEMA.length; i++) {
    const fastVal = fastEMA[i + diff];
    if (fastVal == null || slowEMA[i] == null) continue;
    macdLine.push(fastVal - slowEMA[i]);
  }

  if (macdLine.length < signalPeriod) return null;

  // Signal line = EMA of MACD line
  const macdCandles = macdLine.map((v, i) => ({ close: v, time: i, open: v, high: v, low: v, volume: 1 }));
  const signalArr = calculateEMA(macdCandles, signalPeriod);

  const last     = macdLine.length - 1;
  const macdNow  = macdLine[last];
  const macdPrev = macdLine[last - 1];
  const sigNow   = signalArr[signalArr.length - 1];
  const sigPrev  = signalArr[signalArr.length - 2];
  const histNow  = macdNow  - sigNow;
  const histPrev = macdPrev - (sigPrev ?? 0);

  // Crossovers
  const bullCross = macdPrev <= sigPrev && macdNow > sigNow;  // MACD crossed above signal
  const bearCross = macdPrev >= sigPrev && macdNow < sigNow;  // MACD crossed below signal
  // Zero-line crossovers (stronger signal)
  const zeroLineBull = macdPrev <= 0 && macdNow > 0;
  const zeroLineBear = macdPrev >= 0 && macdNow < 0;
  // Histogram momentum
  const histGrowing   = histNow > histPrev;   // momentum accelerating
  const histShrinking = histNow < histPrev;   // momentum waning (early warning)

  return {
    macd: macdNow,
    signal: sigNow,
    histogram: histNow,
    bullCross,
    bearCross,
    zeroLineBull,
    zeroLineBear,
    histGrowing,
    histShrinking,
    isAboveZero: macdNow > 0,
    isBelowZero: macdNow < 0,
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 5 — STOCHASTIC RSI (14, 3, 3)
//  More sensitive than RSI alone. Great for timing precise entries.
// ═══════════════════════════════════════════════════════════════
export function calculateStochRSI(candles, rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3) {
  if (!candles || candles.length < rsiPeriod + stochPeriod + smoothK + smoothD) return null;

  // Step 1: RSI values series
  const closes = candles.map(c => c.close);
  const rsiValues = [];
  for (let i = rsiPeriod; i < closes.length; i++) {
    const slice = closes.slice(i - rsiPeriod, i + 1);
    let gains = 0, losses = 0;
    for (let j = 1; j < slice.length; j++) {
      const diff = slice[j] - slice[j-1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    if (avgLoss === 0) { rsiValues.push(100); continue; }
    const rs = avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));
  }

  if (rsiValues.length < stochPeriod) return null;

  // Step 2: Stochastic of RSI
  const stochK = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const slice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const minRsi = Math.min(...slice);
    const maxRsi = Math.max(...slice);
    if (maxRsi === minRsi) { stochK.push(50); continue; }
    stochK.push(((rsiValues[i] - minRsi) / (maxRsi - minRsi)) * 100);
  }

  // Step 3: Smooth K and D
  const smoothKline = [];
  for (let i = smoothK - 1; i < stochK.length; i++) {
    smoothKline.push(stochK.slice(i - smoothK + 1, i + 1).reduce((a, b) => a + b, 0) / smoothK);
  }
  const smoothDline = [];
  for (let i = smoothD - 1; i < smoothKline.length; i++) {
    smoothDline.push(smoothKline.slice(i - smoothD + 1, i + 1).reduce((a, b) => a + b, 0) / smoothD);
  }

  if (smoothKline.length === 0 || smoothDline.length === 0) return null;

  const kNow  = smoothKline[smoothKline.length - 1];
  const dNow  = smoothDline[smoothDline.length - 1];
  const kPrev = smoothKline[smoothKline.length - 2] ?? kNow;
  const dPrev = smoothDline[smoothDline.length - 2] ?? dNow;

  return {
    k: kNow, d: dNow,
    isOversold:  kNow < 20,
    isOverbought: kNow > 80,
    // Bullish: K crosses above D from oversold
    bullCrossOversold:  kPrev <= dPrev && kNow > dNow && kNow < 40,
    // Bearish: K crosses below D from overbought
    bearCrossOverbought: kPrev >= dPrev && kNow < dNow && kNow > 60,
    bullCross: kPrev <= dPrev && kNow > dNow,
    bearCross: kPrev >= dPrev && kNow < dNow,
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 6 — VOLUME PROFILE / POINT OF CONTROL (POC)
//  Identifies price level with the highest traded volume (POC)
//  and Value Area High/Low (VAH/VAL = 70% of volume).
// ═══════════════════════════════════════════════════════════════
export function calculateVolumeProfile(candles, numBins = 30) {
  if (!candles || candles.length < 10) return null;

  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const priceHigh = Math.max(...highs);
  const priceLow  = Math.min(...lows);
  const range = priceHigh - priceLow;
  if (range === 0) return null;

  const binSize = range / numBins;
  const bins = Array.from({ length: numBins }, (_, i) => ({
    low:    priceLow + i * binSize,
    high:   priceLow + (i + 1) * binSize,
    mid:    priceLow + (i + 0.5) * binSize,
    volume: 0,
  }));

  // Distribute volume across price bins proportionally by overlap
  for (const c of candles) {
    const vol = c.volume || 0;
    if (vol === 0) continue;
    const candleRange = c.high - c.low;
    if (candleRange === 0) continue;
    for (const bin of bins) {
      const overlap = Math.max(0, Math.min(c.high, bin.high) - Math.max(c.low, bin.low));
      bin.volume += vol * (overlap / candleRange);
    }
  }

  // POC = highest volume bin
  const poc = bins.reduce((a, b) => (b.volume > a.volume ? b : a), bins[0]);

  // Value Area: 70% of total volume centered around POC
  const totalVol = bins.reduce((s, b) => s + b.volume, 0);
  const targetVol = totalVol * 0.70;
  let accumulated = poc.volume;
  let vaLow = poc.low, vaHigh = poc.high;
  let lo = bins.indexOf(poc) - 1, hi = bins.indexOf(poc) + 1;
  while (accumulated < targetVol && (lo >= 0 || hi < bins.length)) {
    const addLow  = lo >= 0 ? bins[lo].volume : 0;
    const addHigh = hi < bins.length ? bins[hi].volume : 0;
    if (addLow >= addHigh && lo >= 0) {
      accumulated += addLow;
      vaLow = bins[lo].low;
      lo--;
    } else if (hi < bins.length) {
      accumulated += addHigh;
      vaHigh = bins[hi].high;
      hi++;
    } else { break; }
  }

  return {
    poc: poc.mid,
    valueAreaHigh: vaHigh,
    valueAreaLow:  vaLow,
    priceHigh, priceLow,
    bins,
    // Price at POC = institutions actively traded here = strong support/resistance
    isAtPOC: (price) => Math.abs(price - poc.mid) / poc.mid < 0.003, // within 0.3%
    isInValueArea: (price) => price >= vaLow && price <= vaHigh,
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 7 — WYCKOFF MARKET PHASE DETECTION
//  Detects Accumulation (Spring) and Distribution (Upthrust)
//  phases — the highest-quality institutional reversal signals.
// ═══════════════════════════════════════════════════════════════
export function detectWyckoffPhase(candles, lookback = 50) {
  if (!candles || candles.length < lookback) return null;
  const slice = candles.slice(-lookback);
  const n = slice.length;

  // Step 1: Find trading range (compression zone)
  const rangeHigh = Math.max(...slice.map(c => c.high));
  const rangeLow  = Math.min(...slice.map(c => c.low));
  const rangeSize = rangeHigh - rangeLow;
  const midPrice  = (rangeHigh + rangeLow) / 2;

  // Step 2: Measure how "compressed" we are (BB bandwidth proxy)
  const firstHalf  = slice.slice(0, Math.floor(n / 2));
  const secondHalf = slice.slice(Math.floor(n / 2));
  const firstRange  = Math.max(...firstHalf.map(c => c.high)) - Math.min(...firstHalf.map(c => c.low));
  const secondRange = Math.max(...secondHalf.map(c => c.high)) - Math.min(...secondHalf.map(c => c.low));
  const isConsolidating = secondRange < firstRange * 0.65; // Range contracting

  const last = slice[n - 1];
  const currentPrice = last.close;

  // Step 3: Detect Spring (false breakdown → bullish reversal)
  // Price dips below the range low but closes back above it
  const recentLow  = slice.slice(-5).reduce((min, c) => Math.min(min, c.low), Infinity);
  const springDetected = recentLow < rangeLow && currentPrice > rangeLow + rangeSize * 0.05;

  // Step 4: Detect Upthrust (false breakout → bearish reversal)
  const recentHigh = slice.slice(-5).reduce((max, c) => Math.max(max, c.high), -Infinity);
  const upthrustDetected = recentHigh > rangeHigh && currentPrice < rangeHigh - rangeSize * 0.05;

  // Step 5: Assess volume on the spring/upthrust (high volume spring = institutional buying)
  const avgVol = slice.reduce((s, c) => s + (c.volume || 0), 0) / n;
  const recentVol = slice.slice(-3).reduce((s, c) => s + (c.volume || 0), 0) / 3;
  const highVolumeEvent = recentVol > avgVol * 1.3;

  // Phase determination
  let phase = 'RANGING';
  let signal = null;
  let description = '';

  if (springDetected && isConsolidating) {
    phase  = 'ACCUMULATION';
    signal = 'long';
    description = highVolumeEvent
      ? '🔥 High-Volume Spring: Institutional Accumulation — Strong Bullish Signal'
      : 'Spring Detected: False breakdown below range — Potential accumulation';
  } else if (upthrustDetected && isConsolidating) {
    phase  = 'DISTRIBUTION';
    signal = 'short';
    description = highVolumeEvent
      ? '🔥 High-Volume Upthrust: Institutional Distribution — Strong Bearish Signal'
      : 'Upthrust Detected: False breakout above range — Potential distribution';
  } else if (currentPrice > rangeHigh * 1.005) {
    phase = 'MARKUP';
    signal = 'long';
    description = 'Markup Phase: Price escaping range to the upside';
  } else if (currentPrice < rangeLow * 0.995) {
    phase = 'MARKDOWN';
    signal = 'short';
    description = 'Markdown Phase: Price escaping range to the downside';
  } else {
    description = 'Consolidating inside range — no clear Wyckoff signal yet';
  }

  return {
    phase, signal, description,
    springDetected, upthrustDetected,
    rangeHigh, rangeLow, midPrice,
    isConsolidating, highVolumeEvent,
    strength: (springDetected || upthrustDetected) && highVolumeEvent ? 2.0 : 1.0,
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 8 — OBV DIVERGENCE (On-Balance Volume)
//  OBV rising while price falls = smart money accumulating.
//  OBV falling while price rises = distribution, reversal near.
// ═══════════════════════════════════════════════════════════════
export function calculateOBVDivergence(candles, lookback = 30) {
  if (!candles || candles.length < lookback + 5) return null;
  const slice = candles.slice(-lookback);

  // Calculate OBV
  const obv = [0];
  for (let i = 1; i < slice.length; i++) {
    const prev = obv[i - 1];
    const vol  = slice[i].volume || 0;
    if      (slice[i].close > slice[i-1].close) obv.push(prev + vol);
    else if (slice[i].close < slice[i-1].close) obv.push(prev - vol);
    else                                          obv.push(prev);
  }

  const firstPrice = slice[0].close;
  const lastPrice  = slice[slice.length - 1].close;
  const firstOBV   = obv[0];
  const lastOBV    = obv[obv.length - 1];

  const priceRising = lastPrice > firstPrice;
  const priceFalling = lastPrice < firstPrice;
  const obvRising  = lastOBV > firstOBV;
  const obvFalling = lastOBV < firstOBV;

  // Bearish divergence: price makes new high but OBV doesn't confirm (distribution)
  const bearishDiv = priceRising && obvFalling;
  // Bullish divergence: price makes new low but OBV doesn't confirm (accumulation)
  const bullishDiv = priceFalling && obvRising;

  const obvTrend = obvRising ? 'rising' : obvFalling ? 'falling' : 'flat';

  return {
    obv: lastOBV,
    obvTrend,
    bullishDivergence: bullishDiv,
    bearishDivergence: bearishDiv,
    hasDivergence: bullishDiv || bearishDiv,
    divergenceType: bullishDiv ? 'bullish' : bearishDiv ? 'bearish' : null,
    description: bullishDiv
      ? '📈 OBV Bullish Divergence: Smart money accumulating while price falls'
      : bearishDiv
      ? '📉 OBV Bearish Divergence: Distribution detected while price rises'
      : 'OBV confirming price trend',
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 9 — HIDDEN DIVERGENCE DETECTOR
//  Hidden Bull: Price HL, RSI LL → trend continuation UP
//  Hidden Bear: Price LH, RSI HH → trend continuation DOWN
//  More reliable than regular divergence in trending markets.
// ═══════════════════════════════════════════════════════════════
export function detectHiddenDivergence(candles, direction, period = 14) {
  if (!candles || candles.length < period * 3) return { hasHiddenDiv: false };
  
  const rsiValues = calculateRSI(candles, period);
  if (!rsiValues || rsiValues.length < 10) return { hasHiddenDiv: false };

  // Find swing lows in price and RSI (for bullish hidden div)
  const slice = candles.slice(-40);
  const rsiSlice = rsiValues.slice(-40);
  const n = Math.min(slice.length, rsiSlice.length);

  let hasHiddenDiv = false;
  let divType = null;
  let description = '';

  if (direction === 'long') {
    // Hidden Bullish: price makes higher low (HL) but RSI makes lower low (LL)
    // Find two recent swing lows
    let swingLow1Idx = -1, swingLow2Idx = -1;
    for (let i = n - 2; i >= 2; i--) {
      if (slice[i].low < slice[i-1].low && slice[i].low < slice[i+1].low) {
        if (swingLow2Idx === -1) swingLow2Idx = i;
        else if (swingLow1Idx === -1) { swingLow1Idx = i; break; }
      }
    }
    if (swingLow1Idx >= 0 && swingLow2Idx >= 0) {
      const priceHL = slice[swingLow2Idx].low > slice[swingLow1Idx].low; // Higher low in price
      const rsiLL   = rsiSlice[swingLow2Idx] < rsiSlice[swingLow1Idx];   // Lower low in RSI
      if (priceHL && rsiLL) {
        hasHiddenDiv = true;
        divType = 'bullish';
        description = '🔮 Hidden Bullish Divergence: Price HL + RSI LL → Trend continuation UP';
      }
    }
  } else if (direction === 'short') {
    // Hidden Bearish: price makes lower high (LH) but RSI makes higher high (HH)
    let swingHigh1Idx = -1, swingHigh2Idx = -1;
    for (let i = n - 2; i >= 2; i--) {
      if (slice[i].high > slice[i-1].high && slice[i].high > slice[i+1].high) {
        if (swingHigh2Idx === -1) swingHigh2Idx = i;
        else if (swingHigh1Idx === -1) { swingHigh1Idx = i; break; }
      }
    }
    if (swingHigh1Idx >= 0 && swingHigh2Idx >= 0) {
      const priceLH = slice[swingHigh2Idx].high < slice[swingHigh1Idx].high; // Lower high in price
      const rsiHH   = rsiSlice[swingHigh2Idx] > rsiSlice[swingHigh1Idx];     // Higher high in RSI
      if (priceLH && rsiHH) {
        hasHiddenDiv = true;
        divType = 'bearish';
        description = '🔮 Hidden Bearish Divergence: Price LH + RSI HH → Trend continuation DOWN';
      }
    }
  }

  return { hasHiddenDiv, divType, description };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 10 — WEEKLY OPEN & SESSION RANGE TRACKER
//  Price above/below weekly open = strong directional bias.
//  Asian range breakout = key entry signal for London session.
// ═══════════════════════════════════════════════════════════════
export function getWeeklyOpenBias(candles, currentPrice) {
  if (!candles || candles.length < 7) return null;
  // Find the most recent Monday candle (day of week from timestamp)
  // Timestamps are Unix seconds; Monday = 1
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 10); i--) {
    const date = new Date(candles[i].time * 1000);
    if (date.getUTCDay() === 1) { // Monday
      const weeklyOpen = candles[i].open;
      return {
        weeklyOpen,
        bias: currentPrice > weeklyOpen ? 'bullish' : 'bearish',
        distancePct: ((currentPrice - weeklyOpen) / weeklyOpen) * 100,
        description: currentPrice > weeklyOpen
          ? `↑ Price above Weekly Open ($${weeklyOpen.toFixed(2)}) — Bullish week bias`
          : `↓ Price below Weekly Open ($${weeklyOpen.toFixed(2)}) — Bearish week bias`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------
//  MODULE 11 � DISPLACEMENT QUALITY VALIDATOR
// ---------------------------------------------------------------
export function validateDisplacement(candles, breakCandleIndex) {
  if (!candles || breakCandleIndex < 0 || breakCandleIndex >= candles.length)
    return { valid: false, score: 0, reason: 'No break candle' };
  const c = candles[breakCandleIndex];
  if (!c) return { valid: false, score: 0, reason: 'No candle at index' };
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range === 0) return { valid: false, score: 0, reason: 'Doji' };
  const bodyRatio = body / range;
  const isBull = c.close > c.open;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const wickRatio = isBull ? (lowerWick / range) : (upperWick / range);
  const lookbackStart = Math.max(0, breakCandleIndex - 20);
  const avgVol = candles.slice(lookbackStart, breakCandleIndex)
    .reduce((s, x) => s + (x.volume || 0), 0) / Math.max(1, breakCandleIndex - lookbackStart);
  const volMult = avgVol > 0 ? (c.volume || 0) / avgVol : 1;
  let score = 0; const reasons = [];
  if (bodyRatio >= 0.60)      { score += 35; reasons.push(`Body ${(bodyRatio*100).toFixed(0)}%`); }
  else if (bodyRatio >= 0.45) { score += 20; reasons.push('Moderate body'); }
  if (wickRatio <= 0.20)      { score += 25; reasons.push('Closes at extreme'); }
  else if (wickRatio <= 0.35) { score += 12; }
  if (volMult >= 1.5)         { score += 25; reasons.push(`Vol ${volMult.toFixed(1)}x`); }
  else if (volMult >= 1.0)    { score += 12; }
  if (breakCandleIndex > 0) {
    const prev = candles[breakCandleIndex - 1];
    if (prev && isBull && c.close > prev.high) { score += 15; reasons.push('Engulfs'); }
    if (prev && !isBull && c.close < prev.low) { score += 15; reasons.push('Engulfs'); }
  }
  score = Math.min(100, score);
  return { valid: score >= 50, score, bodyRatio, volMultiplier: volMult, reason: reasons.join(' � ') || 'Weak' };
}

// ---------------------------------------------------------------
//  MODULE 12 � ERL / IRL LIQUIDITY CLASSIFICATION
// ---------------------------------------------------------------
export function classifyLiquidityLevels(candles, fvgs, orderBlocks, currentPrice) {
  if (!candles || candles.length < 10) return { erl: [], irl: [] };
  const erl = [], irl = [];
  const swings = findSwingPoints(candles, 5);
  const highs = swings.filter(s => s.type === 'high').slice(-10);
  const lows  = swings.filter(s => s.type === 'low').slice(-10);
  highs.forEach((h, i) => {
    const isEq = highs.some((h2, j) => j !== i && Math.abs(h2.price - h.price) / h.price < 0.0005);
    erl.push({ level: h.price, type: 'high', subtype: isEq ? 'EQH' : 'swing_high',
      label: isEq ? 'Equal High (EQH)' : 'Swing High', priority: isEq ? 'HIGH' : 'MEDIUM',
      distPct: ((h.price - currentPrice) / currentPrice) * 100 });
  });
  lows.forEach((l, i) => {
    const isEq = lows.some((l2, j) => j !== i && Math.abs(l2.price - l.price) / l.price < 0.0005);
    erl.push({ level: l.price, type: 'low', subtype: isEq ? 'EQL' : 'swing_low',
      label: isEq ? 'Equal Low (EQL)' : 'Swing Low', priority: isEq ? 'HIGH' : 'MEDIUM',
      distPct: ((l.price - currentPrice) / currentPrice) * 100 });
  });
  (fvgs || []).forEach(f => irl.push({ level: f.midpoint, type: f.type === 'bullish' ? 'low' : 'high',
    subtype: 'fvg', label: `${f.type === 'bullish' ? 'Bull' : 'Bear'} FVG`, priority: 'MEDIUM',
    distPct: ((f.midpoint - currentPrice) / currentPrice) * 100 }));
  (orderBlocks || []).filter(ob => ob.status === 'active').forEach(ob => {
    const mid = (ob.upperBound + ob.lowerBound) / 2;
    irl.push({ level: mid, type: ob.type === 'demand' ? 'low' : 'high', subtype: 'ob',
      label: `${ob.type === 'demand' ? 'Demand' : 'Supply'} OB`, priority: ob.strength > 3 ? 'HIGH' : 'MEDIUM',
      distPct: ((mid - currentPrice) / currentPrice) * 100 });
  });
  return { erl, irl };
}

// ---------------------------------------------------------------
//  MODULE 13 � INDUCEMENT DETECTION
// ---------------------------------------------------------------
function _dispCheck(c, dir) {
  if (!c) return false;
  const body = Math.abs(c.close - c.open), range = c.high - c.low;
  if (range === 0 || body / range < 0.50) return false;
  return dir === 'bullish' ? c.close > c.open : c.close < c.open;
}
export function detectInducement(candles, direction) {
  if (!candles || candles.length < 20) return { hasInducement: false };
  const recent = candles.slice(-Math.min(30, candles.length - 2));
  const swings = findSwingPoints(recent, 2);
  if (direction === 'long') {
    const minorHighs = swings.filter(s => s.type === 'high').slice(-4);
    for (let i = 1; i < minorHighs.length; i++) {
      const mh = minorHighs[i];
      for (let k = mh.index + 1; k < recent.length - 2; k++) {
        if (recent[k] && recent[k].high > mh.price && recent[k].close < mh.price && _dispCheck(recent[k+1],'bullish'))
          return { hasInducement: true, inducementLevel: mh.price, description: `Bull inducement swept $${mh.price.toFixed(2)}` };
      }
    }
  } else {
    const minorLows = swings.filter(s => s.type === 'low').slice(-4);
    for (let i = 1; i < minorLows.length; i++) {
      const ml = minorLows[i];
      for (let k = ml.index + 1; k < recent.length - 2; k++) {
        if (recent[k] && recent[k].low < ml.price && recent[k].close > ml.price && _dispCheck(recent[k+1],'bearish'))
          return { hasInducement: true, inducementLevel: ml.price, description: `Bear inducement swept $${ml.price.toFixed(2)}` };
      }
    }
  }
  return { hasInducement: false };
}

// ---------------------------------------------------------------
//  MODULE 14 � CHOCH QUALITY FILTER
// ---------------------------------------------------------------
export function assessChochQuality(candles, sweeps, direction) {
  if (!candles || candles.length < 10) return { quality: 'LOW', score: 0, reasons: [] };
  let score = 0; const reasons = [];
  const recentSweep = (sweeps||[]).some(s => {
    const age = candles.length - 1 - (s.candleIndex||0);
    const isStrong = s.strength !== 'weak';
    return age <= 10 && isStrong && ((direction==='long' && (s.type==='bullish'||s.direction==='long')) ||
                         (direction==='short'&& (s.type==='bearish'||s.direction==='short')));
  });
  if (recentSweep) { score += 40; reasons.push('ERL swept before CHOCH'); }
  const disp = validateDisplacement(candles, candles.length - 2);
  if (disp.valid) { score += Math.round(disp.score * 0.4); reasons.push(`Disp: ${disp.reason}`); }
  const sw = findSwingPoints(candles.slice(-20), 3);
  const rel = direction==='long' ? sw.filter(s=>s.type==='high') : sw.filter(s=>s.type==='low');
  if (rel.length >= 2) { score += 20; reasons.push('Multi-swing'); }
  score = Math.min(100, score);
  const quality = score>=70?'ELITE':score>=45?'HIGH':score>=25?'MEDIUM':'LOW';
  return { quality, score, reasons };
}

// ---------------------------------------------------------------
//  MODULE 15 � ATR VOLATILITY REGIME CLASSIFIER
// ---------------------------------------------------------------
export function classifyVolatilityRegime(candles, period = 14) {
  if (!candles || candles.length < period * 2) return { regime:'UNKNOWN', atr:0, atrPct:0, trend:'flat', sizingMultiplier:1.0, description:'Insufficient data' };
  const atrs = [];
  for (let i = 1; i < candles.length; i++) {
    const c=candles[i], p=candles[i-1];
    atrs.push(Math.max(c.high-c.low, Math.abs(c.high-p.close), Math.abs(c.low-p.close)));
  }
  const k = 2/(period+1);
  let atr = atrs.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const sm=[atr];
  for (let i=period;i<atrs.length;i++){atr=atrs[i]*k+sm[sm.length-1]*(1-k);sm.push(atr);}
  const cur=sm[sm.length-1],p5=sm[sm.length-6]||cur,p14=sm[Math.max(0,sm.length-15)]||cur;
  const price=candles[candles.length-1].close, atrPct=(cur/price)*100;
  const c5=(cur-p5)/p5, c14=(cur-p14)/p14;
  let regime='NORMAL',trend='flat';
  if(c5>0.10&&c14>0.05){regime='EXPANDING';trend='rising';}
  else if(c5<-0.10&&c14<-0.05){regime='CONTRACTING';trend='falling';}
  else if(Math.abs(c14)<0.03&&atrPct<0.5){regime='CONTRACTING';trend='compressed';}
  else if(c5>0.05&&c14<0){regime='TRANSITIONING';trend='inflecting';}
  return { regime, atr:parseFloat(cur.toFixed(4)), atrPct:parseFloat(atrPct.toFixed(3)), trend,
    description:`${regime} | ATR ${atrPct.toFixed(2)}% | ${trend}`,
    sizingMultiplier: regime==='EXPANDING'?0.75:regime==='CONTRACTING'?1.25:regime==='TRANSITIONING'?1.1:1.0 };
}

// ---------------------------------------------------------------
//  MODULE 16 � DRAW ON LIQUIDITY
// ---------------------------------------------------------------
export function identifyDrawOnLiquidity(candles, direction, currentPrice, fvgs, orderBlocks) {
  if (!candles||candles.length<20) return null;
  const { erl } = classifyLiquidityLevels(candles, fvgs, orderBlocks, currentPrice);
  const targets = direction==='long'
    ? erl.filter(l=>l.level>currentPrice&&l.type==='high').sort((a,b)=>a.level-b.level)
    : erl.filter(l=>l.level<currentPrice&&l.type==='low').sort((a,b)=>b.level-a.level);
  if (!targets.length) return null;
  return {
    primary:   targets[0]?{...targets[0],distPct:Math.abs(targets[0].distPct)}:null,
    secondary: targets[1]?{...targets[1],distPct:Math.abs(targets[1].distPct)}:null,
    tertiary:  targets[2]?{...targets[2],distPct:Math.abs(targets[2].distPct)}:null,
    description: targets[0]?`Draw ? ${targets[0].label} @ $${targets[0].level.toFixed(2)}`:'No draw',
  };
}

// ---------------------------------------------------------------
//  MODULE 17 � EQUAL HIGHS / LOWS
// ---------------------------------------------------------------
export function detectEqualHighsLows(candles, currentPrice, tolerance=0.0005) {
  if (!candles||candles.length<10) return { eqh:[], eql:[] };
  const eqh=[],eql=[];
  const recent=candles.slice(-Math.min(60,candles.length));
  const procH=new Set();
  for(let i=0;i<recent.length-1;i++){
    if(procH.has(i)) continue;
    const grp=[i];
    for(let j=i+1;j<recent.length;j++){
      if(Math.abs(recent[j].high-recent[i].high)/recent[i].high<=tolerance){grp.push(j);procH.add(j);}
    }
    if(grp.length>=2){
      const lvl=grp.reduce((s,idx)=>s+recent[idx].high,0)/grp.length;
      if(lvl>currentPrice) eqh.push({level:lvl,count:grp.length,label:`EQH (${grp.length}x)`,priority:grp.length>=3?'HIGH':'MEDIUM',distPct:((lvl-currentPrice)/currentPrice)*100});
    }
  }
  const procL=new Set();
  for(let i=0;i<recent.length-1;i++){
    if(procL.has(i)) continue;
    const grp=[i];
    for(let j=i+1;j<recent.length;j++){
      if(Math.abs(recent[j].low-recent[i].low)/recent[i].low<=tolerance){grp.push(j);procL.add(j);}
    }
    if(grp.length>=2){
      const lvl=grp.reduce((s,idx)=>s+recent[idx].low,0)/grp.length;
      if(lvl<currentPrice) eql.push({level:lvl,count:grp.length,label:`EQL (${grp.length}x)`,priority:grp.length>=3?'HIGH':'MEDIUM',distPct:((lvl-currentPrice)/currentPrice)*100});
    }
  }
  eqh.sort((a,b)=>a.distPct-b.distPct);
  eql.sort((a,b)=>Math.abs(a.distPct)-Math.abs(b.distPct));
  return { eqh, eql };
}

// ---------------------------------------------------------------
//  MODULE 18 � SIGNAL GRADE (A+ / A / B / C / D)
// ---------------------------------------------------------------
export function calculateSignalGrade({ chochQuality, displacementScore, hasSweep, hasInducement,
  mtfAligned, mtfPartial, drawAligned, volatilityRegime, rrrMet, inOTE, atPOC, rsiCrossAligned }) {
  let s=0;
  if(hasSweep)                                  s+=15;
  if(hasInducement)                             s+=10;
  if(chochQuality?.quality==='ELITE')           s+=15;
  else if(chochQuality?.quality==='HIGH')       s+=10;
  else if(chochQuality?.quality==='MEDIUM')     s+=5;
  if((displacementScore||0)>=70)                s+=10;
  else if((displacementScore||0)>=50)           s+=5;
  if(mtfAligned)        s+=15;
  else if(mtfPartial)   s+=8;
  if(drawAligned) s+=10;
  if(inOTE)       s+=5;
  if(rrrMet)      s+=8;
  if(atPOC)       s+=5;
  if(rsiCrossAligned) s+=5;
  if(volatilityRegime==='TRANSITIONING')        s+=7;
  else if(volatilityRegime==='CONTRACTING')     s+=5;
  else if(volatilityRegime==='EXPANDING')       s+=2;
  s=Math.min(100,s);
  const grade=s>=80?'A+':s>=70?'A':s>=55?'B':s>=40?'C':'D';
  const label=s>=80?'ELITE SETUP':s>=70?'HIGH CONVICTION':s>=55?'MODERATE':s>=40?'LOW CONVICTION':'AVOID';
  return { grade, score:s, label };
}