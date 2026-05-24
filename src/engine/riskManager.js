// ─────────────────────────────────────────────────────────
//  Risk Manager v8.1 — Corrected TP Placement
//  FIX: TP anchors use clean 3x/3.5x/4x multiples (not fib 3.272/4.236)
//  FIX: Structural candidates capped at MAX_TP_MULTIPLIER x risk
//  FIX: Nearest qualifying target always wins
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT } from '../utils/constants.js';

// ── Constants ─────────────────────────────────────────────
const ENTRY_OFFSET       = 0.0008; // 0.08% buffer inside structural level
const SL_BUFFER          = 0.003;  // 0.3% beyond invalidation
const MIN_TP1_RRR        = 3.0;    // TP1 must reach at least 1:3
const MIN_TP2_RRR        = 3.5;    // TP2 must reach at least 1:3.5
const MIN_TP3_RRR        = 4.0;    // TP3 must reach at least 1:4
const MAX_TP_MULTIPLIER  = 4.5;    // Never place TP beyond 4.5x risk — prevents absurdly far targets
const MIN_TP_SPACING_PCT = 0.004;  // TPs must be at least 0.4% apart

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
  // Cap: never place a TP beyond this distance from entry
  const maxTpDistance = risk * MAX_TP_MULTIPLIER;

  const applyOffset = (price) =>
    direction === 'long' ? price * (1 - ENTRY_OFFSET) : price * (1 + ENTRY_OFFSET);

  const candidates = [];

  // ── 1. Structural swing levels (capped at MAX_TP_MULTIPLIER × risk) ──
  for (const s of swings) {
    if (direction === 'long' && s.price > entry) {
      if (s.price - entry <= maxTpDistance)
        candidates.push({ price: s.price, reason: `Swing High @ ${s.price.toFixed(0)}` });
    }
    if (direction === 'short' && s.price < entry) {
      if (entry - s.price <= maxTpDistance)
        candidates.push({ price: s.price, reason: `Swing Low @ ${s.price.toFixed(0)}` });
    }
  }

  // ── 2. FVG levels (capped) ─────────────────────────────────────────
  for (const f of fvgs) {
    if (direction === 'long' && f.type === 'bearish' && f.lower > entry) {
      if (f.lower - entry <= maxTpDistance)
        candidates.push({ price: f.midpoint, reason: `Bearish FVG @ ${f.midpoint?.toFixed(0)}` });
    }
    if (direction === 'short' && f.type === 'bullish' && f.upper < entry) {
      if (entry - f.upper <= maxTpDistance)
        candidates.push({ price: f.midpoint, reason: `Bullish FVG @ ${f.midpoint?.toFixed(0)}` });
    }
  }

  // ── 3. Clean RRR anchors (guaranteed fallbacks, always in range) ───
  // These replace the old fibonacci extensions (3.272x, 4.236x) which placed
  // TPs at awkward multiples. Clean anchors ensure the NEAREST qualifying
  // target wins: if no structural level is between entry and 3.0x risk,
  // TP1 lands exactly at 3:1 — not at a 4H swing low at 4.31x.
  const anchor1 = direction === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;  // 1:3 minimum
  const anchor2 = direction === 'long' ? entry + risk * 3.5 : entry - risk * 3.5;  // 1:3.5
  const anchor3 = direction === 'long' ? entry + risk * 4.0 : entry - risk * 4.0;  // 1:4
  candidates.push({ price: anchor1, reason: '1:3 RRR Target'   });
  candidates.push({ price: anchor2, reason: '1:3.5 RRR Target' });
  candidates.push({ price: anchor3, reason: '1:4 RRR Target'   });

  // Sort: LONG ascending (closest first), SHORT descending (highest price = closest first)
  candidates.sort((a, b) => direction === 'long' ? a.price - b.price : b.price - a.price);

  // ── Find TPs with minimum RRR, nearest qualifying target wins ─────
  const minRRRs = [MIN_TP1_RRR, MIN_TP2_RRR, MIN_TP3_RRR];
  for (const minRRR of minRRRs) {
    if (tps.length >= 3) break;
    for (const candidate of candidates) {
      // Skip if already used as a previous TP (within $1)
      if (tps.some(t => Math.abs(t.level - candidate.price) < 1)) continue;

      const exitLevel = applyOffset(candidate.price);
      const rrr = calculateRRR(entry, stopLoss, exitLevel);
      if (rrr < minRRR) continue;

      // Ensure minimum spacing between consecutive TPs
      if (tps.length > 0) {
        const spacing = Math.abs(exitLevel - tps[tps.length - 1].level) / tps[tps.length - 1].level;
        if (spacing < MIN_TP_SPACING_PCT) continue;
      }

      tps.push({ level: parseFloat(exitLevel.toFixed(2)), reason: candidate.reason, rrr });
      break;
    }
  }

  // Hard fallback (should almost never trigger given anchor candidates above)
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
