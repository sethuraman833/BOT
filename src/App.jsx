import { useEffect, useState } from 'react';
import { useMarket, useMarketDispatch } from './context/MarketContext.jsx';
import { useBinanceWS } from './hooks/useBinanceWS.js';
import { useCandles, fetchCurrentPrice, fetchKlines } from './hooks/useCandles.js';
import { useAnalyze } from './hooks/useAnalyze.js';
import { useHotkeys } from './hooks/useHotkeys.js';
import { formatPrice, formatPercent } from './utils/formatters.js';
import { recordSignal } from './engine/tradeJournal.js';
import Header from './components/Header/Header.jsx';
import ChartPanel from './components/ChartPanel/ChartPanel.jsx';
import AnalysisSidebar from './components/AnalysisSidebar/AnalysisSidebar.jsx';
import ControlBar from './components/ControlBar/ControlBar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function App() {
  const { asset, timeframe, error, analysis, livePrice, liveChange, isAnalyzing } = useMarket();
  const dispatch = useMarketDispatch();
  const { loadAllTimeframes } = useCandles();
  const { handleAnalyze } = useAnalyze();

  // Hotkey system: 1-5=TF, E=Analyze, B=Backtest, Ctrl+1-7=Asset
  useHotkeys(dispatch, handleAnalyze, isAnalyzing);

  // 'chart' | 'analysis'
  const [mobileTab, setMobileTab] = useState('chart');

  // Dynamic tab title update (live price + change %)
  useEffect(() => {
    if (livePrice != null) {
      const formattedPrice = formatPrice(livePrice, asset);
      const formattedChange = formatPercent(liveChange);
      document.title = `${formattedPrice} | ${asset} (${formattedChange})`;
    } else {
      document.title = 'TERMINUS — SMC Institutional Trading Terminal';
    }
  }, [livePrice, liveChange, asset]);

  useEffect(() => {
    // Initial fetch
    fetchCurrentPrice(asset).then(priceData => {
      if (priceData) {
        dispatch({ type: 'SET_LIVE_PRICE', price: priceData.price, change: priceData.change });
      }
    });
    loadAllTimeframes(asset);

    // Fallback: Poll REST API every 3 seconds in case WebSocket is blocked (common in some regions)
    const interval = setInterval(() => {
      fetchCurrentPrice(asset).then(priceData => {
        if (priceData) {
          dispatch({ type: 'SET_LIVE_PRICE', price: priceData.price, change: priceData.change });
        }
      });
      
      // Also poll the latest forming candle for the current timeframe
      fetchKlines(asset, timeframe, 2).then(candles => {
        if (candles && candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          dispatch({
            type: 'UPDATE_LAST_CANDLE',
            key: `${asset}_${timeframe}`,
            candle: lastCandle,
            isClosed: false,
          });
        }
      }).catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  }, [asset, timeframe, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  useBinanceWS(asset, timeframe);

  // Auto-switch to analysis tab when a result comes in on mobile
  useEffect(() => {
    if (analysis && window.innerWidth <= 1024) {
      setMobileTab('analysis');
    }
  }, [analysis]);

  // Auto-record trade signals to journal
  useEffect(() => {
    if (analysis && analysis.decision === 'TAKE_NOW') {
      recordSignal(analysis);
    }
  }, [analysis]);

  return (
    <div className={`app-shell tab-${mobileTab}`}>
      <Header />
      
      <ErrorBoundary><ChartPanel /></ErrorBoundary>
      <ErrorBoundary><AnalysisSidebar /></ErrorBoundary>

      <ControlBar />

      {/* ── Mobile Tab Navigation ── */}
      <nav className="mobile-nav">
        <button 
          className={`nav-item ${mobileTab === 'chart' ? 'active' : ''}`}
          onClick={() => setMobileTab('chart')}
        >
          <span className="nav-icon">📊</span>
          <span className="nav-label">Chart</span>
        </button>
        <button 
          className={`nav-item ${mobileTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setMobileTab('analysis')}
        >
          <span className="nav-icon">🧠</span>
          <span className="nav-label">Analysis</span>
          {analysis && <span className="nav-dot" />}
        </button>
      </nav>

      {error && (
        <div className="error-banner-fixed" role="alert" aria-live="assertive">
          <span>⚠ {error}</span>
          <button onClick={() => dispatch({ type: 'CLEAR_ERROR' })}>✕</button>
        </div>
      )}
    </div>
  );
}
