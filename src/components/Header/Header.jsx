import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { ASSETS, ASSET_LIST } from '../../utils/constants.js';
import { formatPrice, formatPercent } from '../../utils/formatters.js';
import { useAnalyze } from '../../hooks/useAnalyze.js';
import { useRef, useEffect, useState } from 'react';
import SessionBadge from '../SessionBadge/SessionBadge.jsx';
import './Header.css';

export default function Header() {
  const { asset, livePrice, liveChange, isAnalyzing, backtestMode, backtestTime } = useMarket();
  const dispatch = useMarketDispatch();
  const { handleAnalyze } = useAnalyze();
  const isPositive = (liveChange || 0) >= 0;

  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setAssetDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      </div>

      <div className="header-center" ref={dropdownRef}>
        <div className={`asset-dropdown-container ${assetDropdownOpen ? 'open' : ''}`}>
          <button 
            className="asset-dropdown-active" 
            onClick={() => setAssetDropdownOpen(!assetDropdownOpen)}
          >
            <span className="asset-dropdown-label">{ASSETS[asset].label}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-down">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
          
          {assetDropdownOpen && (
            <div className="asset-dropdown-menu">
              {ASSET_LIST.map(key => (
                <button
                  key={key}
                  className={`asset-dropdown-item ${asset === key ? 'active' : ''}`}
                  onClick={() => {
                    dispatch({ type: 'SET_ASSET', payload: key });
                    setAssetDropdownOpen(false);
                  }}
                >
                  {ASSETS[key].label}
                  {asset === key && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

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
        <SessionBadge />
        <div className="live-dot" title="Live Data Feed" />
      </div>
    </header>
  );
}
