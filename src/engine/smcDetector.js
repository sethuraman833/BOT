// ─────────────────────────────────────────────────────────
//  Smart Money Concepts Detector
//  Order Blocks, FVGs, Liquidity Sweeps, BOS/CHOCH, Breakers
// ─────────────────────────────────────────────────────────

/**
 * Detect Order Blocks (refined boundaries as per prompt).
 * Demand OB: Last bearish candle before a strong bullish impulse.
 * Supply OB: Last bullish candle before a strong bearish impulse.
 */
export function detectOrderBlocks(candles, sensitivity = 1.5) {
  const orderBlocks = [];
  const avgRange = getAverageRange(candles, 20);

  for (let i = 2; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];

    // Demand OB: bearish candle followed by strong bullish impulse
    if (prev.close < prev.open) { // prev is bearish
      const impulseSize = next.close - curr.open;
      if (impulseSize > avgRange * sensitivity && curr.close > curr.open) {
        orderBlocks.push({
          type: 'demand',
          // Refined: HIGH of bearish candle = upper entry, LOW = SL invalidation
          upper: prev.high,
          lower: prev.low,
          entryBoundary: prev.high,   // refined entry
          invalidation: prev.low,     // SL invalidation
          index: i - 1,
          time: prev.time,
          status: 'active',
          mitigated: false,
        });
      }
    }

    // Supply OB: bullish candle followed by strong bearish impulse
    if (prev.close > prev.open) { // prev is bullish
      const impulseSize = curr.open - next.close;
      if (impulseSize > avgRange * sensitivity && curr.close < curr.open) {
        orderBlocks.push({
          type: 'supply',
          upper: prev.high,
          lower: prev.low,
          entryBoundary: prev.low,    // refined entry
          invalidation: prev.high,    // SL invalidation
          index: i - 1,
          time: prev.time,
          status: 'active',
          mitigated: false,
        });
      }
    }
  }

  // Check mitigation — has price returned and broken through?
  const lastPrice = candles[candles.length - 1].close;
  orderBlocks.forEach(ob => {
    if (ob.type === 'demand' && lastPrice < ob.lower) {
      ob.status = 'mitigated';
      ob.mitigated = true;
    }
    if (ob.type === 'supply' && lastPrice > ob.upper) {
      ob.status = 'mitigated';
      ob.mitigated = true;
    }
    // Check if price has already visited the zone
    for (let j = ob.index + 3; j < candles.length; j++) {
      if (ob.type === 'demand' && candles[j].low <= ob.upper) {
        ob.status = 'mitigated';
        ob.mitigated = true;
        break;
      }
      if (ob.type === 'supply' && candles[j].high >= ob.lower) {
        ob.status = 'mitigated';
        ob.mitigated = true;
        break;
      }
    }
  });

  return orderBlocks;
}

/**
 * Detect Fair Value Gaps (3-candle structure).
 * FVG for bullish: candle[i-1].high < candle[i+1].low
 * FVG for bearish: candle[i-1].low > candle[i+1].high
 */
export function detectFVGs(candles) {
  const fvgs = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];

    // Bullish FVG: gap between prev.high and next.low
    if (next.low > prev.high) {
      fvgs.push({
        type: 'bullish',
        upper: next.low,
        lower: prev.high,
        midCandle: curr,
        index: i,
        time: curr.time,
        status: 'unfilled',
      });
    }

    // Bearish FVG: gap between next.high and prev.low
    if (next.high < prev.low) {
      fvgs.push({
        type: 'bearish',
        upper: prev.low,
        lower: next.high,
        midCandle: curr,
        index: i,
        time: curr.time,
        status: 'unfilled',
      });
    }
  }

  // Check if filled
  fvgs.forEach(fvg => {
    for (let j = fvg.index + 2; j < candles.length; j++) {
      if (fvg.type === 'bullish' && candles[j].low <= fvg.lower) {
        fvg.status = 'filled';
        break;
      }
      if (fvg.type === 'bearish' && candles[j].high >= fvg.upper) {
        fvg.status = 'filled';
        break;
      }
    }
  });

  return fvgs;
}

/**
 * Detect Liquidity Sweeps with 3-rule validation.
 * Rule 1: Price exceeded equal high/low by ≥0.15%
 * Rule 2: Sweep candle closed back inside range
 * Rule 3: Displacement candle followed within 1-2 candles
 */
