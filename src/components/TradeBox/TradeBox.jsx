import { useState, useCallback } from 'react';
import { formatPrice, formatSize } from '../../utils/formatters.js';
import { ASSETS } from '../../utils/constants.js';
import './TradeBox.css';

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (value == null) return;
    const raw = typeof value === 'number' ? value.toString() : value;
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [value]);
  return (
    <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy} title="Copy" aria-label="Copy price">
      {copied ? '✓' : '⧉'}
    </button>
  );
}

function buildDirectionChips(analysis) {
  const { direction, aiModules, confluenceScore, inducement, chochQuality, displacementScore } = analysis;
  if (!direction) return [];
  const isLong = direction === 'long';
  const chips = [];
  const checks = confluenceScore?.checks || [];

  const bosChoch = checks.find(c => c.label.includes('BOS/CHOCH'));
  if (chochQuality?.quality === 'ELITE' || chochQuality?.quality === 'HIGH') {
    chips.push({ text: 'High-Prob CHOCH', type: isLong ? 'bullish' : 'bearish' });
  } else if (bosChoch?.met) {
    chips.push({ text: `BOS ${isLong ? 'Bullish' : 'Bearish'}`, type: isLong ? 'bullish' : 'bearish' });
  }
  
  if (displacementScore?.valid) chips.push({ text: 'Displacement', type: 'active' });
  if (inducement?.hasInducement) chips.push({ text: 'Retail Trapped', type: 'active' });

  if (aiModules?.macd?.bullCross && isLong) chips.push({ text: 'MACD Bull Cross', type: 'bullish' });
  if (aiModules?.macd?.bearCross && !isLong) chips.push({ text: 'MACD Bear Cross', type: 'bearish' });
  if (aiModules?.fibonacciData?.goldenPocket) chips.push({ text: 'Golden Pocket', type: 'active' });
  
  if (chips.length === 0) chips.push({ text: `${isLong ? 'Bullish' : 'Bearish'} Bias`, type: isLong ? 'bullish' : 'bearish' });
  return chips;
}

