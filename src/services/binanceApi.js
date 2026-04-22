// ─────────────────────────────────────────────────────────
//  Binance Futures API — REST + WebSocket
//  Pairs: BTCUSDT, ETHUSDT, XAUUSDT  (Futures only)
// ─────────────────────────────────────────────────────────

// In dev, Vite proxy handles /fapi → fapi.binance.com
// In production (Vercel), VITE_API_BASE is set to https://fapi.binance.com
const BASE_REST = import.meta.env?.VITE_API_BASE ?? '';
const BASE_WS   = 'wss://fstream.binance.com/ws';

// ── REST: Historical Klines ──────────────────────────────

/**
 * Fetch historical candlestick data from Binance Futures.
 * @param {string} symbol  – e.g. 'BTCUSDT'
 * @param {string} interval – e.g. '15m', '1h', '4h', '1d'
 * @param {number} limit   – number of candles (max 1500, default 500)
 * @returns {Promise<Array>} array of candle objects
 */
export async function fetchKlines(symbol, interval, limit = 500) {
  const url = `${BASE_REST}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const raw = await res.json();

  return raw.map(k => ({
    time:   Math.floor(k[0] / 1000),        // Unix seconds
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/**
 * Fetch candles for all required timeframes at once.
 * Carefully bounded limits to guarantee structural visibility:
 * - Daily: 200 (~6 months)
 * - 4H: 200 (33 days) — CRITICAL for deep unmitigated OBs
 * - 1H: 150 (6 days)  — BOS/CHOCH sequence and OTE legs
 * - 15m: 100 (~1 day) — Sweep validation and displacement
 * - 5m: 80 (~6 hours)— Entry timing precision
 */
export async function fetchAllTimeframes(symbol) {
  const [daily, h4, h1, m15, m5] = await Promise.all([
    fetchKlines(symbol, '1d', 200),
    fetchKlines(symbol, '4h', 200),
    fetchKlines(symbol, '1h', 150),
    fetchKlines(symbol, '15m', 100),
    fetchKlines(symbol, '5m', 80),
  ]);
  return { daily, h4, h1, m15, m5 };
}

// ── WebSocket: Real-time Kline Stream ────────────────────

/**
 * Subscribe to a real-time kline stream.
 * @param {string} symbol   – e.g. 'btcusdt' (lowercase for WS)
 * @param {string} interval – e.g. '15m'
 * @param {Function} onCandle – callback with parsed candle
 * @returns {{ close: Function }} – call close() to disconnect
 */
export function subscribeKline(symbol, interval, onCandle) {
  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  const ws = new WebSocket(`${BASE_WS}/${stream}`);
  let reconnectTimer = null;
  let isClosing = false;

  ws.onopen = () => {
    console.log(`[WS] Connected: ${stream}`);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.e === 'kline') {
      const k = msg.k;
      onCandle({
        time:     Math.floor(k.t / 1000),
        open:     parseFloat(k.o),
        high:     parseFloat(k.h),
        low:      parseFloat(k.l),
        close:    parseFloat(k.c),
        volume:   parseFloat(k.v),
        isClosed: k.x,
        symbol:   k.s, // Note: Binance returns uppercase e.g. 'BTCUSDT'
        interval: k.i,
      });
    }
  };

  ws.onerror = (err) => {
    if (!isClosing) {
      console.error(`[WS] Error on ${stream}:`, err);
    }
  };

  ws.onclose = () => {
    if (isClosing) {
      console.log(`[WS] Closed intentionally: ${stream}`);
      return;
    }
    console.log(`[WS] Disconnected: ${stream}, reconnecting in 5s...`);
    reconnectTimer = setTimeout(() => {
      const newSub = subscribeKline(symbol, interval, onCandle);
      ws._replacement = newSub;
    }, 5000);
  };

  return {
    close: () => {
      isClosing = true;
      clearTimeout(reconnectTimer);
      if (ws._replacement) ws._replacement.close();
      ws.close();
    }
  };
}

/**
 * Subscribe to miniTicker stream (Last TRADED Price — updates every 1 second).
 * Uses the exact same price source as Kline close price.
 * This guarantees Header price === Chart candle close price.
 * @param {string} symbol   – e.g. 'BTCUSDT'
 * @param {Function} onTick – callback({ price, symbol })
 * @returns {{ close: Function }}
 */
export function subscribeMiniTicker(symbol, onTick) {
  const stream = `${symbol.toLowerCase()}@miniTicker`;
  const ws = new WebSocket(`${BASE_WS}/${stream}`);
  let isClosing = false;
  let reconnectTimer = null;

  ws.onopen = () => {
    console.log(`[WS] MiniTicker connected: ${stream}`);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.e === '24hrMiniTicker') {
      onTick({
        price: parseFloat(msg.c),  // LAST traded price — same as kline close
        high: parseFloat(msg.h),
        low: parseFloat(msg.l),
        open: parseFloat(msg.o),
        symbol: msg.s,
      });
    }
  };

  ws.onerror = (err) => {
    if (!isClosing) console.error(`[WS] MiniTicker error ${stream}:`, err);
  };

  ws.onclose = () => {
    if (isClosing) return;
    console.log(`[WS] MiniTicker disconnected, reconnecting in 3s...`);
    reconnectTimer = setTimeout(() => {
      const newSub = subscribeMiniTicker(symbol, onTick);
      ws._replacement = newSub;
    }, 3000);
  };

  return {
    close: () => {
      isClosing = true;
      clearTimeout(reconnectTimer);
      if (ws._replacement) ws._replacement.close();
      ws.close();
    }
  };
}

/**
 * Subscribe to multiple streams for a given symbol.
 */
export function subscribeAllTimeframes(symbol, callbacks) {
  const subs = [];
  const intervals = ['5m', '15m', '1h', '4h', '1d'];
  intervals.forEach(interval => {
    if (callbacks[interval]) {
      subs.push(subscribeKline(symbol, interval, callbacks[interval]));
    }
  });
  return {
    closeAll: () => subs.forEach(s => s.close()),
  };
}


/**
 * Fetch current mark price and funding rate.
 */
export async function fetchFundingRate(symbol) {
  const url = `${BASE_REST}/fapi/v1/premiumIndex?symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    markPrice:   parseFloat(data.markPrice),
    fundingRate: parseFloat(data.lastFundingRate),
    nextFundingTime: data.nextFundingTime,
  };
}

/**
 * Fetch open interest for sentiment analysis.
 */
export async function fetchOpenInterest(symbol) {
  const url = `${BASE_REST}/fapi/v1/openInterest?symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    openInterest: parseFloat(data.openInterest),
    symbol: data.symbol,
    time: data.time,
  };
}
