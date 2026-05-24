// ─────────────────────────────────────────────────────────
//  Risk Manager v10.0 — Risk-Scaled Progressive Engine
//  - Progressive RRR targets (3R, 4R, 5R)
//  - Pure risk-scaled buffers (no fixed percentages)
//  - One-directional anchor logic
//  - Risk-based deduplication
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT } from '../utils/constants.js';

// ── 🎯 Tunable Constants ──────────────────────────────────
const MIN_TP1_RRR        = 3.0;   // TP1 must be at least 3R
const MIN_TP2_RRR        = 4.0;   // TP2 must be at least 4R
const MIN_TP3_RRR        = 5.0;   // TP3 must be at least 5R
const MIN_TP_SPACING_RRR = 1.0;   // Minimum 1R between TPs
const MAX_TP_RISK_MULT   = 7.0;   // Hard cap on TP distance
const STRUCT_DEDUP_PCT   = 0.003; // Collapse structural levels within 0.3%
const DEDUP_THRESHOLD_R  = 0.2;   // Drop TPs within 0.2R of each other
const ENTRY_OFFSET_MULT  = 0.05;  // Front-run by 5% of risk
const SL_BUFFER_MULT     = 0.15;  // Buffer SL by 15% of risk

/**
 * Calculate Risk-to-Reward Ratio.
 * @returns {number} RRR rounded to 2 decimals
 */
export function calculateRRR(entry, stopLoss, takeProfit) {
  const risk   = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk === 0) return 0;
  return parseFloat((reward / risk).toFixed(2));
}

/**
 * Calculate position size based on $5 fixed risk.
 */
export function calculatePositionSize(entry, stopLoss) {
  const riskAmount = 5.0;
  const slDistance = Math.abs(entry - stopLoss);
  if (slDistance === 0) return 0;
  return parseFloat((riskAmount / slDistance).toFixed(6));
}

/**
 * Apply risk-scaled front-run offset to a target price.
 */
function applyFrontRunOffset(price, direction, risk) {
  const offset = risk * ENTRY_OFFSET_MULT;
  return direction === 'long' ? price - offset : price + offset;
}

/**
 * Check if a level is too close to already selected TPs (Risk-based).
 */
function isDuplicate(level, existingTPs, risk) {
  return existingTPs.some(tp => {
    const distanceInRisk = Math.abs(tp.level - level) / risk;
    return distanceInRisk < DEDUP_THRESHOLD_R;
  });
}

/**
 * Calculate smart stop loss with 3-layer defense using Risk scaling.
 */
export function calculateSmartSL(invalidationLevel, direction, fvgs, currentPrice = null) {
  const layer1 = invalidationLevel;
  
  const estRisk = currentPrice ? Math.abs(currentPrice - layer1) : layer1 * 0.001; 
  const bufferDistance = estRisk * SL_BUFFER_MULT;

  const layer2 = direction === 'long'
    ? layer1 - bufferDistance
    : layer1 + bufferDistance;

  let layer3 = layer2;
  if (fvgs && fvgs.length > 0) {
    for (const fvg of fvgs) {
      if (direction === 'long' && fvg.type === 'bullish' && fvg.lower < layer2 && fvg.upper > layer2) {
        layer3 = fvg.lower - bufferDistance;
        break;
      }
      if (direction === 'short' && fvg.type === 'bearish' && fvg.upper > layer2 && fvg.lower < layer2) {
        layer3 = fvg.upper + bufferDistance;
        break;
      }
    }
  }

  return {
    value: layer3,
    rawInvalidation: invalidationLevel,
    buffer: `+${(SL_BUFFER_MULT * 100).toFixed(0)}% risk buffer`,
    layer1,
    layer2,
    layer3,
  };
}

/**
 * Calculate dynamic position scaling percentages.
 */
export function getDynamicScaling(tier, sessionName, tpCount) {
  const isPower = sessionName?.includes('London') || sessionName?.includes('NY');
  const isAsian = sessionName?.includes('Asian') || !sessionName;

  const base = {
    EXCEPTIONAL: [25, 35, 40],
    HIGH:        [30, 40, 30],
    MEDIUM:      [45, 35, 20],
    REJECT:      [70, 20, 10],
  }[tier] || [35, 35, 30];

  let [p1, p2, p3] = base;
  if (isPower) { p1 -= 5; p3 += 5; }
  if (isAsian)  { p1 += 10; p3 -= 10; }

  if (tpCount === 1) return [100, 0, 0];
  if (tpCount === 2) return [isPower ? 45 : 55, isPower ? 55 : 45, 0];
  return [p1, p2, p3];
}

