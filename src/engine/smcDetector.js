// ─────────────────────────────────────────────────────────
//  SMC Detector v6.0 — High-Conviction Institutional Engine
//  Pure functions — no React dependencies
// ─────────────────────────────────────────────────────────

/**
 * Find swing highs and lows using a configurable lookback.
 */
export function findSwingPoints(candles, lookback = 5) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) swings.push({ type: 'high', price: candles[i].high, index: i, time: candles[i].time });
    if (isLow)  swings.push({ type: 'low',  price: candles[i].low,  index: i, time: candles[i].time });
  }
  return swings;
}

/**
 * Detect Order Blocks (v6: requires 2.5x impulse ratio, body validation, recency cap 50 bars).
 */
export function detectOrderBlocks(candles, currentPrice) {
  const obs = [];
  const recencyCutoff = candles.length - 50;

  for (let i = 2; i < candles.length - 2; i++) {
    const ob = candles[i];
    const impulse = candles[i + 1];
    const obBody = Math.abs(ob.close - ob.open);
    const impulseBody = Math.abs(impulse.close - impulse.open);
    if (obBody === 0) continue; // skip doji

    // Demand OB: bearish candle followed by strong bullish impulse
    if (ob.close < ob.open && impulse.close > impulse.open && impulseBody >= obBody * 2.5) {
      const mitigated = currentPrice != null && currentPrice < ob.low;
      if (!mitigated && i >= recencyCutoff) {
        obs.push({
          type: 'demand',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: ob.high,
          slBoundary: ob.low,
          status: 'active',
          strength: impulseBody / obBody,
          candleIndex: i,
          time: ob.time,
        });
      }
    }

    // Supply OB: bullish candle followed by strong bearish impulse
    if (ob.close > ob.open && impulse.close < impulse.open && impulseBody >= obBody * 2.5) {
      const mitigated = currentPrice != null && currentPrice > ob.high;
      if (!mitigated && i >= recencyCutoff) {
        obs.push({
          type: 'supply',
          upperBound: ob.high,
          lowerBound: ob.low,
          entryBoundary: ob.low,
          slBoundary: ob.high,
          status: 'active',
          strength: impulseBody / obBody,
          candleIndex: i,
          time: ob.time,
        });
      }
    }
  }

  // Sort by proximity to price, strongest first, limit to 5
  return obs
    .sort((a, b) => {
      const distA = Math.abs(a.entryBoundary - (currentPrice || 0));
      const distB = Math.abs(b.entryBoundary - (currentPrice || 0));
      return distA - distB;
    })
    .slice(0, 5);
}

/**
 * Detect Fair Value Gaps. Only unfilled, recent (last 60 bars), with minimum size filter.
 */
