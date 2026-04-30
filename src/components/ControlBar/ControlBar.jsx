import { useState } from 'react';
import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { TIMEFRAMES } from '../../utils/constants.js';
import { runAnalysis } from '../../engine/tradeAnalyzer.js';
import { useCandles } from '../../hooks/useCandles.js';
import { formatUTCTime } from '../../utils/formatters.js';
import './ControlBar.css';

export default function ControlBar() {
  const { asset, timeframe, isAnalyzing } = useMarket();
  const dispatch = useMarketDispatch();
  const { loadAllTimeframes } = useCandles();
  const [lastRun, setLastRun] = useState(null);

  const handleAnalyze = async () => {
    dispatch({ type: 'SET_ANALYZING', payload: true });
    try {
      // loadAllTimeframes returns fresh data directly — no stale closure
      const freshData = await loadAllTimeframes(asset);

      if (!freshData) {
        dispatch({ type: 'SET_ANALYZING', payload: false });
        return;
      }

      const result = runAnalysis(freshData, { symbol: asset });
      dispatch({ type: 'SET_ANALYSIS', payload: result });
      setLastRun(formatUTCTime());
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Analysis failed: ' + err.message });
      dispatch({ type: 'SET_ANALYZING', payload: false });
    }
  };

  return (
    <div className="control-bar">
      <div className="control-left">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.key}
            className={`tf-btn ${timeframe === tf.key ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_TIMEFRAME', payload: tf.key })}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <button
        className={`analyze-btn ${isAnalyzing ? 'running' : ''}`}
        onClick={handleAnalyze}
        disabled={isAnalyzing}
      >
        {isAnalyzing
          ? <><span className="spinner" /> ANALYZING...</>
          : '⚡ RUN ANALYSIS'
        }
      </button>

      <div className="control-right">
        {lastRun && <span className="last-run mono">Last: {lastRun}</span>}
      </div>
    </div>
  );
}
