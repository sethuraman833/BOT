import { formatPrice } from '../../utils/formatters.js';
import { computeRegime } from '../../engine/marketRegime.js';
import './MarketRegime.css';


// Format slope as angle string
function slopeLabel(slope) {
  if (slope >  0.05) return { text: `+${slope.toFixed(3)}%`, color: '#00e5b4', arrow: '↗' };
  if (slope >  0.008) return { text: `+${slope.toFixed(3)}%`, color: '#a8e6cf', arrow: '↗' };
  if (slope < -0.05) return { text: `${slope.toFixed(3)}%`, color: '#ff3f5e', arrow: '↘' };
  if (slope < -0.008) return { text: `${slope.toFixed(3)}%`, color: '#ffb3b3', arrow: '↘' };
  return { text: `${slope.toFixed(3)}%`, color: '#8a93a8', arrow: '→' };
}

export default function MarketRegime({ analysis }) {
  if (!analysis) return null;

  const ind = analysis.indicators;
  const symbol = analysis.symbol || 'BTCUSDT';
  const currentPrice = analysis.entry || analysis.currentPrice || 0;
  const result = computeRegime(ind, currentPrice);

  const { regime, strength, label, rec, icon } = result;
  const regimeClass = regime.toLowerCase(); // 'bull', 'bear', 'sideways'

  // Deviation from each EMA (how far price is from each EMA)
  const dev = (ema) => ema && currentPrice ? ((currentPrice - ema) / ema * 100).toFixed(2) : null;
  const e20dev  = dev(ind?.ema20);
  const e50dev  = dev(ind?.ema50);
  const e200dev = dev(ind?.ema200);

  // Stack ordering label
  const stackLabel = ind?.ema20 && ind?.ema50 && ind?.ema200
    ? (ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200
        ? 'EMA20 > EMA50 > EMA200'
        : ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200
          ? 'EMA20 < EMA50 < EMA200'
          : 'EMAs Tangled')
    : '—';

  const s20 = ind ? slopeLabel(ind.ema20_slope || 0) : null;
  const s50 = ind ? slopeLabel(ind.ema50_slope || 0) : null;
  const s200 = ind ? slopeLabel(ind.ema200_slope || 0) : null;

  const strengthBadgeClass =
    strength === 'STRONG' ? 'strength-strong' :
    strength === 'MODERATE' ? 'strength-moderate' :
    strength === 'TRANSITION' ? 'strength-transition' :
    'strength-weak';

  return (
    <div className={`market-regime-card animate-fade-in-up ${regimeClass}`}>
      {/* Top accent line animated */}
      <div className="regime-accent-bar" />

      {/* Header row */}
      <div className="regime-header-row">
        <span className="regime-icon">{icon}</span>
        <div className="regime-title-block">
          <span className={`regime-label ${regimeClass}`}>{label}</span>
          <span className={`regime-strength-badge ${strengthBadgeClass}`}>{strength}</span>
        </div>
        <span className={`regime-rec-pill ${regimeClass}`}>{rec}</span>
      </div>

      {/* EMA Stack row */}
      {ind && (
        <>
          <div className="regime-stack-label">{stackLabel}</div>

          {/* EMA value + slope table */}
          <div className="regime-ema-table">
            {[
              { name: 'EMA 20',  val: ind.ema20,  slope: s20,  dev: e20dev },
              { name: 'EMA 50',  val: ind.ema50,  slope: s50,  dev: e50dev },
              { name: 'EMA 200', val: ind.ema200, slope: s200, dev: e200dev },
            ].map(({ name, val, slope, dev: deviation }) => (
              <div className="regime-ema-row" key={name}>
                <span className="ema-row-name">{name}</span>
                <span className="ema-row-val mono">{val ? formatPrice(val, symbol) : '—'}</span>
                <span className="ema-row-slope" style={{ color: slope?.color }}>
                  {slope?.arrow} {slope?.text}
                </span>
                <span className={`ema-row-dev ${deviation > 0 ? 'pos' : deviation < 0 ? 'neg' : ''}`}>
                  {deviation !== null ? `${deviation > 0 ? '+' : ''}${deviation}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
