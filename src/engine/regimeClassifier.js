import * as indicators from './regimeIndicators.js';
import { percentileRank } from './utils/statistics.js';

/**
 * Classify market regime based on indicator outputs.
 * @param {Object} inds - Output object of all indicator functions.
 * @param {Object[]} priceHistory - Candles array if needed (often unused explicitly if indicators have everything).
 * @returns {Object} Regime object.
 */
export function classifyRegime(inds, priceHistory) {
  const atrData = inds.atrData || { atrPercentile: 0, isExtreme: false };
  const chop = inds.chop || { chopPercentile: 0 };
  const adx = inds.adx || { adxPercentile: 0 };
  const bb = inds.bb || { bandwidthPercentile: 0 };
  const rangeWidth = inds.rangeWidth || { rangeWidthPercentile: 0 };
  const relVol = inds.relVol || { relVolPercentile: 0 };
  const emaSlope = inds.emaSlope || { slope: 0, slopePercentile: 0, isPositive: false };
  const valueArea = inds.valueArea || { isInValueArea: () => false };
  const estCVD = inds.estimatedCVD || { slope: 0 };
  
  const currentPrice = priceHistory && priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].close : 0;
  
  // Step 1: Calculate 5 independent regime scores
  let chaosScore = 0;
  if (atrData.atrPercentile > 95) chaosScore += 60;
  if (atrData.isExtreme) chaosScore += 20;
  if (chop.chopPercentile > 85 && adx.adxPercentile > 75) chaosScore += 20;
  chaosScore = Math.min(100, chaosScore);
  
  let compressionScore = 0;
  if (bb.bandwidthPercentile < 20) compressionScore += 40;
  if (atrData.atrPercentile < 25) compressionScore += 30;
  if (rangeWidth.rangeWidthPercentile < 20) compressionScore += 30;
  compressionScore = Math.min(100, compressionScore);
  
  let expansionScore = 0;
  if (atrData.atrPercentile > 80) expansionScore += 40;
  if (relVol.relVolPercentile > 75) expansionScore += 30;
  // Approximation for growing emaSlope
  if (Math.abs(emaSlope.slope) > 0.1) expansionScore += 30; 
  expansionScore = Math.min(100, expansionScore);
  
  let trendScore = 0;
  if (adx.adxPercentile > 60) trendScore += 40;
  if (chop.chopPercentile < 40) trendScore += 30;
  if (emaSlope.slopePercentile > 60) trendScore += 30;
  trendScore = Math.min(100, trendScore);
  
  let rangeScore = 0;
  if (adx.adxPercentile < 40) rangeScore += 35;
  if (chop.chopPercentile > 60) rangeScore += 35;
  if (valueArea.isInValueArea(currentPrice)) rangeScore += 30;
  rangeScore = Math.min(100, rangeScore);
  
  // Step 2: Priority hierarchy
  let regime = 'UNCERTAIN';
  let confidence = 0;
  
  if (chaosScore >= 80) {
    regime = 'CHAOTIC';
    confidence = chaosScore;
  } else if (compressionScore >= 70) {
    regime = 'COMPRESSION';
    confidence = compressionScore;
  } else if (expansionScore >= 70) {
    regime = 'EXPANSION';
    confidence = expansionScore;
  } else if (trendScore >= 65) {
    regime = 'TRENDING';
    confidence = trendScore;
  } else if (rangeScore >= 65) {
    regime = 'RANGING';
    confidence = rangeScore;
  }
  
  // Step 3: Direction
  let direction = null;
  if (regime === 'TRENDING') {
    direction = emaSlope.isPositive ? 'long' : 'short';
  } else if (regime === 'EXPANSION') {
    direction = estCVD.slope > 0 ? 'long' : 'short';
  }
  
  // Step 4: Strategy mapping
  const strategyMap = {
    'TRENDING': 'TREND_CONTINUATION',
    'RANGING': 'RANGE_REVERSAL',
    'COMPRESSION': 'BREAKOUT',
    'EXPANSION': 'MOMENTUM',
    'CHAOTIC': null,
    'UNCERTAIN': null
  };
  
  const emojis = {
    'TRENDING': '↑',
    'RANGING': '↔',
    'COMPRESSION': '⚡',
    'EXPANSION': '🌀',
    'CHAOTIC': '❓',
    'UNCERTAIN': '❓'
  };
  
  return {
    regime,
    direction,
    strategy: strategyMap[regime],
    allowTrade: regime !== 'CHAOTIC' && regime !== 'UNCERTAIN',
    scores: { chaosScore, compressionScore, expansionScore, trendScore, rangeScore },
    confidence,
    description: `Current regime is ${regime} with ${confidence}% confidence`,
    emoji: emojis[regime]
  };
}

