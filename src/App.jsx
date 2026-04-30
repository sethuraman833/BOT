import { useEffect } from 'react';
import { useMarket, useMarketDispatch } from './context/MarketContext.jsx';
import { useBinanceWS } from './hooks/useBinanceWS.js';
import { useCandles } from './hooks/useCandles.js';
import { fetchCurrentPrice } from './hooks/useCandles.js';
import Header from './components/Header/Header.jsx';
import ChartPanel from './components/ChartPanel/ChartPanel.jsx';
import AnalysisSidebar from './components/AnalysisSidebar/AnalysisSidebar.jsx';
import ControlBar from './components/ControlBar/ControlBar.jsx';

export default function App() {
  const { asset, timeframe, error } = useMarket();
  const dispatch = useMarketDispatch();
  const { loadAllTimeframes } = useCandles();

  // ── Load all historical candles when asset changes ──────
  useEffect(() => {
    // Also fetch the REST price immediately as a fallback
    // so the header shows something even before WS connects
    fetchCurrentPrice(asset).then(price => {
      if (price) dispatch({ type: 'SET_LIVE_PRICE', price, change: 0 });
    });
    loadAllTimeframes(asset);
  }, [asset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live WebSocket — price + kline ticks ────────────────
  useBinanceWS(asset, timeframe);

  return (
    <div className="app-shell">
      <Header />
      <ChartPanel />
      <AnalysisSidebar />
      <ControlBar />
      {error && (
        <div
          className="error-banner"
          style={{ position: 'fixed', bottom: 60, left: 24, right: 24, zIndex: 100 }}
        >
          ⚠ {error}
          <button onClick={() => dispatch({ type: 'CLEAR_ERROR' })}>✕</button>
        </div>
      )}
    </div>
  );
}
