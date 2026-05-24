// ─────────────────────────────────────────────────────────
//  Risk Manager v9.1 — Risk-Scaled SL/TP Math Fixes
//  Fix: Removed absolute % buffers that ruined scalping RRR
//  Fix: Spacing and offsets now scale with the trade's Risk
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT } from '../utils/constants.js';

// ── Constants ─────────────────────────────────────────────
const MIN_TP1_RRR        = 3.0;    // TP1 must reach at least 1:3
const MIN_TP2_RRR        = 3.0;    // TP2 also needs 1:3 but spacing forces it higher
const MIN_TP3_RRR        = 3.0;    // TP3 also 1:3 minimum
const MIN_TP_SPACING_RRR = 1.0;    // TPs must be separated by at least 1.0 Risk (e.g., 3R, 4R, 5R)
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
 * Layer 1: Structural invalidation (Order Block / Swing boundary)
 * Layer 2: 15% risk buffer beyond structure (scales with volatility, not fixed price %)
 * Layer 3: Expand to clear any FVG void sitting directly behind SL
 */
export function calculateSmartSL(invalidationLevel, direction, fvgs, currentPrice = null) {
  const layer1 = invalidationLevel;
  
  // Calculate raw risk distance to invalidation
  // If currentPrice is provided, use it; otherwise fallback to an estimated risk
  const estRisk = currentPrice ? Math.abs(currentPrice - layer1) : layer1 * 0.001; 
  const bufferDistance = estRisk * 0.15; // 15% of the risk as buffer

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
    buffer: `+15% risk buffer`,
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
 * Build a deduplicated list of structural swing levels near entry.
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
    if (Math.abs(lvl.price - prev.price) / prev.price < 0.003) continue;
    deduped.push(lvl);
  }

  return deduped;
}

/**
 * Calculate TPs using multi-TF structural levels as primary candidates.
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

  // Front-run the TP by 5% of the risk distance (e.g. if risk is 100, front-run by 5 pts)
  // This scales perfectly with tight scalping SLs, unlike the old fixed 0.08% price offset.
  const applyOffset = (price) =>
    direction === 'long' ? price - (risk * 0.05) : price + (risk * 0.05);

  const structural = buildStructuralLevels(entry, direction, allSwings, fvgs, maxTpDistance);

  const anchors = [
    { mult: 3.0, label: '1:3 RRR Anchor'  },
    { mult: 5.0, label: '1:5 RRR Anchor'  },
    { mult: 7.0, label: '1:7 RRR Anchor'  },
  ]
    .map(a => ({
      // We ADD the offset back to the anchor so that when applyOffset() runs below,
      // the anchor lands precisely at exactly 3.0 / 5.0 / 7.0 RRR.
      price:  direction === 'long' 
        ? (entry + risk * a.mult) + (risk * 0.05) 
        : (entry - risk * a.mult) - (risk * 0.05),
      reason: a.label,
      isStructural: false,
    }))
    .filter(a => Math.abs(a.price - entry) <= maxTpDistance);

  const allCandidates = [...structural, ...anchors];
  allCandidates.sort((a, b) => direction === 'long' ? a.price - b.price : b.price - a.price);

  for (const candidate of allCandidates) {
    if (tps.length >= 3) break;

    const exitLevel = applyOffset(candidate.price);
    const rrr = calculateRRR(entry, stopLoss, exitLevel);
    if (rrr < MIN_TP1_RRR) continue;

    // Enforce spacing using RISK MULTIPLES instead of fixed price percentages
    if (tps.length > 0) {
      const prev = tps[tps.length - 1];
      const spacingRrr = Math.abs(exitLevel - prev.level) / risk;
      if (spacingRrr < MIN_TP_SPACING_RRR) continue; // Must be at least 1R away from previous TP
    }

    if (tps.some(t => Math.abs(t.level - exitLevel) / risk < 0.2)) continue;

    tps.push({
      level:       parseFloat(exitLevel.toFixed(2)),
      reason:      candidate.reason,
      rrr,
      isStructural: candidate.isStructural,
    });
  }

  if (tps.length === 0) {
    const fallback = direction === 'long' ? entry + risk * 3.0 : entry - risk * 3.0;
    tps.push({
      level: parseFloat(fallback.toFixed(2)),
      reason: '1:3 Fallback',
      rrr: 3.0,
      isStructural: false,
    });
  }

  const closePercents = getDynamicScaling(tier, sessionName, tps.length);
  tps.forEach((tp, i) => { tp.closePercent = closePercents[i] ?? 0; });

  return { tps, tpStructure: tps.length >= 3 ? 'multiple' : tps.length === 2 ? 'dual' : 'single' };
}

export function calculateBreakevenMove(entry, stopLoss) {
  const slDistance = Math.abs(entry - stopLoss);
  const dir = entry > stopLoss ? 1 : -1;
  return parseFloat((entry + dir * slDistance * 1.5).toFixed(2));
}
