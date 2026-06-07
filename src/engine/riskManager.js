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
 * Calculate position size based on fixed RISK_AMOUNT.
 */
export function calculatePositionSize(entry, stopLoss) {
  const riskAmount = RISK_AMOUNT;
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
  direction, tier = 'HIGH', sessionName = '', maxTpPct = 0.06,
  primaryTf = '15M', structureTf = '1H', biasTf = '4H'
) {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return { tps: [], tpStructure: 'single' };

  const isLong = direction === 'long';

  // Compute absolute maximum allowed price based on profile maxTpPct
  let maxTpPrice;
  if (isLong) {
    maxTpPrice = entry * (1 + maxTpPct);
  } else {
    maxTpPrice = entry * (1 - maxTpPct);
  }

  const maxPossibleRrr = calculateRRR(entry, stopLoss, maxTpPrice);

  const highs = allSwings.filter(s => s.type === 'high');
  const lows  = allSwings.filter(s => s.type === 'low');
  
  // 1. Calculate candidate TP1 (Nearest EQH/EQL or Nearest Swing with 0.12% buffer)
  let tp1Target = null;
  let tp1Reason = 'Nearest Swing';

  if (isLong) {
    const validHighs = highs.filter(h => h.price > entry && h.price <= (maxTpPrice + entry * 0.0012));
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
      tp1Target = eqhPrice * (1 - 0.0012);
    } else {
      const nearestHigh = validHighs.sort((a, b) => a.price - b.price)[0];
      if (nearestHigh) {
        tp1Target = nearestHigh.price * (1 - 0.0012);
        tp1Reason = `Nearest Swing High (${nearestHigh.tfLabel || 'Swing'})`;
      } else {
        tp1Target = entry + risk * MIN_TP1_RRR;
        tp1Reason = `${MIN_TP1_RRR.toFixed(1)}R Target (No structures)`;
      }
    }

    // Force min RRR
    if (calculateRRR(entry, stopLoss, tp1Target) < MIN_TP1_RRR) {
      tp1Target = entry + risk * MIN_TP1_RRR;
      tp1Reason = `${MIN_TP1_RRR.toFixed(1)}R Target (Below min RRR)`;
    }
    // Cap it
    if (tp1Target > maxTpPrice) {
      tp1Target = maxTpPrice;
      tp1Reason = 'Max TF/Risk TP Cap';
    }
  } else {
    const validLows = lows.filter(l => l.price < entry && l.price >= (maxTpPrice - entry * 0.0012));
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
      tp1Target = eqlPrice * (1 + 0.0012);
    } else {
      const nearestLow = validLows.sort((a, b) => b.price - a.price)[0];
      if (nearestLow) {
        tp1Target = nearestLow.price * (1 + 0.0012);
        tp1Reason = `Nearest Swing Low (${nearestLow.tfLabel || 'Swing'})`;
      } else {
        tp1Target = entry - risk * MIN_TP1_RRR;
        tp1Reason = `${MIN_TP1_RRR.toFixed(1)}R Target (No structures)`;
      }
    }

    // Force min RRR
    if (calculateRRR(entry, stopLoss, tp1Target) < MIN_TP1_RRR) {
      tp1Target = entry - risk * MIN_TP1_RRR;
      tp1Reason = `${MIN_TP1_RRR.toFixed(1)}R Target (Below min RRR)`;
    }
    // Cap it
    if (tp1Target < maxTpPrice) {
      tp1Target = maxTpPrice;
      tp1Reason = 'Max TF/Risk TP Cap';
    }
  }

  const tp1Rrr = calculateRRR(entry, stopLoss, tp1Target);

  // If max possible RRR is less than MIN_TP3_RRR (5.0R), or if TP1 RRR is < MIN_TP2_RRR (4.0R),
  // we cannot form a valid 3-TP ladder, so we return a Single TP.
  if (maxPossibleRrr < MIN_TP3_RRR || tp1Rrr < MIN_TP2_RRR) {
    return {
      tps: [{
        level: parseFloat(tp1Target.toFixed(4)),
        reason: tp1Reason,
        rrr: tp1Rrr,
        isStructural: true,
        closePercent: 100,
      }],
      tpStructure: 'single'
    };
  }

  // 2. Calculate TP2 (Previous unmitigated swing high/low on structure or bias TF with 0.12% buffer)
  let tp2Target = null;
  let tp2Reason = `${structureTf}/${biasTf} Swing Target`;
  const tfSwings = allSwings.filter(s => s.tfLabel === structureTf || s.tfLabel === biasTf);

  if (isLong) {
    const minTp2Price = tp1Target + risk * MIN_TP_SPACING_RRR;
    const validTP2Swings = tfSwings.filter(s => s.type === 'high' && s.price * (1 - 0.0012) >= minTp2Price && s.price <= (maxTpPrice + entry * 0.0012));
    const nearestTP2 = validTP2Swings.sort((a, b) => a.price - b.price)[0];
    
    if (nearestTP2) {
      tp2Target = nearestTP2.price * (1 - 0.0012);
      tp2Reason = `Unmitigated Swing High (${nearestTP2.tfLabel})`;
    } else {
      const anyValid = highs.filter(s => s.price * (1 - 0.0012) >= minTp2Price && s.price <= (maxTpPrice + entry * 0.0012));
      const nearestAny = anyValid.sort((a, b) => a.price - b.price)[0];
      if (nearestAny) {
        tp2Target = nearestAny.price * (1 - 0.0012);
        tp2Reason = `Swing High (${nearestAny.tfLabel})`;
      } else {
        tp2Target = tp1Target + risk * MIN_TP_SPACING_RRR;
        tp2Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
      }
    }

    // Ensure RRR and spacing
    const tp2Rrr = calculateRRR(entry, stopLoss, tp2Target);
    if (tp2Rrr < MIN_TP2_RRR || tp2Rrr < tp1Rrr + MIN_TP_SPACING_RRR) {
      tp2Target = tp1Target + risk * MIN_TP_SPACING_RRR;
      tp2Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
    }
  } else {
    const maxTp2Price = tp1Target - risk * MIN_TP_SPACING_RRR;
    const validTP2Swings = tfSwings.filter(s => s.type === 'low' && s.price * (1 + 0.0012) <= maxTp2Price && s.price >= (maxTpPrice - entry * 0.0012));
    const nearestTP2 = validTP2Swings.sort((a, b) => b.price - a.price)[0];

    if (nearestTP2) {
      tp2Target = nearestTP2.price * (1 + 0.0012);
      tp2Reason = `Unmitigated Swing Low (${nearestTP2.tfLabel})`;
    } else {
      const anyValid = lows.filter(s => s.price * (1 + 0.0012) <= maxTp2Price && s.price >= (maxTpPrice - entry * 0.0012));
      const nearestAny = anyValid.sort((a, b) => a.price - b.price)[0];
      if (nearestAny) {
        tp2Target = nearestAny.price * (1 + 0.0012);
        tp2Reason = `Swing Low (${nearestAny.tfLabel})`;
      } else {
        tp2Target = tp1Target - risk * MIN_TP_SPACING_RRR;
        tp2Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
      }
    }

    // Ensure RRR and spacing
    const tp2Rrr = calculateRRR(entry, stopLoss, tp2Target);
    if (tp2Rrr < MIN_TP2_RRR || tp2Rrr < tp1Rrr + MIN_TP_SPACING_RRR) {
      tp2Target = tp1Target - risk * MIN_TP_SPACING_RRR;
      tp2Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
    }
  }

  const tp2Rrr = calculateRRR(entry, stopLoss, tp2Target);

  // 3. Calculate TP3 (HTF FVG far boundary or 1.272-1.618 Fib extension with 0.12% buffer)
  let tp3Target = null;
  let tp3Reason = 'HTF Target';
  const htfFvgs = fvgs || [];

  if (isLong) {
    const minTp3Price = tp2Target + risk * MIN_TP_SPACING_RRR;
    const validFVG = htfFvgs.find(f => f.type === 'bearish' && f.upper * (1 - 0.0012) >= minTp3Price && f.upper <= (maxTpPrice + entry * 0.0012));
    
    if (validFVG) {
      tp3Target = validFVG.upper * (1 - 0.0012);
      tp3Reason = `${biasTf} Bearish FVG Far Boundary`;
    } else {
      const primaryHighs = highs.filter(h => h.price > entry).sort((a, b) => a.price - b.price);
      const primaryLows = lows.filter(l => l.price < entry).sort((a, b) => b.price - a.price);
      if (primaryHighs[0] && primaryLows[0]) {
        const range = primaryHighs[0].price - primaryLows[0].price;
        const extTarget = (primaryLows[0].price + range * 1.272) * (1 - 0.0012);
        if (extTarget >= minTp3Price) {
          tp3Target = extTarget;
          tp3Reason = '1.272 Fib Extension';
        } else {
          const ext1618 = (primaryLows[0].price + range * 1.618) * (1 - 0.0012);
          if (ext1618 >= minTp3Price) {
            tp3Target = ext1618;
            tp3Reason = '1.618 Fib Extension';
          } else {
            tp3Target = tp2Target + risk * MIN_TP_SPACING_RRR;
            tp3Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
          }
        }
      } else {
        tp3Target = tp2Target + risk * MIN_TP_SPACING_RRR;
        tp3Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
      }
    }

    // Ensure RRR and spacing
    const tp3Rrr = calculateRRR(entry, stopLoss, tp3Target);
    if (tp3Rrr < MIN_TP3_RRR || tp3Rrr < tp2Rrr + MIN_TP_SPACING_RRR) {
      tp3Target = tp2Target + risk * MIN_TP_SPACING_RRR;
      tp3Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
    }
  } else {
    const maxTp3Price = tp2Target - risk * MIN_TP_SPACING_RRR;
    const validFVG = htfFvgs.find(f => f.type === 'bullish' && f.lower * (1 + 0.0012) <= maxTp3Price && f.lower >= (maxTpPrice - entry * 0.0012));

    if (validFVG) {
      tp3Target = validFVG.lower * (1 + 0.0012);
      tp3Reason = `${biasTf} Bullish FVG Far Boundary`;
    } else {
      const primaryHighs = highs.filter(h => h.price > entry).sort((a, b) => a.price - b.price);
      const primaryLows = lows.filter(l => l.price < entry).sort((a, b) => b.price - a.price);
      if (primaryHighs[0] && primaryLows[0]) {
        const range = primaryHighs[0].price - primaryLows[0].price;
        const extTarget = (primaryHighs[0].price - range * 1.272) * (1 + 0.0012);
        if (extTarget <= maxTp3Price) {
          tp3Target = extTarget;
          tp3Reason = '1.272 Fib Extension';
        } else {
          const ext1618 = (primaryHighs[0].price - range * 1.618) * (1 + 0.0012);
          if (ext1618 <= maxTp3Price) {
            tp3Target = ext1618;
            tp3Reason = '1.618 Fib Extension';
          } else {
            tp3Target = tp2Target - risk * MIN_TP_SPACING_RRR;
            tp3Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
          }
        }
      } else {
        tp3Target = tp2Target - risk * MIN_TP_SPACING_RRR;
        tp3Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
      }
    }

    // Ensure RRR and spacing
    const tp3Rrr = calculateRRR(entry, stopLoss, tp3Target);
    if (tp3Rrr < MIN_TP3_RRR || tp3Rrr > tp2Rrr - MIN_TP_SPACING_RRR) {
      tp3Target = tp2Target - risk * MIN_TP_SPACING_RRR;
      tp3Reason = `Progressive RRR Target (+${MIN_TP_SPACING_RRR.toFixed(1)}R)`;
    }
  }

  // Double Check Caps and Ladder Legitimate Validation:
  // If TP2 or TP3 exceeds the absolute maximum cap price, we must adjust them.
  // If we cap TP3 at maxTpPrice, we must adjust TP2 down (for long) or up (for short)
  // to maintain MIN_TP_SPACING_RRR.
  let finalTp1 = tp1Target;
  let finalTp2 = tp2Target;
  let finalTp3 = tp3Target;

  if (isLong) {
    if (finalTp3 > maxTpPrice) {
      finalTp3 = maxTpPrice;
      finalTp2 = Math.min(finalTp2, finalTp3 - risk * MIN_TP_SPACING_RRR);
      finalTp1 = Math.min(finalTp1, finalTp2 - risk * MIN_TP_SPACING_RRR);
    }
    // If the cap forced TP1 below the minimum required RRR, we cannot have a 3-TP ladder.
    if (calculateRRR(entry, stopLoss, finalTp1) < MIN_TP1_RRR) {
      // Fallback to Single TP capped at maxTpPrice
      return {
        tps: [{
          level: parseFloat(Math.min(tp1Target, maxTpPrice).toFixed(4)),
          reason: tp1Reason,
          rrr: Math.min(tp1Rrr, maxPossibleRrr),
          isStructural: true,
          closePercent: 100,
        }],
        tpStructure: 'single'
      };
    }
  } else {
    if (finalTp3 < maxTpPrice) {
      finalTp3 = maxTpPrice;
      finalTp2 = Math.max(finalTp2, finalTp3 + risk * MIN_TP_SPACING_RRR);
      finalTp1 = Math.max(finalTp1, finalTp2 + risk * MIN_TP_SPACING_RRR);
    }
    // If the cap forced TP1 below the minimum required RRR, fallback to Single TP
    if (calculateRRR(entry, stopLoss, finalTp1) < MIN_TP1_RRR) {
      return {
        tps: [{
          level: parseFloat(Math.max(tp1Target, maxTpPrice).toFixed(4)),
          reason: tp1Reason,
          rrr: Math.min(tp1Rrr, maxPossibleRrr),
          isStructural: true,
          closePercent: 100,
        }],
        tpStructure: 'single'
      };
    }
  }

  const finalTp1Rrr = calculateRRR(entry, stopLoss, finalTp1);
  const finalTp2Rrr = calculateRRR(entry, stopLoss, finalTp2);
  const finalTp3Rrr = calculateRRR(entry, stopLoss, finalTp3);

  const tps = [
    {
      level: parseFloat(finalTp1.toFixed(4)),
      reason: tp1Reason,
      rrr: finalTp1Rrr,
      isStructural: true,
      closePercent: 40,
    },
    {
      level: parseFloat(finalTp2.toFixed(4)),
      reason: tp2Reason,
      rrr: finalTp2Rrr,
      isStructural: true,
      closePercent: 35,
    },
    {
      level: parseFloat(finalTp3.toFixed(4)),
      reason: tp3Reason,
      rrr: finalTp3Rrr,
      isStructural: true,
      closePercent: 25,
    }
  ];

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