export function detectLiquiditySweeps(candles, swingHighs, swingLows) {
  const sweeps = [];

  // Find equal highs (levels with multiple touches)
  const equalHighs = findEqualLevels(swingHighs, 0.002);
  const equalLows = findEqualLevels(swingLows, 0.002);

  // Check for bearish sweeps (sweep above equal highs then reverse)
  equalHighs.forEach(level => {
    for (let i = level.lastIndex + 1; i < candles.length - 2; i++) {
      const c = candles[i];
      const exceedPct = (c.high - level.price) / level.price;

      // Rule 1: exceeded by ≥0.15%
      if (exceedPct >= 0.0015) {
        // Rule 2: closed back below the swept level
        if (c.close < level.price) {
          // Rule 3: displacement candle within next 1-2 candles
          const next1 = candles[i + 1];
          const next2 = i + 2 < candles.length ? candles[i + 2] : null;
          const bodySize1 = Math.abs(next1.close - next1.open);
          const wickRatio1 = bodySize1 / (next1.high - next1.low + 0.0001);

          if ((next1.close < next1.open && wickRatio1 > 0.6) ||
              (next2 && next2.close < next2.open && Math.abs(next2.close - next2.open) / (next2.high - next2.low + 0.0001) > 0.6)) {
            sweeps.push({
              type: 'bearish',
              sweptLevel: level.price,
              sweepCandle: c,
              index: i,
              time: c.time,
              validated: true,
              exceedPercent: (exceedPct * 100).toFixed(2),
            });
            break;
          }
        }
      }
    }
  });

  // Check for bullish sweeps (sweep below equal lows then reverse)
  equalLows.forEach(level => {
    for (let i = level.lastIndex + 1; i < candles.length - 2; i++) {
      const c = candles[i];
      const exceedPct = (level.price - c.low) / level.price;

      if (exceedPct >= 0.0015) {
        if (c.close > level.price) {
          const next1 = candles[i + 1];
          const next2 = i + 2 < candles.length ? candles[i + 2] : null;
          const bodySize1 = Math.abs(next1.close - next1.open);
          const wickRatio1 = bodySize1 / (next1.high - next1.low + 0.0001);

          if ((next1.close > next1.open && wickRatio1 > 0.6) ||
              (next2 && next2.close > next2.open && Math.abs(next2.close - next2.open) / (next2.high - next2.low + 0.0001) > 0.6)) {
            sweeps.push({
              type: 'bullish',
              sweptLevel: level.price,
              sweepCandle: c,
              index: i,
              time: c.time,
              validated: true,
              exceedPercent: (exceedPct * 100).toFixed(2),
            });
            break;
          }
        }
      }
    }
  });

  return sweeps;
}

/**
 * Detect Break of Structure (BOS) and Change of Character (CHOCH).
 */
export function detectStructureShifts(candles, swingHighs, swingLows) {
  const shifts = [];

  if (swingHighs.length < 2 || swingLows.length < 2) return shifts;

  // Determine prevailing trend
  const recentHighs = swingHighs.slice(-4);
  const recentLows = swingLows.slice(-4);

  // Check for BOS (trend continuation)
  for (let i = 1; i < recentHighs.length; i++) {
    // Bullish BOS: new higher high
    if (recentHighs[i].price > recentHighs[i-1].price &&
        recentLows.length > i && recentLows[i].price > recentLows[i-1].price) {
      shifts.push({
        type: 'BOS',
        direction: 'bullish',
        level: recentHighs[i].price,
        index: recentHighs[i].index,
        time: recentHighs[i].time,
        description: 'Break of Structure — Higher High confirmed',
      });
    }
  }

  for (let i = 1; i < recentLows.length; i++) {
    // Bearish BOS: new lower low
    if (recentLows[i].price < recentLows[i-1].price &&
        recentHighs.length > i && recentHighs[i].price < recentHighs[i-1].price) {
      shifts.push({
        type: 'BOS',
        direction: 'bearish',
        level: recentLows[i].price,
        index: recentLows[i].index,
        time: recentLows[i].time,
        description: 'Break of Structure — Lower Low confirmed',
      });
    }
  }

  // Check for CHOCH (trend reversal)
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const lastHigh = recentHighs[recentHighs.length - 1];
    const prevHigh = recentHighs[recentHighs.length - 2];
    const lastLow = recentLows[recentLows.length - 1];
    const prevLow = recentLows[recentLows.length - 2];

    // Bullish CHOCH: was making LH/LL, now breaks above last LH
    if (prevHigh.price > lastHigh.price && prevLow.price > lastLow.price) {
      // Check if current price broke above the last lower high
      const currentPrice = candles[candles.length - 1].close;
      if (currentPrice > lastHigh.price) {
        shifts.push({
          type: 'CHOCH',
          direction: 'bullish',
          level: lastHigh.price,
          index: candles.length - 1,
          time: candles[candles.length - 1].time,
          description: 'Change of Character — Bearish to Bullish',
        });
      }
    }

    // Bearish CHOCH: was making HH/HL, now breaks below last HL
    if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
      const currentPrice = candles[candles.length - 1].close;
      if (currentPrice < lastLow.price) {
        shifts.push({
          type: 'CHOCH',
          direction: 'bearish',
          level: lastLow.price,
          index: candles.length - 1,
          time: candles[candles.length - 1].time,
          description: 'Change of Character — Bullish to Bearish',
        });
      }
    }
  }

  return shifts;
}

