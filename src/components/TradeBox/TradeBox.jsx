import { formatPrice, formatSize } from '../../utils/formatters.js';
import './TradeBox.css';

export default function TradeBox({ analysis }) {
  if (!analysis || !analysis.direction) {
    return (
      <div className="sidebar-section">
        <div className="trade-box-empty">No trade direction detected.</div>
      </div>
    );
  }

  const {
    direction, entry, stopLoss, tpDetails,
    positionSize, breakevenMove, confluenceScore,
    session, keyRisk, invalidationLevel, symbol,
    primaryTimeframe, analysisMode,
  } = analysis;

  const isLong = direction === 'long';
  const slPct  = (entry && stopLoss?.value)
    ? ((Math.abs(entry - stopLoss.value) / entry) * 100).toFixed(2)
    : '—';

  return (
    <div className={`trade-box ${isLong ? 'long' : 'short'}`}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="trade-box-header">
        <span>TRADE SETUP</span>
        <span className={`trade-dir-badge ${isLong ? 'long' : 'short'}`}>
          {isLong ? '▲ LONG' : '▼ SHORT'}
        </span>
      </div>

      {/* ── Meta ───────────────────────────────────────────── */}
      <div className="trade-meta-row">
        <div className="trade-meta-cell">
          <span className="tm-label">Asset</span>
          <span className="tm-value mono">{String(symbol || '—')}</span>
        </div>
        <div className="trade-meta-cell">
          <span className="tm-label">TF</span>
          <span className="tm-value mono">{String(primaryTimeframe || '—').toUpperCase()}</span>
        </div>
        <div className="trade-meta-cell">
          <span className="tm-label">Session</span>
          <span className="tm-value">{String(session?.name || '—')}</span>
        </div>
        <div className="trade-meta-cell">
          <span className="tm-label">Score</span>
          <span className="tm-value mono">{String(confluenceScore?.total || 0)}/{String(confluenceScore?.max || 11)}</span>
        </div>
      </div>

      <div className="trade-divider" />

      {/* ── Entry ──────────────────────────────────────────── */}
      <div className="trade-entry-block">
        <div className="teb-label">Entry Price</div>
        <div className="teb-price">{formatPrice(entry, symbol)}</div>
        <div className="teb-sub">
          <div className="teb-sub-item">
            <span className="text-dim">Size:</span>
            <strong className="mono">{formatSize(positionSize)} units</strong>
          </div>
          <div className="teb-sub-item">
            <span className="text-dim">Risk:</span>
            <strong className="mono text-red">${analysis.riskAmount ? analysis.riskAmount.toFixed(2) : '5.00'}</strong>
          </div>
          <div className="teb-sub-item">
            <span className="text-dim">SL dist:</span>
            <strong className="mono text-red">−{slPct}%</strong>
          </div>
        </div>
      </div>

      <div className="trade-divider" />

      {/* ── Stop Loss ──────────────────────────────────────── */}
      <div className="trade-level-row sl">
        <div className="tlr-left">
          <span className="tlr-badge sl-badge">SL</span>
          <span className="tlr-label">Stop Loss</span>
        </div>
        <div className="tlr-right">
          <span className="tlr-price text-red mono">{formatPrice(stopLoss?.value, symbol)}</span>
          <span className="tlr-pct text-red">−{slPct}%</span>
        </div>
      </div>

      {/* ── TPs ────────────────────────────────────────────── */}
      {tpDetails && Array.isArray(tpDetails) && tpDetails.map((tp, i) => {
        if (!tp || !tp.level) return null;
        const pctMove  = (entry && tp.level) ? ((Math.abs(tp.level - entry) / entry) * 100).toFixed(2) : '—';
        const rrrLabel = (tp.rrr != null) ? `1:${Number(tp.rrr).toFixed(1)}` : '—';
        return (
          <div className={`trade-level-row tp tp${i + 1}`} key={i}>
            <div className="tlr-left">
              <span className={`tlr-badge tp-badge tp${i + 1}-badge`}>TP{i + 1}</span>
              <span className="tlr-label">{String(tp.reason || 'Target')}</span>
            </div>
            <div className="tlr-right">
              <span className="tlr-price text-green mono">{formatPrice(tp.level, symbol)}</span>
              <span className="tlr-rrr">{rrrLabel}</span>
              <span className="tlr-pct text-green">+{pctMove}%</span>
              <span className="tlr-close">→{String(tp.closePercent || 0)}%</span>
            </div>
          </div>
        );
      })}

      <div className="trade-divider" />

      {/* ── Breakeven ──────────────────────────────────────── */}
      <div className="trade-be-row">
        <span className="text-dim">⚡ Move SL to BE at</span>
        <span className="mono text-yellow">{formatPrice(breakevenMove, symbol)}</span>
      </div>

      <div className="trade-divider" />
      
      {/* ── Trade Management Rules ─────────────────────────── */}
      <div className="trade-management-rules">
        <div className="tm-rules-header">📈 Trade Management Exit Rules</div>
        <div className="tm-rules-body">
          <div className="tm-rule-item">
            <strong>BE Trigger:</strong> Move SL to Entry at 1.5R in profit ($+{(analysis.riskAmount * 1.5 || 7.50).toFixed(2)} value: {formatPrice(breakevenMove, symbol)})
          </div>
          {tpDetails && tpDetails.length >= 3 ? (
            <>
              <div className="tm-rule-item">
                <strong>TP1 Hit:</strong> Close 40% position & Move SL to Breakeven immediately
              </div>
              <div className="tm-rule-item">
                <strong>TP2 Hit:</strong> Close 35% (total) & Trail SL to TP1 level ({formatPrice(tpDetails[0].level, symbol)})
              </div>
              <div className="tm-rule-item">
                <strong>TP3 Hit:</strong> Close remaining 25% (Terminal exit)
              </div>
            </>
          ) : (
            <div className="tm-rule-item">
              <strong>Single TP:</strong> Close 100% position at Target (No ladder applied)
            </div>
          )}
          <div className="tm-rule-item text-yellow">
            <strong>Momentum Shift:</strong> Close 100% on close of 2 consecutive 15m candles against trade
          </div>
          <div className="tm-rule-item text-red">
            <strong>Structure Shift:</strong> Close 100% immediately if price closes past recent 15m HL/LH
          </div>
          <div className="tm-rule-item text-purple">
            <strong>{analysis.timeCap || '6H'} Time Cap:</strong> Close 50% & BE (if in profit) or exit full position if stalled after {(analysis.timeCap || '6H').toLowerCase()}
          </div>
        </div>
      </div>

      {/* ── Warnings ───────────────────────────────────────── */}
      <div className="trade-warnings">
        <div><span className="text-yellow">⚠</span> {String(keyRisk || '—')}</div>
        <div><span className="text-red">✗</span> Invalidated if price closes beyond {String(invalidationLevel || '—')}</div>
      </div>

    </div>
  );
}