/**
 * Apply hysteresis to regime classification.
 * @param {Object} currentRegime - Current regime object.
 * @param {Object[]} history - Array of previous regime objects.
 * @param {number} activationThreshold - Confidence required to switch.
 * @param {number} sustainThreshold - Confidence required to maintain.
 * @returns {Object} Stable regime object.
 */
export function applyRegimePersistence(currentRegime, history, activationThreshold = 70, sustainThreshold = 55) {
  if (!history || history.length === 0) return currentRegime;
  
  const lastStable = history[history.length - 1];
  
  if (currentRegime.confidence >= activationThreshold) {
    return currentRegime;
  }
  
  if (lastStable && lastStable.regime === currentRegime.regime && currentRegime.confidence >= sustainThreshold) {
    return currentRegime; // Sustain current active regime
  }
  
  // Decay logic -> return recent stable but maybe mark decaying or fallback to UNCERTAIN
  // For simplicity, return UNCERTAIN if decayed
  if (lastStable && currentRegime.confidence < sustainThreshold) {
    return { ...currentRegime, regime: 'UNCERTAIN', allowTrade: false, strategy: null };
  }
  
  return currentRegime;
}

/**
 * Compute composite momentum score.
 * @param {Object} inds - Indicator values.
 * @param {string} regime - Active regime.
 * @param {string} direction - Active direction ('long' | 'short').
 * @param {Object} session - Session details.
 * @returns {Object} Momentum score object.
 */
export function computeMomentumScore(inds, regime, direction, session) {
  let total = 0;
  const breakdown = {
    trend: { score: 0, max: 20 },
    volatility: { score: 0, max: 20 },
    volume: { score: 0, max: 20 },
    location: { score: 0, max: 15 },
    momentum: { score: 0, max: 15 },
    session: { score: 0, max: 10 },
  };
  
  if (inds.adx && inds.adx.adxPercentile > 60) breakdown.trend.score += 8;
  if (inds.emaSlope && ((direction === 'long' && inds.emaSlope.isPositive) || (direction === 'short' && !inds.emaSlope.isPositive))) breakdown.trend.score += 7;
  breakdown.trend.score += 5; // HTF mock
  
  if (inds.atrData && inds.atrData.atrPercentile > 50) breakdown.volatility.score += 10;
  breakdown.volatility.score += 5; // BB mock
  breakdown.volatility.score += 5; // Spike mock
  
  if (inds.relVol && inds.relVol.relVolPercentile > 60) breakdown.volume.score += 8;
  if (inds.estimatedCVD && ((direction === 'long' && inds.estimatedCVD.slope > 0) || (direction === 'short' && inds.estimatedCVD.slope < 0))) breakdown.volume.score += 7;
  if (inds.estimatedCVD && inds.estimatedCVD.divergence.type === 'NONE') breakdown.volume.score += 5;
  
  breakdown.location.score += 5; // VWAP mock
  breakdown.location.score += 5; // VAH/VAL mock
  breakdown.location.score += 5; // clearance mock
  
  breakdown.momentum.score += 5; // RSI mock
  breakdown.momentum.score += 5; // MACD mock
  breakdown.momentum.score += 5; // no div mock
  
  breakdown.session.score += 5; // kill zone mock
  breakdown.session.score += 3; // overlap mock
  breakdown.session.score += 2; // valid mock
  
  total = breakdown.trend.score + breakdown.volatility.score + breakdown.volume.score + breakdown.location.score + breakdown.momentum.score + breakdown.session.score;
  total = Math.min(100, Math.max(0, total));
  
  let grade = 'SKIP';
  if (total >= 90) grade = 'A+';
  else if (total >= 80) grade = 'A';
  else if (total >= 70) grade = 'B';
  else if (total >= 60) grade = 'C';
  
  return {
    total,
    grade,
    breakdown
  };
}
