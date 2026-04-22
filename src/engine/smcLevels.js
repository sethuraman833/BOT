// ─────────────────────────────────────────────────────────
//  SMC Reference Levels — PDH/PDL, Asian Range, Weekly Open
//  These are the primary institutional reference points that
//  London specifically targets every single day.
// ─────────────────────────────────────────────────────────

/**
 * Calculate Previous Day High / Low from daily candles.
 * PDH/PDL are the #1 SMC liquidity targets at London Open.
 */
export function calcPDHL(dailyCandles) {
  if (!dailyCandles || dailyCandles.length < 2) return null;
  // The second-to-last candle is the previous completed day
  const prev = dailyCandles[dailyCandles.length - 2];
  const today = dailyCandles[dailyCandles.length - 1];
  return {
    pdh: prev.high,
    pdl: prev.low,
    pdClose: prev.close,
    todayOpen: today.open,
    description: `PDH: ${prev.high.toFixed(2)} | PDL: ${prev.low.toFixed(2)}`,
  };
}

/**
 * Calculate Asian Session Range from 1H candles.
 * Asian session = 00:00–07:00 UTC
 * The Asian high and low are classic liquidity pools that London targets.
 * Use as: potential TP zones OR sweep targets for long/short entries.
 */
export function calcAsianRange(h1Candles) {
  if (!h1Candles || h1Candles.length < 8) return null;

  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    0, 0, 0
  ) / 1000;
  const asianEnd = utcMidnight + 7 * 3600; // 07:00 UTC

  // Filter candles that fall inside today's Asian session (00–07 UTC)
  const asianCandles = h1Candles.filter(c =>
    c.time >= utcMidnight && c.time < asianEnd
  );

  if (asianCandles.length === 0) return null;

  const asianHigh = Math.max(...asianCandles.map(c => c.high));
  const asianLow  = Math.min(...asianCandles.map(c => c.low));
  const midpoint  = (asianHigh + asianLow) / 2;
  const rangeSize = asianHigh - asianLow;

  return {
    high: asianHigh,
    low: asianLow,
    midpoint,
    rangeSize,
    candleCount: asianCandles.length,
    description: `Asian Range: ${asianLow.toFixed(2)}–${asianHigh.toFixed(2)} (${rangeSize.toFixed(2)} pts)`,
    // London almost always sweeps one side of this range
    sweepTargetIfBullish: asianLow,  // Sweep lows → reverse long
    sweepTargetIfBearish: asianHigh, // Sweep highs → reverse short
  };
}

/**
 * Calculate Weekly Open Level.
 * Institutional reference: price gravitates back to weekly open mid-week.
 * Missing this level means missing a key magnet for price.
 */
export function calcWeeklyOpen(dailyCandles) {
  if (!dailyCandles || dailyCandles.length < 7) return null;

  // Find the Monday candle of the current week
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayMidnight = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday,
    0, 0, 0
  ) / 1000;

  // Find the candle at or after Monday midnight
  const weeklyOpenCandle = dailyCandles.find(c => c.time >= mondayMidnight);
  if (!weeklyOpenCandle) return null;

  return {
    level: weeklyOpenCandle.open,
    weekStart: new Date(mondayMidnight * 1000).toISOString().slice(0, 10),
    description: `Weekly Open: ${weeklyOpenCandle.open.toFixed(2)}`,
  };
}

/**
 * Check Premium / Discount Framework.
 * Foundational SMC logic:
 *   - Buy ONLY from Discount zones (below 50% of dealing range)
 *   - Sell ONLY from Premium zones (above 50% of dealing range)
 *
 * Dealing Range = most recent swing high to swing low on 4H
 */
export function checkPremiumDiscount(currentPrice, swingHigh, swingLow) {
  if (!swingHigh || !swingLow) return null;

  const range      = swingHigh - swingLow;
  const midpoint   = swingLow + range * 0.5;
  const equilibrium = midpoint;

  // OB premium zone: above 50%
  // OTE/Discount zone: 61.8%–78.6% retracement (below 38.2% of range from high)
  const premiumZoneStart  = midpoint;
  const discountZoneEnd   = midpoint;
  const oteLow            = swingHigh - range * 0.786; // 78.6% retracement
  const oteHigh           = swingHigh - range * 0.618; // 61.8% retracement
  const pct = ((currentPrice - swingLow) / range) * 100;

  const zone = currentPrice > midpoint ? 'premium' : 'discount';
  const inOTE = currentPrice >= oteLow && currentPrice <= oteHigh;

  return {
    zone,            // 'premium' or 'discount'
    inOTE,           // true if in 61.8–78.6% retracement (optimal entry)
    pct: pct.toFixed(1), // percentage position within range
    midpoint,
    oteLow,
    oteHigh,
    swingHigh,
    swingLow,
    description: `Price is in ${zone.toUpperCase()} zone (${pct.toFixed(0)}% of range). ${
      inOTE ? '🎯 In OTE zone (61.8–78.6%).' : ''
    } ${zone === 'premium' ? 'Only shorts valid from premium.' : 'Only longs valid from discount.'}`,
  };
}

