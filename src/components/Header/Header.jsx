import { useMarket, useMarketDispatch } from '../../context/MarketContext.jsx';
import { ASSETS, ASSET_LIST } from '../../utils/constants.js';
import { formatPrice, formatPercent } from '../../utils/formatters.js';
import SessionBadge from '../SessionBadge/SessionBadge.jsx';
import './Header.css';

export default function Header() {
  const { asset, livePrice, liveChange } = useMarket();
  const dispatch = useMarketDispatch();
  const isPositive = (liveChange || 0) >= 0;

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-brand">
          <div className="live-dot" />
          <h1 className="header-title heading">TERMINUS</h1>
        </div>
      </div>

      <nav className="header-center">
        {ASSET_LIST.map(key => (
          <button
            key={key}
            className={`asset-tab ${asset === key ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_ASSET', payload: key })}
          >
            {ASSETS[key].label}
          </button>
        ))}
      </nav>

      <div className="header-right">
        {livePrice != null && (
          <div className="live-price-group">
            <span className="live-price mono">{formatPrice(livePrice)}</span>
            <span className={`live-change mono ${isPositive ? 'positive' : 'negative'}`}>
              {formatPercent(liveChange)}
            </span>
          </div>
        )}
        <SessionBadge />
      </div>
    </header>
  );
}