export function detectFVGs(candles, currentPrice) {
  const fvgs = [];
  const recencyCutoff = candles.length - 60;
  const minGapPct = 0.001; // 0.1% minimum gap size

  for (let i = 1; i < candles.length - 1; i++) {
    if (i < recencyCutoff) continue;
    const c1 = candles[i - 1];
    const c3 = candles[i + 1];

    // Bullish FVG: gap up
    if (c3.low > c1.high && (c3.low - c1.high) / c1.high > minGapPct) {
      const filled = currentPrice != null && currentPrice <= c3.low && currentPrice >= c1.high;
      if (!filled) {
        fvgs.push({ type: 'bullish', upper: c3.low, lower: c1.high, midpoint: (c3.low + c1.high) / 2, status: 'unfilled', candleIndex: i, time: candles[i].time });
      }
    }

    // Bearish FVG: gap down
    if (c1.low > c3.high && (c1.low - c3.high) / c3.high > minGapPct) {
      const filled = currentPrice != null && currentPrice >= c3.high && currentPrice <= c1.low;
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
 * Detect Liquidity Sweeps — wick extends beyond a prior swing, then closes back inside.
 * This is the core institutional manipulation signal.
 */
export function detectSweeps(candles) {
  const sweeps = [];
  const swings = findSwingPoints(candles, 3);
  const recentHighs = swings.filter(s => s.type === 'high').slice(-6);
  const recentLows  = swings.filter(s => s.type === 'low').slice(-6);

  // Check last 10 candles for sweep events
  const lookback = Math.min(10, candles.length - 1);
  for (let i = candles.length - lookback; i < candles.length; i++) {
    const c = candles[i];

    // Bearish sweep: wick above a prior high, then closes below it (bull trap)
    for (const swing of recentHighs) {
      if (swing.index >= i) continue;
      if (c.high > swing.price && c.close < swing.price) {
        sweeps.push({
          type: 'bearish',
          sweptLevel: swing.price,
          candleIndex: i,
          time: c.time,
          direction: 'short',
        });
        break;
      }
    }

    // Bullish sweep: wick below a prior low, then closes above it (bear trap)
    for (const swing of recentLows) {
      if (swing.index >= i) continue;
      if (c.low < swing.price && c.close > swing.price) {
        sweeps.push({
          type: 'bullish',
          sweptLevel: swing.price,
          candleIndex: i,
          time: c.time,
          direction: 'long',
        });
        break;
      }
    }
  }

  return sweeps.slice(-3);
}

/**
 * Detect BOS (Break of Structure) and CHOCH (Change of Character) on 15m.
 * BOS = trend continuation. CHOCH = potential reversal.
 */
export function detectStructureShifts(candles) {
  const shifts = [];
  const swings = findSwingPoints(candles, 3);
  const highs = swings.filter(s => s.type === 'high').slice(-5);
  const lows  = swings.filter(s => s.type === 'low').slice(-5);
  const last = candles[candles.length - 1];

  if (highs.length >= 2) {
    const prevHigh = highs[highs.length - 2];
    const lastHigh = highs[highs.length - 1];

    // BOS Bullish: price closes above previous HH
    if (last.close > prevHigh.price) {
      shifts.push({ type: 'BOS', direction: 'bullish', level: prevHigh.price, time: last.time });
    }
    // CHOCH Bearish: price closes below a recent HL after uptrend (reversal signal)
    if (lows.length >= 2) {
      const lastLow = lows[lows.length - 1];
      if (lastHigh.price > prevHigh.price && last.close < lastLow.price) {
        shifts.push({ type: 'CHOCH', direction: 'bearish', level: lastLow.price, time: last.time });
      }
    }
  }

  if (lows.length >= 2) {
    const prevLow = lows[lows.length - 2];
    const lastLow = lows[lows.length - 1];

    // BOS Bearish: price closes below previous LL
    if (last.close < prevLow.price) {
      shifts.push({ type: 'BOS', direction: 'bearish', level: prevLow.price, time: last.time });
    }
    // CHOCH Bullish: price closes above a recent LH after downtrend (reversal signal)
    if (highs.length >= 2) {
      const lastHigh = highs[highs.length - 1];
      if (lastLow.price < prevLow.price && last.close > lastHigh.price) {
        shifts.push({ type: 'CHOCH', direction: 'bullish', level: lastHigh.price, time: last.time });
      }
    }
  }

  return shifts;
}

/**
 * Calculate EMA (Exponential Moving Average).
 */
export function calculateEMA(candles, period) {
  if (candles.length < period) return [];
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
  if (candles.length < period + 1) return [];
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
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - 100 / (1 + rs));
  }
  return rsis;
}

/**
 * Detect RSI divergence by comparing price swings vs RSI swings.
 * Bearish: higher price high, lower RSI high.
 * Bullish: lower price low, higher RSI low.
 */
export function detectRSIDivergence(candles, direction, period = 14) {
  const rsiValues = calculateRSI(candles, period);
  const rsiValue = rsiValues[rsiValues.length - 1];
  const isOverbought = rsiValue > 70;
  const isOversold = rsiValue < 30;
  let hasDivergence = false;
  let detail = '';

  const swings = findSwingPoints(candles.slice(-50), 3);
  const offset = candles.length - 50 - period;
  const rsiOffset = Math.max(0, offset);

  if (direction === 'short') {
    const priceHighs = swings.filter(s => s.type === 'high').slice(-3);
    if (priceHighs.length >= 2) {
      const ph1 = priceHighs[priceHighs.length - 2];
      const ph2 = priceHighs[priceHighs.length - 1];
      const ri1 = rsiValues[rsiOffset + ph1.index];
      const ri2 = rsiValues[rsiOffset + ph2.index];
      if (ri1 && ri2 && ph2.price > ph1.price && ri2 < ri1) {
        hasDivergence = true;
        detail = `Bearish divergence: price HH (${ph2.price.toFixed(0)}) but RSI LH (${ri2?.toFixed(1)})`;
      }
    }
  } else if (direction === 'long') {
    const priceLows = swings.filter(s => s.type === 'low').slice(-3);
    if (priceLows.length >= 2) {
      const pl1 = priceLows[priceLows.length - 2];
      const pl2 = priceLows[priceLows.length - 1];
      const ri1 = rsiValues[rsiOffset + pl1.index];
      const ri2 = rsiValues[rsiOffset + pl2.index];
      if (ri1 && ri2 && pl2.price < pl1.price && ri2 > ri1) {
        hasDivergence = true;
        detail = `Bullish divergence: price LL (${pl2.price.toFixed(0)}) but RSI HL (${ri2?.toFixed(1)})`;
      }
    }
  }

  return { rsiValue, hasDivergence, detail, isOverbought, isOversold };
}
