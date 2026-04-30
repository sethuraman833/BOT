// ─────────────────────────────────────────────────────────
//  Risk Manager — Position Sizing, SL/TP, RRR
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT } from '../utils/constants.js';
import { fibExtension } from './oteCalculator.js';

/**
 * Calculate position size from entry and stop loss.
 * Hard-capped at $5 risk.
 */
export function calculatePositionSize(entry, stopLoss) {
  const slDistance = Math.abs(entry - stopLoss);
  if (slDistance === 0) return 0;
  return Math.max(RISK_AMOUNT / slDistance, 0);
}

/**
 * Calculate smart stop loss with 3-layer defense.
 * Layer 1: Structural invalidation (OB boundary)
 * Layer 2: 0.3% liquidity buffer
 * Layer 3: Check for FVG void behind SL
 */
export function calculateSmartSL(invalidationLevel, direction, fvgs) {
  // Layer 1: Raw structural level
  const layer1 = invalidationLevel;

  // Layer 2: Add 0.3% buffer beyond invalidation
  const buffer = 0.003;
  const layer2 = direction === 'long'
    ? layer1 * (1 - buffer)
    : layer1 * (1 + buffer);

  // Layer 3: If there's an FVG void behind the SL, push to far side
  let layer3 = layer2;
  if (fvgs && fvgs.length > 0) {
    for (const fvg of fvgs) {
      if (direction === 'long' && fvg.type === 'bullish' && fvg.lower < layer2 && fvg.upper > layer2) {
        layer3 = fvg.lower * (1 - buffer);
        break;
      }
      if (direction === 'short' && fvg.type === 'bearish' && fvg.upper > layer2 && fvg.lower < layer2) {
        layer3 = fvg.upper * (1 + buffer);
        break;
      }
    }
  }

  return {
    value: layer3,
    rawInvalidation: invalidationLevel,
    buffer: `${(buffer * 100).toFixed(1)}%`,
    layer1,
    layer2,
    layer3,
  };
}

/**
 * Calculate RRR from entry, SL, TP.
 */
export function calculateRRR(entry, stopLoss, takeProfit) {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk === 0) return 0;
  return reward / risk;
}

/**
 * Calculate Take Profit levels from structural targets.
 * TP1: Nearest liquidity pool / equal highs/lows
 * TP2: Previous unmitigated swing on 1H/4H
 * TP3: Far FVG boundary or Fib extension
 */
export function calculateTPs(entry, stopLoss, swings, fvgs, direction) {
  const offset = 0.0012; // 0.12% before the structural level
  const tps = [];

  // Sort swings by proximity to entry
  const validSwings = swings
    .filter(s => direction === 'long' ? s.price > entry : s.price < entry)
    .sort((a, b) => direction === 'long'
      ? a.price - b.price
      : b.price - a.price
    );

  // TP1: Nearest swing target
  if (validSwings.length > 0) {
    const target = validSwings[0].price;
    tps.push({
      level: direction === 'long' ? target * (1 - offset) : target * (1 + offset),
      reason: 'Nearest swing liquidity pool',
      rrr: calculateRRR(entry, stopLoss, target),
      closePercent: 40,
    });
  }

  // TP2: Second swing target
  if (validSwings.length > 1) {
    const target = validSwings[1].price;
    tps.push({
      level: direction === 'long' ? target * (1 - offset) : target * (1 + offset),
      reason: 'Unmitigated swing level',
      rrr: calculateRRR(entry, stopLoss, target),
      closePercent: 35,
    });
  }

  // TP3: FVG boundary or Fib extension
  const fvgTarget = fvgs.find(f =>
    direction === 'long' ? f.type === 'bearish' && f.upper > entry : f.type === 'bullish' && f.lower < entry
  );

  if (fvgTarget) {
    const target = direction === 'long' ? fvgTarget.upper : fvgTarget.lower;
    tps.push({
      level: direction === 'long' ? target * (1 - offset) : target * (1 + offset),
      reason: '4H FVG boundary target',
      rrr: calculateRRR(entry, stopLoss, target),
      closePercent: 25,
    });
  } else if (tps.length < 3) {
    // Fallback: Fib 1.272 extension
    const slDist = Math.abs(entry - stopLoss);
    const extLevel = direction === 'long'
      ? entry + slDist * 3.272
      : entry - slDist * 3.272;
    tps.push({
      level: extLevel,
      reason: 'Fibonacci 1.272 extension',
      rrr: calculateRRR(entry, stopLoss, extLevel),
      closePercent: 25,
    });
  }

  // Determine TP structure
  const tpStructure = tps.length > 0 && tps[0].rrr >= 4.0 ? 'multiple' : 'single';

  return { tps, tpStructure };
}

/**
 * Calculate the price level at which to move SL to breakeven.
 * Rule: 1.5× SL distance from entry.
 */
export function calculateBreakevenMove(entry, stopLoss) {
  const slDistance = Math.abs(entry - stopLoss);
  const direction = entry > stopLoss ? 1 : -1;
  return entry + direction * slDistance * 1.5;
}
