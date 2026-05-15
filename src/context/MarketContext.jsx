// ─────────────────────────────────────────────────────────
//  Market Context — Global State Provider
// ─────────────────────────────────────────────────────────

import { createContext, useContext, useReducer } from 'react';
import { DEFAULT_ASSET, DEFAULT_TIMEFRAME } from '../utils/constants.js';

const MarketContext = createContext(null);
const MarketDispatchContext = createContext(null);

const initialState = {
  asset: DEFAULT_ASSET,
  timeframe: DEFAULT_TIMEFRAME,
  candles: {},       // { [symbol_tf]: [...candles] }
  livePrice: null,
  liveChange: 0,
  analysis: null,
  isAnalyzing: false,
  error: null,
  backtestMode: false,
  backtestTime: null, // Selected time for historical analysis
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ASSET':
      return { ...state, asset: action.payload, analysis: null, error: null, backtestTime: null };
    case 'SET_TIMEFRAME':
      return { ...state, timeframe: action.payload, backtestTime: null };
    case 'TOGGLE_BACKTEST':
      return { ...state, backtestMode: !state.backtestMode, backtestTime: null, analysis: null };
    case 'SET_BACKTEST_TIME':
      return { ...state, backtestTime: action.payload };
    case 'SET_CANDLES':
      return { ...state, candles: { ...state.candles, [action.key]: action.payload } };
    case 'SET_LIVE_PRICE':
      return { ...state, livePrice: action.price, liveChange: action.change ?? state.liveChange };
    case 'UPDATE_LAST_CANDLE': {
      const key = action.key;
      const existing = state.candles[key];
      if (!existing) return state;
      const updated = [...existing];
      if (action.isClosed) {
        updated.push(action.candle);
        if (updated.length > 500) updated.shift();
      } else {
        updated[updated.length - 1] = action.candle;
      }
      return { ...state, candles: { ...state.candles, [key]: updated } };
    }
    case 'SET_ANALYSIS':
      return { ...state, analysis: action.payload, isAnalyzing: false };
    case 'SET_ANALYZING':
      return { ...state, isAnalyzing: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export function MarketProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <MarketContext.Provider value={state}>
      <MarketDispatchContext.Provider value={dispatch}>
        {children}
      </MarketDispatchContext.Provider>
    </MarketContext.Provider>
  );
}

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be inside MarketProvider');
  return ctx;
}

export function useMarketDispatch() {
  const ctx = useContext(MarketDispatchContext);
  if (!ctx) throw new Error('useMarketDispatch must be inside MarketProvider');
  return ctx;
}
