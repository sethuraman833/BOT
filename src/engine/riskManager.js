// ─────────────────────────────────────────────────────────
//  Risk Manager v9.0 — Full Structural TP Engine
//  Fix: Multi-TF swing candidates (primary + structure + bias)
//  Fix: Min spacing 1.0% (was 0.4% → caused near-identical TPs)
//  Fix: Wider fallback anchors 3x/5x/7x (was 3x/3.5x/4x)
//  Fix: Dynamic cap = max(entry×5%, risk×5) so tight SLs
//       don't get forced to extreme % targets
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT } from '../utils/constants.js';

// ── Constants ─────────────────────────────────────────────
const ENTRY_OFFSET       = 0.0008; // 0.08% buffer inside structural level
const SL_BUFFER          = 0.003;  // 0.3% beyond invalidation
const MIN_TP1_RRR        = 3.0;    // TP1 must reach at least 1:3
const MIN_TP2_RRR        = 3.0;    // TP2 also needs 1:3 but must be further away
const MIN_TP3_RRR        = 3.0;    // TP3 also 1:3 minimum — spacing enforced separately
const MIN_TP_SPACING_PCT = 0.010;  // 1% minimum price gap between consecutive TPs
const MAX_TP_RISK_MULT   = 7.0;    // Hard cap: never beyond 7x risk from entry

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
  const riskAmount = 5.0; // Fixed $5 risk
  const slDistance = Math.abs(entry - stopLoss);
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
 * Calculate dynamic position scaling percentages.
 * Returns [tp1%, tp2%, tp3%] that sum to 100.
 */
export function getDynamicScaling(tier, sessionName, tpCount) {
  // Session modifier
  const isPower = sessionName?.includes('London') || sessionName?.includes('NY');
  const isAsian = sessionName?.includes('Asian') || !sessionName;

  const base = {
    EXCEPTIONAL: [25, 35, 40],
    HIGH:        [30, 40, 30],
    MEDIUM:      [45, 35, 20],
    REJECT:      [70, 20, 10],
  }[tier] || [35, 35, 30];

  let [p1, p2, p3] = base;
  if (isPower) { p1 -= 5; p3 += 5; }  // trend session → ride to TP3
  if (isAsian)  { p1 += 10; p3 -= 10; } // range session → take early

  if (tpCount === 1) return [100, 0, 0];
  if (tpCount === 2) return [isPower ? 45 : 55, isPower ? 55 : 45, 0];
  return [p1, p2, p3];
}

/**
 * Build a deduplicated list of structural swing levels near entry,
 * sourced from multiple timeframes (primary / structure / bias).
 * Levels within 0.3% of each other are collapsed to avoid duplicates.
 */
function buildStructuralLevels(entry, direction, allSwings, fvgs, maxDist) {
  const raw = [];

  // Swings from all timeframes
  for (const s of allSwings) {
    const price = s.price;
    const dist  = direction === 'long' ? price - entry : entry - price;
    if ((direction === 'long' && price > entry && dist <= maxDist) ||
        (direction === 'short' && price < entry && dist <= maxDist)) {
      raw.push({ price, reason: `${s.tfLabel || 'Swing'} @ ${price.toFixed(0)}`, isStructural: true });
    }
  }

  // FVGs
  for (const f of fvgs) {
    if (direction === 'long' && f.type === 'bearish' && f.lower > entry) {
      const dist = f.lower - entry;
      if (dist <= maxDist) raw.push({ price: f.midpoint, reason: `Bearish FVG @ ${f.midpoint?.toFixed(0)}`, isStructural: true });
    }
    if (direction === 'short' && f.type === 'bullish' && f.upper < entry) {
      const dist = entry - f.upper;
      if (dist <= maxDist) raw.push({ price: f.midpoint, reason: `Bullish FVG @ ${f.midpoint?.toFixed(0)}`, isStructural: true });
    }
  }

  // Sort: LONG ascending (closest first), SHORT descending (highest = closest first)
  raw.sort((a, b) => direction === 'long' ? a.price - b.price : b.price - a.price);

  // Deduplicate: collapse levels within 0.3% of each other
  const deduped = [];
  for (const lvl of raw) {
    if (deduped.length === 0) { deduped.push(lvl); continue; }
    const prev = deduped[deduped.length - 1];
    if (Math.abs(lvl.price - prev.price) / prev.price < 0.003) continue; // same zone
    deduped.push(lvl);
  }

  return deduped;
}

