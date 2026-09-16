/**
 * Run backtester on historical data with strict NO LOOK-AHEAD.
 */

import { runHybridAnalysis } from './regimeEngine.js';
import { runAnalysis } from './tradeAnalyzer.js';
import { candlesUpTo } from './utils/candleUtils.js';
import { tradeStats } from './utils/statistics.js';

/**
 * Simulate trade outcome using FUTURE candles (candles N+1 onward).
 * @param {Object[]} futureCandles - Candles after the signal.
 * @param {number} entry - Entry price.
 * @param {number} sl - Stop loss price.
 * @param {number} tp1 - Take profit price.
 * @param {string} direction - 'long' or 'short'.
 * @returns {Object|null} Result of the simulated trade or null if not resolved.
 */
function simulateTrade(futureCandles, entry, sl, tp1, direction) {
  if (!futureCandles.length || !sl || !tp1 || !entry) return null;
  const risk = Math.abs(entry - sl);
  if (risk === 0) return null;
  
  for (const candle of futureCandles) {
    if (direction === 'long') {
      if (candle.low <= sl)  return { outcome: 'LOSS', rMultiple: -1 };
      if (candle.high >= tp1) return { outcome: 'WIN', rMultiple: +(Math.abs(tp1 - entry) / risk).toFixed(2) };
    } else {
      if (candle.high >= sl) return { outcome: 'LOSS', rMultiple: -1 };
      if (candle.low <= tp1)  return { outcome: 'WIN', rMultiple: +(Math.abs(entry - tp1) / risk).toFixed(2) };
    }
  }
  return null; // trade not resolved within 100 candles
}

/**
 * Run backtester on historical data.
 * @param {Object} fullCandleData - Full candle history keyed by TF: { '15m': [...], '1h': [...], ... }
 * @param {Object} config - { symbol, balance, activeTimeframe, mode: 'SMC'|'HYBRID' }
 * @param {Object} [options] - { startIndex: number, minCandlesNeeded: number }
 * @returns {Promise<Object>} Full backtest stats
 */
