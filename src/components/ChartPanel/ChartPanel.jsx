import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { calculateEMA } from '../../engine/smcDetector.js';
import { ASSETS } from '../../utils/constants.js';
import { formatPrice, formatSize } from '../../utils/formatters.js';
import './ChartPanel.css';

export default function ChartPanel() {
  const { asset, timeframe, candles, livePrice, analysis, backtestMode, backtestTime } = useMarket();
  const dispatch = useMarketDispatch();
  const containerRef  = useRef(null);
  const chartRef      = useRef(null);
  const seriesRef     = useRef(null);
  const volumeRef     = useRef(null);
  const emaRefs       = useRef({});
  const priceLinesRef = useRef([]);
  const backtestLineRef = useRef(null);
  const liveLineRef   = useRef(null);   // live price horizontal line
  const crosshairDataRef = useRef(null); // crosshair OHLCV tooltip data

  const renderedKeyRef  = useRef(null);
  const renderedDataRef = useRef([]);

  // ── 1. Create chart once ────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: 'solid', color: '#080b10' },
        textColor: '#7a8a9a',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(30,39,51,0.5)' },
        horzLines: { color: 'rgba(30,39,51,0.5)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(122, 138, 154, 0.3)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1e2733',
        },
        horzLine: {
          color: 'rgba(122, 138, 154, 0.3)',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1e2733',
        },
      },
      rightPriceScale: {
        borderColor: '#1e2733',
        scaleMargins: { top: 0.05, bottom: 0.15 },
      },
      timeScale: {
        borderColor: '#1e2733',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 7,
        rightOffset: 12,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const series = chart.addCandlestickSeries({
      upColor:        '#00e5b4',
      downColor:      '#ff3f5e',
      borderUpColor:  '#00e5b4',
      borderDownColor:'#ff3f5e',
      wickUpColor:    '#00e5b4',
      wickDownColor:  '#ff3f5e',
      lastPriceAnimation: 1, // Add native pulsing animation
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const ema20  = chart.addLineSeries({ color: '#f5c842', lineWidth: 1,   priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema50  = chart.addLineSeries({ color: '#3d9cf0', lineWidth: 1,   priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema200 = chart.addLineSeries({ color: '#9b6dff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    chartRef.current     = chart;
    seriesRef.current    = series;
    volumeRef.current    = volumeSeries;
    emaRefs.current      = { ema20, ema50, ema200 };
    renderedKeyRef.current  = null;
    renderedDataRef.current = [];

    // ResizeObserver for responsive chart sizing
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
        }
      }
    });
    ro.observe(containerRef.current);

    // Fallback window resize
    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      chart.remove();
    };
  }, []);

  // ── 2. Load historical data when asset OR timeframe changes ─
  useEffect(() => {
    const key  = `${asset}_${timeframe}`;
    const data = candles[key];

    if (!seriesRef.current) return;

    // Clear stale data on key change
    if (renderedKeyRef.current && renderedKeyRef.current !== key) {
      seriesRef.current.setData([]);
      if (volumeRef.current) volumeRef.current.setData([]);
      emaRefs.current.ema20.setData([]);
      emaRefs.current.ema50.setData([]);
      emaRefs.current.ema200.setData([]);
      renderedDataRef.current = [];
      renderedKeyRef.current = null;
      setDebugMsg(''); // Clear stale tick messages
      
      // Immediately force auto-scale so the previous manual zoom doesn't persist
      try {
        chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
        seriesRef.current?.priceScale().applyOptions({ autoScale: true });
      } catch (e) {}

      // Remove live price line
      if (liveLineRef.current) {
        try { seriesRef.current.removePriceLine(liveLineRef.current); } catch (_) {}
        liveLineRef.current = null;
      }
    }

    if (!data || data.length === 0) return;

    const decimals = ASSETS[asset]?.decimals ?? 2;
    seriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: 1 / Math.pow(10, decimals),
      },
    });

    if (renderedKeyRef.current === key) return;

    // De-dup + sort
    const seen  = new Set();
    const clean = data
      .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
      .sort((a, b) => a.time - b.time);

    seriesRef.current.setData(clean);
    renderedDataRef.current = clean;
    renderedKeyRef.current  = key;

    // Volume histogram
    if (volumeRef.current) {
      const volData = clean.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(0,229,180,0.25)' : 'rgba(255,63,94,0.25)',
      }));
      volumeRef.current.setData(volData);
    }

    // EMAs
    const e20  = calculateEMA(clean, 20);
    const e50  = calculateEMA(clean, 50);
    const e200 = calculateEMA(clean, 200);

    const mapEMA = (values, period) =>
      values.map((val, j) => {
        const candle = clean[j + period - 1];
        return candle ? { time: candle.time, value: val } : null;
      }).filter(Boolean);

    emaRefs.current.ema20.setData(mapEMA(e20,  20));
    emaRefs.current.ema50.setData(mapEMA(e50,  50));
    emaRefs.current.ema200.setData(mapEMA(e200, 200));

    // Auto-scroll and auto-scale to latest data
    const timeScale = chartRef.current?.timeScale();
    if (timeScale && clean.length > 0) {
      timeScale.applyOptions({
        barSpacing: 7,
        rightOffset: 12,
      });
      // Force price scale to auto-scale in case user dragged it previously
      try {
        seriesRef.current.priceScale().applyOptions({ autoScale: true });
      } catch (e) {
        // fallback if priceScale method isn't available
      }
      timeScale.scrollToRealTime();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, timeframe, candles]);

  // ── 2b. Sync live WS candle updates ──────────
  useEffect(() => {
    if (!seriesRef.current) return;
    const key  = `${asset}_${timeframe}`;
    if (renderedKeyRef.current !== key) return;

    const data = candles[key];
    if (!data || data.length === 0) return;

    const rendered = renderedDataRef.current;
    if (!rendered || rendered.length === 0) return;

    const lastRendered = rendered[rendered.length - 1];
    const lastData     = data[data.length - 1];
    if (!lastData || !lastRendered) return;

    // New closed candle(s) arrived — push to chart
    if (lastData.time > lastRendered.time) {
      const newCandles = data.filter(c => c.time > lastRendered.time);
      for (const c of newCandles) {
        try {
          seriesRef.current.update(c);
          // Also update volume for new candle
          if (volumeRef.current) {
            volumeRef.current.update({
              time: c.time,
              value: c.volume || 0,
              color: c.close >= c.open ? 'rgba(0,229,180,0.25)' : 'rgba(255,63,94,0.25)',
            });
          }
          rendered.push(c);
          if (rendered.length > 2000) rendered.shift(); // Keep bounded
        } catch (_) {}
      }
    }
    // Update the forming (last) candle in-place
    else if (lastData.time === lastRendered.time) {
      try {
        seriesRef.current.update(lastData);
        // Update volume bar for forming candle
        if (volumeRef.current) {
          volumeRef.current.update({
            time: lastData.time,
            value: lastData.volume || 0,
            color: lastData.close >= lastData.open ? 'rgba(0,229,180,0.25)' : 'rgba(255,63,94,0.25)',
          });
        }
        rendered[rendered.length - 1] = lastData;
      } catch (_) {}
    }
  }, [asset, timeframe, candles]);

  // Debug state to surface errors to the UI
  const [debugMsg, setDebugMsg] = useState('');
  
  // ── 3. Live tick — update last candle + live price line ──
  useEffect(() => {
    if (!seriesRef.current || !livePrice || backtestMode) return;

    const data = renderedDataRef.current;
    if (!data || data.length === 0) return;
    const last = data[data.length - 1];

    // Mutate the local reference so new highs/lows aren't lost on the next tick
    last.high = Math.max(last.high, livePrice);
    last.low  = Math.min(last.low, livePrice);
    last.close = livePrice;

    try {
      seriesRef.current.update({
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
      setDebugMsg(`Tick OK: ${livePrice}`);
    } catch (err) {
      setDebugMsg(`Tick Err: ${err.message}`);
    }
  }, [livePrice, backtestMode]);

  // ── 4. Chart Clicks for Backtest ────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    
    const clickHandler = (param) => {
      if (!backtestMode || !param.time) return;
      dispatch({ type: 'SET_BACKTEST_TIME', payload: param.time });
    };

    chartRef.current.subscribeClick(clickHandler);
    return () => chartRef.current?.unsubscribeClick(clickHandler);
  }, [backtestMode, dispatch]);

  // ── 5. Draw analysis price lines ────────────────────────
  useEffect(() => {
    priceLinesRef.current.forEach(pl => {
      try { seriesRef.current?.removePriceLine(pl); } catch (_) {}
    });
    priceLinesRef.current = [];
    
    if (backtestLineRef.current) {
      try { seriesRef.current?.removePriceLine(backtestLineRef.current); } catch (_) {}
      backtestLineRef.current = null;
    }

    if (!seriesRef.current) return;
    if (!analysis) return;
    if (analysis.decision === 'NO_TRADE' && !backtestMode) return;

    const add = (price, color, title, style = 2) => {
      if (!price || isNaN(price)) return;
      const line = seriesRef.current.createPriceLine({
        price, color, lineWidth: 1, lineStyle: style,
        axisLabelVisible: true, title,
      });
      priceLinesRef.current.push(line);
    };

    add(analysis.entry,        '#3d9cf0', 'ENTRY');
    add(analysis.stopLoss?.value, '#ff4d6a', 'SL', 0);
    
    if (analysis.tpDetails && Array.isArray(analysis.tpDetails)) {
      analysis.tpDetails.forEach((tp, i) => {
        add(tp.level, '#00d4aa', `TP${i + 1}`);
      });
    }
  }, [analysis, backtestMode]);

  // ── Crosshair OHLCV tooltip ──────────────────────────────
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;

    const handler = (param) => {
      if (!param.time || !param.seriesData) {
        crosshairDataRef.current = null;
        return;
      }
      const candleData = param.seriesData.get(seriesRef.current);
      if (candleData) {
        crosshairDataRef.current = candleData;
      }
    };

    chartRef.current.subscribeCrosshairMove(handler);
    return () => {
      try { chartRef.current?.unsubscribeCrosshairMove(handler); } catch (_) {}
    };
  }, []);

  const showRibbon = analysis && analysis.decision !== 'NO_TRADE' && analysis.entry;

  return (
    <div className="chart-panel">
      <div className="chart-legend">
        <span className="legend-item" style={{ color: debugMsg.includes('Err') ? 'red' : 'gray' }}>{debugMsg}</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: '#f5c842' }} /> EMA 20</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: '#3d9cf0' }} /> EMA 50</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: '#9b6dff' }} /> EMA 200</span>
        {livePrice && (
          <span className="legend-live">
            <span className="live-pulse" />
            <span className="legend-price mono">{formatPrice(livePrice, asset)}</span>
          </span>
        )}
      </div>

      {showRibbon && (
        <div className={`trade-ribbon fade-in ${analysis.direction}`}>
          {backtestMode && (
            <div className="ribbon-sec backtest">
              <span className="ribbon-label">BACKTEST POINT</span>
              <span className="ribbon-val mono text-yellow">
                {backtestTime ? new Date(backtestTime * 1000).toLocaleString() : '—'}
              </span>
            </div>
          )}
          
          {analysis.newsCaution && (
            <div className="ribbon-sec news">
              <span className="ribbon-label">ECON CAUTION</span>
              <span className="ribbon-val mono text-yellow">{analysis.newsCautionReason || 'Active'}</span>
            </div>
          )}

          <div className="ribbon-sec">
            <span className="ribbon-label">ENTRY</span>
            <span className="ribbon-val mono">{formatPrice(analysis.entry, asset)}</span>
          </div>
          <div className="ribbon-sec">
            <span className="ribbon-label">STOP LOSS</span>
            <span className="ribbon-val mono text-red">
              {formatPrice(analysis.stopLoss?.value, asset)} 
              <small style={{ marginLeft: '4px', opacity: 0.8 }}>(-${analysis.projectedLoss ?? '—'})</small>
            </span>
          </div>
          {analysis.tpDetails?.map((tp, i) => (
            <div className="ribbon-sec" key={i}>
              <span className="ribbon-label">TP{i + 1} ({tp.closePercent}%)</span>
              <span className="ribbon-val mono text-green">
                {formatPrice(tp.level, asset)}
                <small style={{ marginLeft: '4px', opacity: 0.8 }}>(+${tp.projectedProfit ?? '—'})</small>
              </span>
            </div>
          ))}
          <div className="ribbon-sec size">
            <span className="ribbon-label">POSITION</span>
            <span className="ribbon-val mono">{formatSize(analysis.positionSize)} units</span>
          </div>
        </div>
      )}

      <div className="chart-container" ref={containerRef} />
    </div>
  );
}
