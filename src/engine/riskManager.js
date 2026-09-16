import { RISK_AMOUNT, ASSETS } from '../utils/constants.js';

/**
 * Calculates the Risk-to-Reward Ratio (RRR) for a given trade.
 * @param {number} entry - The entry price.
 * @param {number} stopLoss - The stop loss price.
 * @param {number} takeProfit - The take profit price.
 * @param {string} [direction='long'] - Trade direction ('long' or 'short').
 * @returns {number} The calculated RRR, rounded to 2 decimal places.
 */
export function calculateRRR(entry, stopLoss, takeProfit, direction = 'long') {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return 0;
  const reward = direction === 'long' ? takeProfit - entry : entry - takeProfit;
  return parseFloat((reward / risk).toFixed(2));
}

/**
 * Calculates the appropriate position size based on a fixed risk amount.
 * @param {number} entry - The entry price.
 * @param {number} stopLoss - The stop loss price.
 * @param {number} [customRiskAmount] - Optional custom risk amount, defaults to RISK_AMOUNT.
 * @param {string} symbol - The trading pair symbol for precision adjusting.
 * @returns {number} The calculated position size.
 */
export function calculatePositionSize(entry, stopLoss, customRiskAmount, symbol) {
  const risk = customRiskAmount !== undefined ? customRiskAmount : RISK_AMOUNT;
  const riskDistance = Math.abs(entry - stopLoss);
  if (riskDistance === 0) return 0;

  const rawQty = risk / riskDistance;

  if (symbol && ASSETS[symbol]) {
    const { minQty } = ASSETS[symbol];
    const qty = Math.max(minQty, Math.floor(rawQty / minQty) * minQty);
    
    const minQtyStr = minQty.toString();
    const dotIndex = minQtyStr.indexOf('.');
    const decimals = dotIndex === -1 ? 0 : minQtyStr.length - dotIndex - 1;
    
    return parseFloat(qty.toFixed(decimals));
  }

  return parseFloat(rawQty.toFixed(6));
}

/**
 * Calculates the required leverage for a trade based on position size and balance.
 * @param {number} positionSize - The calculated position size.
 * @param {number} entryPrice - The entry price.
 * @param {number} balance - The account balance.
 * @returns {number} The calculated leverage.
 */
export function calculateLeverage(positionSize, entryPrice, balance) {
  if (!balance || balance <= 0) return 1;
  const notional = positionSize * entryPrice;
  const leverage = notional / balance;
  return parseFloat(Math.min(125, Math.max(1, leverage)).toFixed(1));
}

/**
 * Estimates the liquidation price of a trade given its leverage.
 * @param {number} entry - The entry price.
 * @param {string} direction - Trade direction ('long' or 'short').
 * @param {number} leverage - The applied leverage.
 * @param {number} [mmr=0.005] - Maintenance Margin Rate (default is 0.5%).
 * @returns {number} The estimated liquidation price.
 */
export function estimateLiquidationPrice(entry, direction, leverage, mmr = 0.005) {
  if (!leverage || leverage <= 0) return 0;
  if (direction === 'long') {
    return parseFloat((entry * (1 - 1 / leverage + mmr)).toFixed(4));
  } else {
    return parseFloat((entry * (1 + 1 / leverage + mmr)).toFixed(4));
  }
}

/**
 * Calculates a Smart Stop Loss with multiple defensive layers.
 * Layers: Liquidity Buffer -> Wick Variance -> FVG Shield -> Volume/Fib Shield.
 * 
 * @param {number} invalidationLevel - Base structural level to defend.
 * @param {string} direction - Trade direction ('long' or 'short').
 * @param {Array} fvgs - Array of Fair Value Gap objects.
 * @param {string} symbol - Trading pair symbol.
 * @param {Object} [fibData] - Fibonacci retracement data.
 * @param {Object} [volumeProfile] - Volume profile data.
 * @param {number} [atr] - Average True Range for capping SL distance.
 * @param {number} [avgWickSize=0] - Average wick size for the stop-hunt buffer.
 * @returns {Object} Smart Stop Loss data structure.
 */
