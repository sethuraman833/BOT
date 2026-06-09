import { useState } from 'react';
import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { TIMEFRAMES } from '../../utils/constants.js';
import { runAnalysis } from '../../engine/tradeAnalyzer.js';
import { useCandles } from '../../hooks/useCandles.js';
import { formatUTCTime } from '../../utils/formatters.js';
import { checkNewsVeto } from '../../engine/newsService.js';
import { getAccountBalance } from '../../engine/exchangeService.js';
import { getFrontendAiOpinion } from '../../engine/aiAgent.js';
import './ControlBar.css';

// Timeframe mode colors for indicator dot
const TF_COLORS = {
  '5m':  '#00d4ff',
  '15m': '#3b8ef0',
  '1h':  '#f7c948',
  '4h':  '#9d6fff',
  '1d':  '#ff3f5e',
};
const TF_LABELS = {
  '5m':  '5m SCALP',
  '15m': '15m INTRADAY',
  '1h':  '1H SWING',
  '4h':  '4H POSITION',
  '1d':  '1D TREND',
};

export default function ControlBar() {
  const { asset, timeframe, isAnalyzing, backtestMode, backtestTime, analysis } = useMarket();
  const dispatch = useMarketDispatch();
  const { loadAllTimeframes } = useCandles();
  const [lastRun, setLastRun] = useState(null);

  const handleAnalyze = async () => {
    dispatch({ type: 'SET_ANALYZING', payload: true });
    try {
      const freshData = await loadAllTimeframes(asset);
      if (!freshData) { dispatch({ type: 'SET_ANALYZING', payload: false }); return; }

      // Backtest slice
      let activeData = freshData;
      if (backtestMode && backtestTime) {
        activeData = {};
        Object.keys(freshData).forEach(tfKey => {
          activeData[tfKey] = freshData[tfKey].filter(c => c.time <= backtestTime);
        });
      }

      // Parallel: balance + news
      const [balance, newsStatus] = await Promise.all([
        getAccountBalance(),
        checkNewsVeto(asset),
      ]);

      const result = runAnalysis(activeData, {
        symbol: asset,
        balance: balance,
        newsStatus: newsStatus,
        activeTimeframe: timeframe,   // Adaptive engine per TF
      });

      // News caution propagation
      if (newsStatus.caution) {
        result.newsCaution      = true;
        result.newsCautionReason = newsStatus.reason;
        result.analysisSteps    = [
          ...(result.analysisSteps || []),
          `⚠️ NEWS CAUTION: ${newsStatus.reason} — Wait for post-event BOS confirmation`,
        ];
      }

      dispatch({ type: 'SET_ANALYSIS', payload: result });

      // AI second opinion for high-quality signals
      if (result.decision === 'TAKE_NOW' || (result.decision === 'WAIT' && result.confluenceScore?.total >= 5)) {
        const aiResponse = await getFrontendAiOpinion(result);
        if (aiResponse) {
          result.aiAnalysis = aiResponse;
          dispatch({ type: 'SET_ANALYSIS', payload: { ...result } });
        }
      }

      setLastRun(formatUTCTime());
    } catch (err) {
      console.error(err);
      dispatch({ type: 'SET_ERROR', payload: 'Analysis failed: ' + err.message });
    } finally {
      dispatch({ type: 'SET_ANALYZING', payload: false });
    }
  };

  const modeColor = TF_COLORS[timeframe] || '#3b8ef0';
  const modeLabel = TF_LABELS[timeframe] || timeframe?.toUpperCase();

  return (
    <div className="control-bar">
      <div className="control-left">
        {TIMEFRAMES.filter(tf => tf.key !== '1w').map(tf => (
          <button
            key={tf.key}
            data-tf={tf.key}
            className={`tf-btn ${timeframe === tf.key ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_TIMEFRAME', payload: tf.key })}
            title={TF_LABELS[tf.key]}
          >
            {tf.label}
          </button>
        ))}

        <div className="control-divider" />

        <button
          className={`backtest-toggle ${backtestMode ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_BACKTEST' })}
          title="Enable Backtest Mode: Click on chart to select entry point"
        >
          {backtestMode ? '🔴 BACKTEST' : '◎ BACKTEST'}
        </button>
      </div>

      <button
        className={`analyze-btn ${isAnalyzing ? 'running' : ''}`}
        onClick={handleAnalyze}
        disabled={isAnalyzing || (backtestMode && !backtestTime)}
      >
        {isAnalyzing
          ? <><span className="spinner" /> ANALYZING {timeframe?.toUpperCase()}…</>
          : (backtestMode && !backtestTime)
            ? '↖ SELECT CHART POINT'
            : `⚡ ANALYZE ${timeframe?.toUpperCase()}`
        }
      </button>

      <div className="control-right">
        {/* Mode indicator pill */}
        <div className="mode-indicator">
          <div className="mode-dot" style={{ background: modeColor, boxShadow: `0 0 6px ${modeColor}` }} />
          <span className="mode-text">{modeLabel}</span>
        </div>
        {lastRun && <span className="last-run">{lastRun}</span>}
      </div>
    </div>
  );
}