/**
 * Build and deduplicate structural swing levels near entry.
 */
function buildStructuralLevels(entry, direction, allSwings, fvgs, maxDist) {
  const raw = [];

  for (const s of allSwings) {
    const price = s.price;
    const dist  = direction === 'long' ? price - entry : entry - price;
    if ((direction === 'long' && price > entry && dist <= maxDist) ||
        (direction === 'short' && price < entry && dist <= maxDist)) {
      raw.push({ price, reason: `${s.tfLabel || 'Swing'} @ ${price.toFixed(0)}`, isStructural: true });
    }
  }

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

  raw.sort((a, b) => direction === 'long' ? a.price - b.price : b.price - a.price);

  const deduped = [];
  for (const lvl of raw) {
    if (deduped.length === 0) { deduped.push(lvl); continue; }
    const prev = deduped[deduped.length - 1];
    if (Math.abs(lvl.price - prev.price) / prev.price < STRUCT_DEDUP_PCT) continue;
    deduped.push(lvl);
  }

  return deduped;
}

/**
 * Primary TP engine combining progressive RRR, risk scaling, and structural logic.
 */
export function calculateTPs(
  entry, stopLoss, allSwings, fvgs,
  direction, tier = 'HIGH', sessionName = '', maxTpPct = 0.06
) {
  const tps = [];
  const risk = Math.abs(entry - stopLoss);

  const pctCap  = entry * maxTpPct;
  const riskCap = risk * 5.0;
  const hardCap = risk * MAX_TP_RISK_MULT;
  const maxTpDistance = Math.min(hardCap, Math.max(pctCap, riskCap));

  const structural = buildStructuralLevels(entry, direction, allSwings, fvgs, maxTpDistance);

  // Clean one-directional anchor placement
  const anchors = [
    { mult: MIN_TP1_RRR, label: `1:${MIN_TP1_RRR} Anchor` },
    { mult: MIN_TP2_RRR, label: `1:${MIN_TP2_RRR} Anchor` },
    { mult: MIN_TP3_RRR, label: `1:${MIN_TP3_RRR} Anchor` },
  ]
    .map(a => ({
      price:  direction === 'long' ? entry + (risk * a.mult) : entry - (risk * a.mult),
      reason: a.label,
      isStructural: false,
    }))
    .filter(a => Math.abs(a.price - entry) <= maxTpDistance);

  const allCandidates = [...structural, ...anchors];
  allCandidates.sort((a, b) => direction === 'long' ? a.price - b.price : b.price - a.price);

  const minReqs = [MIN_TP1_RRR, MIN_TP2_RRR, MIN_TP3_RRR];

  for (const candidate of allCandidates) {
    if (tps.length >= 3) break;

    const exitLevel = applyFrontRunOffset(candidate.price, direction, risk);
    const rrr = calculateRRR(entry, stopLoss, exitLevel);
    
    // Progressive minimum requirement
    const minRequiredRrr = minReqs[tps.length];
    if (rrr < minRequiredRrr) continue;

    // Minimum 1R spacing enforcement
    if (tps.length > 0) {
      const prev = tps[tps.length - 1];
      const spacingRrr = Math.abs(exitLevel - prev.level) / risk;
      if (spacingRrr < MIN_TP_SPACING_RRR) continue; 
    }

    // Risk-scaled deduplication
    if (isDuplicate(exitLevel, tps, risk)) continue;

    tps.push({
      level:       parseFloat(exitLevel.toFixed(2)),
      reason:      candidate.reason,
      rrr,
      isStructural: candidate.isStructural,
    });
  }

  // Exact 3.0R Fallback placement
  if (tps.length === 0) {
    const fallbackPrice = direction === 'long' ? entry + (risk * 3.0) : entry - (risk * 3.0);
    tps.push({
      level: parseFloat(fallbackPrice.toFixed(2)),
      reason: '1:3 Fallback',
      rrr: 3.0,
      isStructural: false,
    });
  }

  const closePercents = getDynamicScaling(tier, sessionName, tps.length);
  tps.forEach((tp, i) => { tp.closePercent = closePercents[i] ?? 0; });

  return { tps, tpStructure: tps.length >= 3 ? 'multiple' : tps.length === 2 ? 'dual' : 'single' };
}

/**
 * Breakeven price calculation (move SL to entry when 1.5R reached).
 */
export function calculateBreakevenMove(entry, stopLoss) {
  const risk = Math.abs(entry - stopLoss);
  const dir = entry > stopLoss ? 1 : -1;
  return parseFloat((entry + dir * risk * 1.5).toFixed(2));
}