export function calculateSmartSL(
  invalidationLevel,
  direction,
  fvgs,
  symbol,
  fibData = null,
  volumeProfile = null,
  atr = null,
  avgWickSize = 0
) {
  const isLong = direction === 'long';
  const priceDecimals = symbol && ASSETS[symbol] ? ASSETS[symbol].decimals : 4;

  // Layer 1: Base invalidation
  const layer1 = invalidationLevel;

  // Layer 2: Liquidity Buffer (Percentage based)
  let bufferPct = 0.0025; // 0.25% default
  if (symbol && ASSETS[symbol] && ASSETS[symbol].decimals === 2) {
    bufferPct = 0.0015; // tighter for major assets
  }
  const layer2 = isLong ? layer1 * (1 - bufferPct) : layer1 * (1 + bufferPct);

  // Layer 3: Wick-Variance Stop-Hunt Buffer
  const wickBuffer = avgWickSize > 0 ? avgWickSize * 0.5 : 0;
  let layer3 = isLong ? layer2 - wickBuffer : layer2 + wickBuffer;

  // Layer 4: FVG Shield (Avoid placing SL inside an FVG void)
  const maxExtension = atr ? atr * 3 : Math.abs(layer1 - layer3) * 2;
  let fvgReason = null;

  if (fvgs && fvgs.length > 0) {
    if (isLong) {
      const bullishFvgs = fvgs.filter(f => f.type === 'bullish' && f.upper > layer3 && f.lower < layer3);
      if (bullishFvgs.length > 0) {
        const bestFvg = bullishFvgs.reduce((best, f) => (f.lower < best.lower ? f : best));
        if (layer2 - bestFvg.lower <= maxExtension) {
          layer3 = bestFvg.lower;
          fvgReason = `FVG Void avoided (SL below FVG @ $${bestFvg.lower.toFixed(priceDecimals)})`;
        }
      }
    } else {
      const bearishFvgs = fvgs.filter(f => f.type === 'bearish' && f.lower < layer3 && f.upper > layer3);
      if (bearishFvgs.length > 0) {
        const bestFvg = bearishFvgs.reduce((best, f) => (f.upper > best.upper ? f : best));
        if (bestFvg.upper - layer2 <= maxExtension) {
          layer3 = bestFvg.upper;
          fvgReason = `FVG Void avoided (SL above FVG @ $${bestFvg.upper.toFixed(priceDecimals)})`;
        }
      }
    }
  }

  // Layer 5: Volume Profile & Fibonacci AI Shield
  let aiBufferReason = fvgReason;

  if (isLong) {
    if (volumeProfile && layer3 < volumeProfile.valueAreaLow && layer2 >= volumeProfile.valueAreaLow) {
      layer3 = volumeProfile.valueAreaLow * 0.9985;
      aiBufferReason = `Volume Shield — SL outside VA Low ($${volumeProfile.valueAreaLow.toFixed(2)})`;
    }
    if (fibData && fibData.goldenPocket && layer3 < fibData.levels['0.786'] && layer2 >= fibData.goldenPocket.low) {
      layer3 = fibData.levels['0.786'] * 0.9985;
      aiBufferReason = `Fib Defense — SL outside 0.786 ($${fibData.levels['0.786'].toFixed(2)})`;
    }
  } else {
    if (volumeProfile && layer3 > volumeProfile.valueAreaHigh && layer2 <= volumeProfile.valueAreaHigh) {
      layer3 = volumeProfile.valueAreaHigh * 1.0015;
      aiBufferReason = `Volume Shield — SL outside VA High ($${volumeProfile.valueAreaHigh.toFixed(2)})`;
    }
    if (fibData && fibData.goldenPocket && layer3 > fibData.levels['0.786'] && layer2 <= fibData.goldenPocket.high) {
      layer3 = fibData.levels['0.786'] * 1.0015;
      aiBufferReason = `Fib Defense — SL outside 0.786 ($${fibData.levels['0.786'].toFixed(2)})`;
    }
  }

  return {
    value: parseFloat(layer3.toFixed(priceDecimals)),
    rawInvalidation: layer1,
    buffer: aiBufferReason || `±${(bufferPct * 100).toFixed(2)}% liquidity + $${wickBuffer.toFixed(priceDecimals)} wick buffer`,
    layer1,
    layer2,
    layer3,
    wickBuffer,
    fvgReason,
  };
}