/**
 * Detect if a BOS is likely Inducement (fake) rather than real.
 *
 * Inducement signature:
 *   1. A BOS that sweeps a previous minor high/low by a small margin (<0.15%)
 *   2. No displacement candle (large-bodied) following it
 *   3. Price quickly retraces back into the origin range
 *
 * NOTE: Real BOS has BOTH a clean sweep AND a strong displacement candle.
 */
export function detectInducement(candles, structureShifts) {
  if (!structureShifts || structureShifts.length === 0) return [];

  const INDUCEMENT_THRESHOLD = 0.0015; // 0.15% — tiny sweep = fake
  const DISPLACEMENT_RATIO   = 1.5;    // Body must be 1.5× average body size

  const avgBody = candles.slice(-20).reduce((sum, c) =>
    sum + Math.abs(c.close - c.open), 0) / 20;

  return structureShifts.map(shift => {
    // Check if sweep margin was very small (inducement telltale)
    const sweepMarginPct = shift.exceedPercent
      ? parseFloat(shift.exceedPercent) / 100
      : INDUCEMENT_THRESHOLD + 1; // If no exceedPercent, assume real

    const isSmallSweep = sweepMarginPct < INDUCEMENT_THRESHOLD;

    // Check if displacement candle exists after the shift
    const shiftIdx = candles.findIndex(c => c.time === shift.time);
    let hasStrongDisplacement = false;
    if (shiftIdx >= 0 && shiftIdx < candles.length - 1) {
      const nextCandle = candles[shiftIdx + 1];
      const body = Math.abs(nextCandle.close - nextCandle.open);
      hasStrongDisplacement = body > avgBody * DISPLACEMENT_RATIO;
    }

    const likelyInducement = isSmallSweep && !hasStrongDisplacement;

    return {
      ...shift,
      likelyInducement,
      isSmallSweep,
      hasStrongDisplacement,
      warning: likelyInducement
        ? '⚠️ Possible INDUCEMENT — small sweep, no displacement candle. Wait for second structure shift.'
        : null,
    };
  });
}

/**
 * Check daily loss rules (Two-Loss Stop + Hard Floor).
 * Pass sessionLosses (count of losing trades today) and
 * accountBalance with baselineBalance.
 */
export function checkDailyRules(sessionLosses = 0, accountBalance = null, baselineBalance = null) {
  const rules = {
    twoLossRule: {
      triggered: sessionLosses >= 2,
      losses: sessionLosses,
      description: sessionLosses >= 2
        ? `🛑 TWO-LOSS RULE: ${sessionLosses} losses this session. STOP TRADING for today.`
        : `Losses today: ${sessionLosses}/2`,
    },
    hardFloor: {
      triggered: false,
      description: 'Hard Floor: Not triggered',
    },
    maxTrades: {
      triggered: sessionLosses >= 3,
      description: sessionLosses >= 3
        ? '🛑 MAX TRADES LIMIT: 3 trades reached this session.'
        : `Trades taken: ${sessionLosses}/3 maximum`,
    },
  };

  if (accountBalance !== null && baselineBalance !== null && baselineBalance > 0) {
    const floorLevel = baselineBalance * 0.85;
    const triggered  = accountBalance < floorLevel;
    rules.hardFloor = {
      triggered,
      currentBalance: accountBalance,
      floorLevel: floorLevel.toFixed(2),
      description: triggered
        ? `🚨 HARD FLOOR BREACHED: Account at ${((accountBalance / baselineBalance) * 100).toFixed(1)}% of baseline. STOP LIVE TRADING.`
        : `Account at ${((accountBalance / baselineBalance) * 100).toFixed(1)}% of baseline (Floor: 85%)`,
    };
  }

  const canTrade = !rules.twoLossRule.triggered &&
                   !rules.hardFloor.triggered &&
                   !rules.maxTrades.triggered;

  return { ...rules, canTrade };
}
