// ─────────────────────────────────────────────────────────
//  CME Gap Analyzer v1.0 — Weekend Gap Detection & Fill Prediction
//
//  CME BTC/ETH futures close Friday 21:00 UTC, reopen Sunday 22:00 UTC.
//  Any price difference between Friday close and Sunday open creates a
//  "CME Gap". Historically ~77% of gaps fill within 1-2 weeks.
//
//  This module:
//   1. Scans 1H candles to detect weekend gaps
//   2. Tracks whether each gap has been filled
//   3. Predicts fill probability based on market structure
// ─────────────────────────────────────────────────────────

/**
 * Determine if a UTC timestamp falls on a Friday after market close (21:00 UTC)
 * or Saturday/Sunday before market open (22:00 UTC Sunday).
 */
function isWeekendGapCandle(timestampSec) {
  const d = new Date(timestampSec * 1000);
  const day = d.getUTCDay();   // 0=Sun, 5=Fri, 6=Sat
  const hour = d.getUTCHours();

  // Friday after 21:00 UTC (CME close)
  if (day === 5 && hour >= 21) return 'close';
  // All of Saturday
  if (day === 6) return 'weekend';
  // Sunday before 22:00 UTC (CME open)
  if (day === 0 && hour < 22) return 'weekend';
  // Sunday at 22:00 UTC = open
  if (day === 0 && hour >= 22) return 'open';

  return null;
}

/**
 * Detect CME weekend gaps from 1-hour candles.
 *
 * Scans for transitions from Friday close → Sunday open and measures the gap.
 * Then checks if subsequent candles have filled the gap.
 *
 * @param {Array} candles1h - Array of 1H OHLCV candles (sorted chronologically)
 * @param {number} currentPrice - Current live price
 * @param {number} maxGaps - Maximum number of recent gaps to track (default: 8)
 * @returns {Array} Array of gap objects
 */
export function detectCMEGaps(candles1h, currentPrice, maxGaps = 8) {
  if (!candles1h || candles1h.length < 48) return [];

  const gaps = [];
  let fridayClose = null;
  let fridayCloseTime = null;

  for (let i = 0; i < candles1h.length; i++) {
    const c = candles1h[i];
    const phase = isWeekendGapCandle(c.time);

    // Record the last Friday close candle
    if (phase === 'close') {
      fridayClose = c.close;
      fridayCloseTime = c.time;
      continue;
    }

    // When we hit the Sunday open candle after tracking a Friday close
    if (phase === 'open' && fridayClose !== null) {
      const sundayOpen = c.open;
      const gapSize = sundayOpen - fridayClose;
      const gapPct = Math.abs(gapSize) / fridayClose;

      // Only track gaps larger than 0.05% to filter noise
      if (gapPct > 0.0005) {
        const gapDirection = gapSize > 0 ? 'up' : 'down';
        const gapUpper = Math.max(fridayClose, sundayOpen);
        const gapLower = Math.min(fridayClose, sundayOpen);

        // Check if this gap has been filled by subsequent candles
        let filled = false;
        let filledAt = null;
        let filledTime = null;
        let partialFillPct = 0;

        for (let j = i + 1; j < candles1h.length; j++) {
          const fc = candles1h[j];

          if (gapDirection === 'up') {
            // Gap up: price needs to come DOWN to touch fridayClose level
            if (fc.low <= gapLower) {
              filled = true;
              filledAt = fc.low;
              filledTime = fc.time;
              partialFillPct = 100;
              break;
            }
            // Partial fill tracking
            const lowestReach = fc.low;
            const fillDistance = gapUpper - lowestReach;
            const totalGap = gapUpper - gapLower;
            if (totalGap > 0) {
              partialFillPct = Math.max(partialFillPct, Math.min(100, (fillDistance / totalGap) * 100));
            }
          } else {
            // Gap down: price needs to come UP to touch fridayClose level
            if (fc.high >= gapUpper) {
              filled = true;
              filledAt = fc.high;
              filledTime = fc.time;
              partialFillPct = 100;
              break;
            }
            // Partial fill tracking
            const highestReach = fc.high;
            const fillDistance = highestReach - gapLower;
            const totalGap = gapUpper - gapLower;
            if (totalGap > 0) {
              partialFillPct = Math.max(partialFillPct, Math.min(100, (fillDistance / totalGap) * 100));
            }
          }
        }

        // Distance from current price to gap edges
        const distToGap = gapDirection === 'up'
          ? (currentPrice - gapLower) / currentPrice   // How far below current price is the gap floor
          : (gapUpper - currentPrice) / currentPrice;   // How far above current price is the gap ceiling

        gaps.push({
          fridayClose,
          sundayOpen,
          fridayCloseTime,
          sundayOpenTime: c.time,
          direction: gapDirection,
          gapSize: Math.abs(gapSize),
          gapPct: gapPct * 100,
          gapUpper,
          gapLower,
          filled,
          filledAt,
          filledTime,
          partialFillPct: Math.round(partialFillPct),
          distToGapPct: distToGap * 100,
          ageHours: Math.round((currentPrice ? (Date.now() / 1000 - c.time) : 0) / 3600),
        });
      }

      fridayClose = null;
      fridayCloseTime = null;
    }

    // Reset on non-weekend candle if we had a stale Friday close
    if (phase === null && fridayClose !== null) {
      // We passed through the weekend without seeing an open candle
      // This can happen with data gaps — just reset
      fridayClose = null;
      fridayCloseTime = null;
    }
  }

  // Return only the most recent gaps, newest first
  return gaps.slice(-maxGaps).reverse();
}

