import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { ASSETS, ASSET_LIST } from '../../utils/constants.js';
import { formatPrice, formatPercent } from '../../utils/formatters.js';
import { useAnalyze } from '../../hooks/useAnalyze.js';
import { useSession } from '../../hooks/useSession.js';
import { useRef, useEffect, useState } from 'react';
import SessionBadge from '../SessionBadge/SessionBadge.jsx';
import './Header.css';

export default function Header() {
  const { asset, livePrice, liveChange, isAnalyzing, backtestMode, backtestTime, analysis } = useMarket();
  const dispatch = useMarketDispatch();
  const { handleAnalyze } = useAnalyze();
  const { session } = useSession();
  const isPositive = (liveChange || 0) >= 0;

  // Bloomberg-style tick animation
  const prevPrice = useRef(livePrice);
  const [tickClass, setTickClass] = useState('');
  useEffect(() => {
    if (prevPrice.current != null && livePrice != null && livePrice !== prevPrice.current) {
      setTickClass(livePrice > prevPrice.current ? 'tick-up' : 'tick-down');
      const t = setTimeout(() => setTickClass(''), 400);
      prevPrice.current = livePrice;
      return () => clearTimeout(t);
    }
    prevPrice.current = livePrice;
  }, [livePrice]);

  // Regime Pill Logic
  let regime = 'SIDEWAYS';
  let regimeClass = 'sideways';
  if (analysis) {
    const weeklyBias = analysis.aiModules?.weeklyBias?.bias;
    const is1HUp = analysis.direction === 'LONG';
    const is1HDown = analysis.direction === 'SHORT';
    if (weeklyBias === 'long' && is1HUp) {
      regime = 'BULL';
      regimeClass = 'bull';
    } else if (weeklyBias === 'short' && is1HDown) {
      regime = 'BEAR';
      regimeClass = 'bear';
    }
  }

  // Session urgency (pulse red if < 30m)
  const countdown = session?.countdown || '';
  const isUrgent = countdown && !countdown.includes('h') && parseInt(countdown) < 30;

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-brand">
          <div className="brand-icon">T</div>
          <div>
            <h1 className="header-title">TERMINUS</h1>
            <span className="header-subtitle">SMC INTELLIGENCE v12</span>
          </div>
        </div>
        {analysis && (
          <div className={`header-regime-pill ${regimeClass}`}>
            <span className="regime-dot"></span>
            {regime}
          </div>
        )}
      </div>

      <nav className="header-center">
        {ASSET_LIST.map(key => (
          <button
            key={key}
            className={`asset-tab ${asset === key ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_ASSET', payload: key })}
            title={ASSETS[key].label}
          >
            {ASSETS[key].symbol.replace('USDT', '')}
            <div className="tab-indicator"></div>
          </button>
        ))}
      </nav>

      <div className="header-right">
        {livePrice != null && (
          <div className="live-price-group">
            <span className={`live-price mono ${tickClass}`}>{formatPrice(livePrice, asset)}</span>
            <span className={`live-change mono ${isPositive ? 'positive' : 'negative'}`}>
              {isPositive ? '+' : ''}{formatPercent(liveChange)}
            </span>
          </div>
        )}
        <button
          className={`refresh-btn ${isAnalyzing ? 'spinning' : ''}`}
          onClick={handleAnalyze}
          disabled={isAnalyzing || (backtestMode && !backtestTime)}
          title="Refresh Data & Run Analysis"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-refresh-cw">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
            <path d="M16 16h5v5"/>
          </svg>
        </button>
        <div className={`session-wrapper ${isUrgent ? 'urgent' : ''}`}>
          <SessionBadge />
        </div>
        <div className="live-dot" title="Live Data Feed" />
      </div>
    </header>
  );
}
