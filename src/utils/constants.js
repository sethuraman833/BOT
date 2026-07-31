// ─────────────────────────────────────────────────────────
//  Constants — Assets, Timeframes, API Endpoints
// ─────────────────────────────────────────────────────────

export const ASSETS = {
  BTCUSDT: { label: 'BTC/USDT', symbol: 'BTCUSDT', decimals: 2, minQty: 0.001, stepSize: 0.001 },
  ETHUSDT: { label: 'ETH/USDT', symbol: 'ETHUSDT', decimals: 2, minQty: 0.01,  stepSize: 0.01  },
  SOLUSDT: { label: 'SOL/USDT', symbol: 'SOLUSDT', decimals: 2, minQty: 0.1,   stepSize: 0.1   },
  BNBUSDT: { label: 'BNB/USDT', symbol: 'BNBUSDT', decimals: 2, minQty: 0.01,  stepSize: 0.01  },
  XRPUSDT: { label: 'XRP/USDT', symbol: 'XRPUSDT', decimals: 4, minQty: 1.0,   stepSize: 1.0   },
  DOGEUSDT:{ label: 'DOGE/USDT',symbol: 'DOGEUSDT',decimals: 5, minQty: 1.0,   stepSize: 1.0   },
  XAUUSDT: { label: 'XAU/USDT', symbol: 'XAUUSDT', decimals: 2, minQty: 0.01,  stepSize: 0.01  },
};

export const ASSET_LIST = Object.keys(ASSETS);

export const TIMEFRAMES = [
  { key: '5m',  label: '5m',  seconds: 300   },  // NEW — scalping
  { key: '15m', label: '15m', seconds: 900   },
  { key: '1h',  label: '1H',  seconds: 3600  },
  { key: '4h',  label: '4H',  seconds: 14400 },
  { key: '1d',  label: '1D',  seconds: 86400 },
  { key: '1w',  label: '1W',  seconds: 604800 },
];

export const DEFAULT_ASSET     = 'BTCUSDT';
export const DEFAULT_TIMEFRAME = '15m';

export const BINANCE_REST = 'https://fapi.binance.com/fapi/v1';
export const BINANCE_WSS  = 'wss://fstream.binance.com/stream';

export const RISK_AMOUNT  = 50;   // $50 max risk per trade (funding challenge)
export const CANDLE_LIMIT = 1500; // Binance Futures max per request (was 500)

// ── Funding Challenge Configuration ──────────────────────────────
export const CHALLENGE_CONFIG = {
  enabled:          true,       // Toggle challenge mode on/off
  accountBalance:   10000,      // $10,000 account
  profitTarget:     1000,       // $1,000 profit target
  dailyDDLimit:     400,        // Max daily drawdown allowed
  maxOverallLoss:   600,        // Lifetime max loss cap
  riskPerTrade:     50,         // $50 per trade
  ddBudgetPct:      0.50,       // Stop trading at 50% of daily DD limit = -$200
  maxConsecLosses:  4,          // Hard stop after 4 consecutive losses (-$200)
};
