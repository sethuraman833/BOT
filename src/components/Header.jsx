// ─────────────────────────────────────────────────────────
//  Header Component — Logo, Asset Selector, Live Price,
//  Session Badge, Risk Input, Connection Status
// ─────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { getSessionDisplay } from '../engine/sessionFilter.js';

export default function Header({ 
  activeAsset, 
  onAssetChange, 
  marketUpdate, 
  connected, 
  riskAmount, 
  onRiskChange,
  onRunAnalysis,
  loading,
}) {
  const [session, setSession] = useState(getSessionDisplay());

  const livePrice = marketUpdate; // Bridge for easy refactor

  useEffect(() => {
    const interval = setInterval(() => {
      setSession(getSessionDisplay());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const assets = [
    { key: 'BTCUSDT', label: 'BTC/USDT' },
    { key: 'ETHUSDT', label: 'ETH/USDT' },
    { key: 'XAUUSDT', label: 'XAU/USDT' },
  ];

  const priceChange = livePrice?.change ?? 0;
  const isPositive = priceChange >= 0;

  return (
    <header className="header glass-card">
      <div className="header-left">
        <div className="header-logo">
          <div className="header-logo-icon">⚡</div>
          <div>
            <div className="header-title">SMC Trading Bot</div>
            <div className="header-subtitle">Multi-Layer Confluence System v4.0</div>
          </div>
        </div>
      </div>

      <div className="header-center">
        <div className="asset-selector-group">
          {assets.map(a => (
            <button
              key={a.key}
              className={`asset-btn ${activeAsset === a.key ? 'active' : ''}`}
              onClick={() => onAssetChange(a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
        
        {/* Analyze Button in Header */}
        <button
          className={`header-analyze-btn ${loading ? 'loading' : ''}`}
          onClick={onRunAnalysis}
          disabled={loading}
        >
          {loading ? (
            <><span className="spinner" /> Scanning...</>
          ) : (
            <>⚡ Run Analysis</>
          )}
        </button>
      </div>

      <div className="header-right">
        {/* Live Price */}
        {livePrice && (
          <div className="live-price">
            <span className="live-price-value">
              ${livePrice.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`live-price-change ${isPositive ? 'positive' : 'negative'}`}>
              {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </div>
        )}

        {/* Risk Input */}
        <div className="risk-input-group">
          <span className="risk-label">Risk $</span>
          <input
            type="number"
            className="risk-input"
            value={riskAmount}
            onChange={e => onRiskChange(parseFloat(e.target.value) || 0)}
            min={1}
            max={100}
            step={1}
          />
        </div>

        {/* Session Badge */}
        <div className="session-badge" title={session.description}>
          <div className="session-dot" style={{ backgroundColor: session.color }} />
          <span style={{ color: session.color, fontWeight: 600 }}>{session.name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{session.utcTime}</span>
        </div>

        {/* Connection Status */}
        <div className="connection-status">
          <div className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} />
          <span>{connected ? 'Live' : 'Offline'}</span>
        </div>
      </div>
    </header>
  );
}
