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
  const lastDispatchTimeRef = useRef(0);

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
      const tfMap = { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' };
      const wsInterval = tfMap[chartTimeframe] || '15m';

      const url = `${BINANCE_WSS}?streams=${sym}@ticker/${sym}@kline_${wsInterval}/${sym}@aggTrade`;
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

          if (data.e === 'aggTrade') {
            const now = Date.now();
            if (now - lastDispatchTimeRef.current >= 250) {
              lastDispatchTimeRef.current = now;
              dispatch({
                type: 'SET_LIVE_PRICE',
                price: parseFloat(data.p),
              });
            }
          }

          if (data.e === '24hrTicker') {
            dispatch({
              type: 'SET_LIVE_PRICE',
              price: parseFloat(data.c),
              change: parseFloat(data.P),
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
        if (!isMounted || ws !== wsRef.current) return;
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
