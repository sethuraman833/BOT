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

export default function ControlBar() {
  const { asset, timeframe, isAnalyzing, backtestMode, backtestTime } = useMarket();
  const dispatch = useMarketDispatch();
  const { loadAllTimeframes } = useCandles();
  const [lastRun, setLastRun] = useState(null);

  const handleAnalyze = async () => {
    dispatch({ type: 'SET_ANALYZING', payload: true });
    try {
      const freshData = await loadAllTimeframes(asset);
      if (!freshData) {
        dispatch({ type: 'SET_ANALYZING', payload: false });
        return;
      }

      // ── 1. Handle Backtest Mode (Slicing) ───────────────
      let activeData = freshData;
      if (backtestMode && backtestTime) {
        activeData = {};
        Object.keys(freshData).forEach(tfKey => {
          activeData[tfKey] = freshData[tfKey].filter(c => c.time <= backtestTime);
        });
      }

      // ── 2. Run Engine ──────────────────────────────────
      // Fetch dynamic balance and check news veto in parallel
      const [balance, newsStatus] = await Promise.all([
        getAccountBalance(),
        checkNewsVeto(asset)
      ]);

      const result = runAnalysis(activeData, { 
        symbol: asset, 
        balance: balance,
        newsStatus: newsStatus 
      });
      
      // Update state with algorithmic result first
      dispatch({ type: 'SET_ANALYSIS', payload: result });
      
      // ── 3. Request AI Opinion ──────────────────────────
      if (result.decision === 'TAKE_NOW' || (result.decision === 'WAIT' && result.confluenceScore.total >= 5)) {
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
        
        <div className="control-divider" />
        
        <button 
          className={`backtest-toggle ${backtestMode ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_BACKTEST' })}
          title="Enable Backtest Mode: Click on chart to select entry point"
        >
          {backtestMode ? '🔴 BACKTEST: ON' : '⚪ BACKTEST'}
        </button>
      </div>

      <button
        className={`analyze-btn ${isAnalyzing ? 'running' : ''}`}
        onClick={handleAnalyze}
        disabled={isAnalyzing || (backtestMode && !backtestTime)}
      >
        {isAnalyzing
          ? <><span className="spinner" /> ANALYZING...</>
          : (backtestMode && !backtestTime) 
            ? 'SELECT CHART POINT'
            : '⚡ RUN ANALYSIS'
        }
      </button>

      <div className="control-right">
        {lastRun && <span className="last-run mono">Last: {lastRun}</span>}
      </div>
    </div>
  );
}
