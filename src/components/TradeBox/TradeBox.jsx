import { formatPrice, formatSize } from '../../utils/formatters.js';
import './TradeBox.css';

export default function TradeBox({ analysis }) {
  if (!analysis || !analysis.direction) return null;

  const {
    direction, entry, stopLoss, tpDetails,
    positionSize, breakevenMove, confluenceScore,
    session, keyRisk, invalidationLevel, symbol,
  } = analysis;

  const isLong = direction === 'long';
  const slPct  = entry && stopLoss?.value
    ? ((Math.abs(entry - stopLoss.value) / entry) * 100).toFixed(2)
    : '—';

  return (
    <div className={`trade-box ${isLong ? 'long' : 'short'}`}>

      {/* ── Header ───────────────────────────────────── */}
      <div className="trade-box-header">
        <span>TRADE SETUP</span>
        <span className={`trade-dir-badge ${isLong ? 'long' : 'short'}`}>
          {isLong ? '▲ LONG' : '▼ SHORT'}
        </span>
      </div>

      {/* ── Meta row ─────────────────────────────────── */}
      <div className="trade-meta-row">
        <div className="trade-meta-cell">
          <span className="tm-label">Asset</span>
          <span className="tm-value mono">{symbol}</span>
        </div>
        <div className="trade-meta-cell">
          <span className="tm-label">Session</span>
          <span className="tm-value">{session?.name || '—'}</span>
        </div>
        <div className="trade-meta-cell">
          <span className="tm-label">Confluence</span>
          <span className="tm-value mono">{confluenceScore.total}/{confluenceScore.max}</span>
        </div>
      </div>

      <div className="trade-divider" />

      {/* ── Big Entry Block ───────────────────────────── */}
      <div className="trade-entry-block">
        <div className="teb-label">ENTRY</div>
        <div className="teb-price">{formatPrice(entry)}</div>
        <div className="teb-sub">
          Size&nbsp;
          <strong className="mono">{formatSize(positionSize)} units</strong>
          &nbsp;·&nbsp;Max Risk&nbsp;<strong>$5.00</strong>
        </div>
      </div>

      <div className="trade-divider" />

      {/* ── SL Row ───────────────────────────────────── */}
      <div className="trade-level-row sl">
        <div className="tlr-left">
          <span className="tlr-badge sl-badge">SL</span>
          <span className="tlr-label">Stop Loss</span>
        </div>
        <div className="tlr-right">
          <span className="tlr-price text-red mono">{formatPrice(stopLoss?.value)}</span>
          <span className="tlr-pct text-red">−{slPct}%</span>
        </div>
      </div>

      <div className="trade-divider" />

      {/* ── TP Rows ───────────────────────────────────── */}
      {tpDetails && Array.isArray(tpDetails) && tpDetails.map((tp, i) => {
        if (!tp || !tp.level) return null;
        
        const pctMove = (entry && tp.level)
          ? ((Math.abs(tp.level - entry) / entry) * 100).toFixed(2)
          : '—';
        
        const rrrLabel = tp.rrr !== undefined && tp.rrr !== null
          ? `1:${Number(tp.rrr).toFixed(1)}`
          : '—';

        return (
          <div className={`trade-level-row tp tp${i + 1}`} key={i}>
            <div className="tlr-left">
              <span className={`tlr-badge tp-badge tp${i + 1}-badge`}>TP{i + 1}</span>
              <span className="tlr-label">{tp.reason || 'Target'}</span>
            </div>
            <div className="tlr-right">
              <span className="tlr-price text-green mono">{formatPrice(tp.level)}</span>
              <span className="tlr-rrr text-green">{rrrLabel}</span>
              <span className="tlr-pct text-dim">+{pctMove}%</span>
              <span className="tlr-close text-dim">→ {tp.closePercent || 0}%</span>
            </div>
          </div>
        );
      })}

      <div className="trade-divider" />

      {/* ── Breakeven ─────────────────────────────────── */}
      <div className="trade-be-row">
        <span className="text-dim">⚡ Move SL to breakeven at</span>
        <span className="mono text-yellow">{formatPrice(breakevenMove)}</span>
      </div>

      {/* ── Warnings ─────────────────────────────────── */}
      <div className="trade-warnings">
        <div><span className="text-yellow">⚠</span> {keyRisk}</div>
        <div><span className="text-red">✗</span> {invalidationLevel}</div>
      </div>

    </div>
  );
}
