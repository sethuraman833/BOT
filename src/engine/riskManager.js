// ─────────────────────────────────────────────────────────
//  Risk Manager — 3-Layer Smart SL + Smart TP Ladder
//  Position Sizing, OTE Entry Refinement
// ─────────────────────────────────────────────────────────

import { calculateOTE, fibExtension, findSwingPoints } from './indicators.js';

/**
 * Calculate 3-Layer Smart Stop Loss.
 *
 * Layer 1: Structural invalidation point
 * Layer 2: Liquidity buffer (0.25-0.40% beyond)
 * Layer 3: Imbalance void check
 */
export function calculateSmartSL(direction, rawInvalidation, fvgs = []) {
  // Layer 1: Raw invalidation
  const rawSL = rawInvalidation;

  // Layer 2: Liquidity buffer (0.3% default)
  const bufferPercent = 0.003;
  let layeredSL;
  if (direction === 'long') {
    layeredSL = rawSL * (1 - bufferPercent);
  } else {
    layeredSL = rawSL * (1 + bufferPercent);
  }

  // Layer 3: Imbalance void check
  let finalSL = layeredSL;
  fvgs.forEach(fvg => {
    if (direction === 'long' && fvg.type === 'bullish' && fvg.status === 'unfilled') {
      // If there's an unfilled FVG below our SL, move SL below it
      if (fvg.lower < layeredSL && fvg.lower > layeredSL * 0.97) {
        finalSL = fvg.lower * (1 - bufferPercent);
      }
    }
    if (direction === 'short' && fvg.type === 'bearish' && fvg.status === 'unfilled') {
      if (fvg.upper > layeredSL && fvg.upper < layeredSL * 1.03) {
        finalSL = fvg.upper * (1 + bufferPercent);
      }
    }
  });

  return {
    raw: rawSL,
    withBuffer: layeredSL,
    final: finalSL,
    layers: {
      layer1: rawSL,
      layer2: layeredSL,
      layer3: finalSL,
    }
  };
}

/**
 * Calculate Smart TP Ladder.
 * Priority 1: Nearest liquidity pool (equal highs/lows)
 * Priority 2: Previous swing high/low (1H/4H)
 * Priority 3: Higher TF FVG boundary
 * Priority 4: Fibonacci extension
 */
export function calculateSmartTP(direction, entry, swingPoints4H, swingPoints1H, fvgs4H, swingLeg) {
  const tps = [];
  const offset = direction === 'long' ? -0.0012 : 0.0012; // 0.12% offset before target

  // Priority 1: Nearest liquidity pool (swing highs for longs, lows for shorts)
  if (direction === 'long') {
    const targets = [...swingPoints4H.swingHighs, ...swingPoints1H.swingHighs]
      .filter(s => s.price > entry)
      .sort((a, b) => a.price - b.price);
    if (targets.length > 0) {
      tps.push({
        level: targets[0].price * (1 + offset),
        reason: 'Nearest liquidity pool — swing high',
        priority: 1,
      });
    }
    if (targets.length > 1) {
      tps.push({
        level: targets[1].price * (1 + offset),
        reason: 'Previous swing high (1H/4H)',
        priority: 2,
      });
    }
  } else {
    const targets = [...swingPoints4H.swingLows, ...swingPoints1H.swingLows]
      .filter(s => s.price < entry)
      .sort((a, b) => b.price - a.price);
    if (targets.length > 0) {
      tps.push({
        level: targets[0].price * (1 - offset),
        reason: 'Nearest liquidity pool — swing low',
        priority: 1,
      });
    }
    if (targets.length > 1) {
      tps.push({
        level: targets[1].price * (1 - offset),
        reason: 'Previous swing low (1H/4H)',
        priority: 2,
      });
    }
  }

  // Priority 3: 4H FVG boundary
  const relevantFVGs = fvgs4H.filter(f => f.status === 'unfilled');
  relevantFVGs.forEach(fvg => {
    if (direction === 'long' && fvg.type === 'bearish' && fvg.upper > entry) {
      tps.push({
        level: fvg.upper * (1 + offset),
        reason: 'Higher TF FVG upper boundary',
        priority: 3,
      });
    }
    if (direction === 'short' && fvg.type === 'bullish' && fvg.lower < entry) {
      tps.push({
        level: fvg.lower * (1 - offset),
        reason: 'Higher TF FVG lower boundary',
        priority: 3,
      });
    }
  });

  // Priority 4: Fibonacci extensions
  if (swingLeg && tps.length < 3) {
    const ext = fibExtension(swingLeg.low, swingLeg.high);
    if (direction === 'long') {
      tps.push({
        level: ext.ext_1272,
        reason: 'Fibonacci 1.272 extension',
        priority: 4,
      });
    } else {
      // For shorts, extension goes below
      const diff = swingLeg.high - swingLeg.low;
      tps.push({
        level: swingLeg.low - diff * 0.272,
        reason: 'Fibonacci 1.272 extension',
        priority: 4,
      });
    }
  }

  // Sort by priority and take top 3
  tps.sort((a, b) => a.priority - b.priority);
  return tps.slice(0, 3);
}