/**
 * Detect Breaker Blocks (old OB retested from opposite side).
 */
export function detectBreakerBlocks(orderBlocks, candles) {
  const breakers = [];

  orderBlocks.forEach(ob => {
    if (!ob.mitigated) return;

    // For a mitigated demand OB, check if price returns from above (now supply)
    if (ob.type === 'demand') {
      for (let i = ob.index + 5; i < candles.length; i++) {
        if (candles[i].low <= ob.upper && candles[i].low >= ob.lower && candles[i].close > ob.upper) {
          breakers.push({
            type: 'bearish_breaker',   // old demand becomes supply
            upper: ob.upper,
            lower: ob.lower,
            originalOB: ob,
            index: i,
            time: candles[i].time,
          });
          break;
        }
      }
    }

    // For a mitigated supply OB, check if price returns from below (now demand)
    if (ob.type === 'supply') {
      for (let i = ob.index + 5; i < candles.length; i++) {
        if (candles[i].high >= ob.lower && candles[i].high <= ob.upper && candles[i].close < ob.lower) {
          breakers.push({
            type: 'bullish_breaker',
            upper: ob.upper,
            lower: ob.lower,
            originalOB: ob,
            index: i,
            time: candles[i].time,
          });
          break;
        }
      }
    }
  });

  return breakers;
}

/**
 * Detect key entry candle types on 15m.
 */
export function detectEntryCandle(candle, direction) {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;
  const totalRange = candle.high - candle.low;

  if (totalRange === 0) return null;

  // Engulfing — strong body (>70% of range)
  if (body / totalRange > 0.7) {
    if (direction === 'long' && candle.close > candle.open) {
      return { type: 'engulfing_bullish', strength: 'strong' };
    }
    if (direction === 'short' && candle.close < candle.open) {
      return { type: 'engulfing_bearish', strength: 'strong' };
    }
  }

  // Pin bar / Hammer — wick ≥ 2× body
  if (direction === 'long' && lowerWick >= body * 2 && upperWick < body) {
    return { type: 'hammer', strength: 'strong' };
  }
  if (direction === 'short' && upperWick >= body * 2 && lowerWick < body) {
    return { type: 'shooting_star', strength: 'strong' };
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────

function getAverageRange(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  return recent.reduce((sum, c) => sum + (c.high - c.low), 0) / recent.length;
}

function findEqualLevels(swingPoints, tolerance = 0.002) {
  const levels = [];
  for (let i = 0; i < swingPoints.length; i++) {
    for (let j = i + 1; j < swingPoints.length; j++) {
      const diff = Math.abs(swingPoints[i].price - swingPoints[j].price) / swingPoints[i].price;
      if (diff <= tolerance) {
        const avgPrice = (swingPoints[i].price + swingPoints[j].price) / 2;
        const existing = levels.find(l => Math.abs(l.price - avgPrice) / avgPrice < tolerance);
        if (!existing) {
          levels.push({
            price: avgPrice,
            touches: 2,
            lastIndex: Math.max(swingPoints[i].index, swingPoints[j].index),
          });
        } else {
          existing.touches++;
          existing.lastIndex = Math.max(existing.lastIndex, swingPoints[j].index);
        }
      }
    }
  }
  return levels;
}