/**
 * Calculate TPs using multi-TF structural levels as primary candidates.
 *
 * Key logic:
 *  1. Build structural candidates from primary + structure + bias swings + FVGs
 *  2. Deduplicate levels within 0.3% of each other
 *  3. Enforce MIN_TP_SPACING_PCT = 1% between consecutive TPs
 *  4. Fallback anchors at 3x / 5x / 7x risk — wide enough to always be well-separated
 *  5. Cap at max(entry×5%, risk×7) so targets stay realistic
 *
 * @param {number}   entry
 * @param {number}   stopLoss
 * @param {Array}    allSwings   – pre-tagged array [{price, tfLabel}] from multiple TFs
 * @param {Array}    fvgs
 * @param {string}   direction   – 'long' | 'short'
 * @param {string}   tier        – confluence tier
 * @param {string}   sessionName
 * @param {number}   maxTpPct    – max TP distance as fraction of entry price (per TF profile)
 */
export function calculateTPs(
  entry, stopLoss, allSwings, fvgs,
  direction, tier = 'HIGH', sessionName = '', maxTpPct = 0.06
) {
  const tps = [];
  const risk = Math.abs(entry - stopLoss);

  // Dynamic cap: larger of (entry × maxTpPct) and (risk × 5), but never beyond risk × 7
  const pctCap  = entry * maxTpPct;
  const riskCap = risk * 5.0;
  const hardCap = risk * MAX_TP_RISK_MULT;
  const maxTpDistance = Math.min(hardCap, Math.max(pctCap, riskCap));

  const applyOffset = (price) =>
    direction === 'long' ? price * (1 - ENTRY_OFFSET) : price * (1 + ENTRY_OFFSET);

  // ── Build structural candidates ─────────────────────────────────────
  const structural = buildStructuralLevels(entry, direction, allSwings, fvgs, maxTpDistance);

  // ── Fallback anchors: 3x / 5x / 7x risk ────────────────────────────
  // Wide spacing ensures they never land near-identically even for tiny SLs.
  // Only include anchors that fall within the maxTpDistance cap.
  const anchors = [
    { mult: 3.0, label: '1:3 RRR Anchor'  },
    { mult: 5.0, label: '1:5 RRR Anchor'  },
    { mult: 7.0, label: '1:7 RRR Anchor'  },
  ]
    .map(a => ({
      price:  direction === 'long' ? entry + risk * a.mult : entry - risk * a.mult,
      reason: a.label,
      isStructural: false,
    }))
    .filter(a => {
      const dist = Math.abs(a.price - entry);
      return dist <= maxTpDistance;
    });

  // ── Merge: structural first, then anchors (structural levels take priority) ──
  // Re-sort merged list by proximity to entry
  const allCandidates = [...structural, ...anchors];
  allCandidates.sort((a, b) => direction === 'long' ? a.price - b.price : b.price - a.price);

  // ── Select up to 3 TPs ──────────────────────────────────────────────
  for (const candidate of allCandidates) {
    if (tps.length >= 3) break;

    const exitLevel = applyOffset(candidate.price);
    const rrr = calculateRRR(entry, stopLoss, exitLevel);
    if (rrr < MIN_TP1_RRR) continue; // must be at least 3:1

    // Enforce minimum 1% spacing from last TP
    if (tps.length > 0) {
      const prev    = tps[tps.length - 1];
      const spacing = Math.abs(exitLevel - prev.level) / prev.level;
      if (spacing < MIN_TP_SPACING_PCT) continue; // too close, skip
    }

    // Avoid near-duplicate levels
    if (tps.some(t => Math.abs(t.level - exitLevel) / exitLevel < 0.005)) continue;

    tps.push({
      level:       parseFloat(exitLevel.toFixed(2)),
      reason:      candidate.reason,
      rrr,
      isStructural: candidate.isStructural,
    });
  }

  // ── Hard fallback — always produce at least 1 TP ────────────────────
  if (tps.length === 0) {
    const fallback = direction === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    tps.push({
      level: parseFloat(applyOffset(fallback).toFixed(2)),
      reason: '1:3 Fallback',
      rrr: 3.0,
      isStructural: false,
    });
  }

  // ── Dynamic scaling ─────────────────────────────────────────────────
  const closePercents = getDynamicScaling(tier, sessionName, tps.length);
  tps.forEach((tp, i) => { tp.closePercent = closePercents[i] ?? 0; });

  return { tps, tpStructure: tps.length >= 3 ? 'multiple' : tps.length === 2 ? 'dual' : 'single' };
}

/**
 * Calculate breakeven move price.
 * Rule: move SL to entry once price moves 1.5× risk in your favour.
 */
export function calculateBreakevenMove(entry, stopLoss) {
  const slDistance = Math.abs(entry - stopLoss);
  const dir = entry > stopLoss ? 1 : -1; // LONG: entry > SL (dir=1), SHORT: entry < SL (dir=-1)
  return parseFloat((entry + dir * slDistance * 1.5).toFixed(2));
}