/**
 * Helper to get scaling percentages for multi-TP exits.
 */
export function getDynamicScaling(tier, sessionName, tpCount) {
  const isPower = sessionName?.includes('London') || sessionName?.includes('NY');
  const isAsian = sessionName?.includes('Asian') || !sessionName;

  const base = {
    EXCEPTIONAL: [25, 35, 40],
    HIGH:        [30, 40, 30],
    MEDIUM:      [45, 35, 20],
    REJECT:      [70, 20, 10],
  }[tier] || [40, 30, 30];

  let [p1, p2, p3] = base;
  if (isPower) { p1 -= 5; p3 += 5; }
  if (isAsian) { p1 += 10; p3 -= 10; }

  if (tpCount === 1) return [100, 0, 0];
  if (tpCount === 2) return [isPower ? 45 : 55, isPower ? 55 : 45, 0];
  return [p1, p2, p3];
}

/**
 * Calculates progressive Take Profits at 1:3, 1:5, 1:7 aligned with market structure.
 * 
 * @param {number} entry - Trade entry price.
 * @param {number} stopLoss - Calculated stop loss.
 * @param {Array} swingPool - Array of structural swing highs/lows.
 * @param {Array} fvgs - Fair value gaps data.
 * @param {string} direction - 'long' or 'short'.
 * @param {string} tier - Trade conviction tier.
 * @param {string} session - Active trading session.
 * @param {number} maxTpPct - Maximum allowed TP percentage from entry.
 * @param {string} primaryTF - Primary timeframe label.
 * @param {string} structureTF - Structure timeframe label.
 * @param {string} biasTF - Bias timeframe label.
 * @param {number} minRrr - Minimum RRR (usually 3).
 * @param {string} symbol - Asset symbol.
 * @param {Object} fibData - Fibonacci data.
 * @param {Object} volumeProfile - Volume profile data.
 * @returns {Object} TPs array and structure label.
 */
export function calculateTPs(
  entry,
  stopLoss,
  swingPool,
  fvgs,
  direction,
  tier = 'HIGH',
  session = '',
  maxTpPct = 0.06,
  primaryTF = '15M',
  structureTF = '1H',
  biasTF = '4H',
  minRrr = 3.0,
  symbol,
  fibData = null,
  volumeProfile = null
) {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return { tps: [], tpStructure: 'none' };

  const isLong = direction === 'long';
  const candidates = [];

  // Generate structural candidates from swing pools, EQH/EQL, etc.
  if (swingPool && swingPool.length > 0) {
    swingPool.forEach(s => {
      if (isLong && s.type === 'high' && s.price > entry) {
        candidates.push({ level: s.price * 0.9988, reason: `Swing High (${s.tfLabel || 'HTF'})` });
      } else if (!isLong && s.type === 'low' && s.price < entry) {
        candidates.push({ level: s.price * 1.0012, reason: `Swing Low (${s.tfLabel || 'HTF'})` });
      }
    });
  }

  if (fvgs && fvgs.length > 0) {
    fvgs.forEach(f => {
      if (isLong && f.type === 'bearish' && f.upper > entry) {
        candidates.push({ level: f.midpoint, reason: `Bearish FVG Midpoint` });
      } else if (!isLong && f.type === 'bullish' && f.lower < entry) {
        candidates.push({ level: f.midpoint, reason: `Bullish FVG Midpoint` });
      }
    });
  }

  if (volumeProfile && volumeProfile.poc) {
    if ((isLong && volumeProfile.poc > entry) || (!isLong && volumeProfile.poc < entry)) {
      candidates.push({ level: volumeProfile.poc, reason: `Volume POC` });
    }
  }

  // Desired RRR Targets: 1:3, 1:5, 1:7
  const targetRrrs = [Math.max(3.0, minRrr), 5.0, 7.0];
  const tps = [];
  const scaling = getDynamicScaling(tier, session, 3);

  for (let i = 0; i < targetRrrs.length; i++) {
    const targetRrr = targetRrrs[i];
    const exactTarget = isLong ? entry + risk * targetRrr : entry - risk * targetRrr;

    let foundCand = null;
    let minDiff = Infinity;

    // Find the closest valid structural candidate near the target RRR
    for (const cand of candidates) {
      const rrr = calculateRRR(entry, stopLoss, cand.level, direction);
      // Allow candidates slightly before or after the exact RRR (e.g. 2.8 to 4.2 for 3.0 target)
      if (rrr >= targetRrr - 0.2 && rrr <= targetRrr + 1.2) {
        const diff = Math.abs(rrr - targetRrr);
        // Ensure no duplicate TPs too close together
        const isTooClose = tps.some(t => Math.abs(t.level - cand.level) / cand.level < 0.003);
        if (!isTooClose && diff < minDiff) {
          minDiff = diff;
          foundCand = { ...cand, rrr };
        }
      }
    }

    if (foundCand) {
      tps.push({
        level: foundCand.level,
        rrr: foundCand.rrr,
        reason: `1:${targetRrr} Structural — ${foundCand.reason}`,
        isStructural: true,
        closePercent: scaling[i],
      });
    } else {
      tps.push({
        level: exactTarget,
        rrr: targetRrr,
        reason: `1:${targetRrr} Exact Target`,
        isStructural: false,
        closePercent: scaling[i],
      });
    }
  }

  return {
    tps,
    tpStructure: 'progressive_3_5_7',
  };
}