export default function TradeBox({ analysis }) {
  if (!analysis || !analysis.direction) {
    return (
      <div className="trade-box-empty">Scanning for high-probability setup…</div>
    );
  }

  const {
    direction, entry, stopLoss, tpDetails,
    positionSize, breakevenMove, session, symbol,
    primaryTimeframe, analysisMode,
  } = analysis;

  const isLong   = direction === 'long';
  const slPct    = (entry && stopLoss?.value)
    ? ((Math.abs(entry - stopLoss.value) / entry) * 100).toFixed(2)
    : '—';

  const reasonChips = buildDirectionChips(analysis);
  const isElite = analysis.signalGrade?.grade === 'A+';
  const isNoTrade = analysis.decision === 'NO_TRADE';
  const isTakeNow = analysis.decision === 'TAKE_NOW';

  return (
    <div className={`trade-box ${isLong ? 'long' : 'short'} ${isNoTrade ? 'vetoed' : ''}`}>
      
      {isTakeNow && (
        <div className="take-now-banner animate-fade-in-up" style={{animationDelay: '0ms'}}>
          <div className="shimmer"></div>
          ⚡ TAKE TRADE NOW
        </div>
      )}

      {isElite && !isTakeNow && (
        <div className="elite-banner animate-fade-in-up" style={{animationDelay: '0ms'}}>
          🏆 ELITE INSTITUTIONAL SETUP
        </div>
      )}

      {isNoTrade && (
        <div className="veto-banner animate-fade-in-up" style={{animationDelay: '0ms'}}>
          <div>✗ SETUP VETOED / NO TRADE</div>
          <div className="veto-reason">{analysis.rejectionReason || 'SMC parameters not fully met'}</div>
        </div>
      )}

      {/* Header */}
      <div className="trade-box-header animate-fade-in-up" style={{animationDelay: '60ms'}}>
        <div className="tb-header-left">
          <div className="tb-title">Signal · {String(analysisMode || primaryTimeframe || '—')}</div>
          <div className="tb-subtitle">{String(symbol || '—')} · {String(session?.name || '—')}</div>
        </div>
        <div className={`tb-dir-badge ${isLong ? 'long' : 'short'}`}>
          {isLong ? '▲ LONG' : '▼ SHORT'}
        </div>
      </div>

      {/* Entry Block */}
      <div className={`entry-block animate-fade-in-up ${isLong ? 'long' : 'short'}`} style={{animationDelay: '120ms'}}>
        <div className="entry-label">ENTRY ZONE</div>
        <div className="entry-price">{formatPrice(entry, symbol)} <CopyBtn value={entry} /></div>
        <div className="entry-chips">
          <div className="echip size">
            <span>Size</span> <strong>{formatSize(positionSize, symbol)} units</strong>
          </div>
          <div className="echip risk">
            <span>Risk</span> <strong>${analysis.riskAmount ? analysis.riskAmount.toFixed(2) : '5.00'}</strong>
          </div>
          <div className="echip slpct">
            <span>SL Dist</span> <strong>−{slPct}%</strong>
          </div>
        </div>
      </div>

      {/* TP/SL Timeline */}
      <div className="timeline-container animate-fade-in-up" style={{animationDelay: '180ms'}}>
        <div className="timeline-line"></div>
        
        {/* TPs */}
        {tpDetails && Array.isArray(tpDetails) && [...tpDetails].reverse().map((tp, revIdx) => {
          const i = tpDetails.length - 1 - revIdx;
          if (!tp || !tp.level) return null;
          const pctMove  = (entry && tp.level) ? ((Math.abs(tp.level - entry) / entry) * 100).toFixed(2) : '—';
          return (
            <div className="timeline-item tp-item" key={`tp-${i}`}>
              <div className={`timeline-node tp-node-${i+1}`}></div>
              <div className="timeline-card glass-card">
                <div className="tcard-left">
                  <span className={`tcard-badge tp-badge-${i+1}`}>TP{i+1}</span>
                  <span className="tcard-reason">{tp.reason || 'Target'}</span>
                </div>
                <div className="tcard-right">
                  <span className={`tcard-price text-tp-${i+1}`}>
                    {formatPrice(tp.level, symbol)} <CopyBtn value={tp.level} />
                  </span>
                  <span className="tcard-meta">+{pctMove}% · {tp.closePercent}% Close</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* SL */}
        <div className="timeline-item sl-item">
          <div className="timeline-node sl-node"></div>
          <div className="timeline-card glass-card sl-card">
            <div className="tcard-left">
              <span className="tcard-badge sl-badge">SL</span>
              <span className="tcard-reason">{stopLoss?.buffer || 'Structural Stop'}</span>
            </div>
            <div className="tcard-right">
              <span className="tcard-price text-sl">
                {formatPrice(stopLoss?.value, symbol)} <CopyBtn value={stopLoss?.value} />
              </span>
              <span className="tcard-meta">−{slPct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Trailing TP */}
      {analysis.trailingTP && (
        <div className="trailing-tp-card animate-fade-in-up glass-card" style={{animationDelay: '240ms'}}>
          <div className="ttp-header">
            <span className="ttp-icon">📈</span>
            <span className="ttp-title">Bybit Trailing TP</span>
          </div>
          <ol className="ttp-steps">
            <li>Activation Price: <strong>{formatPrice(analysis.trailingTP.activationPrice, symbol)}</strong> <CopyBtn value={analysis.trailingTP.activationPrice} /></li>
            <li>Trail Amount: <strong>${analysis.trailingTP.trailingAmount?.toFixed(ASSETS[symbol]?.decimals ?? 2)}</strong> <CopyBtn value={analysis.trailingTP.trailingAmount} /></li>
            <li>Callback Rate: <strong>{analysis.trailingTP.callbackRate}%</strong> <CopyBtn value={analysis.trailingTP.callbackRate} /></li>
          </ol>
          <div className="ttp-min-profit">
            Min Locked Profit: <span className="text-green">+${analysis.trailingTP.minProfitIfTrailed}</span>
          </div>
        </div>
      )}

      {/* Reasoning Chips */}
      <div className="reasoning-section animate-fade-in-up" style={{animationDelay: '300ms'}}>
        <div className="section-title">🧠 Signal Reasoning</div>
        <div className="reasoning-chip-list">
          {reasonChips.map((c, idx) => (
            <span key={idx} className={`r-chip ${c.type}`}>{c.text}</span>
          ))}
        </div>
      </div>

      {/* Trade Management */}
      <div className="management-section animate-fade-in-up" style={{animationDelay: '360ms'}}>
        <div className="section-title">Trade Management</div>
        <div className="mgmt-steps">
          <div className="mgmt-step">
            <div className="mgmt-num text-yellow">1</div>
            <div className="mgmt-text">Move SL to Breakeven at <strong className="text-yellow">{formatPrice(breakevenMove, symbol)}</strong></div>
          </div>
          {tpDetails && tpDetails.length >= 3 ? (
            <div className="mgmt-step">
              <div className="mgmt-num text-blue">2</div>
              <div className="mgmt-text">Close 40% at TP1, trail SL to Entry. TP2 closes 35%.</div>
            </div>
          ) : (
            <div className="mgmt-step">
              <div className="mgmt-num text-blue">2</div>
              <div className="mgmt-text">Close 100% at TP.</div>
            </div>
          )}
          <div className="mgmt-step">
            <div className="mgmt-num text-purple">3</div>
            <div className="mgmt-text">Time Cap: {analysis.timeCap || '6H'} — Exit if stalled.</div>
          </div>
        </div>
      </div>

    </div>
  );
}
