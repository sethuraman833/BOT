// ─────────────────────────────────────────────────────────
//  SMC Detector — Order Blocks, FVGs, Sweeps, BOS/CHOCH
//  Pure functions — no React dependencies
// ─────────────────────────────────────────────────────────

/**
 * Find swing highs and swing lows using a 5-bar lookback/forward.
 */
export function findSwingPoints(candles, lookback = 5) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) swings.push({ type: 'high', price: candles[i].high, index: i, time: candles[i].time });
    if (isLow) swings.push({ type: 'low', price: candles[i].low, index: i, time: candles[i].time });
  }
  return swings;
}

/**
 * Detect Order Blocks.
 * Demand OB: last bearish candle before a strong bullish impulse.
 * Supply OB: last bullish candle before a strong bearish impulse.
 */
export function detectOrderBlocks(candles, currentPrice) {
  const obs = [];
  for (let i = 2; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const ob = candles[i];
    const impulse = candles[i + 1];

    const obBody = Math.abs(ob.close - ob.open);
    const impulseBody = Math.abs(impulse.close - impulse.open);
    const isBearishOB = ob.close < ob.open;
    const isBullishImpulse = impulse.close > impulse.open;
    const isBullishOB = ob.close > ob.open;
    const isBearishImpulse = impulse.close < impulse.open;

    // Demand OB
    if (isBearishOB && isBullishImpulse && impulseBody >= obBody * 1.5) {
      const mitigated = currentPrice != null && currentPrice < ob.low;
      obs.push({
        type: 'demand',
        upperBound: ob.high,
        lowerBound: ob.low,
        entryBoundary: ob.high,
        slBoundary: ob.low,
        status: mitigated ? 'mitigated' : 'active',
        candleIndex: i,
        time: ob.time,
      });
    }

    // Supply OB
    if (isBullishOB && isBearishImpulse && impulseBody >= obBody * 1.5) {
      const mitigated = currentPrice != null && currentPrice > ob.high;
      obs.push({
        type: 'supply',
        upperBound: ob.high,
        lowerBound: ob.low,
        entryBoundary: ob.low,
        slBoundary: ob.high,
        status: mitigated ? 'mitigated' : 'active',
        candleIndex: i,
        time: ob.time,
      });
    }
  }
  // Most recent first, only active, limit to 5 closest
  return obs
    .filter(o => o.status === 'active')
    .reverse()
    .sort((a, b) => Math.abs((a.entryBoundary - (currentPrice || 0))) - Math.abs((b.entryBoundary - (currentPrice || 0))))
    .slice(0, 5);
}

/**
 * Detect Fair Value Gaps.
 * Bullish FVG: candle[i-1].high < candle[i+1].low
 * Bearish FVG: candle[i-1].low > candle[i+1].high
 */
export function detectFVGs(candles, currentPrice) {
  const fvgs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const c1 = candles[i - 1];
    const c3 = candles[i + 1];

    // Bullish FVG
    if (c3.low > c1.high) {
      const filled = currentPrice != null && currentPrice <= c3.low && currentPrice >= c1.high;
      fvgs.push({
        type: 'bullish',
        upper: c3.low,
        lower: c1.high,
        status: filled ? 'filled' : 'unfilled',
        candleIndex: i,
        time: candles[i].time,
      });
    }

    // Bearish FVG
    if (c3.high < c1.low) {
      const filled = currentPrice != null && currentPrice >= c3.high && currentPrice <= c1.low;
      fvgs.push({
        type: 'bearish',
        upper: c1.low,
        lower: c3.high,
        status: filled ? 'filled' : 'unfilled',
        candleIndex: i,
        time: candles[i].time,
      });
    }
  }
  return fvgs
    .filter(f => f.status === 'unfilled')
    .reverse()
    .slice(0, 5);
}

/**
 * Detect Liquidity Sweeps.
 * Three conditions required:
 * 1. Wick pierces prior swing by ≥ 0.15%
 * 2. Close returns inside the range
 * 3. Next candle(s) show displacement (body ≥ 60% of range)
 */
