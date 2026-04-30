// ─────────────────────────────────────────────────────────
//  useBinanceWS — Multiplexed WebSocket Hook
//  miniTicker (live price) + kline (chart candle)
// ─────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { BINANCE_WSS } from '../utils/constants.js';
import { useMarketDispatch } from '../context/MarketContext.jsx';
import { log, logError } from '../utils/logger.js';

export function useBinanceWS(symbol, chartTimeframe) {
  const dispatch = useMarketDispatch();
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(1000);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    if (!symbol) return;
    let isMounted = true;
    intentionalCloseRef.current = false;

    function connect() {
      if (!isMounted) return;
      if (wsRef.current) {
        try { 
          intentionalCloseRef.current = true;
          wsRef.current.close(); 
        } catch (_) {}
      }
      clearTimeout(reconnectTimerRef.current);
      intentionalCloseRef.current = false;

      const sym = symbol.toLowerCase();
      const tfMap = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
      const wsInterval = tfMap[chartTimeframe] || '15m';

      const url = `${BINANCE_WSS}?streams=${sym}@miniTicker/${sym}@kline_${wsInterval}`;
      log('ws', `Connecting: ${url}`);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) {
          ws.close();
          return;
        }
        log('ws', `Connected: ${symbol} (${wsInterval})`);
        reconnectDelayRef.current = 1000;
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);
          const data = msg.data;
          if (!data) return;

          if (data.e === '24hrMiniTicker') {
            dispatch({
              type: 'SET_LIVE_PRICE',
              price: parseFloat(data.c),
              change: ((parseFloat(data.c) - parseFloat(data.o)) / parseFloat(data.o)) * 100,
            });
          }

          if (data.e === 'kline') {
            const k = data.k;
            const candle = {
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
            };
            dispatch({
              type: 'UPDATE_LAST_CANDLE',
              key: `${symbol}_${chartTimeframe}`,
              candle,
              isClosed: k.x,
            });
            dispatch({ type: 'SET_LIVE_PRICE', price: candle.close });
          }
        } catch (err) {
          logError('ws', 'Parse error', err);
        }
      };

      ws.onerror = (err) => {
        if (!isMounted) return;
        logError('ws', 'WebSocket error', err);
      };

      ws.onclose = () => {
        if (!isMounted || intentionalCloseRef.current) return;
        log('ws', `Disconnected. Reconnecting in ${reconnectDelayRef.current}ms...`);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
          connect();
        }, reconnectDelayRef.current);
      };
    }

    connect();

    return () => {
      isMounted = false;
      intentionalCloseRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
      }
    };
  }, [symbol, chartTimeframe, dispatch]);
}
