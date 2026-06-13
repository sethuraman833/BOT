// ─────────────────────────────────────────────────────────
//  Risk Manager v11.0 — Risk-Scaled Progressive Engine
// ─────────────────────────────────────────────────────────

import { RISK_AMOUNT, ASSETS } from '../utils/constants.js';

// ── 🎯 Tunable Constants ──────────────────────────────────
const MIN_TP_SPACING_RRR = 1.0;   // Minimum 1R between TPs
const MAX_TP_RISK_MULT   = 7.0;   // Hard cap on TP distance (L8)
const STRUCT_DEDUP_PCT   = 0.003; // Collapse structural levels within 0.3%
const DEDUP_THRESHOLD_R  = 0.2;   // Drop TPs within 0.2R of each other

/**
 * Calculate Risk-to-Reward Ratio (direction-aware - H10).
 * @returns {number} RRR rounded to 2 decimals
 */
export function calculateRRR(entry, stopLoss, takeProfit, direction = 'long') {
  const risk   = Math.abs(entry - stopLoss);
  if (risk === 0) return 0;
  const reward = direction === 'long' ? (takeProfit - entry) : (entry - takeProfit);
  return parseFloat((reward / risk).toFixed(2));
}

/**
 * Calculate position size based on fixed RISK_AMOUNT (C6: step size rounding).
 */
export function calculatePositionSize(entry, stopLoss, customRiskAmount, symbol) {
  const riskAmount = customRiskAmount !== undefined ? customRiskAmount : RISK_AMOUNT;
  const slDistance = Math.abs(entry - stopLoss);
  if (slDistance === 0) return 0;
  const rawQty = riskAmount / slDistance;
  
  if (symbol && ASSETS[symbol]) {
    const minQty = ASSETS[symbol].minQty;
    const stepSize = minQty; // standard stepSize is the minQty for these futures contracts
    const qty = Math.max(minQty, Math.floor(rawQty / stepSize) * stepSize);
    
    // Calculate decimal places from minQty
    const minQtyString = minQty.toString();
    const dotIdx = minQtyString.indexOf('.');
    const stepDecimals = dotIdx === -1 ? 0 : minQtyString.length - dotIdx - 1;
    return parseFloat(qty.toFixed(stepDecimals));
  }
  
  return parseFloat(rawQty.toFixed(6));
}

/**
 * Calculate leverage based on position size, entry price, and account balance (C7).
 */
export function calculateLeverage(positionSize, entryPrice, balance) {
  if (!balance || balance <= 0) return 1;
  const notionalValue = positionSize * entryPrice;
  return parseFloat((notionalValue / balance).toFixed(1));
}

/**
 * Estimate liquidation price for a futures position (C7).
 */
