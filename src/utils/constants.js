// ─────────────────────────────────────────────────────────
//  Constants — Assets, Timeframes, API Endpoints
// ─────────────────────────────────────────────────────────

export const ASSETS = {
  BTCUSDT: { label: 'BTC/USDT', symbol: 'BTCUSDT', decimals: 2, minQty: 0.001 },
  ETHUSDT: { label: 'ETH/USDT', symbol: 'ETHUSDT', decimals: 2, minQty: 0.01 },
  XAUUSDT: { label: 'XAU/USDT', symbol: 'XAUUSDT', decimals: 2, minQty: 0.01 },
};

export const ASSET_LIST = Object.keys(ASSETS);

export const TIMEFRAMES = [
  { key: '1d', label: '1D', seconds: 86400 },
  { key: '4h', label: '4H', seconds: 14400 },
  { key: '1h', label: '1H', seconds: 3600 },
  { key: '15m', label: '15m', seconds: 900 },
];

export const DEFAULT_ASSET = 'BTCUSDT';
export const DEFAULT_TIMEFRAME = '15m';

export const BINANCE_REST = 'https://fapi.binance.com/fapi/v1';
export const BINANCE_WSS = 'wss://fstream.binance.com/stream';

export const RISK_AMOUNT = 5; // $5 max risk per trade
export const CANDLE_LIMIT = 500;
