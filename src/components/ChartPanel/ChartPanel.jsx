import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { calculateEMA } from '../../engine/smcDetector.js';
import './ChartPanel.css';

export default function ChartPanel() {
  const { asset, timeframe, candles, livePrice, analysis, backtestMode, backtestTime } = useMarket();
  const dispatch = useMarketDispatch();
  const containerRef  = useRef(null);
  const chartRef      = useRef(null);
  const seriesRef     = useRef(null);  // candlestick series
  const emaRefs       = useRef({});
  const priceLinesRef = useRef([]);
  const backtestLineRef = useRef(null);

  // The key we've currently rendered (asset_timeframe)
  const renderedKeyRef  = useRef(null);
  // Cache of last rendered clean candle array (avoids re-sorting every tick)
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
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#1e2733' },
      timeScale:       { borderColor: '#1e2733', timeVisible: true, secondsVisible: false },
    });

    const series = chart.addCandlestickSeries({
      upColor:        '#00d4aa',
      downColor:      '#ff4d6a',
      borderUpColor:  '#00d4aa',
      borderDownColor:'#ff4d6a',
      wickUpColor:    '#00d4aa',
      wickDownColor:  '#ff4d6a',
    });

    const ema20  = chart.addLineSeries({ color: '#f5c842', lineWidth: 1,   priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema50  = chart.addLineSeries({ color: '#3d9cf0', lineWidth: 1,   priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema200 = chart.addLineSeries({ color: '#9b6dff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    chartRef.current     = chart;
    seriesRef.current    = series;
    emaRefs.current      = { ema20, ema50, ema200 };
    renderedKeyRef.current  = null;
    renderedDataRef.current = [];

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.remove(); };
  }, []);

  // ── 2. Load historical data when asset OR timeframe changes ─
  // This fires ONLY when we intentionally switch symbol/timeframe
  useEffect(() => {
    const key  = `${asset}_${timeframe}`;
    const data = candles[key];

    if (!seriesRef.current || !data || data.length < 5) return;
    // If this key is already rendered and data length hasn't changed much
    // (i.e. this is a WS tick update — handled separately), skip full reload
    if (renderedKeyRef.current === key) return;

    // De-dup + sort
    const seen  = new Set();
    const clean = data
      .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
      .sort((a, b) => a.time - b.time);

    seriesRef.current.setData(clean);
    renderedDataRef.current = clean;
    renderedKeyRef.current  = key;

    // EMAs
    const e20  = calculateEMA(clean, 20);
    const e50  = calculateEMA(clean, 50);
    const e200 = calculateEMA(clean, 200);
    emaRefs.current.ema20.setData( clean.map((c, i) => e20[i]  != null ? { time: c.time, value: e20[i]  } : null).filter(Boolean));
    emaRefs.current.ema50.setData( clean.map((c, i) => e50[i]  != null ? { time: c.time, value: e50[i]  } : null).filter(Boolean));
    emaRefs.current.ema200.setData(clean.map((c, i) => e200[i] != null ? { time: c.time, value: e200[i] } : null).filter(Boolean));

    chartRef.current?.timeScale().fitContent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, timeframe, candles]);
  // Note: candles is in deps so we reload when fresh historical fetch completes.
  // We guard against tick-only updates with the renderedKeyRef check above.

  // ── 3. Live tick — cheaply update ONLY the last candle ──
  useEffect(() => {
    if (!seriesRef.current || !livePrice || backtestMode) return;

    const data = renderedDataRef.current;
    if (!data || data.length === 0) return;
    const last = data[data.length - 1];

    try {
      seriesRef.current.update({
        time:  last.time,
        open:  last.open,
        high:  Math.max(last.high,  livePrice),
        low:   Math.min(last.low,   livePrice),
        close: livePrice,
      });
    } catch (_) { /* chart may not be ready yet */ }
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

  // ── 4. Draw analysis price lines ────────────────────────
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

    // Draw Backtest Vertical Line (as a high price line for now, 
    // lightweight-charts doesn't have vertical lines easily, 
    // so we'll use a marker or custom series, 
    // but for simplicity we'll just use the time in the Ribbon)
    
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

  const showRibbon = analysis && analysis.decision !== 'NO_TRADE' && analysis.entry;

  return (
    <div className="chart-panel">
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: '#f5c842' }} /> EMA 20</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: '#3d9cf0' }} /> EMA 50</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: '#9b6dff' }} /> EMA 200</span>
      </div>

      {showRibbon && (
        <div className={`trade-ribbon fade-in ${analysis.direction}`}>
          {backtestMode && (
            <div className="ribbon-sec backtest">
              <span className="ribbon-label">BACKTEST POINT</span>
              <span className="ribbon-val mono text-yellow">
                {new Date(backtestTime * 1000).toLocaleString()}
              </span>
            </div>
          )}
          
          {analysis.newsCaution && (
            <div className="ribbon-sec news">
              <span className="ribbon-label">ECON CAUTION</span>
              <span className="ribbon-val mono text-yellow">{analysis.newsCaution}</span>
            </div>
          )}

          <div className="ribbon-sec">
            <span className="ribbon-label">ENTRY</span>
            <span className="ribbon-val mono">{analysis.entry.toLocaleString()}</span>
          </div>
          <div className="ribbon-sec">
            <span className="ribbon-label">STOP LOSS</span>
            <span className="ribbon-val mono text-red">
              {analysis.stopLoss?.value?.toLocaleString()} 
              <small style={{ marginLeft: '4px', opacity: 0.8 }}>(-${analysis.projectedLoss})</small>
            </span>
          </div>
          {analysis.tpDetails?.map((tp, i) => (
            <div className="ribbon-sec" key={i}>
              <span className="ribbon-label">TP{i + 1} ({tp.closePercent}%)</span>
              <span className="ribbon-val mono text-green">
                {tp.level?.toLocaleString()}
                <small style={{ marginLeft: '4px', opacity: 0.8 }}>(+${tp.projectedProfit})</small>
              </span>
            </div>
          ))}
          <div className="ribbon-sec size">
            <span className="ribbon-label">POSITION</span>
            <span className="ribbon-val mono">{analysis.positionSize} units</span>
          </div>
        </div>
      )}

      <div className="chart-container" ref={containerRef} />
    </div>
  );
}