export function detectSweeps(candles) {
  const swings = findSwingPoints(candles, 3);
  const sweeps = [];

  for (let i = candles.length - 5; i < candles.length - 1; i++) {
    if (i < 1) continue;
    const candle = candles[i];
    const nextCandle = candles[i + 1];
    if (!nextCandle) continue;

    // Check against recent swing highs (buy-side sweep)
    const recentHighs = swings.filter(s => s.type === 'high' && s.index < i && s.index > i - 30);
    for (const swing of recentHighs) {
      const pierce = (candle.high - swing.price) / swing.price;
      const closedBelow = candle.close < swing.price;
      const nextBody = Math.abs(nextCandle.close - nextCandle.open);
      const nextRange = nextCandle.high - nextCandle.low;
      const displacement = nextRange > 0 && nextBody / nextRange >= 0.6;

      if (pierce >= 0.0015 && closedBelow && displacement) {
        sweeps.push({
          type: 'bearish',
          sweptLevel: swing.price,
          sweepCandle: i,
          displacementCandle: i + 1,
          confirmed: true,
          time: candle.time,
        });
      }
    }

    // Check against recent swing lows (sell-side sweep)
    const recentLows = swings.filter(s => s.type === 'low' && s.index < i && s.index > i - 30);
    for (const swing of recentLows) {
      const pierce = (swing.price - candle.low) / swing.price;
      const closedAbove = candle.close > swing.price;
      const nextBody = Math.abs(nextCandle.close - nextCandle.open);
      const nextRange = nextCandle.high - nextCandle.low;
      const displacement = nextRange > 0 && nextBody / nextRange >= 0.6;

      if (pierce >= 0.0015 && closedAbove && displacement) {
        sweeps.push({
          type: 'bullish',
          sweptLevel: swing.price,
          sweepCandle: i,
          displacementCandle: i + 1,
          confirmed: true,
          time: candle.time,
        });
      }
    }
  }
  return sweeps.filter(s => s.confirmed).slice(-3);
}

/**
 * Detect BOS (Break of Structure) and CHOCH (Change of Character).
 * BOS: close beyond last swing in the SAME direction as prevailing trend.
 * CHOCH: close beyond swing in OPPOSITE direction.
 */
export function detectStructureShifts(candles) {
  const swings = findSwingPoints(candles, 3);
  const shifts = [];
  if (swings.length < 4) return shifts;

  // Determine prevailing trend from swing sequence
  const lastHighs = swings.filter(s => s.type === 'high').slice(-3);
  const lastLows = swings.filter(s => s.type === 'low').slice(-3);

  let prevailingTrend = 'neutral';
  if (lastHighs.length >= 2 && lastLows.length >= 2) {
    const hhCount = lastHighs[lastHighs.length - 1].price > lastHighs[lastHighs.length - 2].price ? 1 : 0;
    const hlCount = lastLows[lastLows.length - 1].price > lastLows[lastLows.length - 2].price ? 1 : 0;
    if (hhCount && hlCount) prevailingTrend = 'bullish';
    else if (!hhCount && !hlCount) prevailingTrend = 'bearish';
  }

  // Check last few candles for structure breaks
  for (let i = candles.length - 5; i < candles.length; i++) {
    if (i < 0) continue;
    const c = candles[i];

    // Break above last swing high
    const lastSwingHigh = lastHighs[lastHighs.length - 1];
    if (lastSwingHigh && c.close > lastSwingHigh.price) {
      shifts.push({
        type: prevailingTrend === 'bullish' ? 'BOS' : 'CHOCH',
        direction: 'bullish',
        level: lastSwingHigh.price,
        candleIndex: i,
        time: c.time,
      });
    }

    // Break below last swing low
    const lastSwingLow = lastLows[lastLows.length - 1];
    if (lastSwingLow && c.close < lastSwingLow.price) {
      shifts.push({
        type: prevailingTrend === 'bearish' ? 'BOS' : 'CHOCH',
        direction: 'bearish',
        level: lastSwingLow.price,
        candleIndex: i,
        time: c.time,
      });
    }
  }
  return shifts.slice(-3);
}

/**
 * Calculate EMA for a given period from candle closes.
 */
export function calculateEMA(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const emaValues = [];
  let ema = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      emaValues.push(null);
    } else if (i === period - 1) {
      emaValues.push(ema);
    } else {
      ema = candles[i].close * k + ema * (1 - k);
      emaValues.push(ema);
    }
  }
  return emaValues;
}

/**
 * Calculate RSI for a given period.
 */
export function calculateRSI(candles, period = 14) {
  if (candles.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
