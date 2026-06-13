// ─────────────────────────────────────────────────────────
//  useAnalyze — Shared Hook for Trade Analysis Execution
// ─────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useMarket, useMarketDispatch } from '../context/MarketContext.jsx';
import { runAnalysis } from '../engine/tradeAnalyzer.js';
import { useCandles } from './useCandles.js';
import { formatUTCTime } from '../utils/formatters.js';
import { checkNewsVeto } from '../engine/newsService.js';
import { getAccountBalance } from '../engine/exchangeService.js';
import { getFrontendAiOpinion } from '../engine/aiAgent.js';
import { playSignalSound, playAnalysisComplete, playRejectSound } from '../utils/sounds.js';

export function useAnalyze() {
  const { asset, timeframe, isAnalyzing, backtestMode, backtestTime } = useMarket();
  const dispatch = useMarketDispatch();
  const { loadAllTimeframes } = useCandles();

  const handleAnalyze = useCallback(async () => {
    dispatch({ type: 'SET_ANALYZING', payload: true });
    try {
      const freshData = await loadAllTimeframes(asset);
      if (!freshData) {
        dispatch({ type: 'SET_ANALYZING', payload: false });
        return;
      }

      // Backtest slice
      let activeData = freshData;
      if (backtestMode && backtestTime) {
        activeData = {};
        Object.keys(freshData).forEach(tfKey => {
          activeData[tfKey] = freshData[tfKey].filter(c => c.time <= backtestTime);
        });
      }

      // Parallel: balance + news
      const [balance, newsStatus] = await Promise.all([
        getAccountBalance(),
        checkNewsVeto(asset),
      ]);

      const result = runAnalysis(activeData, {
        symbol: asset,
        balance: balance,
        newsStatus: newsStatus,
        activeTimeframe: timeframe,   // Adaptive engine per TF
      });

      // News caution propagation
      if (newsStatus.caution) {
        result.newsCaution      = true;
        result.newsCautionReason = newsStatus.reason;
        result.analysisSteps    = [
          ...(result.analysisSteps || []),
          `⚠️ NEWS CAUTION: ${newsStatus.reason} — Wait for post-event BOS confirmation`,
        ];
      }

      const utcTime = formatUTCTime();
      dispatch({ type: 'SET_ANALYSIS', payload: result, lastAnalysisTime: utcTime });

      // Sound feedback based on decision
      if (result.decision === 'TAKE_NOW') {
        playSignalSound();
      } else if (result.decision === 'NO_TRADE') {
        playRejectSound();
      } else {
        playAnalysisComplete();
      }

      // AI second opinion for high-quality signals
      if (result.decision === 'TAKE_NOW' || (result.decision === 'WAIT' && result.confluenceScore?.total >= 5)) {
        const aiResponse = await getFrontendAiOpinion(result);
        if (aiResponse) {
          result.aiAnalysis = aiResponse;
          dispatch({ type: 'SET_ANALYSIS', payload: { ...result }, lastAnalysisTime: utcTime });
        }
      }

      return utcTime;
    } catch (err) {
      console.error(err);
      dispatch({ type: 'SET_ERROR', payload: 'Analysis failed: ' + err.message });
    } finally {
      dispatch({ type: 'SET_ANALYZING', payload: false });
    }
  }, [asset, timeframe, backtestMode, backtestTime, loadAllTimeframes, dispatch]);

  return {
    handleAnalyze,
    isAnalyzing,
  };
}
