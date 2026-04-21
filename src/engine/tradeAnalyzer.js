// ─────────────────────────────────────────────────────────
//  Trade Analyzer — Master Orchestrator
//  Runs the complete 17-step analysis pipeline
// ─────────────────────────────────────────────────────────

import { calculateAllEMAs, calculateRSI, findSwingPoints, averageCandleRange, priceChangePercent } from './indicators.js';
import { detectOrderBlocks, detectFVGs, detectLiquiditySweeps, detectStructureShifts, detectBreakerBlocks, detectEntryCandle } from './smcDetector.js';
import { analyzeDailyBias, analyze4HBias, analyze1HStructure } from './marketStructure.js';
import { getCurrentSession } from './sessionFilter.js';
import { buildTradeSetup, refineEntryWithOTE, calculateRRR } from './riskManager.js';

/**
 * Run the full 17-step analysis pipeline.
 * @param {Object} data — { daily, h4, h1, m15 } candle arrays for trading asset
 * @param {Object} btcData — optional BTC data for market context { daily, h4, h1, m15 }
 * @param {Object} config — { riskAmount, symbol }
 * @returns {Object} complete analysis result
 */
export function runAnalysis(data, btcData, config) {
  const { riskAmount = 5, symbol = 'ETHUSDT' } = config;
  const steps = {};
  const rejections = [];
  let confluenceScore = 0;
  const confluenceFactors = {};

  // ═══════════════════════════════════════════════
  // STEP 1 — DAILY BIAS CONTEXT
  // ═══════════════════════════════════════════════
  steps.step1 = analyzeDailyBias(data.daily);

  // BTC context (if ETH trade)
  let btcContext = null;
  if (btcData) {
    btcContext = analyze4HBias(btcData.h4);
    steps.btcContext = {
      bias: btcContext.bias,
      description: `BTC sentiment: ${btcContext.bias} (${btcContext.strength})`,
    };
  }

  // ═══════════════════════════════════════════════
  // STEP 2 — HIGHER TIMEFRAME BIAS (4H) — PILLAR 1
  // ═══════════════════════════════════════════════
  steps.step2 = analyze4HBias(data.h4);
  const bias4H = steps.step2.bias;

  // PILLAR 1 check
  const pillar1 = bias4H !== 'neutral';
  confluenceFactors.pillar1 = { name: '4H trend aligned', met: pillar1, core: true };
  if (pillar1) confluenceScore++;

  if (bias4H === 'neutral' && steps.step2.trend === 'ranging') {
    rejections.push('4H is ranging with no clear direction');
  }

  // ═══════════════════════════════════════════════
  // STEP 3 — SMART MONEY CONCEPTS — PILLAR 2
  // ═══════════════════════════════════════════════
  const smcH4 = {
    orderBlocks: detectOrderBlocks(data.h4),
    fvgs: detectFVGs(data.h4),
  };

  const swings1H = findSwingPoints(data.h1, 2, 2);
  const smcH1 = {
    orderBlocks: detectOrderBlocks(data.h1),
    fvgs: detectFVGs(data.h1),
    sweeps: detectLiquiditySweeps(data.h1, swings1H.swingHighs, swings1H.swingLows),
  };

  const swings15m = findSwingPoints(data.m15, 2, 2);
  const smc15m = {
    orderBlocks: detectOrderBlocks(data.m15, 1.2),
    fvgs: detectFVGs(data.m15),
    sweeps: detectLiquiditySweeps(data.m15, swings15m.swingHighs, swings15m.swingLows),
  };

  // PILLAR 2: Liquidity event — sweep OR FVG fill on 1H/15m
  const hasLiquidityEvent =
    smcH1.sweeps.length > 0 ||
    smc15m.sweeps.length > 0 ||
    smcH1.fvgs.some(f => f.status === 'filled') ||
    smc15m.fvgs.some(f => f.status === 'filled') ||
    smcH1.fvgs.some(f => f.status === 'unfilled') ||
    smc15m.fvgs.some(f => f.status === 'unfilled');

  const pillar2 = hasLiquidityEvent;
  confluenceFactors.pillar2 = { name: 'Liquidity event present', met: pillar2, core: true };
  if (pillar2) confluenceScore++;

  steps.step3 = {
    h4: smcH4,
    h1: smcH1,
    m15: smc15m,
    hasLiquidityEvent,
    activeOBs: [
      ...smcH4.orderBlocks.filter(ob => !ob.mitigated),
      ...smcH1.orderBlocks.filter(ob => !ob.mitigated),
      ...smc15m.orderBlocks.filter(ob => !ob.mitigated),
    ],
    unfilledFVGs: [
      ...smcH4.fvgs.filter(f => f.status === 'unfilled'),
      ...smcH1.fvgs.filter(f => f.status === 'unfilled'),
      ...smc15m.fvgs.filter(f => f.status === 'unfilled'),
    ],
    validatedSweeps: [
      ...smcH1.sweeps.filter(s => s.validated),
      ...smc15m.sweeps.filter(s => s.validated),
    ],
  };

  // ═══════════════════════════════════════════════
  // STEP 4 — ORDER FLOW SIGNALS (if available from API)
  // ═══════════════════════════════════════════════
  steps.step4 = {
    liquidationClusters: 'Not visible',
    fundingRate: config.fundingRate || 'Neutral',
    openInterest: config.openInterest || 'Not visible',
  };

  // ═══════════════════════════════════════════════
  // STEP 5 — MARKET STRUCTURE 1H
  // ═══════════════════════════════════════════════
  steps.step5 = analyze1HStructure(data.h1);

  // ═══════════════════════════════════════════════
  // STEP 7 — ENTRY TIMING 15m — PILLAR 3
  // ═══════════════════════════════════════════════
  const structureShifts15m = detectStructureShifts(data.m15, swings15m.swingHighs, swings15m.swingLows);

  const hasBOS = structureShifts15m.some(s => s.type === 'BOS');
  const hasCHOCH = structureShifts15m.some(s => s.type === 'CHOCH');
  const pillar3 = hasBOS || hasCHOCH;
  confluenceFactors.pillar3 = { name: '15m BOS/CHOCH confirmed', met: pillar3, core: true };
  if (pillar3) confluenceScore++;

  steps.step7 = {
    structureShifts: structureShifts15m,
    hasBOS,
    hasCHOCH,
    confirmed: pillar3,
  };

  // ═══════════════════════════════════════════════
  // STEP 8 — SESSION FILTER — PILLAR 4
  // ═══════════════════════════════════════════════
  const session = getCurrentSession();
  const pillar4 = session.valid;
  confluenceFactors.pillar4 = { name: 'Session active (London/NY)', met: pillar4, core: true };
  if (pillar4) confluenceScore++;

  steps.step8 = session;

  // ═══════════════════════════════════════════════
  // DETERMINE TRADE DIRECTION
  // ═══════════════════════════════════════════════
  let direction = null;
  if (bias4H === 'bullish') direction = 'long';
  else if (bias4H === 'bearish') direction = 'short';
  else {
    // Check 1H for direction if 4H is neutral
    if (steps.step5.setupType?.includes('bullish')) direction = 'long';
    else if (steps.step5.setupType?.includes('bearish')) direction = 'short';
  }

  // ═══════════════════════════════════════════════
  // STEP 15 — TRADE SETUP (Entry, SL, TP)
  // ═══════════════════════════════════════════════
  let tradeSetup = null;
  const currentPrice = data.m15[data.m15.length - 1].close;

  if (direction) {
    // Find nearest active OB for entry
    const activeOBs = steps.step3.activeOBs
      .filter(ob => (direction === 'long' && ob.type === 'demand') ||
                     (direction === 'short' && ob.type === 'supply'))
      .sort((a, b) => {
        const distA = Math.abs(currentPrice - a.entryBoundary);
        const distB = Math.abs(currentPrice - b.entryBoundary);
        return distA - distB;
      });

    const nearestOB = activeOBs[0];
    let entry = currentPrice;
    let rawInvalidation;

    if (nearestOB) {
      entry = nearestOB.entryBoundary;
      rawInvalidation = nearestOB.invalidation;

      // Try OTE refinement
      if (swings15m.swingHighs.length > 0 && swings15m.swingLows.length > 0) {
        const recentHigh = swings15m.swingHighs[swings15m.swingHighs.length - 1].price;
        const recentLow = swings15m.swingLows[swings15m.swingLows.length - 1].price;
        const oteResult = refineEntryWithOTE(currentPrice, recentLow, recentHigh, nearestOB);
        if (oteResult.refined) {
          entry = oteResult.entry;
          steps.oteRefinement = oteResult;
        }
      }
    } else {
      // Fallback: use recent swing for SL
      if (direction === 'long' && swings15m.swingLows.length > 0) {
        rawInvalidation = swings15m.swingLows[swings15m.swingLows.length - 1].price;
      } else if (direction === 'short' && swings15m.swingHighs.length > 0) {
        rawInvalidation = swings15m.swingHighs[swings15m.swingHighs.length - 1].price;
      } else {
        rawInvalidation = direction === 'long' ? currentPrice * 0.98 : currentPrice * 1.02;
      }
    }

    const swings4H = findSwingPoints(data.h4, 3, 3);

    // Determine swing leg for fib extensions
    let swingLeg = null;
    if (direction === 'long' && swings15m.swingLows.length > 0 && swings15m.swingHighs.length > 0) {
      swingLeg = {
        low: swings15m.swingLows[swings15m.swingLows.length - 1].price,
        high: swings15m.swingHighs[swings15m.swingHighs.length - 1].price,
      };
    } else if (direction === 'short' && swings15m.swingLows.length > 0 && swings15m.swingHighs.length > 0) {
      swingLeg = {
        high: swings15m.swingHighs[swings15m.swingHighs.length - 1].price,
        low: swings15m.swingLows[swings15m.swingLows.length - 1].price,
      };
    }

    tradeSetup = buildTradeSetup({
      direction,
      entry,
      rawInvalidation,
      fvgs: [...smc15m.fvgs, ...smcH1.fvgs],
      swingPoints4H: swings4H,
      swingPoints1H: swings1H,
      fvgs4H: smcH4.fvgs,
      swingLeg,
      riskAmount,
      currentPrice,
      symbol,
    });
  }

  // PILLAR 5: RRR ≥ 1:3
  const pillar5 = tradeSetup?.valid && tradeSetup.rrr >= 3;
  confluenceFactors.pillar5 = { name: 'RRR ≥ 1:3 from structure', met: pillar5, core: true };
  if (pillar5) confluenceScore++;

  steps.step15 = tradeSetup;

  // ═══════════════════════════════════════════════
  // SUPPORTING CONFLUENCE FACTORS (BONUS)
  // ═══════════════════════════════════════════════

  // Daily bias aligned
  const dailyAligned = (direction === 'long' && steps.step1.bias === 'bullish') ||
                       (direction === 'short' && steps.step1.bias === 'bearish');
  confluenceFactors.dailyBias = { name: 'Daily bias aligned', met: dailyAligned, core: false };
  if (dailyAligned) confluenceScore++;

  // RSI divergence
  const hasDivergence = steps.step5.divergence !== null;
  confluenceFactors.rsiDivergence = { name: 'RSI divergence present', met: hasDivergence, core: false };
  if (hasDivergence) confluenceScore++;

  // EMA200 support/resistance at zone
  const emas4H = steps.step2.emas;
  let ema200Acting = false;
  if (emas4H) {
    const ema200Val = emas4H.ema200[emas4H.ema200.length - 1];
    if (ema200Val) {
      const distToEma200 = Math.abs(currentPrice - ema200Val) / currentPrice;
      ema200Acting = distToEma200 < 0.01; // Within 1%
    }
  }
  confluenceFactors.ema200 = { name: 'EMA200 at zone', met: ema200Acting, core: false };
  if (ema200Acting) confluenceScore++;

  // OTE entry bonus
  const oteBonus = steps.oteRefinement?.refined || false;
  confluenceFactors.oteEntry = { name: 'OTE entry (61.8-78.6%)', met: oteBonus, core: false };
  if (oteBonus) confluenceScore++;

  // ═══════════════════════════════════════════════
  // STEP 10 — CONFLUENCE SCORING
  // ═══════════════════════════════════════════════
  steps.step10 = {
    score: confluenceScore,
    maxScore: 11,
    factors: confluenceFactors,
    rating: confluenceScore >= 10 ? 'Exceptional' :
            confluenceScore >= 7 ? 'High' :
            confluenceScore >= 5 ? 'Medium' : 'Reject',
  };

  // ═══════════════════════════════════════════════
  // STEP 11 — HARD REJECTION LIST
  // ═══════════════════════════════════════════════
  const coresMet = [pillar1, pillar2, pillar3, pillar4, pillar5].filter(Boolean).length;
  if (coresMet < 5) rejections.push(`Only ${coresMet}/5 core pillars met`);
  if (confluenceScore <= 4) rejections.push(`Confluence score ${confluenceScore}/11 — too low`);

  // Check if price has moved more than 3% in last 2 hours (8× 15m candles)
  const recentMove = priceChangePercent(data.m15, 8);
  if (recentMove > 3) rejections.push(`Price moved ${recentMove.toFixed(1)}% in last 2h — chasing`);

  // Daily AND 4H both conflict
  if (direction === 'long' && steps.step1.bias === 'bearish' && bias4H === 'bearish') {
    rejections.push('Daily AND 4H both bearish — cannot go long');
  }
  if (direction === 'short' && steps.step1.bias === 'bullish' && bias4H === 'bullish') {
    rejections.push('Daily AND 4H both bullish — cannot go short');
  }

  steps.step11 = { rejections };

  // ═══════════════════════════════════════════════
  // STEP 12 — VOLATILITY AND TRADE DURATION CHECK
  // ═══════════════════════════════════════════════
  const avgRange = averageCandleRange(data.m15);
  let estimatedDuration = null;
  if (tradeSetup?.valid && tradeSetup.takeProfits.length > 0) {
    const tpDist = Math.abs(tradeSetup.takeProfits[0].level - tradeSetup.entry);
    const candlesNeeded = tpDist / avgRange;
    estimatedDuration = (candlesNeeded * 15) / 60; // hours
  }

  steps.step12 = {
    avgCandleRange: avgRange,
    estimatedHours: estimatedDuration,
    withinLimit: estimatedDuration ? estimatedDuration <= 8 : false,
    warning: estimatedDuration && estimatedDuration > 8 ? 'Trade duration likely exceeds 8h' : null,
  };

  if (estimatedDuration && estimatedDuration > 8) {
    rejections.push('Estimated duration exceeds 8 hours');
  }

  // ═══════════════════════════════════════════════
  // STEP 13 — DIRECTION PROBABILITY
  // ═══════════════════════════════════════════════
  let upProb = 50, downProb = 50, rangeProb = 0;

  // Adjust based on evidence
  if (bias4H === 'bullish') { upProb += 15; downProb -= 15; }
  if (bias4H === 'bearish') { downProb += 15; upProb -= 15; }
  if (steps.step1.bias === 'bullish') { upProb += 5; downProb -= 5; }
  if (steps.step1.bias === 'bearish') { downProb += 5; upProb -= 5; }
  if (steps.step5.rsiContext === 'bullish') { upProb += 5; downProb -= 5; }
  if (steps.step5.rsiContext === 'bearish') { downProb += 5; upProb -= 5; }
  if (hasDivergence) {
    if (steps.step5.divergence.type.includes('bullish')) { upProb += 5; downProb -= 5; }
    else { downProb += 5; upProb -= 5; }
  }
  if (bias4H === 'neutral') rangeProb = 30;

  // Normalize
  const total = upProb + downProb + rangeProb;
  upProb = Math.round(upProb / total * 100);
  downProb = Math.round(downProb / total * 100);
  rangeProb = 100 - upProb - downProb;

  steps.step13 = { upProb, downProb, rangeProb };

  const dirProb = direction === 'long' ? upProb : downProb;
  if (dirProb < 55) {
    rejections.push(`Directional probability ${dirProb}% — insufficient conviction`);
  }

  // ═══════════════════════════════════════════════
  // STEP 14 — TRADE DECISION
  // ═══════════════════════════════════════════════
  let decision;
  if (rejections.length > 0) {
    decision = {
      action: 'NO_TRADE',
      reason: rejections[0],
      allReasons: rejections,
      icon: '❌',
    };
  } else if (!pillar3) {
    decision = {
      action: 'WAIT',
      reason: 'Waiting for 15m BOS/CHOCH confirmation',
      trigger: 'Watch for structural break on 15m after liquidity event',
      icon: '⏳',
    };
  } else if (tradeSetup?.valid) {
    decision = {
      action: 'TAKE_TRADE',
      reason: 'All pillars met, confluence sufficient',
      icon: '✅',
    };
  } else {
    decision = {
      action: 'NO_TRADE',
      reason: tradeSetup?.reason || 'Setup did not validate',
      icon: '❌',
    };
  }

  steps.step14 = decision;

  // ═══════════════════════════════════════════════
  // STEP 17 — FINAL SUMMARY
  // ═══════════════════════════════════════════════
  steps.step17 = {
    asset: symbol,
    tradeType: decision.action === 'TAKE_TRADE' ? (direction === 'long' ? 'LONG' : 'SHORT') : 'NO TRADE',
    confluence: `${confluenceScore}/11`,
    session: session.name,
    decision: decision.action,
    setup: tradeSetup?.valid ? tradeSetup : null,
    keyRisk: rejections.length > 0 ? rejections[0] : 'Monitor for structure break against position',
    currentPrice,
    direction,
    probability: { up: upProb, down: downProb, range: rangeProb },
  };

  const outlook = generateOutlook(steps, direction);

  return {
    steps,
    decision,
    outlook, // NEW
    tradeSetup: tradeSetup?.valid ? tradeSetup : null,
    confluenceScore,
    confluenceFactors,
    rejections,
    direction,
    symbol,
    currentPrice,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Summarize technical outlook based on analysis results
 */
function generateOutlook(steps, direction) {
  const bias4H = steps.step2?.bias;
  const biasDaily = steps.step1?.bias;
  const session = steps.step8;
  const liquidityEvent = steps.step3?.hasLiquidityEvent;
  const entryConfirmed = steps.step7?.confirmed;

  let outlook = "";

  if (bias4H === 'neutral') {
    outlook = "Market is currently in an accumulation phase with no clear 4H bias. Expect ranging behavior until a structural break occurs.";
  } else {
    const mainDir = bias4H === 'bullish' ? "Bullish" : "Bearish";
    const recovery = biasDaily === bias4H ? "aligned with" : "counter to";
    
    outlook = `Higher Timeframe bias is ${mainDir}, ${recovery} the daily trend. `;

    if (!liquidityEvent) {
      outlook += `Waiting for a liquidity grab (sweep or FVG fill) into a ${bias4H === 'bullish' ? 'Demand' : 'Supply'} zone. `;
    } else if (!entryConfirmed) {
      outlook += `Liquidity event detected. Currently looking for a ${bias4H === 'bullish' ? 'BOS/CHOCH higher' : 'BOS/CHOCH lower'} on the 15m timeframe to confirm expansion. `;
    } else {
      outlook += `Internal structure has shifted. Expecting a follow-through expansion towards the ${bias4H === 'bullish' ? 'next liquidity pool' : 'downside liquidity'}. `;
    }
  }

  if (session && !session.valid) {
    outlook += `Note: Current time is outside optimal trading sessions; volatility may be low.`;
  }

  return outlook;
}
