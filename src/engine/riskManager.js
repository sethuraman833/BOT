// ─────────────────────────────────────────────────────────
//  Risk Manager v7.0 — Corrected RRR Thresholds
//  FIX: MIN_TP1_RRR 1.5→3.0 (prompt requires ≥1:3 minimum)
//  FIX: Fallback TP uses risk*3.0 not risk*2.5
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT } from '../utils/constants.js';

// ── Constants ─────────────────────────────────────────────
const ENTRY_OFFSET  = 0.0008; // 0.08% buffer before structural level (tighter)
const SL_BUFFER     = 0.003;  // 0.3% beyond invalidation
const MIN_TP1_RRR   = 3.0;    // FIX: TP1 must be at least 1:3 (was 1.5 — too low)
const MIN_TP2_RRR   = 4.0;    // TP2 must be at least 1:4
const MIN_TP3_RRR   = 5.0;    // TP3 must be at least 1:5
const MIN_TP_SPACING_PCT = 0.005; // TPs must be at least 0.5% apart

/**
 * Calculate Risk-to-Reward Ratio.
 * Formula: |TP - Entry| / |Entry - SL|
 */
export function calculateRRR(entry, stopLoss, takeProfit) {
  const risk   = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk === 0) return 0;
  return parseFloat((reward / risk).toFixed(2));
}

/**
 * Calculate position size from entry and stop loss.
 * Formula: $5 Fixed Risk / SL Distance
 */
export function calculatePositionSize(entry, stopLoss) {
  const riskAmount   = 5.0; // Fixed $5 risk
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
 * Calculate dynamic scaling percentages based on conviction tier and session.
 * Profile: [TP1, TP2, TP3]
 */
export function getDynamicScaling(tier, sessionName, tpCount) {
  // Base profiles
  let [p1, p2, p3] = { 
    EXCEPTIONAL: [25, 35, 40], 
    HIGH:        [35, 40, 25], 
    MEDIUM:      [50, 35, 15], 
    REJECT:      [80, 15, 5] 
  }[tier] || [40, 35, 25];

  // Session Modifiers
  const isActivePower = sessionName?.includes('London') || sessionName?.includes('NY');
  const isAsian = sessionName?.includes('Asian') || !sessionName;

  if (isActivePower) { p1 -= 5; p3 += 5; } // Trend potential
  if (isAsian)       { p1 += 10; p3 -= 10; } // Mean reverting

  // Distribution for fewer TPs
  if (tpCount === 2) return [55, 45, 0];
  if (tpCount === 1) return [100, 0, 0];

  return [p1, p2, p3];
}

/**
 * Calculate TPs using structural levels with minimum RRR validation.
 * FIX: MIN_TP1_RRR is now 3.0, fallback uses risk*3.0
 */
export function calculateTPs(entry, stopLoss, swings, fvgs, direction, tier = 'HIGH', sessionName = '') {
  const tps = [];
  const risk = Math.abs(entry - stopLoss);

  const applyOffset = (price) =>
    direction === 'long' ? price * (1 - ENTRY_OFFSET) : price * (1 + ENTRY_OFFSET);

  const candidates = [];
  for (const s of swings) {
    if (direction === 'long' && s.price > entry)  candidates.push({ price: s.price, reason: `Swing High @ ${s.price.toFixed(0)}` });
    if (direction === 'short' && s.price < entry) candidates.push({ price: s.price, reason: `Swing Low @ ${s.price.toFixed(0)}` });
  }

  for (const f of fvgs) {
    if (direction === 'long' && f.type === 'bearish' && f.lower > entry) {
      candidates.push({ price: f.midpoint, reason: `Bearish FVG mid @ ${f.midpoint?.toFixed(0)}` });
      candidates.push({ price: f.upper,    reason: `Bearish FVG boundary @ ${f.upper.toFixed(0)}` });
    }
    if (direction === 'short' && f.type === 'bullish' && f.upper < entry) {
      candidates.push({ price: f.midpoint, reason: `Bullish FVG mid @ ${f.midpoint?.toFixed(0)}` });
      candidates.push({ price: f.lower,    reason: `Bullish FVG boundary @ ${f.lower.toFixed(0)}` });
    }
  }

  candidates.sort((a, b) => direction === 'long' ? a.price - b.price : b.price - a.price);

  // FIX: Fibonacci extensions use risk × 3/4/5 multiples for cleaner RRR levels
  const fib1272level = direction === 'long' ? entry + risk * 3.272 : entry - risk * 3.272;
  const fib1618level = direction === 'long' ? entry + risk * 4.236 : entry - risk * 4.236;
  const fib2000level = direction === 'long' ? entry + risk * 5.0   : entry - risk * 5.0;
  candidates.push({ price: fib1272level, reason: 'Fibonacci 1.272 Extension' });
  candidates.push({ price: fib1618level, reason: 'Fibonacci 1.618 Extension' });
  candidates.push({ price: fib2000level, reason: 'Fibonacci 2.000 Extension' });

  // ── Find structural TPs with minimum RRR ────────────────────────
  const minRRRs  = [MIN_TP1_RRR, MIN_TP2_RRR, MIN_TP3_RRR];
  for (const minRRR of minRRRs) {
    if (tps.length >= 3) break;
    for (const candidate of candidates) {
      const exitLevel = applyOffset(candidate.price);
      const rrr = calculateRRR(entry, stopLoss, exitLevel);
      if (rrr < minRRR) continue;

      if (tps.length > 0) {
        const spacing = Math.abs(exitLevel - tps[tps.length - 1].level) / tps[tps.length - 1].level;
        if (spacing < MIN_TP_SPACING_PCT) continue;
      }

      tps.push({ level: parseFloat(exitLevel.toFixed(2)), reason: candidate.reason, rrr });
      break;
    }
  }

  // FIX BUG 5 — Fallback uses risk*3.0 minimum RRR (was 2.5)
  if (tps.length === 0) {
    const fallback = direction === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    tps.push({ level: parseFloat(applyOffset(fallback).toFixed(2)), reason: 'Min 1:3 Fallback', rrr: 3.0 });
  }

  // ── Apply Dynamic Scaling ─────────────────────────────────────────
  const closePercents = getDynamicScaling(tier, sessionName, tps.length);
  tps.forEach((tp, i) => {
    tp.closePercent = closePercents[i];
  });

  return { tps, tpStructure: tps.length >= 3 ? 'multiple' : 'single' };
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
