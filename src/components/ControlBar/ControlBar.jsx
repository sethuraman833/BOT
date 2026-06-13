import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { TIMEFRAMES } from '../../utils/constants.js';
import { useAnalyze } from '../../hooks/useAnalyze.js';
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
  const { timeframe, isAnalyzing, backtestMode, backtestTime, lastAnalysisTime } = useMarket();
  const dispatch = useMarketDispatch();
  const { handleAnalyze } = useAnalyze();

  const modeColor = TF_COLORS[timeframe] || '#3b8ef0';
  const modeLabel = TF_LABELS[timeframe] || timeframe?.toUpperCase();

  return (
    <div className="control-bar" role="toolbar" aria-label="Analysis controls">
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

        <button
          className="tf-refresh-btn"
          onClick={() => window.location.reload()}
          title="Reload Terminal"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-refresh-cw">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
            <path d="M16 16h5v5"/>
          </svg>
          <span>REFRESH</span>
        </button>

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
        {lastAnalysisTime && <span className="last-run">{lastAnalysisTime}</span>}
      </div>
    </div>
  );
}
