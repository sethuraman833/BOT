import { formatPrice, formatPercent, formatSize, formatRRR } from '../../utils/formatters.js';
import './TradeBox.css';

export default function TradeBox({ analysis }) {
  if (!analysis || !analysis.direction) return null;
  const { direction, entry, stopLoss, tp1, tp2, tp3, rrr, positionSize, breakevenMove, confluenceScore, session, keyRisk, invalidationLevel, tpDetails } = analysis;

  const isLong = direction === 'long';
  const slPct = entry && stopLoss?.value ? ((Math.abs(entry - stopLoss.value) / entry) * 100).toFixed(2) : '—';

  return (
    <div className={`trade-box ${isLong ? 'long' : 'short'}`}>
      <div className="trade-box-header">TRADE SETUP</div>
      <div className="trade-row">
        <span>Asset</span><span className="mono">{analysis.symbol}</span>
        <span>Direction</span><span className={isLong ? 'text-green' : 'text-red'}>{direction.toUpperCase()}</span>
      </div>
      <div className="trade-row">
        <span>Confluence</span><span className="mono">{confluenceScore.total} / {confluenceScore.max}</span>
        <span>Session</span><span>{session.name}</span>
      </div>
      <div className="trade-divider" />
      <div className="trade-row">
        <span>Entry</span><span className="mono">{formatPrice(entry)}</span>
      </div>
      <div className="trade-row">
        <span>Stop Loss</span><span className="mono text-red">{formatPrice(stopLoss?.value)} ({slPct}%)</span>
      </div>
      {tpDetails.map((tp, i) => (
        <div className="trade-row" key={i}>
          <span>TP{i + 1}</span>
          <span className="mono text-green">{formatPrice(tp.level)} → {formatRRR(tp.rrr)} → Close {tp.closePercent}%</span>
        </div>
      ))}
      <div className="trade-divider" />
      <div className="trade-row">
        <span>Position</span><span className="mono">{formatSize(positionSize)}</span>
        <span>Max Risk</span><span className="mono">$5.00</span>
      </div>
      <div className="trade-row">
        <span>Breakeven</span><span className="mono">{formatPrice(breakevenMove)}</span>
      </div>
      <div className="trade-divider" />
      <div className="trade-meta">
        <div><span className="text-yellow">⚠</span> {keyRisk}</div>
        <div><span className="text-red">✗</span> {invalidationLevel}</div>
      </div>
    </div>
  );
}