/**
 * Calculate position size based on risk, accounting for spread + slippage buffer.
 *
 * SPREAD BUFFER: On BTC/XAU with tight SLs, a 2-3 point spread at entry
 * materially distorts actual risk. We add 0.05% of entry as a safety margin.
 *
 * @param {number} entry       – planned entry price
 * @param {number} stopLoss    – stop loss price
 * @param {number} riskAmount  – $ risk per trade
 * @param {string} symbol      – e.g. 'BTCUSDT'
 */
export function calculatePositionSize(entry, stopLoss, riskAmount, symbol = '') {
  // Spread buffer: 0.05% for BTC/ETH, 0.08% for XAU (wider spread)
  const spreadPct = symbol.includes('XAU') ? 0.0008 : 0.0005;
  const spreadBuffer = entry * spreadPct;

  const slDistance = Math.abs(entry - stopLoss) + spreadBuffer;
  if (slDistance === 0) return 0;
  return riskAmount / slDistance;
}

/**
 * Calculate Risk-Reward Ratio.
 */
export function calculateRRR(entry, stopLoss, takeProfit) {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk === 0) return 0;
  return reward / risk;
}


/**
 * Refine entry using OTE zone.
 */
export function refineEntryWithOTE(currentPrice, swingLow, swingHigh, zone) {
  const ote = calculateOTE(swingLow, swingHigh);

  // Check if current price is inside OTE zone AND inside the demand/supply zone
  if (currentPrice >= ote.lower && currentPrice <= ote.upper) {
    if (zone && currentPrice >= zone.lower && currentPrice <= zone.upper) {
      return {
        refined: true,
        entry: ote.mid,
        oteZone: ote,
        description: 'Entry refined to OTE zone (61.8-78.6% Fib)',
      };
    }
  }

  return {
    refined: false,
    entry: currentPrice,
    oteZone: ote,
    description: 'OTE not available — using structural entry',
  };
}

/**
 * Build complete trade setup.
 */
export function buildTradeSetup(params) {
  const {
    direction, entry, rawInvalidation, fvgs,
    swingPoints4H, swingPoints1H, fvgs4H,
    swingLeg, riskAmount, currentPrice, symbol,
  } = params;

  // Smart SL
  const sl = calculateSmartSL(direction, rawInvalidation, fvgs);

  // SL distance check (max 2.5%)
  const slDistPercent = Math.abs(entry - sl.final) / entry * 100;
  if (slDistPercent > 2.5) {
    return { valid: false, reason: 'SL distance exceeds 2.5% — rejected', slDistPercent };
  }

  // Smart TP
  const tps = calculateSmartTP(direction, entry, swingPoints4H, swingPoints1H, fvgs4H, swingLeg);
  if (tps.length === 0) {
    return { valid: false, reason: 'No valid TP targets found' };
  }

  // RRR from TP1
  const rrr = calculateRRR(entry, sl.final, tps[0].level);
  
  // (We no longer exit early here so CAUTION setups and UI features get full data)
  // If rrr < 3, the setup is returned, but the tradeAnalyzer will flag it as caution or reject it.

  // Position size
  const positionSize = calculatePositionSize(entry, sl.final, riskAmount, symbol);

  // Min position size check
  const minSize = symbol.includes('BTC') ? 0.00001 : 0.001;
  const isTooSmall = positionSize < minSize;
  
  // We still consider the setup "valid" structurally so the UI can display it
  // tradeAnalyzer will handle the final decision.

  // TP structure decision
  const tpStructure = rrr >= 4 ? 'multiple' : 'single';

  // RRR for each TP
  const tpsWithRRR = tps.map(tp => ({
    ...tp,
    rrr: calculateRRR(entry, sl.final, tp.level),
  }));

  // Breakeven trigger (1.5× SL distance)
  const slDist = Math.abs(entry - sl.final);
  const breakevenTrigger = direction === 'long'
    ? entry + slDist * 1.5
    : entry - slDist * 1.5;

  return {
    valid: true,
    direction,
    entry,
    stopLoss: sl,
    takeProfits: tpStructure === 'single' ? [tpsWithRRR[0]] : tpsWithRRR,
    positionSize,
    rrr,
    slDistPercent,
    tpStructure,
    breakevenTrigger,
    riskAmount,
    symbol,
    management: tpStructure === 'multiple' ? {
      tp1Action: 'Close 40%, move SL to breakeven',
      tp2Action: 'Close 35%, trail SL to TP1 level',
      tp3Action: 'Close final 25%',
    } : {
      action: 'Hold full position to TP',
    },
  };
}