/**
 * Predict whether unfilled CME gaps will close, using market structure.
 *
 * Factors considered:
 *   1. Historical fill rate (~77% fill within 2 weeks)
 *   2. Current trend alignment (does the trend point toward the gap?)
 *   3. Order Block presence near the gap zone
 *   4. Gap age (older unfilled gaps have slightly lower probability)
 *   5. Partial fill progress (more filled = higher chance of completion)
 *   6. Distance from current price (closer = more likely)
 *
 * @param {Array} gaps - Output of detectCMEGaps
 * @param {string|null} direction - Current trade direction ('long'/'short'/null)
 * @param {string} trendBias - Higher TF trend ('bullish'/'bearish'/'ranging')
 * @param {Array} orderBlocks - All detected order blocks
 * @param {number} currentPrice - Current price
 * @returns {Object} CME gap analysis result
 */
export function analyzeCMEGaps(gaps, direction, trendBias, orderBlocks, currentPrice) {
  if (!gaps || gaps.length === 0) {
    return {
      hasUnfilledGaps: false,
      unfilledGaps: [],
      filledGaps: [],
      nearestGap: null,
      gapFillBias: null,
      summary: 'No CME gaps detected',
    };
  }

  const unfilledGaps = gaps.filter(g => !g.filled);
  const filledGaps = gaps.filter(g => g.filled).slice(0, 3); // Show last 3 filled

  // Predict fill probability for each unfilled gap
  const analyzed = unfilledGaps.map(gap => {
    let probability = 65; // Base: historical CME gap fill rate is ~77%, discount for uncertainty
    const factors = [];

    // Factor 1: Trend alignment — does the trend push price toward the gap?
    const trendTowardGap =
      (gap.direction === 'up' && trendBias === 'bearish') ||   // Gap up + bearish trend → price heading down toward gap
      (gap.direction === 'down' && trendBias === 'bullish');     // Gap down + bullish trend → price heading up toward gap

    if (trendTowardGap) {
      probability += 15;
      factors.push('Trend pushes price toward gap (+15%)');
    } else if (
      (gap.direction === 'up' && trendBias === 'bullish') ||
      (gap.direction === 'down' && trendBias === 'bearish')
    ) {
      probability -= 10;
      factors.push('Trend moves price away from gap (-10%)');
    }

    // Factor 2: Trade direction alignment
    const tradeTowardGap =
      (gap.direction === 'up' && direction === 'short') ||     // Gap up + short direction → filling gap
      (gap.direction === 'down' && direction === 'long');       // Gap down + long direction → filling gap

    if (tradeTowardGap) {
      probability += 10;
      factors.push('Active trade aims toward gap fill (+10%)');
    }

    // Factor 3: Order block near gap zone — institutional interest
    const obNearGap = (orderBlocks || []).some(ob => {
      const obMid = (ob.upperBound + ob.lowerBound) / 2;
      return obMid >= gap.gapLower * 0.995 && obMid <= gap.gapUpper * 1.005;
    });
    if (obNearGap) {
      probability += 8;
      factors.push('Order Block near gap zone (+8%)');
    }

    // Factor 4: Proximity — closer gaps more likely to fill
    if (gap.distToGapPct < 1) {
      probability += 10;
      factors.push('Gap very close to price (+10%)');
    } else if (gap.distToGapPct < 3) {
      probability += 5;
      factors.push('Gap within 3% of price (+5%)');
    } else if (gap.distToGapPct > 8) {
      probability -= 10;
      factors.push('Gap far from price (-10%)');
    }

    // Factor 5: Partial fill momentum
    if (gap.partialFillPct > 70) {
      probability += 10;
      factors.push(`${gap.partialFillPct}% already filled → momentum (+10%)`);
    } else if (gap.partialFillPct > 40) {
      probability += 5;
      factors.push(`${gap.partialFillPct}% partially filled (+5%)`);
    }

    // Factor 6: Age penalty — very old unfilled gaps less likely
    if (gap.ageHours > 336) { // > 2 weeks
      probability -= 8;
      factors.push('Gap older than 2 weeks (-8%)');
    } else if (gap.ageHours > 672) { // > 4 weeks
      probability -= 15;
      factors.push('Gap older than 4 weeks (-15%)');
    }

    // Clamp
    probability = Math.max(10, Math.min(95, probability));

    const tier = probability >= 80 ? 'VERY_HIGH'
               : probability >= 65 ? 'HIGH'
               : probability >= 45 ? 'MODERATE'
               : 'LOW';

    return {
      ...gap,
      fillProbability: Math.round(probability),
      fillTier: tier,
      factors,
    };
  });

  // Sort by proximity (closest first)
  analyzed.sort((a, b) => a.distToGapPct - b.distToGapPct);
  const nearestGap = analyzed[0] || null;

  // Determine if the gap creates a directional bias
  let gapFillBias = null;
  if (nearestGap && nearestGap.fillProbability >= 60) {
    gapFillBias = nearestGap.direction === 'up' ? 'bearish' : 'bullish';
  }

  // Summary line for logs/UI
  let summary = '';
  if (analyzed.length === 0) {
    summary = 'All CME gaps filled ✓';
  } else if (analyzed.length === 1) {
    const g = analyzed[0];
    summary = `1 unfilled gap ${g.direction === 'up' ? '↑' : '↓'} $${g.gapLower.toFixed(0)}–$${g.gapUpper.toFixed(0)} (${g.fillProbability}% fill)`;
  } else {
    summary = `${analyzed.length} unfilled gaps — nearest: $${nearestGap.gapLower.toFixed(0)}–$${nearestGap.gapUpper.toFixed(0)} (${nearestGap.fillProbability}%)`;
  }

  return {
    hasUnfilledGaps: analyzed.length > 0,
    unfilledGaps: analyzed,
    filledGaps,
    nearestGap,
    gapFillBias,
    summary,
  };
}
