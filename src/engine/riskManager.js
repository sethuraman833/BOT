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
export function calculatePositionSize(entry, stopLoss, customRiskAmount) {
  const riskAmount = customRiskAmount !== undefined ? customRiskAmount : RISK_AMOUNT;
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
  primaryTf = '15M', structureTf = '1H', biasTf = '4H',
  minRrr = 3.0
) {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return { tps: [], tpStructure: 'single' };

  const isLong = direction === 'long';
  const minTp1Rrr = minRrr;
  const minTp2Rrr = minRrr + 1.0;
  const minTp3Rrr = minRrr + 2.0;

  // Compute absolute maximum allowed price based on profile maxTpPct
  let maxTpPrice;
  if (isLong) {
    maxTpPrice = entry * (1 + maxTpPct);
  } else {
    maxTpPrice = entry * (1 - maxTpPct);
  }

  const highs = allSwings.filter(s => s.type === 'high');
  const lows  = allSwings.filter(s => s.type === 'low');

  const candidates = [];

  // 1. Equal Highs / Equal Lows (EQH/EQL) Pools
  if (isLong) {
    const validHighs = highs.filter(h => h.price > entry);
    let eqhPrices = new Set();
    for (let i = 0; i < validHighs.length; i++) {
      for (let j = i + 1; j < validHighs.length; j++) {
        const diff = Math.abs(validHighs[i].price - validHighs[j].price) / validHighs[i].price;
        if (diff <= 0.0015) {
          const eqhPrice = Math.max(validHighs[i].price, validHighs[j].price);
          eqhPrices.add(eqhPrice);
        }
      }
    }
    for (const eqhPrice of eqhPrices) {
      candidates.push({
        level: eqhPrice * (1 - 0.0012),
        reason: 'Equal Highs (EQH) Liquidity Pool',
        isStructural: true,
      });
    }
  } else {
    const validLows = lows.filter(l => l.price < entry);
    let eqlPrices = new Set();
    for (let i = 0; i < validLows.length; i++) {
      for (let j = i + 1; j < validLows.length; j++) {
        const diff = Math.abs(validLows[i].price - validLows[j].price) / validLows[i].price;
        if (diff <= 0.0015) {
          const eqlPrice = Math.min(validLows[i].price, validLows[j].price);
          eqlPrices.add(eqlPrice);
        }
      }
    }
    for (const eqlPrice of eqlPrices) {
      candidates.push({
        level: eqlPrice * (1 + 0.0012),
        reason: 'Equal Lows (EQL) Liquidity Pool',
        isStructural: true,
      });
    }
  }

  // 2. Individual Swing Highs / Lows
  if (isLong) {
    highs.forEach(s => {
      if (s.price > entry) {
        candidates.push({
          level: s.price * (1 - 0.0012),
          reason: `Swing High (${s.tfLabel || 'Swing'})`,
          isStructural: true,
        });
      }
    });
  } else {
    lows.forEach(s => {
      if (s.price < entry) {
        candidates.push({
          level: s.price * (1 + 0.0012),
          reason: `Swing Low (${s.tfLabel || 'Swing'})`,
          isStructural: true,
        });
      }
    });
  }

  // 3. HTF FVGs
  const htfFvgs = fvgs || [];
  htfFvgs.forEach(f => {
    if (isLong && f.type === 'bearish' && f.upper > entry) {
      candidates.push({
        level: f.midpoint,
        reason: `${biasTf} Bearish FVG Midpoint`,
        isStructural: true,
      });
      candidates.push({
        level: f.upper * (1 - 0.0012),
        reason: `${biasTf} Bearish FVG Far Boundary`,
        isStructural: true,
      });
    } else if (!isLong && f.type === 'bullish' && f.lower < entry) {
      candidates.push({
        level: f.midpoint,
        reason: `${biasTf} Bullish FVG Midpoint`,
        isStructural: true,
      });
      candidates.push({
        level: f.lower * (1 + 0.0012),
        reason: `${biasTf} Bullish FVG Far Boundary`,
        isStructural: true,
      });
    }
  });

  // 4. Fibonacci Extensions of the Primary Range
  let primHigh = highs.filter(h => h.tfLabel === primaryTf && h.price > entry).sort((a, b) => a.price - b.price)[0]?.price;
  let primLow = lows.filter(l => l.tfLabel === primaryTf && l.price < entry).sort((a, b) => b.price - a.price)[0]?.price;

  if (!primHigh) {
    primHigh = highs.sort((a, b) => b.price - a.price)[0]?.price;
  }
  if (!primLow) {
    primLow = lows.sort((a, b) => a.price - b.price)[0]?.price;
  }

  if (primHigh && primLow && primHigh > primLow) {
    const range = primHigh - primLow;
    if (isLong) {
      candidates.push({ level: (primLow + range * 1.272) * (1 - 0.0012), reason: '1.272 Fib Extension', isStructural: true });
      candidates.push({ level: (primLow + range * 1.618) * (1 - 0.0012), reason: '1.618 Fib Extension', isStructural: true });
      candidates.push({ level: (primLow + range * 2.0) * (1 - 0.0012), reason: '2.0 Fib Extension', isStructural: true });
      candidates.push({ level: (primLow + range * 2.618) * (1 - 0.0012), reason: '2.618 Fib Extension', isStructural: true });
    } else {
      candidates.push({ level: (primHigh - range * 1.272) * (1 + 0.0012), reason: '1.272 Fib Extension', isStructural: true });
      candidates.push({ level: (primHigh - range * 1.618) * (1 + 0.0012), reason: '1.618 Fib Extension', isStructural: true });
      candidates.push({ level: (primHigh - range * 2.0) * (1 + 0.0012), reason: '2.0 Fib Extension', isStructural: true });
      candidates.push({ level: (primHigh - range * 2.618) * (1 + 0.0012), reason: '2.618 Fib Extension', isStructural: true });
    }
  }

  // Filter candidates: must be in trade direction and within maxTpPrice
  const filteredCandidates = candidates.filter(c => {
    if (isNaN(c.level) || !isFinite(c.level)) return false;
    if (isLong) {
      return c.level > entry && c.level <= maxTpPrice;
    } else {
      return c.level < entry && c.level >= maxTpPrice;
    }
  });

  // Sort candidates from closest to furthest from entry
  filteredCandidates.sort((a, b) => isLong ? a.level - b.level : b.level - a.level);

  // Deduplicate candidates that are too close (within STRUCT_DEDUP_PCT)
  const dedupedCandidates = [];
  for (const cand of filteredCandidates) {
    const isDup = dedupedCandidates.some(dc => Math.abs(dc.level - cand.level) / dc.level < STRUCT_DEDUP_PCT);
    if (!isDup) {
      dedupedCandidates.push(cand);
    }
  }

  // Systematic fallback ONLY when no structural candidate exists at all
  if (dedupedCandidates.length === 0) {
    if (isLong) {
      dedupedCandidates.push({
        level: entry + risk * minTp1Rrr,
        reason: `${minTp1Rrr.toFixed(1)}R Target (No structures)`,
        isStructural: false,
      });
      dedupedCandidates.push({
        level: entry + risk * (minTp1Rrr + MIN_TP_SPACING_RRR),
        reason: `${(minTp1Rrr + MIN_TP_SPACING_RRR).toFixed(1)}R Target (No structures)`,
        isStructural: false,
      });
      dedupedCandidates.push({
        level: entry + risk * (minTp1Rrr + 2 * MIN_TP_SPACING_RRR),
        reason: `${(minTp1Rrr + 2 * MIN_TP_SPACING_RRR).toFixed(1)}R Target (No structures)`,
        isStructural: false,
      });
    } else {
      dedupedCandidates.push({
        level: entry - risk * minTp1Rrr,
        reason: `${minTp1Rrr.toFixed(1)}R Target (No structures)`,
        isStructural: false,
      });
      dedupedCandidates.push({
        level: entry - risk * (minTp1Rrr + MIN_TP_SPACING_RRR),
        reason: `${(minTp1Rrr + MIN_TP_SPACING_RRR).toFixed(1)}R Target (No structures)`,
        isStructural: false,
      });
      dedupedCandidates.push({
        level: entry - risk * (minTp1Rrr + 2 * MIN_TP_SPACING_RRR),
        reason: `${(minTp1Rrr + 2 * MIN_TP_SPACING_RRR).toFixed(1)}R Target (No structures)`,
        isStructural: false,
      });
    }
  }

  let tp1 = null;
  let tp2 = null;
  let tp3 = null;

  // Find TP1 candidate (first one satisfying RRR >= minTp1Rrr)
  for (const cand of dedupedCandidates) {
    const candRrr = calculateRRR(entry, stopLoss, cand.level);
    if (candRrr >= minTp1Rrr) {
      tp1 = { ...cand, rrr: candRrr };
      break;
    }
  }

  // Find TP2 candidate (first one satisfying RRR >= minTp2Rrr and spacing >= 1.0R from TP1)
  if (tp1) {
    for (const cand of dedupedCandidates) {
      const candRrr = calculateRRR(entry, stopLoss, cand.level);
      const spacingRrr = Math.abs(cand.level - tp1.level) / risk;
      const isFurther = isLong ? cand.level > tp1.level : cand.level < tp1.level;
      if (candRrr >= minTp2Rrr && spacingRrr >= MIN_TP_SPACING_RRR && isFurther) {
        tp2 = { ...cand, rrr: candRrr };
        break;
      }
    }
  }

  // Find TP3 candidate (first one satisfying RRR >= minTp3Rrr and spacing >= 1.0R from TP2)
  if (tp2) {
    for (const cand of dedupedCandidates) {
      const candRrr = calculateRRR(entry, stopLoss, cand.level);
      const spacingRrr = Math.abs(cand.level - tp2.level) / risk;
      const isFurther = isLong ? cand.level > tp2.level : cand.level < tp2.level;
      if (candRrr >= minTp3Rrr && spacingRrr >= MIN_TP_SPACING_RRR && isFurther) {
        tp3 = { ...cand, rrr: candRrr };
        break;
      }
    }
  }

  // If no TP1 satisfies RRR >= minTp1Rrr, return single TP at the first candidate level
  if (!tp1) {
    const firstCand = dedupedCandidates[0];
    const level = firstCand.level;
    const rrr = calculateRRR(entry, stopLoss, level);
    return {
      tps: [{
        level: parseFloat(level.toFixed(4)),
        reason: firstCand.reason,
        rrr,
        isStructural: firstCand.isStructural,
        closePercent: 100,
      }],
      tpStructure: 'single'
    };
  }

  // If we only have TP1
  if (!tp2) {
    return {
      tps: [{
        level: parseFloat(tp1.level.toFixed(4)),
        reason: tp1.reason,
        rrr: tp1.rrr,
        isStructural: tp1.isStructural,
        closePercent: 100,
      }],
      tpStructure: 'single'
    };
  }

  // If we have TP1 and TP2
  if (!tp3) {
    const tps = [
      {
        level: parseFloat(tp1.level.toFixed(4)),
        reason: tp1.reason,
        rrr: tp1.rrr,
        isStructural: tp1.isStructural,
      },
      {
        level: parseFloat(tp2.level.toFixed(4)),
        reason: tp2.reason,
        rrr: tp2.rrr,
        isStructural: tp2.isStructural,
      }
    ];
    const scaling = getDynamicScaling(tier, sessionName, 2);
    tps.forEach((tp, idx) => {
      tp.closePercent = scaling[idx];
    });
    return { tps, tpStructure: 'multiple' };
  }

  // If we have all three
  const tps = [
    {
      level: parseFloat(tp1.level.toFixed(4)),
      reason: tp1.reason,
      rrr: tp1.rrr,
      isStructural: tp1.isStructural,
    },
    {
      level: parseFloat(tp2.level.toFixed(4)),
      reason: tp2.reason,
      rrr: tp2.rrr,
      isStructural: tp2.isStructural,
    },
    {
      level: parseFloat(tp3.level.toFixed(4)),
      reason: tp3.reason,
      rrr: tp3.rrr,
      isStructural: tp3.isStructural,
    }
  ];
  const scaling = getDynamicScaling(tier, sessionName, 3);
  tps.forEach((tp, idx) => {
    tp.closePercent = scaling[idx];
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
