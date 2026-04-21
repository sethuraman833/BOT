// ─────────────────────────────────────────────────────────
//  Trade Card — Final trade setup display (Step 17)
//  Entry, SL, TP levels, position size, management plan
// ─────────────────────────────────────────────────────────

export default function TradeCard({ analysis }) {
  if (!analysis) return null;

  const { decision, tradeSetup, steps, direction, currentPrice, symbol } = analysis;

  // NO TRADE state
  if (decision.action !== 'TAKE_TRADE' || !tradeSetup) {
    return (
      <div className={`trade-card glass-card no-trade fade-in`}>
        <div className="trade-card-glow" />
        <div className="no-trade-message">
          <div className="no-trade-icon">{decision.icon}</div>
          <div className="no-trade-title">
            {decision.action === 'WAIT' ? 'Waiting for Confirmation' : 'No Trade'}
          </div>
          <div className="no-trade-reason">
            {decision.reason}
          </div>
          {decision.trigger && (
            <div style={{
              marginTop: '12px',
              padding: '10px 16px',
              background: 'var(--amber-dim)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.78rem',
              color: 'var(--amber)',
              border: '1px solid rgba(255,176,32,0.15)',
            }}>
              ⏳ Trigger: {decision.trigger}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isLong = tradeSetup.direction === 'long';
  const dirClass = isLong ? 'long' : 'short';

  return (
    <div className={`trade-card glass-card ${dirClass} fade-in`}>
      <div className="trade-card-glow" />

      {/* Header */}
      <div className="trade-card-header">
        <div className="trade-direction">
          <span className={`trade-direction-badge ${dirClass}`}>
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {symbol}
          </span>
        </div>
        <div className="trade-rrr" style={{ color: isLong ? 'var(--green)' : 'var(--red)' }}>
          1:{tradeSetup.rrr?.toFixed(1)}
        </div>
      </div>

      {/* Trade Levels */}
      <div className="trade-levels stagger">
        <div className="trade-level-item">
          <div className="trade-level-label">Entry</div>
          <div className="trade-level-value" style={{ color: 'var(--cyan)' }}>
            ${tradeSetup.entry?.toFixed(2)}
          </div>
          <div className="trade-level-sub">
            {tradeSetup.oteRefined ? 'OTE refined' : 'Structural'}
          </div>
        </div>

        <div className="trade-level-item">
          <div className="trade-level-label">Stop Loss</div>
          <div className="trade-level-value" style={{ color: 'var(--red)' }}>
            ${tradeSetup.stopLoss?.final?.toFixed(2)}
          </div>
          <div className="trade-level-sub">
            {tradeSetup.slDistPercent?.toFixed(2)}% from entry
          </div>
        </div>

        {tradeSetup.takeProfits?.map((tp, idx) => (
          <div className="trade-level-item" key={idx}>
            <div className="trade-level-label">
              TP{idx + 1}
              {tradeSetup.tpStructure === 'multiple' && (
                <span style={{ marginLeft: '4px', opacity: 0.6 }}>
                  {idx === 0 ? '40%' : idx === 1 ? '35%' : '25%'}
                </span>
              )}
            </div>
            <div className="trade-level-value" style={{ color: 'var(--green)' }}>
              ${tp.level?.toFixed(2)}
            </div>
            <div className="trade-level-sub">
              RRR 1:{tp.rrr?.toFixed(1)}
            </div>
          </div>
        ))}
      </div>

      {/* Meta Information */}
      <div className="trade-meta">
        <div className="trade-meta-item">
          <span className="trade-meta-label">Position Size</span>
          <span className="trade-meta-value">
            {tradeSetup.positionSize?.toFixed(symbol.includes('BTC') ? 5 : 3)} {symbol.replace('USDT', '')}
          </span>
        </div>
        <div className="trade-meta-item">
          <span className="trade-meta-label">Max Risk</span>
          <span className="trade-meta-value" style={{ color: 'var(--red)' }}>
            ${tradeSetup.riskAmount?.toFixed(2)}
          </span>
        </div>
        <div className="trade-meta-item">
          <span className="trade-meta-label">Breakeven @</span>
          <span className="trade-meta-value" style={{ color: 'var(--cyan)' }}>
            ${tradeSetup.breakevenTrigger?.toFixed(2)}
          </span>
        </div>
        <div className="trade-meta-item">
          <span className="trade-meta-label">TP Structure</span>
          <span className="trade-meta-value">
            {tradeSetup.tpStructure === 'multiple' ? 'Multi TP' : 'Single TP'}
          </span>
        </div>
        <div className="trade-meta-item">
          <span className="trade-meta-label">Confluence</span>
          <span className="trade-meta-value">
            {steps.step10?.score}/{steps.step10?.maxScore}
          </span>
        </div>
      </div>

      {/* Position Management (for multi-TP trades) */}
      {tradeSetup.tpStructure === 'multiple' && tradeSetup.management && (
        <div style={{
          marginTop: '16px',
          padding: '14px',
          background: 'var(--bg-glass)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '8px',
          }}>
            Position Management Plan
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
            <div style={{ color: 'var(--green)' }}>
              TP1 → {tradeSetup.management.tp1Action}
            </div>
            <div style={{ color: 'var(--green)' }}>
              TP2 → {tradeSetup.management.tp2Action}
            </div>
            <div style={{ color: 'var(--green)' }}>
              TP3 → {tradeSetup.management.tp3Action}
            </div>
          </div>
        </div>
      )}

      {/* Early Exit Rules */}
      <div style={{
        marginTop: '12px',
        padding: '12px',
        background: 'var(--amber-dim)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid rgba(255,176,32,0.1)',
        fontSize: '0.72rem',
        color: 'var(--amber)',
      }}>
        <strong>Early Exit Rules:</strong> 2 consecutive 15m candles against direction → EXIT | 
        Structure break below recent swing → EXIT | 6h time limit
      </div>
    </div>
  );
}
