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
export function calculateSmartSL(invalidationLevel, direction, fvgs) {
  const layer1 = invalidationLevel;
  
  // Layer 2: 0.3% buffer above/below Layer 1
  const layer2 = direction === 'long'
    ? layer1 * (1 - 0.003)
    : layer1 * (1 + 0.003);

  // Layer 3: Imbalance Void Check
  let layer3 = layer2;
  if (fvgs && fvgs.length > 0) {
    if (direction === 'long') {
      // Find bullish FVG behind Layer 2 SL (spans across layer 2)
      const fvg = fvgs.find(f => f.type === 'bullish' && f.upper > layer2 && f.lower < layer2);
      if (fvg) {
        layer3 = fvg.lower; // Move SL to far side of FVG
      }
    } else {
      // Find bearish FVG behind Layer 2 SL (spans across layer 2)
      const fvg = fvgs.find(f => f.type === 'bearish' && f.lower < layer2 && f.upper > layer2);
      if (fvg) {
        layer3 = fvg.upper; // Move SL to far side of FVG
      }
    }
  }

  return {
    value: parseFloat(layer3.toFixed(4)),
    rawInvalidation: invalidationLevel,
    buffer: `±0.3% liquidity buffer`,
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
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return { tps: [], tpStructure: 'single' };

  // 1. Calculate TP1 (Nearest EQH/EQL or Nearest Swing with 0.12% buffer)
  const highs = allSwings.filter(s => s.type === 'high');
  const lows  = allSwings.filter(s => s.type === 'low');
  
  let tp1Target = null;
  let tp1Reason = 'Nearest Swing';

  if (direction === 'long') {
    // Find EQH (within 0.15% of each other) above entry
    const validHighs = highs.filter(h => h.price > entry);
    let eqhPrice = null;
    for (let i = 0; i < validHighs.length; i++) {
      for (let j = i + 1; j < validHighs.length; j++) {
        const diff = Math.abs(validHighs[i].price - validHighs[j].price) / validHighs[i].price;
        if (diff <= 0.0015) {
          eqhPrice = Math.max(validHighs[i].price, validHighs[j].price);
          tp1Reason = 'Equal Highs (EQH) Liquidity Pool';
          break;
        }
      }
      if (eqhPrice) break;
    }
    
    if (eqhPrice) {
      tp1Target = eqhPrice * (1 - 0.0012); // 0.12% buffer below
    } else {
      const nearestHigh = validHighs.sort((a, b) => a.price - b.price)[0];
      if (nearestHigh) {
        tp1Target = nearestHigh.price * (1 - 0.0012);
        tp1Reason = `Nearest Swing High (${nearestHigh.tfLabel || 'Swing'})`;
      } else {
        tp1Target = entry + risk * 3.0; // Fallback to 3R
        tp1Reason = '3.0R Target (No structures)';
      }
    }
  } else {
    // Find EQL (within 0.15% of each other) below entry
    const validLows = lows.filter(l => l.price < entry);
    let eqlPrice = null;
    for (let i = 0; i < validLows.length; i++) {
      for (let j = i + 1; j < validLows.length; j++) {
        const diff = Math.abs(validLows[i].price - validLows[j].price) / validLows[i].price;
        if (diff <= 0.0015) {
          eqlPrice = Math.min(validLows[i].price, validLows[j].price);
          tp1Reason = 'Equal Lows (EQL) Liquidity Pool';
          break;
        }
      }
      if (eqlPrice) break;
    }

    if (eqlPrice) {
      tp1Target = eqlPrice * (1 + 0.0012); // 0.12% buffer above
    } else {
      const nearestLow = validLows.sort((a, b) => b.price - a.price)[0];
      if (nearestLow) {
        tp1Target = nearestLow.price * (1 + 0.0012);
        tp1Reason = `Nearest Swing Low (${nearestLow.tfLabel || 'Swing'})`;
      } else {
        tp1Target = entry - risk * 3.0; // Fallback to 3R
        tp1Reason = '3.0R Target (No structures)';
      }
    }
  }

  const tp1Rrr = calculateRRR(entry, stopLoss, tp1Target);
  const tps = [];

  // TP structure trigger:
  // - RRR 1:3 - 1:3.9 -> Single TP only (full size 100%)
  // - RRR >= 1:4 -> Three-TP ladder applies
  if (tp1Rrr < 4.0) {
    tps.push({
      level: parseFloat(tp1Target.toFixed(2)),
      reason: tp1Reason,
      rrr: tp1Rrr,
      isStructural: true,
      closePercent: 100,
    });
    return { tps, tpStructure: 'single' };
  }

  // RRR >= 4.0 -> Build 3-TP ladder
  // TP1 (40%)
  tps.push({
    level: parseFloat(tp1Target.toFixed(2)),
    reason: tp1Reason,
    rrr: tp1Rrr,
    isStructural: true,
    closePercent: 40,
  });

  // 2. Calculate TP2 (Previous unmitigated swing high/low on 1H or 4H with 0.12% buffer)
  let tp2Target = null;
  let tp2Reason = '1H/4H Swing Target';
  const tfSwings = allSwings.filter(s => s.tfLabel === '1H' || s.tfLabel === '4H');

  if (direction === 'long') {
    const validTP2Swings = tfSwings.filter(s => s.type === 'high' && s.price * (1 - 0.0012) > tp1Target);
    const nearestTP2 = validTP2Swings.sort((a, b) => a.price - b.price)[0];
    if (nearestTP2) {
      tp2Target = nearestTP2.price * (1 - 0.0012);
      tp2Reason = `Unmitigated Swing High (${nearestTP2.tfLabel})`;
    } else {
      tp2Target = entry + risk * 4.5; // Fallback
      tp2Reason = '4.5R Target (No HTF swing)';
    }
  } else {
    const validTP2Swings = tfSwings.filter(s => s.type === 'low' && s.price * (1 + 0.0012) < tp1Target);
    const nearestTP2 = validTP2Swings.sort((a, b) => b.price - a.price)[0];
    if (nearestTP2) {
      tp2Target = nearestTP2.price * (1 + 0.0012);
      tp2Reason = `Unmitigated Swing Low (${nearestTP2.tfLabel})`;
    } else {
      tp2Target = entry - risk * 4.5; // Fallback
      tp2Reason = '4.5R Target (No HTF swing)';
    }
  }

  tps.push({
    level: parseFloat(tp2Target.toFixed(2)),
    reason: tp2Reason,
    rrr: calculateRRR(entry, stopLoss, tp2Target),
    isStructural: true,
    closePercent: 35,
  });

  // 3. Calculate TP3 (4H FVG far boundary or 1.272-1.618 Fib extension with 0.12% buffer)
  let tp3Target = null;
  let tp3Reason = 'HTF Target';

  // Find 4H FVG
  const h4Fvgs = fvgs || [];

  if (direction === 'long') {
    const validFVG = h4Fvgs.find(f => f.type === 'bearish' && f.upper * (1 - 0.0012) > tp2Target);
    if (validFVG) {
      tp3Target = validFVG.upper * (1 - 0.0012); // Far boundary of bearish FVG
      tp3Reason = '4H Bearish FVG Far Boundary';
    } else {
      // Calculate Fib extension of nearest structural swings
      const primaryHighs = highs.filter(h => h.price > entry).sort((a, b) => a.price - b.price);
      const primaryLows = lows.filter(l => l.price < entry).sort((a, b) => b.price - a.price);
      if (primaryHighs[0] && primaryLows[0]) {
        const range = primaryHighs[0].price - primaryLows[0].price;
        tp3Target = (primaryLows[0].price + range * 1.272) * (1 - 0.0012);
        tp3Reason = '1.272 Fib Extension';
      } else {
        tp3Target = entry + risk * 6.0;
        tp3Reason = '6.0R Target (No HTF FVG/Fib)';
      }
    }
  } else {
    const validFVG = h4Fvgs.find(f => f.type === 'bullish' && f.lower * (1 + 0.0012) < tp2Target);
    if (validFVG) {
      tp3Target = validFVG.lower * (1 + 0.0012); // Far boundary of bullish FVG
      tp3Reason = '4H Bullish FVG Far Boundary';
    } else {
      const primaryHighs = highs.filter(h => h.price > entry).sort((a, b) => a.price - b.price);
      const primaryLows = lows.filter(l => l.price < entry).sort((a, b) => b.price - a.price);
      if (primaryHighs[0] && primaryLows[0]) {
        const range = primaryHighs[0].price - primaryLows[0].price;
        tp3Target = (primaryHighs[0].price - range * 1.272) * (1 + 0.0012);
        tp3Reason = '1.272 Fib Extension';
      } else {
        tp3Target = entry - risk * 6.0;
        tp3Reason = '6.0R Target (No HTF FVG/Fib)';
      }
    }
  }

  tps.push({
    level: parseFloat(tp3Target.toFixed(2)),
    reason: tp3Reason,
    rrr: calculateRRR(entry, stopLoss, tp3Target),
    isStructural: true,
    closePercent: 25,
  });

  return { tps, tpStructure: 'multiple' };
}

/**
 * Breakeven price calculation (move SL to entry when 1.5R reached).
 */
export function calculateBreakevenMove(entry, stopLoss) {
  const risk = Math.abs(entry - stopLoss);
  const dir = entry > stopLoss ? 1 : -1;
  return parseFloat((entry + dir * risk * 1.5).toFixed(2));
}
