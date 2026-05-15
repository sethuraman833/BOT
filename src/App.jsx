import { useEffect, useState } from 'react';
import { useMarket, useMarketDispatch } from './context/MarketContext.jsx';
import { useBinanceWS } from './hooks/useBinanceWS.js';
import { useCandles, fetchCurrentPrice } from './hooks/useCandles.js';
import Header from './components/Header/Header.jsx';
import ChartPanel from './components/ChartPanel/ChartPanel.jsx';
import AnalysisSidebar from './components/AnalysisSidebar/AnalysisSidebar.jsx';
import ControlBar from './components/ControlBar/ControlBar.jsx';

export default function App() {
  const { asset, timeframe, error, analysis } = useMarket();
  const dispatch = useMarketDispatch();
  const { loadAllTimeframes } = useCandles();

  // 'chart' | 'analysis'
  const [mobileTab, setMobileTab] = useState('chart');

  useEffect(() => {
    fetchCurrentPrice(asset).then(price => {
      if (price) dispatch({ type: 'SET_LIVE_PRICE', price, change: 0 });
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
