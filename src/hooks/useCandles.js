// ─────────────────────────────────────────────────────────
//  useCandles — Fetch + Cache OHLCV Data
//  Returns data directly so callers avoid stale closures
// ─────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react';
import { BINANCE_REST, CANDLE_LIMIT, TIMEFRAMES } from '../utils/constants.js';
import { useMarketDispatch } from '../context/MarketContext.jsx';
import { log, logError } from '../utils/logger.js';

async function fetchKlines(symbol, interval, limit = CANDLE_LIMIT, signal) {
  const url = `${BINANCE_REST}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Binance API ${res.status}: ${res.statusText}`);
  const raw = await res.json();
  return raw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function fetchCurrentPrice(symbol) {
  try {
    const res = await fetch(`${BINANCE_REST}/ticker/24hr?symbol=${symbol}`);
    const data = await res.json();
    return {
      price: parseFloat(data.lastPrice),
      change: parseFloat(data.priceChangePercent),
    };
  } catch (_) {
    return null;
  }
}

export function useCandles() {
  const dispatch = useMarketDispatch();
  const abortControllerRef = useRef(null);

  // Returns { [tf]: candles[] } so the caller can use fresh data immediately
  const loadAllTimeframes = useCallback(async (symbol) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    log('api', `Fetching ${CANDLE_LIMIT} candles × all timeframes for ${symbol}`);
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      const resultMap = {};
      await Promise.all(
        TIMEFRAMES.map(async (tf) => {
          const candles = await fetchKlines(symbol, tf.key, CANDLE_LIMIT, abortController.signal);
          resultMap[tf.key] = candles;
          const key = `${symbol}_${tf.key}`;
          dispatch({ type: 'SET_CANDLES', key, payload: candles });
        })
      );
      if (abortController.signal.aborted) return null;
      log('api', `Loaded: ${Object.entries(resultMap).map(([tf, c]) => `${tf}(${c.length})`).join(', ')}`);
      return resultMap; // ← Return fresh data directly — no stale closure
    } catch (err) {
      if (err.name === 'AbortError') {
        log('api', `Fetch aborted for ${symbol}`);
        return null;
      }
      logError('api', `Failed to fetch data for ${symbol}`, err);
      dispatch({ type: 'SET_ERROR', payload: `Failed to load ${symbol}: ${err.message}` });
      return null;
    }
  }, [dispatch]);

  return { loadAllTimeframes };
}