export function estimateLiquidationPrice(entry, direction, leverage, mmr = 0.005) {
  if (!leverage || leverage <= 0) return 0;
  if (direction === 'long') {
    return parseFloat((entry * (1 - 1 / leverage + mmr)).toFixed(4));
  } else {
    return parseFloat((entry * (1 + 1 / leverage - mmr)).toFixed(4));
  }
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
 * Calculate smart stop loss with 3-layer defense using Risk scaling (M10: risk-scaled buffer).
 */
export function calculateSmartSL(invalidationLevel, direction, fvgs, symbol) {
  const layer1 = invalidationLevel;
  
  // Scale buffer based on asset decimal precision or standard risk scale
  let bufferPct = 0.0025; // default 0.25%
  if (symbol && ASSETS[symbol]) {
    const decimals = ASSETS[symbol].decimals;
    if (decimals === 2) bufferPct = 0.0015; // tighter for BTC/ETH/SOL/BNB
    else if (decimals >= 4) bufferPct = 0.004; // wider for XRP/ADA
  }
  
  // Layer 2: buffer above/below Layer 1
  const layer2 = direction === 'long'
    ? layer1 * (1 - bufferPct)
    : layer1 * (1 + bufferPct);

  // Layer 3: Imbalance Void Check
  let layer3 = layer2;
  if (fvgs && fvgs.length > 0) {
    if (direction === 'long') {
      const fvg = fvgs.find(f => f.type === 'bullish' && f.upper > layer2 && f.lower < layer2);
      if (fvg) {
        layer3 = fvg.lower;
      }
    } else {
      const fvg = fvgs.find(f => f.type === 'bearish' && f.lower < layer2 && f.upper > layer2);
      if (fvg) {
        layer3 = fvg.upper;
      }
    }
  }

  // Cap: prevent FVG from widening SL more than the buffer percentage beyond Layer 2
  if (direction === 'long' && layer3 < layer2 * (1 - bufferPct)) {
    layer3 = layer2 * (1 - bufferPct);
  } else if (direction !== 'long' && layer3 > layer2 * (1 + bufferPct)) {
    layer3 = layer2 * (1 + bufferPct);
  }

  const priceDecimals = (symbol && ASSETS[symbol]) ? ASSETS[symbol].decimals : 4;
  return {
    value: parseFloat(layer3.toFixed(priceDecimals)),
    rawInvalidation: invalidationLevel,
    buffer: `±${(bufferPct * 100).toFixed(2)}% liquidity buffer`,
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
 * Primary TP engine combining progressive RRR, risk scaling, and structural logic.
 */
export function calculateTPs(
  entry, stopLoss, allSwings, fvgs,
  direction, tier = 'HIGH', sessionName = '', maxTpPct = 0.06,
  primaryTf = '15M', structureTf = '1H', biasTf = '4H',
  minRrr = 3.0, symbol
) {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return { tps: [], tpStructure: 'single' };

  const isLong = direction === 'long';
  const minTp1Rrr = minRrr;
  const minTp2Rrr = minRrr + 1.0;
  const minTp3Rrr = minRrr + 2.0;
  const priceDecimals = (symbol && ASSETS[symbol]) ? ASSETS[symbol].decimals : 4;

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

  // Fallback: nearest swing from ANY timeframe
  if (!primHigh) {
    primHigh = highs.filter(h => h.price > entry).sort((a, b) => a.price - b.price)[0]?.price;
  }
  if (!primLow) {
    primLow = lows.filter(l => l.price < entry).sort((a, b) => b.price - a.price)[0]?.price;
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

  // Filter candidates: must be in trade direction, positive price (M12), and within maxTpPrice
  const filteredCandidates = candidates.filter(c => {
    if (isNaN(c.level) || !isFinite(c.level) || c.level <= 0) return false;
    const candRrr = calculateRRR(entry, stopLoss, c.level, direction);
    if (candRrr > MAX_TP_RISK_MULT) return false; // Enforce max risk-reward cap (L8)
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
    const candRrr = calculateRRR(entry, stopLoss, cand.level, direction);
    if (candRrr >= minTp1Rrr) {
      tp1 = { ...cand, rrr: candRrr };
      break;
    }
  }

  // Find TP2 candidate (first one satisfying RRR >= minTp2Rrr and spacing >= 1.0R from TP1)
  if (tp1) {
    for (const cand of dedupedCandidates) {
      const candRrr = calculateRRR(entry, stopLoss, cand.level, direction);
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
      const candRrr = calculateRRR(entry, stopLoss, cand.level, direction);
      const spacingRrr = Math.abs(cand.level - tp2.level) / risk;
      const isFurther = isLong ? cand.level > tp2.level : cand.level < tp2.level;
      if (candRrr >= minTp3Rrr && spacingRrr >= MIN_TP_SPACING_RRR && isFurther) {
        tp3 = { ...cand, rrr: candRrr };
        break;
      }
    }
  }

  // If no TP1 satisfies RRR >= minTp1Rrr, reject the trade — never accept sub-minRRR targets
  if (!tp1) {
    return { tps: [], tpStructure: 'rejected', rejectReason: `No TP candidate meets minimum ${minTp1Rrr}R requirement` };
  }

  // If we only have TP1
  if (!tp2) {
    return {
      tps: [{
        level: parseFloat(tp1.level.toFixed(priceDecimals)),
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
        level: parseFloat(tp1.level.toFixed(priceDecimals)),
        reason: tp1.reason,
        rrr: tp1.rrr,
        isStructural: tp1.isStructural,
      },
      {
        level: parseFloat(tp2.level.toFixed(priceDecimals)),
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
      level: parseFloat(tp1.level.toFixed(priceDecimals)),
      reason: tp1.reason,
      rrr: tp1.rrr,
      isStructural: tp1.isStructural,
    },
    {
      level: parseFloat(tp2.level.toFixed(priceDecimals)),
      reason: tp2.reason,
      rrr: tp2.rrr,
      isStructural: tp2.isStructural,
    },
    {
      level: parseFloat(tp3.level.toFixed(priceDecimals)),
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
 * Breakeven price calculation (move SL to entry when 1.5R reached - L10: asset decimals).
 */
export function calculateBreakevenMove(entry, stopLoss, symbol) {
  const risk = Math.abs(entry - stopLoss);
  const dir = entry > stopLoss ? 1 : -1;
  const decimals = (symbol && ASSETS[symbol]) ? ASSETS[symbol].decimals : 2;
  return parseFloat((entry + dir * risk * 1.5).toFixed(decimals));
}

// ─── TRAILING STOP LOGIC ───────────────────────────────────────
// Dynamic SL movement based on TP hits and ATR-based trailing.

/**
 * Calculate trailing stop levels as price hits each TP.
 * Returns a trail schedule: what to set SL to at each milestone.
 * 
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Initial SL
 * @param {Array} tpLevels - Array of TP price levels [tp1, tp2, tp3]
 * @param {string} direction - 'long' or 'short'
 * @param {string} symbol - Trading pair symbol
 * @returns {Array} Trail schedule: [{ trigger, newSL, label }]
 */
export function calculateTrailingSchedule(entry, stopLoss, tpLevels, direction, symbol) {
  if (!tpLevels || tpLevels.length === 0) return [];
  const decimals = (symbol && ASSETS[symbol]) ? ASSETS[symbol].decimals : 2;
  const fmt = v => parseFloat(v.toFixed(decimals));

  const schedule = [];

  // Milestone 1: At 1.5R profit → move SL to breakeven (entry)
  const risk = Math.abs(entry - stopLoss);
  const beTrigger = direction === 'long' ? entry + risk * 1.5 : entry - risk * 1.5;
  schedule.push({
    trigger: fmt(beTrigger),
    newSL: fmt(entry),
    label: 'Move SL to Breakeven (1.5R)',
  });

  // Milestone 2: TP1 hit → trail SL to entry + 0.5R (lock in small profit)
  if (tpLevels[0]) {
    const lockProfit = direction === 'long' ? entry + risk * 0.5 : entry - risk * 0.5;
    schedule.push({
      trigger: fmt(tpLevels[0]),
      newSL: fmt(lockProfit),
      label: 'TP1 Hit → Trail SL to Entry + 0.5R',
    });
  }

  // Milestone 3: TP2 hit → trail SL to TP1
  if (tpLevels[1] && tpLevels[0]) {
    schedule.push({
      trigger: fmt(tpLevels[1]),
      newSL: fmt(tpLevels[0]),
      label: 'TP2 Hit → Trail SL to TP1',
    });
  }

  // Milestone 4: TP3 (terminal exit — close all)
  if (tpLevels[2]) {
    schedule.push({
      trigger: fmt(tpLevels[2]),
      newSL: fmt(tpLevels[1] || tpLevels[0]),
      label: 'TP3 Hit → Close remaining position',
    });
  }

  return schedule;
}

/**
 * Calculate ATR-based trailing stop.
 * Trails the SL at a distance of `atrMultiplier × ATR` behind the price.
 * 
 * @param {number} currentPrice - Current market price
 * @param {number} atrValue - Current ATR value
 * @param {string} direction - 'long' or 'short'
 * @param {number} atrMultiplier - Multiple of ATR for trail distance (default 2.0)
 * @returns {number} Trailing stop level
 */
export function calculateATRTrailingStop(currentPrice, atrValue, direction, atrMultiplier = 2.0) {
  if (!atrValue || atrValue <= 0) return 0;
  const trailDist = atrValue * atrMultiplier;
  if (direction === 'long') {
    return currentPrice - trailDist;
  }
  return currentPrice + trailDist;
}
