import { useEffect, useState } from 'react';
import { useMarket, useMarketDispatch } from './context/MarketContext.jsx';
import { useBinanceWS } from './hooks/useBinanceWS.js';
import { useCandles, fetchCurrentPrice } from './hooks/useCandles.js';
import { useAnalyze } from './hooks/useAnalyze.js';
import { useHotkeys } from './hooks/useHotkeys.js';
import { formatPrice, formatPercent } from './utils/formatters.js';
import { recordSignal } from './engine/tradeJournal.js';
import Header from './components/Header/Header.jsx';
import ChartPanel from './components/ChartPanel/ChartPanel.jsx';
import AnalysisSidebar from './components/AnalysisSidebar/AnalysisSidebar.jsx';
import ControlBar from './components/ControlBar/ControlBar.jsx';

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
    fetchCurrentPrice(asset).then(priceData => {
      if (priceData) {
        dispatch({ type: 'SET_LIVE_PRICE', price: priceData.price, change: priceData.change });
      }
    });
    loadAllTimeframes(asset);
  }, [asset]); // eslint-disable-line react-hooks/exhaustive-deps

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
      
      <ChartPanel />
      <AnalysisSidebar />

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
        <div className="error-banner-fixed">
          <span>⚠ {error}</span>
          <button onClick={() => dispatch({ type: 'CLEAR_ERROR' })}>✕</button>
        </div>
      )}
    </div>
  );
}
