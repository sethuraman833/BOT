// ─────────────────────────────────────────────────────────
//  useHotkeys — Keyboard Shortcuts for Trading Terminal
// ─────────────────────────────────────────────────────────

import { useEffect, useCallback } from 'react';

/**
 * Hook to register global keyboard shortcuts.
 * 
 * Hotkeys:
 *   1-5        → Switch timeframe (1=5m, 2=15m, 3=1h, 4=4h, 5=1d)
 *   E / Enter  → Run Analysis
 *   B          → Toggle Backtest Mode
 *   Escape     → Clear selection / close modals
 * 
 * @param {Function} dispatch - MarketContext dispatch
 * @param {Function} handleAnalyze - Analysis trigger function
 * @param {boolean} isAnalyzing - Whether analysis is currently running
 */
export function useHotkeys(dispatch, handleAnalyze, isAnalyzing = false) {
  const TIMEFRAME_MAP = {
    '1': '5m',
    '2': '15m',
    '3': '1h',
    '4': '4h',
    '5': '1d',
  };

  const handleKeyDown = useCallback((e) => {
    // Don't trigger hotkeys when typing in an input/textarea
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const key = e.key;

    // Timeframe switching (1-5)
    if (TIMEFRAME_MAP[key]) {
      e.preventDefault();
      dispatch({ type: 'SET_TIMEFRAME', payload: TIMEFRAME_MAP[key] });
      return;
    }

    // Run Analysis (E or Enter)
    if ((key === 'e' || key === 'E' || key === 'Enter') && !isAnalyzing) {
      e.preventDefault();
      handleAnalyze();
      return;
    }

    // Toggle Backtest Mode (B)
    if (key === 'b' || key === 'B') {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_BACKTEST' });
      return;
    }

    // Asset switching: Ctrl+1 through Ctrl+7
    if (e.ctrlKey && key >= '1' && key <= '7') {
      e.preventDefault();
      const ASSET_KEYS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LINKUSDT'];
      const idx = parseInt(key) - 1;
      if (idx < ASSET_KEYS.length) {
        dispatch({ type: 'SET_ASSET', payload: ASSET_KEYS[idx] });
      }
      return;
    }
  }, [dispatch, handleAnalyze, isAnalyzing]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
