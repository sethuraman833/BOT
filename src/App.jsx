// ─────────────────────────────────────────────────────────
//  Main App — Professional Crypto Intraday Trading Bot
//  Multi-Layer Confluence System | BTC/ETH/XAU Futures
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header.jsx';
import ChartPanel from './components/ChartPanel.jsx';
import AnalysisPanel from './components/AnalysisPanel.jsx';
import TradeCard from './components/TradeCard.jsx';
import { fetchAllTimeframes, fetchFundingRate, fetchOpenInterest, subscribeKline, subscribeMiniTicker } from './services/binanceApi.js';
import { notifyAnalysisResult } from './services/telegramService.js';
import { calculateAllEMAs } from './engine/indicators.js';
import { runAnalysis } from './engine/tradeAnalyzer.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function App() {
  // ── State ────────────────────────────────────────────
  const [activeAsset, setActiveAsset] = useState('BTCUSDT');
  const [riskAmount, setRiskAmount] = useState(5);
  const [timeframe, setTimeframe] = useState('m15');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Candle data per asset
  const [candleData, setCandleData] = useState({});
  const [btcData, setBtcData] = useState(null);

  // Analysis result
  const [analysis, setAnalysis] = useState(null);

  // WebSocket refs
  const wsRef = useRef([]);

  // ── Fetch Historical Data ────────────────────────────
  const fetchData = useCallback(async (symbol) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllTimeframes(symbol);
      setCandleData(prev => ({ ...prev, [symbol]: data }));

      // Always fetch BTC for context (unless we are BTC)
      if (symbol !== 'BTCUSDT') {
        try {
          const btc = await fetchAllTimeframes('BTCUSDT');
          setBtcData(btc);
        } catch (e) {
          console.warn('Could not fetch BTC context:', e);
        }
      }

      // Fetch funding rate & OI
      const [funding, oi] = await Promise.allSettled([
        fetchFundingRate(symbol),
        fetchOpenInterest(symbol),
      ]);

      // Set live market state from latest candle
      const lastCandle = data.m5?.[data.m5.length - 1] || data.m15[data.m15.length - 1];
      if (lastCandle) {
        const change = ((lastCandle.close - data.daily[data.daily.length - 1]?.open) / data.daily[data.daily.length - 1]?.open) * 100;
        setMarketUpdate({
          price: lastCandle.close,
          change: isNaN(change) ? 0 : change,
          symbol,
          tick: {
            time: lastCandle.time,
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
          }
        });
      }

      setConnected(true);
      setLoading(false);

      return {
        data,
        funding: funding.status === 'fulfilled' ? funding.value : null,
        oi: oi.status === 'fulfilled' ? oi.value : null,
      };
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return null;
    }
  }, []);

  // Ref to track the forming candle OHLC without causing re-renders
  const currentCandleRef = useRef(null);

  // Live Market State — Unified for Zero-Lag Sync
  const [marketUpdate, setMarketUpdate] = useState({
    price: null,
    change: 0,
    symbol: null,
    tick: null, // OHLC for current forming candle
  });

  // ── Start WebSocket (Dual Stream) ─────────────────────
  // @param seedCandle — last historical candle to initialize the live ref
  const startWebSocket = useCallback((symbol, timeframeKey, seedCandle) => {
    // Close all existing subscriptions
    wsRef.current.forEach(sub => sub.close());
    wsRef.current = [];

    // Interval mappings
    const intervalMap = { m5: '5m', m15: '15m', h1: '1h', h4: '4h', daily: '1d' };
    const intervalSeconds = { m5: 300, m15: 900, h1: 3600, h4: 14400, daily: 86400 };
    const interval = intervalMap[timeframeKey] || '15m';
    const candleSeconds = intervalSeconds[timeframeKey] || 900;

    // ✔ Pre-seed the ref from historical data so live ticks work immediately
    if (seedCandle) {
      currentCandleRef.current = { ...seedCandle };
    }

    // Snap any raw timestamp to the nearest candle boundary
    const snapToCandleTime = (unixSec) =>
      Math.floor(unixSec / candleSeconds) * candleSeconds;

    // ─────────────────────────────────────────────────
    // STREAM 1: MiniTicker @ 1s — Last TRADED Price
    // Same price source as kline close — Header === Chart
    // ─────────────────────────────────────────────────
    const miniTickerSub = subscribeMiniTicker(symbol, (tick) => {
      if (tick.symbol !== symbol.toUpperCase()) return;

      const livePrice = tick.price;
      const currentOHLC = currentCandleRef.current;

      // Determine the candle time: prefer kline ref, fallback to snapped boundary
      const candleTime = currentOHLC
        ? currentOHLC.time
        : snapToCandleTime(Math.floor(Date.now() / 1000));

      // Build the live tick for the chart
      const liveTick = {
        time: candleTime,
        open: currentOHLC?.open ?? livePrice,
        high: currentOHLC ? Math.max(currentOHLC.high, livePrice) : livePrice,
        low: currentOHLC ? Math.min(currentOHLC.low, livePrice) : livePrice,
        close: livePrice,  // <- 1-second live price from miniTicker
      };

      // Keep the OHLC ref in sync
      if (currentOHLC) {
        currentCandleRef.current = {
          ...currentOHLC,
          high: liveTick.high,
          low: liveTick.low,
          close: livePrice,
        };
      }

      // Single atomic update — drives Header + Chart on same render
      setMarketUpdate(prev => ({
        price: livePrice,
        change: prev?.change ?? 0,
        symbol: tick.symbol,
        tick: liveTick,
      }));
    });

    // ─────────────────────────────────────────────────
    // STREAM 2: Kline — Maintains proper OHLC candle structure
    // ─────────────────────────────────────────────────
    const klineSub = subscribeKline(symbol, interval, (candle) => {
      if (candle.symbol !== symbol.toUpperCase()) return;

      // Always update the OHLC ref with latest kline data
      currentCandleRef.current = {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };

      // On candle close — append finalized candle to history
      if (candle.isClosed) {
        setCandleData(prev => {
          const existing = prev[symbol];
          if (!existing) return prev;
          const list = existing[timeframeKey];
          if (!list) return prev;
          const lastCandle = list[list.length - 1];
          if (lastCandle && lastCandle.time === candle.time) {
            const newList = [...list];
            newList[newList.length - 1] = { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
            return { ...prev, [symbol]: { ...existing, [timeframeKey]: newList } };
          } else if (lastCandle && candle.time < lastCandle.time) {
            return prev;
          }
          const newList = [...list, { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }];
          if (newList.length > 500) newList.shift();
          return { ...prev, [symbol]: { ...existing, [timeframeKey]: newList } };
        });
      }
    });

    wsRef.current.push(miniTickerSub, klineSub);
    setConnected(true);
  }, []);

  // ── Initial Load & WS Lifecycle ──────────────────────
  useEffect(() => {
    fetchData(activeAsset).then((result) => {
      if (!result) return;
      // Pass the last historical candle so the chart starts live immediately
      const seedCandle = result.data[timeframe]?.[result.data[timeframe].length - 1];
      startWebSocket(activeAsset, timeframe, seedCandle);
    });

    return () => {
      wsRef.current.forEach(sub => sub.close());
    };
  }, [activeAsset, timeframe]);

  // ── Run Analysis ─────────────────────────────────────
  const handleRunAnalysis = useCallback(async () => {
    setLoading(true);
    
    // Refresh data first
    const result = await fetchData(activeAsset);
    if (!result) {
      setLoading(false);
      return;
    }

    const { data, funding, oi } = result;

    try {
      const analysisResult = runAnalysis(
        data,
        activeAsset !== 'BTCUSDT' ? btcData : null,
        {
          riskAmount,
          symbol: activeAsset,
          fundingRate: funding?.fundingRate
            ? (funding.fundingRate > 0.001 ? 'Extreme positive' :
               funding.fundingRate < -0.001 ? 'Extreme negative' : 'Neutral')
            : 'Not available',
          openInterest: oi ? 'Available' : 'Not visible',
        }
      );

      setAnalysis(analysisResult);

      // 📬 Telegram — only notify on confirmed trades
      if (analysisResult.decision?.action === 'TAKE_TRADE') {
        notifyAnalysisResult(analysisResult, activeAsset, riskAmount)
          .catch(e => console.warn('[Telegram] Notification failed:', e.message));
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setError('Analysis failed: ' + err.message);
    }

    setLoading(false);
  }, [activeAsset, riskAmount, btcData, fetchData]);

  // ── Asset Change ─────────────────────────────────────
  const handleAssetChange = useCallback((symbol) => {
    setActiveAsset(symbol);
    setAnalysis(null);
  }, []);

  // ── Get current chart data ───────────────────────────
  const currentData = candleData[activeAsset];
  const chartCandles = currentData?.[timeframe] || [];
  const chartEMAs = chartCandles.length > 200 ? calculateAllEMAs(chartCandles) : null;

  return (
    <div className="app">
      <Header
        activeAsset={activeAsset}
        onAssetChange={handleAssetChange}
        marketUpdate={marketUpdate}
        connected={connected}
        riskAmount={riskAmount}
        onRiskChange={setRiskAmount}
        onRunAnalysis={handleRunAnalysis}
        loading={loading}
      />

      {/* Error Banner */}
      {error && (
        <div style={{
          padding: '12px 20px',
          background: 'var(--red-dim)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(255,59,92,0.15)',
          color: 'var(--red)',
          fontSize: '0.85rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} style={{
            background: 'none', border: 'none', color: 'var(--red)',
            cursor: 'pointer', fontSize: '1rem'
          }}>✕</button>
        </div>
      )}

      {/* Main Grid Content */}
      <div className="main-content">
        {/* Chart — wrapped in ErrorBoundary to prevent chart crashes */}
        <ErrorBoundary>
          <ChartPanel
            candles={chartCandles}
            marketUpdate={marketUpdate}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            smcData={analysis?.steps?.step3}
            tradeSetup={analysis?.tradeSetup}
            emas={chartEMAs}
          />
        </ErrorBoundary>

        {/* Analysis Sidebar */}
        <AnalysisPanel
          analysis={analysis}
          loading={loading}
        />
      </div>

      {/* Trade Notification Layer */}
      {analysis && (
        <div className="trade-overlay-layer fade-in">
          <TradeCard analysis={analysis} />
        </div>
      )}
    </div>
  );
}