/**
 * Calculates the price level to move the stop loss to breakeven.
 * Generally triggered when trade reaches 2R.
 * 
 * @param {number} entry - Trade entry price.
 * @param {number} stopLoss - Initial stop loss.
 * @param {string} symbol - Trading pair symbol.
 * @returns {number} The trigger price to move SL to breakeven.
 */
export function calculateBreakevenMove(entry, stopLoss, symbol) {
  const risk = Math.abs(entry - stopLoss);
  const isLong = entry > stopLoss;
  const decimals = symbol && ASSETS[symbol] ? ASSETS[symbol].decimals : 2;
  return parseFloat((entry + (isLong ? risk * 2.0 : -risk * 2.0)).toFixed(decimals));
}

/**
 * Calculates trailing stop levels as price hits each TP.
 * 
 * @param {number} entry - Entry price
 * @param {number} stopLoss - Initial SL
 * @param {Array} tpLevels - Array of TP price levels
 * @param {string} direction - 'long' or 'short'
 * @param {string} symbol - Trading pair symbol
 * @returns {Array} Trail schedule
 */
export function calculateTrailingSchedule(entry, stopLoss, tpLevels, direction, symbol) {
  if (!tpLevels || tpLevels.length === 0) return [];
  const decimals = symbol && ASSETS[symbol] ? ASSETS[symbol].decimals : 2;
  const fmt = v => parseFloat(v.toFixed(decimals));

  const schedule = [];
  const risk = Math.abs(entry - stopLoss);
  const isLong = direction === 'long';

  const beTrigger = isLong ? entry + risk * 2.0 : entry - risk * 2.0;
  schedule.push({
    trigger: fmt(beTrigger),
    newSL: fmt(entry),
    label: 'Move SL to Breakeven (2.0R)',
  });

  if (tpLevels[0]) {
    const lockProfit = isLong ? entry + risk * 0.5 : entry - risk * 0.5;
    schedule.push({
      trigger: fmt(tpLevels[0]),
      newSL: fmt(lockProfit),
      label: 'TP1 Hit → Trail SL to Entry + 0.5R',
    });
  }

  if (tpLevels[1] && tpLevels[0]) {
    schedule.push({
      trigger: fmt(tpLevels[1]),
      newSL: fmt(tpLevels[0]),
      label: 'TP2 Hit → Trail SL to TP1',
    });
  }

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
 * Calculates ATR-based trailing stop.
 * 
 * @param {number} currentPrice - Current market price.
 * @param {number} atrValue - Current ATR value.
 * @param {string} direction - 'long' or 'short'.
 * @param {number} [atrMultiplier=2.0] - ATR multiplier.
 * @returns {number} Trailing stop level.
 */
export function calculateATRTrailingStop(currentPrice, atrValue, direction, atrMultiplier = 2.0) {
  if (!atrValue || atrValue <= 0) return 0;
  const trailDist = atrValue * atrMultiplier;
  return direction === 'long' ? currentPrice - trailDist : currentPrice + trailDist;
}
