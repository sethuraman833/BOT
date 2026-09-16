/**
 * Hybrid Regime + SMC Analysis Engine
 * 
 * Pipeline:
 * 1. Data validation + safety
 * 2. Regime indicators (percentile-based)
 * 3. Regime classification (score-based, mutually exclusive)
 * 4. Regime persistence (hysteresis)
 * 5. Strategy selection
 * 6. Strategy-aware SMC analysis (calls tradeAnalyzer.runAnalysis with regimeContext)
 * 7. Estimated CVD confirmation
 * 8. Quality score (100-point breakdown)
 * 9. Mandatory entry gates (separate from score)
 * 10. Decision: TAKE_NOW / WAIT_RETEST / WAIT_CONFIRMATION / NO_TRADE
 */

import { 
  calculateADX, 
  calculateChoppinessIndex, 
  calculateBollingerBandwidth,
  calculateATRData, 
  calculateEMASlope, 
  calculateEstimatedCVD,
  calculateRelativeVolume, 
  calculateSessionVWAP, 
  calculateValueArea,
  calculatePriceLocation, 
  calculateRangeWidth 
} from './regimeIndicators.js';
import { 
  classifyRegime, 
  applyRegimePersistence, 
  computeMomentumScore 
} from './regimeClassifier.js';
import { runAnalysis } from './tradeAnalyzer.js';
import { 
  validateCandleData, 
  checkSafetyGates, 
  detectVolatilitySpike 
} from './utils/validation.js';
import { candlesUpTo, filterValid } from './utils/candleUtils.js';
import { getCurrentSession, getKillZone } from './sessionFilter.js';
import { ASSETS } from '../utils/constants.js';

// In-memory persistence across calls (per symbol+TF)
const _regimePersistenceState = {}; // keyed by `${symbol}_${tf}`

/**
 * Helper to return a basic NO_TRADE result.
 * @param {string} reason - Rejection reason
 * @param {string[]} steps - Analysis steps
 * @returns {Object}
 */
function noTradeResult(reason, steps) {
  return {
    decision: 'NO_TRADE',
    rejectionReason: reason,
    analysisSteps: steps,
    engineMode: 'HYBRID',
    regimeInfo: null,
    qualityScore: { total: 0, grade: 'SKIP' },
  };
}

/**
 * Run the full hybrid analysis pipeline.
 * @param {Object} allData - Candle data keyed by timeframe: { '1m': [], '5m': [], '15m': [], '1h': [], '4h': [], '1d': [] }
 * @param {Object} config - { symbol, balance, newsStatus, activeTimeframe }
 * @returns {Promise<Object>} Full hybrid analysis result
 */