export async function runBacktest(fullCandleData, config, options = {}) {
  // At candle index N, only use candles 0..N
  // Swing detection needs lookback candles AFTER to confirm — account for this:
  // swingLookback = 5, so at candle N, confirmed swings only exist up to N-5
  // The engine itself handles this, but we slice correctly here
  
  const SWING_CONFIRMATION_DELAY = 5; // bars needed after swing to confirm it
  const primaryTF = config.activeTimeframe || '15m';
  const primaryCandles = fullCandleData[primaryTF] || [];
  const { startIndex = 100, minCandlesNeeded = 100 } = options;
  
  const trades = [];
  
  for (let n = startIndex; n < primaryCandles.length - SWING_CONFIRMATION_DELAY; n++) {
    // Slice ALL timeframes up to candle N (no future data)
    const slicedData = {};
    for (const [tf, candles] of Object.entries(fullCandleData)) {
      slicedData[tf] = candlesUpTo(candles, n);
    }
    
    if (slicedData[primaryTF].length < minCandlesNeeded) continue;
    
    // Run analysis
    let result;
    try {
      if (config.mode === 'SMC') {
        result = await runAnalysis(slicedData, config);
      } else {
        result = await runHybridAnalysis(slicedData, config);
      }
    } catch (e) {
      continue; // skip errored candles
    }
    
    if (result.decision !== 'TAKE_NOW') continue;
    
    // Simulate trade outcome using FUTURE candles (candles N+1 onward)
    // This is fine — we're simulating what would have happened
    const futureCandles = primaryCandles.slice(n + 1, n + 100);
    const tradeOutcome = simulateTrade(
      futureCandles,
      result.entry,
      result.stopLoss?.value,
      result.tpDetails?.[0]?.level,
      result.direction
    );
    
    if (!tradeOutcome) continue;
    
    trades.push({
      index: n,
      time: primaryCandles[n].time,
      direction: result.direction,
      entry: result.entry,
      sl: result.stopLoss?.value,
      tp1: result.tpDetails?.[0]?.level,
      rrr: result.tpDetails?.[0]?.rrr,
      outcome: tradeOutcome.outcome, // 'WIN' | 'LOSS'
      rMultiple: tradeOutcome.rMultiple,
      regime: result.regimeInfo?.regime || 'SMC_PURE',
      strategy: result.strategyMode || result.regimeContext?.strategy || 'SMC_PURE',
      session: result.session?.name || 'Unknown',
      qualityScore: result.qualityScore?.total || result.confluenceScore?.aiConfidence || 0,
    });
  }
  
  const rMultiples = trades.map(t => t.rMultiple);
  const baseStats = tradeStats(rMultiples); // from utils/statistics.js
  
  // Group by regime
  const byRegime = {};
  const byStrategy = {};
  const bySession = {};
  const byScoreBucket = { '60-69': [], '70-79': [], '80-89': [], '90-100': [] };
  
  for (const trade of trades) {
    // byRegime
    if (!byRegime[trade.regime]) byRegime[trade.regime] = [];
    byRegime[trade.regime].push(trade.rMultiple);
    
    // byStrategy
    if (!byStrategy[trade.strategy]) byStrategy[trade.strategy] = [];
    byStrategy[trade.strategy].push(trade.rMultiple);
    
    // bySession
    if (!bySession[trade.session]) bySession[trade.session] = [];
    bySession[trade.session].push(trade.rMultiple);
    
    // byScoreBucket
    const score = trade.qualityScore;
    const bucket = score >= 90 ? '90-100' : score >= 80 ? '80-89' : score >= 70 ? '70-79' : score >= 60 ? '60-69' : null;
    if (bucket) byScoreBucket[bucket].push(trade.rMultiple);
  }
  
  // Convert groups to stats
  const statsFor = (rMults) => rMults.length > 0 ? tradeStats(rMults) : null;
  
  return {
    // Summary
    totalTrades:         trades.length,
    ...baseStats,        // winRate, avgRRR, profitFactor, expectancy, etc.
    longWinRate:         statsFor(trades.filter(t => t.direction === 'long').map(t => t.rMultiple))?.winRate ?? null,
    shortWinRate:        statsFor(trades.filter(t => t.direction === 'short').map(t => t.rMultiple))?.winRate ?? null,
    
    // Segmented
    byRegime:   Object.fromEntries(Object.entries(byRegime).map(([k, v])   => [k, statsFor(v)])),
    byStrategy: Object.fromEntries(Object.entries(byStrategy).map(([k, v]) => [k, statsFor(v)])),
    bySession:  Object.fromEntries(Object.entries(bySession).map(([k, v])  => [k, statsFor(v)])),
    byScoreBucket: Object.fromEntries(Object.entries(byScoreBucket).map(([k, v]) => [k, statsFor(v)])),
    
    // Raw trade log (for further analysis)
    trades,
    config,
    mode: config.mode || 'HYBRID',
  };
}

/**
 * Compare SMC vs HYBRID on the same candle data.
 * Runs both engines and returns side-by-side stats.
 * @param {Object} fullCandleData - Full historical candle data.
 * @param {Object} baseConfig - Trading configuration.
 * @param {Object} [options] - Backtest options.
 * @returns {Promise<Object>} Comparison statistics.
 */
export async function compareEngines(fullCandleData, baseConfig, options = {}) {
  const [smcStats, hybridStats] = await Promise.all([
    runBacktest(fullCandleData, { ...baseConfig, mode: 'SMC' }, options),
    runBacktest(fullCandleData, { ...baseConfig, mode: 'HYBRID' }, options),
  ]);
  return {
    SMC:    smcStats,
    HYBRID: hybridStats,
    comparison: {
      winRateDiff:   (hybridStats.winRate - smcStats.winRate).toFixed(3),
      expectancyDiff:(hybridStats.expectancy - smcStats.expectancy).toFixed(3),
      tradesDiff:    hybridStats.totalTrades - smcStats.totalTrades,
    }
  };
}
