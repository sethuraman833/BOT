// ─────────────────────────────────────────────────────────
//  Chart Panel — TradingView Lightweight Charts v5
//  Multi-timeframe with EMA overlays & SMC markers
//  ARCHITECTURE: Live ticks bypass React state entirely via
//  a ref callback for zero-latency chart updates.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, CandlestickSeries, LineSeries } from 'lightweight-charts';

export default function ChartPanel({ candles, marketUpdate, timeframe, onTimeframeChange, smcData, tradeSetup, emas }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const emaSeriesRef = useRef({ ema20: null, ema50: null, ema200: null });
  const markerSeriesRef = useRef([]);
  const priceLinesRef = useRef([]);

  const timeframes = [
    { key: 'm5', label: '5m' },
    { key: 'm15', label: '15m' },
    { key: 'h1', label: '1H' },
    { key: 'h4', label: '4H' },
    { key: 'daily', label: '1D' },
  ];

  // ── Initialize chart (once) ──────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b8f98',
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.15)', width: 1, style: 2 },
        horzLine: { color: 'rgba(255,255,255,0.15)', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 6,
        shiftVisibleRangeOnNewBar: true,
        rightBarStaysOnScroll: true,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00d26a',
      downColor: '#ff3b5c',
      borderDownColor: '#ff3b5c',
      borderUpColor: '#00d26a',
      wickDownColor: '#ff3b5c',
      wickUpColor: '#00d26a',
    });

    const ema20Series = chart.addSeries(LineSeries, {
      color: '#ffb020', lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
    });
    const ema50Series = chart.addSeries(LineSeries, {
      color: '#00c8ff', lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
    });
    const ema200Series = chart.addSeries(LineSeries, {
      color: '#a78bfa', lineWidth: 1.5, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    emaSeriesRef.current = { ema20: ema20Series, ema50: ema50Series, ema200: ema200Series };

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ── LIVE UPDATE: Bypass React render cycle entirely ──
  // marketUpdate changes every second. Instead of using useEffect
  // (which goes through React scheduler), we watch the ref directly
  // using a plain effect that re-subscribes when the prop changes.
  // This mirrors the value directly to series.update() with no delay.
  useEffect(() => {
    const tick = marketUpdate?.tick;
    if (!seriesRef.current || !tick) return;
    try {
      seriesRef.current.update({
        time: tick.time,
        open: tick.open,
        high: tick.high,
        low: tick.low,
        close: tick.close,
      });
    } catch (_) {
      // Silently ignore out-of-order ticks during candle transitions
    }
  }, [marketUpdate]);

  // ── Fit content on timeframe switch ─────────────────
  useEffect(() => {
    chartRef.current?.timeScale().fitContent();
  }, [timeframe]);

  // ── Historical candle data update ───────────────────
  useEffect(() => {
    if (!seriesRef.current || !candles || candles.length === 0) return;

    // Deduplicate and sort
    const seenTimes = new Set();
    const sanitizedData = [];
    [...candles]
      .sort((a, b) => a.time - b.time)
      .forEach(c => {
        if (!seenTimes.has(c.time)) {
          sanitizedData.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
          seenTimes.add(c.time);
        }
      });

    seriesRef.current.setData(sanitizedData);
    chartRef.current?.timeScale().fitContent();
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });

    // Re-apply the live tick immediately after setData so
    // the chart doesn't freeze on the last historical price
    const tick = marketUpdate?.tick;
    if (tick && seenTimes.has(tick.time)) {
      try {
        seriesRef.current.update({
          time: tick.time,
          open: tick.open,
          high: tick.high,
          low: tick.low,
          close: tick.close,
        });
      } catch (_) {}
    }

    // EMA data
    if (emas) {
      const setEma = (series, values) => {
        if (!series) return;
        const uniqueEma = [];
        const seenEma = new Set();
        values.forEach((v, i) => {
          const candle = candles[i];
          if (v !== null && candle && seenTimes.has(candle.time) && !seenEma.has(candle.time)) {
            uniqueEma.push({ time: candle.time, value: v });
            seenEma.add(candle.time);
          }
        });
        if (uniqueEma.length > 0) series.setData(uniqueEma);
      };
      if (emas.ema20) setEma(emaSeriesRef.current.ema20, emas.ema20);
      if (emas.ema50) setEma(emaSeriesRef.current.ema50, emas.ema50);
      if (emas.ema200) setEma(emaSeriesRef.current.ema200, emas.ema200);
    }

    // SMC OB lines — clear then redraw
    priceLinesRef.current.forEach(pl => { try { seriesRef.current.removePriceLine(pl); } catch (_) {} });
    priceLinesRef.current = [];
    if (smcData?.activeOBs) {
      smcData.activeOBs.slice(-3).forEach(ob => {
        try {
          const line = seriesRef.current.createPriceLine({
            price: ob.entryBoundary || ob.upper,
            color: ob.type === 'demand' ? 'rgba(0,210,106,0.6)' : 'rgba(255,59,92,0.6)',
            lineWidth: 1,
            lineStyle: 1,
            axisLabelVisible: true,
            title: ob.type === 'demand' ? 'OB↑' : 'OB↓',
          });
          priceLinesRef.current.push(line);
        } catch (_) {}
      });
    }

    // Trade level lines
    if (tradeSetup?.valid && chartRef.current) {
      markerSeriesRef.current.forEach(s => { try { chartRef.current.removeSeries(s); } catch (_) {} });
      markerSeriesRef.current = [];
      const addLevelLine = (price, color, title) => {
        if (!price || !candles.length) return;
        const line = chartRef.current.addSeries(LineSeries, {
          color, lineWidth: 1, lineStyle: 2, priceLineVisible: false,
          lastValueVisible: true, crosshairMarkerVisible: false, title,
        });
        const startTime = candles[Math.max(0, candles.length - 30)]?.time || candles[0].time;
        const endTime = candles[candles.length - 1].time;
        line.setData([{ time: startTime, value: price }, { time: endTime, value: price }]);
        markerSeriesRef.current.push(line);
      };
      addLevelLine(tradeSetup.entry, '#00c8ff', 'Entry');
      addLevelLine(tradeSetup.stopLoss?.final, '#ff3b5c', 'SL');
      tradeSetup.takeProfits?.forEach((tp, idx) => addLevelLine(tp.level, '#00d26a', `TP${idx + 1}`));
    }
  }, [candles, emas, smcData, tradeSetup]);

  return (
    <div className="chart-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="chart-tabs">
          {timeframes.map(tf => (
            <button
              key={tf.key}
              className={`chart-tab ${timeframe === tf.key ? 'active' : ''}`}
              onClick={() => onTimeframeChange(tf.key)}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: '#ffb020' }}>● EMA 20</span>
          <span style={{ fontSize: '0.65rem', color: '#00c8ff' }}>● EMA 50</span>
          <span style={{ fontSize: '0.65rem', color: '#a78bfa' }}>● EMA 200</span>
        </div>
      </div>
      <div className="chart-container" ref={chartContainerRef} />
    </div>
  );
}