export async function runHybridAnalysis(allData, config = {}) {
  const { 
    symbol = 'BTCUSDT', 
    balance = 10000, 
    newsStatus = { veto: false }, 
    activeTimeframe = '15m' 
  } = config;
  
  const steps = [];

  // Step 2: Data validation
  const dataCheck = validateCandleData(allData, activeTimeframe, 50);
  if (!dataCheck.valid) return noTradeResult(dataCheck.reason, steps);

  // Step 3: Get candles
  const primaryCandles = allData[activeTimeframe] || [];
  
  // Mapping for bias timeframe
  const biasMap = {
    '1m': '15m',
    '5m': '1h',
    '15m': '4h',
    '1h': '1d',
    '4h': '1d',
    '1d': '1d'
  };
  const biasTf = biasMap[activeTimeframe] || '4h';
  const biasCandles = allData[biasTf] || primaryCandles;

  // Step 4: Calculate all regime indicators (on primary candles)
  const adxData = calculateADX(primaryCandles);
  const chopData = calculateChoppinessIndex(primaryCandles);
  const bbData = calculateBollingerBandwidth(primaryCandles);
  const atrData = calculateATRData(primaryCandles);
  const emaSlope = calculateEMASlope(biasCandles, 20, 5); // use bias TF for trend
  const cvdData = calculateEstimatedCVD(primaryCandles);
  const relVol = calculateRelativeVolume(primaryCandles);
  const vwapData = calculateSessionVWAP(primaryCandles);
  const valueArea = calculateValueArea(primaryCandles);
  const rangeWidth = calculateRangeWidth(primaryCandles);
  
  const currentPrice = primaryCandles[primaryCandles.length - 1].close;
  
  // Need prevHigh/Low from last 20 bars
  const lookbackBars = primaryCandles.slice(Math.max(0, primaryCandles.length - 20));
  const prevHigh = Math.max(...lookbackBars.map(c => c.high));
  const prevLow = Math.min(...lookbackBars.map(c => c.low));
  
  const priceLocation = calculatePriceLocation(
    currentPrice, 
    vwapData.vwap, 
    valueArea.vah, 
    valueArea.val,
    prevHigh, 
    prevLow
  );

  // Step 5: Classify regime
  const indicators = { 
    adx: adxData, 
    chop: chopData, 
    bbData, 
    atrData, 
    emaSlope, 
    relVol, 
    vwap: vwapData, 
    valueArea, 
    estimatedCVD: cvdData, 
    rangeWidth 
  };
  const rawRegime = classifyRegime(indicators, primaryCandles);

  // Step 6: Apply persistence (hysteresis)
  const persistKey = `${symbol}_${activeTimeframe}`;
  if (!_regimePersistenceState[persistKey]) _regimePersistenceState[persistKey] = [];
  const history = _regimePersistenceState[persistKey];
  const regime = applyRegimePersistence(rawRegime, history);
  history.push(rawRegime);
  if (history.length > 10) history.shift(); // keep last 10

  // Step 7: Regime gate
  if (!regime.allowTrade) {
    return {
      decision: 'NO_TRADE',
      regimeInfo: regime,
      rejectionReason: `${regime.emoji} ${regime.regime}: ${regime.description}`,
      analysisSteps: steps,
      engineMode: 'HYBRID',
      qualityScore: { total: 0, grade: 'SKIP' },
    };
  }
  steps.push(`${regime.emoji} Regime: ${regime.regime} (${regime.confidence}%) → Strategy: ${regime.strategy}`);

  // Step 8: CVD confirmation check
  const cvdAligned = regime.direction === 'long'  ? cvdData.slope > 0 :
                     regime.direction === 'short' ? cvdData.slope < 0 : true;
  const cvdDivergence = cvdData.divergence;
  if (cvdDivergence.type !== 'NONE') {
    steps.push(`⚠️ ${cvdData.label}: ${cvdDivergence.description}`);
  }

  // Step 9: Build regimeContext and call SMC engine
  const regimeContext = {
    regime: regime.regime,
    strategy: regime.strategy,
    direction: regime.direction,
    allowTrade: regime.allowTrade,
    cvdAligned,
    confidence: regime.confidence,
  };

  // Run SMC analysis with strategy context
  const smcResult = await runAnalysis(allData, config, regimeContext);

  // Step 10: Compute quality score
  const session = typeof getCurrentSession === 'function' ? getCurrentSession(symbol) : null;
  const qualityScore = computeMomentumScore(
    { adx: adxData, chop: chopData, bbData, atrData, emaSlope, relVol, vwap: vwapData, valueArea, estimatedCVD: cvdData },
    regime.regime,
    regime.direction,
    session
  );

  // Step 11: Mandatory entry gates (separate from score)
  const gates = [
    { name: 'Regime Valid',          pass: regime.allowTrade },
    { name: 'Direction Identified',  pass: !!smcResult.direction },
    { name: 'SMC Setup Found',       pass: smcResult.decision !== 'NO_TRADE' || smcResult.decision === 'WAIT' },
    { name: 'Valid Entry Zone',      pass: !!smcResult.entry },
    { name: 'Valid Stop Loss',       pass: !!smcResult.stopLoss },
    { name: 'RRR >= 1:3',            pass: (smcResult.tpDetails?.[0]?.rrr || 0) >= 3.0 },
    { name: 'Risk = $10',            pass: (smcResult.riskAmount || 0) <= 10 },
    { name: 'Leverage <= 75x',       pass: (smcResult.leverage || 0) <= 75 },
    { name: 'Liquidation Safe',      pass: !!smcResult.liquidationPrice },
  ];
  const failedGates = gates.filter(g => !g.pass);

  // Step 12: Final decision
  let decision = 'NO_TRADE';
  let rejectionReason = null;

  if (failedGates.length > 0) {
    rejectionReason = `Gate failed: ${failedGates.map(g => g.name).join(', ')}`;
  } else if (qualityScore.total < 60) {
    rejectionReason = `Quality score too low: ${qualityScore.total}/100 (min 60)`;
  } else if (regime.strategy === 'BREAKOUT' && smcResult.decision !== 'TAKE_NOW') {
    decision = 'WAIT_RETEST'; // Breakout detected but needs retest confirmation
  } else if (qualityScore.total < 70) {
    decision = 'WAIT_CONFIRMATION';
  } else if (smcResult.decision === 'TAKE_NOW') {
    decision = 'TAKE_NOW';
  } else {
    decision = smcResult.decision; // WAIT or NO_TRADE from SMC engine
    rejectionReason = smcResult.rejectionReason;
  }

  return {
    // Decision
    decision,
    rejectionReason,
    
    // Regime layer
    regimeInfo: regime,
    regimeIndicators: { 
      adxData, 
      chopData, 
      bbData, 
      atrData, 
      emaSlope, 
      cvdData, 
      relVol, 
      vwapData, 
      valueArea, 
      priceLocation 
    },
    
    // Quality layer  
    qualityScore,         
    mandatoryGates: gates,
    
    // SMC layer (all original SMC fields)
    ...smcResult,
    
    // Override decision with hybrid decision
    decision,             
    regimeContext,
    
    // Meta
    engineMode: 'HYBRID',
    analysisSteps: [...steps, ...(smcResult.analysisSteps || [])],
  };
}
