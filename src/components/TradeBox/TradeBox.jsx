import { useState, useCallback } from 'react';
import { formatPrice, formatSize } from '../../utils/formatters.js';
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

// Build a human-readable explanation of why the direction was chosen
function buildDirectionExplanation(analysis) {
  const { direction, aiModules, confluenceScore, inducement, chochQuality, drawOnLiquidity, displacementScore } = analysis;
  if (!direction) return null;

  const checks  = confluenceScore?.checks || [];
  const isLong  = direction === 'long';
  const reasons = [];

  // SMC structure & Institutional Logic
  const trenAligned = checks.find(c => c.label.includes('Trend Aligned'));
  const bosChoch    = checks.find(c => c.label.includes('BOS/CHOCH'));
  const liquidity   = checks.find(c => c.label.includes('Liquidity Sweep'));
  
  if (chochQuality?.quality === 'ELITE' || chochQuality?.quality === 'HIGH') {
    reasons.push(`High-probability CHOCH (ERL Swept + Disp)`);
  } else if (bosChoch?.met) {
    reasons.push(`Structure shift (${isLong ? 'BOS bullish' : 'BOS bearish'})`);
  }
  
  if (displacementScore?.valid) reasons.push(`Displacement Confirmed`);
  if (inducement?.hasInducement) reasons.push(`Inducement Swept (Retail Trapped)`);
  if (drawOnLiquidity?.primary) reasons.push(`Draw on Liquidity: ${drawOnLiquidity.primary.label}`);
  if (liquidity?.met && !chochQuality) reasons.push(`Liquidity swept at entry zone`);

  // AI modules
  if (aiModules?.macd?.bullCross && isLong)   reasons.push('MACD bullish crossover');
  if (aiModules?.macd?.bearCross && !isLong)  reasons.push('MACD bearish crossover');
  if (aiModules?.wyckoffPhase?.signal === direction) {
    reasons.push(`Wyckoff: ${aiModules.wyckoffPhase.phase}`);
  }
  if (aiModules?.obvDivergence?.bullishDivergence && isLong)  reasons.push('OBV smart-money accumulation');
  if (aiModules?.obvDivergence?.bearishDivergence && !isLong) reasons.push('OBV smart-money distribution');
  if (aiModules?.weeklyBias?.bias === direction) reasons.push(`Weekly open bias: ${isLong ? '↑ Bullish' : '↓ Bearish'}`);
  if (aiModules?.fibonacciData?.goldenPocket)    reasons.push('Entry in Fib Golden Pocket');
  if (aiModules?.stochRSI?.isOversold && isLong)   reasons.push('StochRSI oversold');
  if (aiModules?.stochRSI?.isOverbought && !isLong) reasons.push('StochRSI overbought');
  if (aiModules?.bollingerBands?.isSqueezeRelease)  reasons.push('BB Squeeze release');

  return reasons.length > 0 ? reasons.join(' · ') : `${isLong ? 'Bullish' : 'Bearish'} bias detected`;
}

// Build active signal chips for the top banner
function buildSignalChips(analysis) {
  const { aiModules, confluenceScore, direction, inducement, displacementScore, equalHighsLows, volatilityRegime } = analysis;
  const checks = confluenceScore?.checks || [];
  const isLong = direction === 'long';
  const chips  = [];

  const chipIf = (labelStr, shortText, type = 'active') => {
    if (checks.some(c => c.label.includes(labelStr) && c.met)) {
      chips.push({ text: shortText, type });
    }
  };

  // Core SMC
  chipIf('Trend Aligned', 'Trend ✓');
  chipIf('Liquidity', 'Liq ✓');
  chipIf('Order Block', 'OB ✓');
  chipIf('OTE Zone', 'OTE ✓');

  // Institutional Logic
  if (displacementScore?.valid) chips.push({ text: 'Disp ✓', type: 'active ai' });
  if (inducement?.hasInducement) chips.push({ text: 'Inducement ✓', type: 'active ai' });
  if (isLong && equalHighsLows?.eqh?.length > 0) chips.push({ text: 'EQH Target', type: 'active ai' });
  if (!isLong && equalHighsLows?.eql?.length > 0) chips.push({ text: 'EQL Target', type: 'active ai' });
  if (volatilityRegime?.regime === 'CONTRACTING') chips.push({ text: 'Squeeze', type: 'active ai' });

  // Tech / AI
  chipIf('Golden Pocket', 'Fib GP ✓', 'active ai');
  chipIf('MACD', 'MACD ✓', 'active ai');
  if (aiModules?.wyckoffPhase?.signal === direction) chips.push({ text: `Wyckoff ✓`, type: 'active ai' });
  chipIf('Volume POC', 'POC ✓', 'active ai');
  chipIf('Kill Zone', 'KZ ✓');
  chipIf('Funding Rate', 'Funding ✓', 'active ai');

  return chips.slice(0, 8); // max 8 chips
}

