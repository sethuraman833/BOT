// ─────────────────────────────────────────────────────────
//  Risk Manager v6.1 — Structurally-Grounded RRR Engine
//  Fixed: TP offset before RRR, minimum RRR per TP, fib extension
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT } from '../utils/constants.js';

// ── Constants ─────────────────────────────────────────────
const ENTRY_OFFSET  = 0.0008; // 0.08% buffer before structural level (tighter)
const SL_BUFFER     = 0.003;  // 0.3% beyond invalidation
const MIN_TP1_RRR   = 1.5;    // TP1 must be at least 1:1.5
const MIN_TP2_RRR   = 2.5;    // TP2 must be at least 1:2.5
const MIN_TP3_RRR   = 4.0;    // TP3 must be at least 1:4.0
const MIN_TP_SPACING_PCT = 0.005; // TPs must be at least 0.5% apart

/**
 * Calculate Risk-to-Reward Ratio.
 * Formula: |TP - Entry| / |Entry - SL|
 * FIXED: RRR is now always calculated against the ACTUAL exit level (with offset applied).
 */
export function calculateRRR(entry, stopLoss, takeProfit) {
  const risk   = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk === 0) return 0;
  return parseFloat((reward / risk).toFixed(2));
}

/**
 * Calculate position size from entry and stop loss.
 * Formula: (Balance * 1%) / SL Distance
 */
export function calculatePositionSize(entry, stopLoss, balance = 10000) {
  const RISK_PERCENT = 0.01; // 1% risk per trade
  const riskAmount   = balance * RISK_PERCENT;
  const slDistance   = Math.abs(entry - stopLoss);
  
  if (slDistance === 0) return 0;
  return parseFloat((riskAmount / slDistance).toFixed(6));
}

/**
 * Calculate smart stop loss with 3-layer defense.
 * Layer 1: Structural invalidation (Order Block boundary)
 * Layer 2: 0.3% liquidity buffer beyond structure
 * Layer 3: Expand to clear any FVG void sitting directly behind SL
 */
export function calculateSmartSL(invalidationLevel, direction, fvgs) {
  const layer1 = invalidationLevel;

  const layer2 = direction === 'long'
    ? layer1 * (1 - SL_BUFFER)
    : layer1 * (1 + SL_BUFFER);

  let layer3 = layer2;
  if (fvgs && fvgs.length > 0) {
    for (const fvg of fvgs) {
      if (direction === 'long' && fvg.type === 'bullish' && fvg.lower < layer2 && fvg.upper > layer2) {
        layer3 = fvg.lower * (1 - SL_BUFFER);
        break;
      }
      if (direction === 'short' && fvg.type === 'bearish' && fvg.upper > layer2 && fvg.lower < layer2) {
        layer3 = fvg.upper * (1 + SL_BUFFER);
        break;
      }
    }
  }

  return {
    value: layer3,
    rawInvalidation: invalidationLevel,
    buffer: `${(SL_BUFFER * 100).toFixed(1)}%`,
    layer1,
    layer2,
    layer3,
  };
}

/**
 * Calculate TPs using structural levels with minimum RRR validation.
 *
 * Priority order:
 *   TP1 → Nearest unfilled FVG midpoint or swing (must be ≥ 1:1.5 RRR)
 *   TP2 → Second swing / FVG boundary    (must be ≥ 1:2.5 RRR)
 *   TP3 → Fib extension 1.272 or 1.618   (must be ≥ 1:4.0 RRR)
 *
 * Each TP is spaced at least 0.5% apart.
 * RRR is calculated against the ACTUAL exit level (post-offset).
 */
