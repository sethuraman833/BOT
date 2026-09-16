/**
 * Data quality and safety guards.
 */

/**
 * Check that allData has at least minCandles on the primary timeframe.
 * Returns { valid: boolean, reason: string }
 * @param {Object} allData
 * @param {string} primaryTF
 * @param {number} minCandles
 * @returns {Object}
 */
export function validateCandleData(allData, primaryTF, minCandles = 30) {
  if (!allData || !allData[primaryTF]) {
    return { valid: false, reason: `Missing data for primary timeframe ${primaryTF}` };
  }
  const candles = allData[primaryTF];
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { valid: false, reason: `Insufficient candles: expected ${minCandles}, got ${candles ? candles.length : 0}` };
  }
  return { valid: true, reason: 'Valid' };
}

/**
 * Check daily loss limit using challengeStatus object.
 * Returns { safe: boolean, reason: string }
 * @param {Object} config
 * @param {Object} challengeStatus
 * @returns {Object}
 */
export function checkSafetyGates(config, challengeStatus) {
  if (!config || !config.enabled) {
    return { safe: true, reason: 'Challenge limits not enabled' };
  }
  if (!challengeStatus) {
    return { safe: true, reason: 'No challenge status provided' };
  }
  
  if (challengeStatus.dailyDrawdown >= config.dailyDDLimit) {
    return { safe: false, reason: `Daily drawdown limit reached (${challengeStatus.dailyDrawdown}/${config.dailyDDLimit})` };
  }
  if (challengeStatus.overallDrawdown >= config.maxOverallLoss) {
    return { safe: false, reason: `Max overall loss reached (${challengeStatus.overallDrawdown}/${config.maxOverallLoss})` };
  }
  if (challengeStatus.consecutiveLosses >= config.maxConsecLosses) {
    return { safe: false, reason: `Max consecutive losses reached (${challengeStatus.consecutiveLosses}/${config.maxConsecLosses})` };
  }
  if (challengeStatus.dailyDrawdown >= config.dailyDDLimit * config.ddBudgetPct) {
    return { safe: false, reason: 'Daily drawdown budget threshold reached (soft stop)' };
  }
  
  return { safe: true, reason: 'Safe' };
}

/**
 * Check for extreme volatility spike: last candle body > spikeMultiple × ATR
 * Returns { isSpike: boolean, ratio: number }
 * @param {Object[]} candles
 * @param {number} atr
 * @param {number} spikeMultiple
 * @returns {Object}
 */
export function detectVolatilitySpike(candles, atr, spikeMultiple = 4.5) {
  if (!candles || candles.length === 0 || !atr || atr <= 0) {
    return { isSpike: false, ratio: 0 };
  }
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const ratio = body / atr;
  return {
    isSpike: ratio > spikeMultiple,
    ratio
  };
}

/**
 * Validate that an entry/SL/TP set is internally consistent.
 * Returns { valid: boolean, reason: string }
 * @param {number} entry
 * @param {number} sl
 * @param {number} tp1
 * @param {string} direction
 * @returns {Object}
 */
export function validateTradeLevels(entry, sl, tp1, direction) {
  if (typeof entry !== 'number' || typeof sl !== 'number' || typeof tp1 !== 'number') {
    return { valid: false, reason: 'Trade levels must be numbers' };
  }
  if (entry <= 0 || sl <= 0 || tp1 <= 0) {
    return { valid: false, reason: 'Trade levels must be greater than zero' };
  }
  
  if (direction === 'long') {
    if (sl >= entry) return { valid: false, reason: 'SL must be below entry for long' };
    if (tp1 <= entry) return { valid: false, reason: 'TP must be above entry for long' };
  } else if (direction === 'short') {
    if (sl <= entry) return { valid: false, reason: 'SL must be above entry for short' };
    if (tp1 >= entry) return { valid: false, reason: 'TP must be below entry for short' };
  } else {
    return { valid: false, reason: 'Invalid direction' };
  }
  
  return { valid: true, reason: 'Valid' };
}