export default function TradeBox({ analysis }) {
  if (!analysis || !analysis.direction) {
    return (
      <div className="sidebar-section">
        <div className="trade-box-empty">Scanning for high-probability setup…</div>
      </div>
    );
  }

  const {
    direction, entry, stopLoss, tpDetails,
    positionSize, breakevenMove, confluenceScore,
    session, keyRisk, invalidationLevel, symbol,
    primaryTimeframe, analysisMode, aiModules,
  } = analysis;

  const isLong   = direction === 'long';
  const grade    = confluenceScore?.aiGrade?.toLowerCase() || 'skip';
  const conf     = confluenceScore?.aiConfidence || 0;
  const slPct    = (entry && stopLoss?.value)
    ? ((Math.abs(entry - stopLoss.value) / entry) * 100).toFixed(2)
    : '—';

  const dirExplanation = buildDirectionExplanation(analysis);
  const chips          = buildSignalChips(analysis);

  // TP color helpers
  const tpPriceClass = (i) => i === 0 ? 'tp' : i === 1 ? 'tp2' : 'tp3';
  const tpBadgeClass = (i) => `tp${i + 1}-badge`;
  const tpAccent     = (i) => `tp${i + 1}`;

  // Wyckoff / Volume context
  const wyckoff = aiModules?.wyckoffPhase;
  const vp      = aiModules?.volumeProfile;
  const macd    = aiModules?.macd;
  const funding = aiModules?.fundingSentiment;

  return (
    <div className={`trade-box ${isLong ? 'long' : 'short'}`}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="trade-box-header">
        <div className="trade-box-header-left">
          <div className="trade-box-title">Signal · {String(analysisMode || primaryTimeframe || '—')}</div>
          <div className="trade-box-subtitle">{String(symbol || '—')} · {String(session?.name || '—')}</div>
        </div>
        <div className={`trade-dir-badge ${isLong ? 'long' : 'short'}`}>
          {isLong ? '▲ LONG' : '▼ SHORT'}
        </div>
      </div>

      {/* ── AI Score Banner ──────────────────────────────────── */}
      <div className="trade-ai-banner">
        <div className="tai-score-wrap">
          <div className={`tai-score-ring ${grade}`}>
            {analysis.signalGrade ? analysis.signalGrade.grade : `${conf}%`}
          </div>
          <div className="tai-grade-info">
            <div className={`tai-grade-label grade-${grade}`}>
              {analysis.signalGrade ? analysis.signalGrade.label : (confluenceScore?.aiGrade || 'SKIP')}
            </div>
            <div className="tai-grade-sub">
              {analysis.signalGrade ? `Inst. Score: ${analysis.signalGrade.score}/100` : 'AI Confidence'}
            </div>
          </div>
        </div>
        <div className="tai-signals">
          {chips.map((c, i) => (
            <span key={i} className={`tai-signal-chip ${c.type}`}>{c.text}</span>
          ))}
        </div>
      </div>

      {/* ── Entry ───────────────────────────────────────────── */}
      <div className={`trade-entry-block ${isLong ? 'long' : 'short'}`}>
        <div className="teb-label">Entry Zone</div>
        <div className="teb-price">{formatPrice(entry, symbol)} <CopyBtn value={entry} /></div>
        <div className="teb-chips">
          <div className="teb-chip size">
            <span className="chip-label">Size</span>
            <strong>{formatSize(positionSize)} units</strong>
          </div>
          <div className="teb-chip risk">
            <span className="chip-label">Risk</span>
            <strong>${analysis.riskAmount ? analysis.riskAmount.toFixed(2) : '5.00'}</strong>
          </div>
          <div className="teb-chip sldist">
            <span className="chip-label">SL Dist</span>
            <strong>−{slPct}%</strong>
          </div>
        </div>
      </div>

      <div className="trade-divider" />

      {/* ── Stop Loss ───────────────────────────────────────── */}
      <div className="trade-level-row sl">
        <div className="tlr-accent" />
        <div className="tlr-content">
          <div className="tlr-left">
            <div className="tlr-badge-row">
              <span className="tlr-badge sl-badge">SL</span>
            </div>
            <div className="tlr-reason" title={stopLoss?.buffer || 'Structural Stop'}>
              {stopLoss?.buffer || 'Structural Stop'}
            </div>
          </div>
          <div className="tlr-right">
            <span className="tlr-price sl">{formatPrice(stopLoss?.value, symbol)} <CopyBtn value={stopLoss?.value} /></span>
            <div className="tlr-meta">
              <span className="tlr-rrr sl">−{slPct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Take Profits ────────────────────────────────────── */}
      {tpDetails && Array.isArray(tpDetails) && tpDetails.map((tp, i) => {
        if (!tp || !tp.level) return null;
        const pctMove  = (entry && tp.level) ? ((Math.abs(tp.level - entry) / entry) * 100).toFixed(2) : '—';
        const rrrLabel = (tp.rrr != null) ? `1:${Number(tp.rrr).toFixed(1)}` : '—';
        return (
          <div className={`trade-level-row ${tpAccent(i)}`} key={i}>
            <div className="tlr-accent" />
            <div className="tlr-content">
              <div className="tlr-left">
                <div className="tlr-badge-row">
                  <span className={`tlr-badge ${tpBadgeClass(i)}`}>TP{i + 1}</span>
                  <span className="tlr-close">→ {String(tp.closePercent || 0)}% of position</span>
                </div>
                <div className="tlr-reason" title={String(tp.reason || 'Target')}>
                  {String(tp.reason || 'Target')}
                </div>
              </div>
              <div className="tlr-right">
                <span className={`tlr-price ${tpPriceClass(i)}`}>
                  {formatPrice(tp.level, symbol)} <CopyBtn value={tp.level} />
                </span>
                <div className="tlr-meta">
                  <span className="tlr-rrr">{rrrLabel}</span>
                  <span className="tlr-pct" style={{ color: i === 0 ? '#00e5b4' : i === 1 ? '#3b8ef0' : '#9d6fff' }}>
                    +{pctMove}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div className="trade-divider" />

      {/* ── Breakeven ───────────────────────────────────────── */}
      <div className="trade-be-row">
        <span>⚡ Move SL to Breakeven at</span>
        <span className="mono" style={{ color: 'var(--accent-yellow)', fontWeight: 700 }}>
          {formatPrice(breakevenMove, symbol)}
        </span>
      </div>

      {/* ── AI Reasoning ────────────────────────────────────── */}
      <div className="trade-reasoning">
        <div className="trade-reasoning-header">🧠 Signal Reasoning</div>
        <div className="reasoning-grid">
          <div className="reasoning-item full-width">
            <div className="ri-label">Why {isLong ? 'LONG' : 'SHORT'}?</div>
            <div className={`ri-value ${isLong ? 'bullish' : 'bearish'}`}>{dirExplanation}</div>
          </div>
          {wyckoff?.signal && (
            <div className="reasoning-item">
              <div className="ri-label">Wyckoff Phase</div>
              <div className={`ri-value ${wyckoff.signal === direction ? 'bullish' : 'bearish'}`}>
                {wyckoff.phase} — {wyckoff.description?.split('.')[0]}
              </div>
            </div>
          )}
          {vp?.poc && (
            <div className="reasoning-item">
              <div className="ri-label">Volume Profile</div>
              <div className="ri-value neutral">
                POC: {formatPrice(vp.poc, symbol)} · VA: {formatPrice(vp.valueAreaLow, symbol)}–{formatPrice(vp.valueAreaHigh, symbol)}
              </div>
            </div>
          )}
          {macd && (
            <div className="reasoning-item">
              <div className="ri-label">MACD</div>
              <div className={`ri-value ${macd.bullCross ? 'bullish' : macd.bearCross ? 'bearish' : 'neutral'}`}>
                {macd.bullCross ? 'Bull cross ↑' : macd.bearCross ? 'Bear cross ↓' : `H: ${macd.histogram?.toFixed?.(2) ?? '—'}`}
              </div>
            </div>
          )}
          {funding?.sentiment && funding.sentiment !== 'neutral' && (
            <div className="reasoning-item">
              <div className="ri-label">Funding / OI</div>
              <div className={`ri-value ${funding.aligned ? (isLong ? 'bullish' : 'bearish') : 'neutral'}`}>
                {funding.fundingRatePct} · {funding.sentiment.replace('overleveraged_', 'OL ').replace('_', ' ')}
              </div>
            </div>
          )}
          <div className="reasoning-item">
            <div className="ri-label">Invalidation</div>
            <div className="ri-value bearish">
              Price close beyond {String(invalidationLevel || '—')}
            </div>
          </div>
          <div className="reasoning-item">
            <div className="ri-label">Key Risk</div>
            <div className="ri-value neutral">{String(keyRisk || '—')}</div>
          </div>
        </div>
      </div>

      {/* ── Trade Management ─────────────────────────────────── */}
      <div className="trade-management-rules">
        <div className="tm-rules-header">Trade Management</div>
        <div className="tm-rules-body">
          <div className="tm-rule-item text-green">
            <strong>BE Trigger:</strong> Move SL to Entry after 1.5R gain
          </div>
          {tpDetails && tpDetails.length >= 3 ? (
            <>
              <div className="tm-rule-item">
                <strong>TP1:</strong> Close 40% → move SL to breakeven
              </div>
              <div className="tm-rule-item">
                <strong>TP2:</strong> Close 35% → trail SL to TP1 ({formatPrice(tpDetails[0]?.level, symbol)})
              </div>
              <div className="tm-rule-item">
                <strong>TP3:</strong> Close remaining 25% — final exit
              </div>
            </>
          ) : (
            <div className="tm-rule-item">
              <strong>Single Target:</strong> Close 100% at TP
            </div>
          )}
          <div className="tm-rule-item text-yellow">
            <strong>Momentum Exit:</strong> 2 consecutive 15m closes against trade
          </div>
          <div className="tm-rule-item text-red">
            <strong>Structure Exit:</strong> Immediate close on 15m HL/LH breach
          </div>
          <div className="tm-rule-item text-purple">
            <strong>{analysis.timeCap || '6H'} Cap:</strong> Exit or reduce if stalled
          </div>
        </div>
      </div>

    </div>
  );
}