export function calculateTPs(entry, stopLoss, swings, fvgs, direction) {
  const tps = [];
  const risk = Math.abs(entry - stopLoss);

  // Helper: apply a small buffer before structural level (so we exit before the crowd)
  const applyOffset = (price) =>
    direction === 'long'
      ? price * (1 - ENTRY_OFFSET)
      : price * (1 + ENTRY_OFFSET);

  // Collect candidate targets: swings + FVG midpoints + FVG boundaries
  const candidates = [];

  // From swings
  for (const s of swings) {
    if (direction === 'long' && s.price > entry)  candidates.push({ price: s.price,    reason: `Swing High @ ${s.price.toFixed(0)}` });
    if (direction === 'short' && s.price < entry) candidates.push({ price: s.price,    reason: `Swing Low @ ${s.price.toFixed(0)}` });
  }

  // From FVGs — use midpoint (most conservative) and far boundary
  for (const f of fvgs) {
    if (direction === 'long' && f.type === 'bearish' && f.lower > entry) {
      candidates.push({ price: f.midpoint, reason: `Bearish FVG mid @ ${f.midpoint?.toFixed(0) || '?'}` });
      candidates.push({ price: f.upper,    reason: `Bearish FVG boundary @ ${f.upper.toFixed(0)}` });
    }
    if (direction === 'short' && f.type === 'bullish' && f.upper < entry) {
      candidates.push({ price: f.midpoint, reason: `Bullish FVG mid @ ${f.midpoint?.toFixed(0) || '?'}` });
      candidates.push({ price: f.lower,    reason: `Bullish FVG boundary @ ${f.lower.toFixed(0)}` });
    }
  }

  // Sort by proximity to entry
  candidates.sort((a, b) =>
    direction === 'long'
      ? a.price - b.price   // ascending: nearest first for longs
      : b.price - a.price   // descending: nearest first for shorts
  );

  // Add Fibonacci extensions as additional candidates
  const fib1272level = direction === 'long' ? entry + risk * 3.272 : entry - risk * 3.272;
  const fib1618level = direction === 'long' ? entry + risk * 4.236 : entry - risk * 4.236;
  candidates.push({ price: fib1272level, reason: 'Fibonacci 1.272 Extension' });
  candidates.push({ price: fib1618level, reason: 'Fibonacci 1.618 Extension' });

  // ── Build TP1 (min 1:1.5) ──────────────────────────────
  const minRRRs  = [MIN_TP1_RRR, MIN_TP2_RRR, MIN_TP3_RRR];
  const closeAmt = [40, 35, 25];

  for (const minRRR of minRRRs) {
    const tpIndex = tps.length;
    if (tpIndex >= 3) break;

    for (const candidate of candidates) {
      if (!candidate.price || isNaN(candidate.price)) continue;

      const exitLevel = applyOffset(candidate.price);
      const rrr = calculateRRR(entry, stopLoss, exitLevel);

      // Must meet minimum RRR for this TP tier
      if (rrr < minRRR) continue;

      // Must be spaced at least 0.5% from last TP
      if (tps.length > 0) {
        const lastTP  = tps[tps.length - 1].level;
        const spacing = Math.abs(exitLevel - lastTP) / lastTP;
        if (spacing < MIN_TP_SPACING_PCT) continue;
      }

      tps.push({
        level:        parseFloat(exitLevel.toFixed(2)),
        reason:       candidate.reason,
        rrr,
        closePercent: closeAmt[tpIndex],
      });
      break; // move on to next TP tier
    }
  }

  // If no structural TP was found at all, use a pure fib extension as fallback
  if (tps.length === 0) {
    const fallback = direction === 'long' ? entry + risk * 2.5 : entry - risk * 2.5;
    tps.push({
      level:        parseFloat(applyOffset(fallback).toFixed(2)),
      reason:       'Minimum 1:2.5 Fallback',
      rrr:          2.5,
      closePercent: 100,
    });
  }

  const tpStructure = tps.length >= 3 ? 'multiple' : 'single';
  return { tps, tpStructure };
}

/**
 * Calculate the price at which to move SL to breakeven.
 * Rule: move when price has moved 1.5× the SL distance in our favour.
 */
export function calculateBreakevenMove(entry, stopLoss) {
  const slDistance = Math.abs(entry - stopLoss);
  const direction  = entry > stopLoss ? 1 : -1;
  return parseFloat((entry + direction * slDistance * 1.5).toFixed(2));
}
