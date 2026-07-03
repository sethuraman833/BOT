import { useMarket } from '../../context/MarketContext.jsx';
import TradeBox from '../TradeBox/TradeBox.jsx';
import { useState } from 'react';
import './AnalysisSidebar.css';

// Pillar dot row
function PillarDots({ checks }) {
  const pillars = checks.filter(c => c.pillar);
  return (
    <div className="pillar-dots">
      {pillars.map((p, i) => (
        <div key={i} className={`pillar-dot ${p.met ? 'met' : 'unmet'}`} title={p.label} />
      ))}
      <span className="pillar-count">{pillars.filter(p => p.met).length}/{pillars.length} pillars</span>
    </div>
  );
}

function ConfluenceSection({ score }) {
  if (!score) return null;
  const pct = score.aiConfidence || 0;
  const barColor = pct >= 85 ? 'var(--accent-green)' : pct >= 70 ? 'var(--accent-blue)' : pct >= 55 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  return (
    <div className="sidebar-section">
      <div className="section-header">Confluence Score</div>
      <div className="score-display">
        <span className="score-number mono">{pct}</span>
        <span className="score-divider" style={{ fontSize: '18px' }}>%</span>
        <span className={`score-tier ${score.aiGrade?.toLowerCase() || 'skip'}`}>{score.aiGrade || 'SKIP'}</span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: barColor, boxShadow: `0 0 8px ${barColor}50` }} />
      </div>
      <PillarDots checks={score.checks} />
      <ul className="check-list">
        {score.checks.map((c, i) => (
          <li key={i} className={`check-item ${c.pillar ? 'pillar' : ''}`}>
            <div className={`check-icon ${c.met ? 'met' : 'unmet'}`}>{c.met ? '✓' : '✗'}</div>
            <span className="check-label">{c.label}</span>
            {c.pillar && <span className="pillar-tag">PILLAR</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionBadge({ decision, waitCondition }) {
  const map = {
    TAKE_NOW: { label: '⚡ TAKE TRADE NOW', color: 'var(--accent-green)' },
    WAIT:     { label: '⏳ WAIT FOR SETUP', color: 'var(--accent-yellow)' },
    NO_TRADE: { label: '✗ NO TRADE',        color: 'var(--accent-red)' },
  };
  const cfg = map[decision] || { label: decision, color: 'var(--text-secondary)' };
  return (
    <div className="sidebar-section">
      <div className="decision-badge" style={{ borderColor: cfg.color, color: cfg.color }}>
        {cfg.label}
      </div>
      {waitCondition && <div className="wait-note">{waitCondition}</div>}
    </div>
  );
}

function StepAccordion({ steps }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;
  return (
    <div className="sidebar-section">
      <button className="section-header clickable" onClick={() => setOpen(!open)}>
        Analysis Log {open ? '▾' : '▸'} ({steps.length} steps)
      </button>
      {open && (
        <ul className="steps-list fade-in">
          {steps.map((s, i) => <li key={i} className="step-item">{s}</li>)}
        </ul>
      )}
    </div>
  );
}

function SMCSection({ smcData }) {
  if (!smcData) return null;
  const { orderBlocks, breakerBlocks, fvgs, sweeps, structureShifts, vwap } = smcData;
  const activeOBs = (orderBlocks || []).filter(ob => ob.status === 'active');
  const counts = [
    { label: 'Order Blocks', val: activeOBs.length, color: 'var(--accent-purple)' },
    { label: 'Breaker Blocks', val: breakerBlocks?.length || 0, color: 'var(--accent-cyan)' },
    { label: 'Active FVGs',  val: fvgs?.length || 0,        color: 'var(--accent-blue)' },
    { label: 'Sweeps',       val: sweeps?.length || 0,       color: 'var(--accent-yellow)' },
    { label: 'BOS / CHOCH',  val: structureShifts?.length || 0, color: 'var(--accent-green)' },
    ...(vwap ? [{ label: 'VWAP', val: `$${vwap.toFixed(2)}`, color: 'var(--accent-cyan)' }] : []),
  ];
  return (
    <div className="sidebar-section">
      <div className="section-header">SMC Detected</div>
      <div className="smc-grid">
        {counts.map(({ label, val, color }) => (
          <div className="smc-stat" key={label}>
            <span className="smc-count" style={{ color }}>{val}</span>
            <span className="smc-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProbabilityBars({ up, down, range }) {
  return (
    <div className="sidebar-section">
      <div className="section-header">Direction Probability</div>
      {[
        { label: `↑ ${up}%`,    pct: up,    color: 'var(--accent-green)' },
        { label: `◼ ${range}%`, pct: range, color: 'var(--text-dim)' },
        { label: `↓ ${down}%`,  pct: down,  color: 'var(--accent-red)' },
      ].map(({ label, pct, color }) => (
        <div className="prob-row" key={label}>
          <span className="prob-label" style={{ color }}>{label}</span>
          <div className="prob-track">
            <div className="prob-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
          <span className="prob-pct">{pct}%</span>
        </div>
      ))}
    </div>
  );
}

function AIOpinion({ aiAnalysis }) {
  if (!aiAnalysis) return null;
  const decision  = String(aiAnalysis.decision || 'ERROR');
  const reasoning = String(aiAnalysis.reasoning || 'No reasoning provided');
  const colorMap  = { AGREE: 'var(--accent-green)', DISAGREE: 'var(--accent-red)', CAUTION: 'var(--accent-yellow)', ERROR: 'var(--text-dim)' };
  return (
    <div className="sidebar-section">
      <div className="section-header">🧠 AI Second Opinion</div>
      <div className="ai-opinion-card">
        <div className="ai-verdict" style={{ color: colorMap[decision] || 'var(--text-dim)' }}>{decision}</div>
        <div className="ai-reasoning">{reasoning}</div>
      </div>
    </div>
  );
}

function CMEGapSection({ cmeGapData }) {
  if (!cmeGapData || (!cmeGapData.hasUnfilledGaps && (!cmeGapData.filledGaps || cmeGapData.filledGaps.length === 0))) return null;

  const tierColor = (tier) => {
    if (tier === 'VERY_HIGH') return 'var(--accent-green)';
    if (tier === 'HIGH') return 'var(--accent-blue)';
    if (tier === 'MODERATE') return 'var(--accent-yellow)';
    return 'var(--accent-red)';
  };

  return (
    <div className="sidebar-section">
      <div className="section-header">📊 CME Gap Analysis</div>

      {cmeGapData.gapFillBias && (
        <div className="cme-bias-pill" style={{
          background: cmeGapData.gapFillBias === 'bullish' ? 'rgba(0,212,100,0.12)' : 'rgba(255,63,94,0.12)',
          color: cmeGapData.gapFillBias === 'bullish' ? 'var(--accent-green)' : 'var(--accent-red)',
          border: `1px solid ${cmeGapData.gapFillBias === 'bullish' ? 'var(--accent-green)' : 'var(--accent-red)'}30`,
        }}>
          Gap Fill Bias: {cmeGapData.gapFillBias === 'bullish' ? '↑ BULLISH' : '↓ BEARISH'}
        </div>
      )}

      {/* Unfilled gaps */}
      {cmeGapData.unfilledGaps && cmeGapData.unfilledGaps.length > 0 && (
        <div className="cme-gaps-list">
          {cmeGapData.unfilledGaps.map((g, i) => (
            <div className="cme-gap-card" key={i}>
              <div className="cme-gap-header">
                <span className={`cme-gap-dir ${g.direction}`}>
                  {g.direction === 'up' ? '⬆' : '⬇'} Gap {g.direction.toUpperCase()}
                </span>
                <span className="cme-gap-pct">{g.gapPct.toFixed(2)}%</span>
              </div>
              <div className="cme-gap-range mono">
                ${g.gapLower.toFixed(2)} — ${g.gapUpper.toFixed(2)}
              </div>
              <div className="cme-gap-meta">
                <span>Dist: {g.distToGapPct.toFixed(1)}%</span>
                <span>
                  Age: {(() => {
                    if (g.ageHours < 24) return `${g.ageHours}h`;
                    const days = Math.round(g.ageHours / 24);
                    if (days < 7) return `${days}d`;
                    const weeks = days / 7;
                    return weeks % 1 === 0 ? `${weeks}w` : `${weeks.toFixed(1)}w`;
                  })()}
                </span>
                <span>Fill: {g.partialFillPct}%</span>
              </div>
              {/* Fill probability bar */}
              <div className="cme-prob-row">
                <span className="cme-prob-label">Fill Probability</span>
                <div className="cme-prob-track">
                  <div
                    className="cme-prob-fill"
                    style={{
                      width: `${g.fillProbability}%`,
                      background: tierColor(g.fillTier),
                      boxShadow: `0 0 6px ${tierColor(g.fillTier)}40`,
                    }}
                  />
                </div>
                <span className="cme-prob-pct" style={{ color: tierColor(g.fillTier) }}>{g.fillProbability}%</span>
              </div>
              {/* Prediction factors */}
              {g.factors && g.factors.length > 0 && (
                <ul className="cme-factors">
                  {g.factors.map((f, fi) => <li key={fi}>{f}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recently filled gaps */}
      {cmeGapData.filledGaps && cmeGapData.filledGaps.length > 0 && (
        <div className="cme-filled-section">
          <div className="cme-filled-header">Recently Filled</div>
          {cmeGapData.filledGaps.map((g, i) => {
            const ageStr = (() => {
              if (g.ageHours < 24) return `${g.ageHours}h ago`;
              const days = Math.round(g.ageHours / 24);
              if (days < 7) return `${days}d ago`;
              const weeks = days / 7;
              return (weeks % 1 === 0 ? `${weeks}w` : `${weeks.toFixed(1)}w`) + ' ago';
            })();
            const fillStr = g.timeToFillHours != null
              ? (g.timeToFillHours < 24 ? `${g.timeToFillHours}h` : `${Math.round(g.timeToFillHours / 24)}d`)
              : null;
            return (
              <div className="cme-filled-row" key={i}>
                <span className="cme-filled-icon">✓</span>
                <span className="cme-filled-range mono">${g.gapLower.toFixed(0)}–${g.gapUpper.toFixed(0)}</span>
                <span className="cme-filled-dir">{g.direction === 'up' ? '↑' : '↓'}</span>
                <span className="cme-filled-age">{ageStr}</span>
                {fillStr && <span className="cme-filled-time">⏱ {fillStr}</span>}
              </div>
            );
          })}
        </div>
      )}

      {!cmeGapData.hasUnfilledGaps && (
        <div className="cme-all-filled">✓ All CME gaps filled</div>
      )}

      {/* This Week's Gap status */}
      {cmeGapData.stats?.thisWeekGap && (
        <div className={`cme-this-week-card ${cmeGapData.stats.thisWeekFilled ? 'filled' : 'open'}`}>
          <div className="cme-tw-header">
            <span className="cme-tw-label">This Week's Gap</span>
            <span className="cme-tw-status-badge">
              {cmeGapData.stats.thisWeekFilled ? '✓ FILLED' : '⬤ OPEN'}
            </span>
          </div>
          <div className="cme-tw-price mono">
            ${cmeGapData.stats.thisWeekGap.gapLower.toFixed(2)} — ${cmeGapData.stats.thisWeekGap.gapUpper.toFixed(2)}
          </div>
          <div className="cme-tw-meta">
            <span className={cmeGapData.stats.thisWeekGap.direction}>
              {cmeGapData.stats.thisWeekGap.direction === 'up' ? '⬆ Gap Up' : '⬇ Gap Down'}
            </span>
            <span>Size: {cmeGapData.stats.thisWeekGap.gapPct.toFixed(2)}%</span>
            {cmeGapData.stats.thisWeekGap.timeToFillHours && (
              <span>⏱ {cmeGapData.stats.thisWeekGap.timeToFillHours < 24 ? `${cmeGapData.stats.thisWeekGap.timeToFillHours}h` : `${Math.round(cmeGapData.stats.thisWeekGap.timeToFillHours / 24)}d`}</span>
            )}
          </div>
        </div>
      )}

      {/* Stats bar */}
      {cmeGapData.stats && cmeGapData.stats.totalGaps > 0 && (
        <div className="cme-stats-bar">
          <div className="cme-stat-item">
            <span className="cme-stat-val">{cmeGapData.stats.fillRate}%</span>
            <span className="cme-stat-lbl">Fill Rate</span>
          </div>
          <div className="cme-stat-item">
            <span className="cme-stat-val">{cmeGapData.stats.totalFilled}/{cmeGapData.stats.totalGaps}</span>
            <span className="cme-stat-lbl">Gaps Filled</span>
          </div>
          {cmeGapData.stats.avgFillTimeHours != null && (
            <div className="cme-stat-item">
              <span className="cme-stat-val">
                {cmeGapData.stats.avgFillTimeHours < 24
                  ? `${cmeGapData.stats.avgFillTimeHours}h`
                  : `${Math.round(cmeGapData.stats.avgFillTimeHours / 24)}d`}
              </span>
              <span className="cme-stat-lbl">Avg Fill</span>
            </div>
          )}
          {cmeGapData.stats.consecutiveDir && cmeGapData.stats.consecutiveCount >= 2 && (
            <div className="cme-stat-item">
              <span className="cme-stat-val" style={{ color: cmeGapData.stats.consecutiveDir === 'up' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {cmeGapData.stats.consecutiveCount}× {cmeGapData.stats.consecutiveDir === 'up' ? '↑' : '↓'}
              </span>
              <span className="cme-stat-lbl">Streak</span>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// Colour per TF mode
const MODE_COLORS = {
  '5m':  '#00d4ff',
  '15m': '#3b8ef0',
  '1h':  '#f7c948',
  '4h':  '#9d6fff',
  '1d':  '#ff3f5e',
};

export default function AnalysisSidebar() {
  const { analysis, isAnalyzing, timeframe } = useMarket();

  if (isAnalyzing) {
    return (
      <aside className="analysis-sidebar">
        <div className="sidebar-empty">
          <div className="empty-icon">
            <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
          </div>
          <div className="empty-title">ANALYZING {timeframe?.toUpperCase()}</div>
          <p className="empty-sub">Running 17-step confluence engine on {timeframe} candles…</p>
        </div>
      </aside>
    );
  }

  if (!analysis) {
    const modeColor = MODE_COLORS[timeframe] || '#3b8ef0';
    return (
      <aside className="analysis-sidebar">
        <div className="sidebar-empty">
          <div className="empty-icon">⚡</div>
          <div className="empty-title">SYSTEM STANDBY</div>
          <p className="empty-sub">Select <span style={{ color: modeColor, fontWeight: 700 }}>{timeframe?.toUpperCase()}</span> timeframe and click Analyze to run the SMC engine</p>
        </div>
      </aside>
    );
  }

  const modeColor = analysis.modeColor || MODE_COLORS[analysis.primaryTimeframe] || '#3b8ef0';

  return (
    <aside className="analysis-sidebar">
      <div className="sidebar-scroll fade-in stagger-in">

        {/* ── ANALYSIS MODE HEADER ─────────────────────────── */}
        <div className="analysis-mode-header">
          <span
            className="amh-tf-badge"
            style={{
              background: `${modeColor}18`,
              color: modeColor,
              border: `1px solid ${modeColor}40`,
            }}
          >
            {(analysis.primaryTimeframe || 'N/A').toUpperCase()}
          </span>
          <span className="amh-label">Analysis</span>
          <span className="amh-mode">{analysis.analysisMode || '—'}</span>
          {analysis.emaSignal?.active && (
            <span className="ema-signal-pill">⚡ {analysis.emaSignal.type}</span>
          )}
        </div>

        {/* ── QUICK STATS ───────────────────────────────────── */}
        <div className="quick-stats-bar">
          <div className="qs-item">
            <span className="qs-label">Entry</span>
            <span className="qs-val mono text-blue">{analysis.entry?.toLocaleString() || '—'}</span>
          </div>
          <div className="qs-item">
            <span className="qs-label">SL (-$5)</span>
            <span className="qs-val mono text-red">{analysis.stopLoss?.value?.toLocaleString() || '—'}</span>
          </div>
          <div className="qs-item">
            <span className="qs-label">TP1</span>
            <span className="qs-val mono text-green">{analysis.tpDetails?.[0]?.level?.toLocaleString() || '—'}</span>
          </div>
          <div className="qs-item">
            <span className="qs-label">Size</span>
            <span className="qs-val mono">{analysis.positionSize || '—'}</span>
          </div>
        </div>

        {/* ── DECISION ──────────────────────────────────────── */}
        <DecisionBadge decision={analysis.decision} waitCondition={analysis.waitCondition} />

        {/* ── REJECTION REASON ──────────────────────────────── */}
        {analysis.rejectionReason && (
          <div className="sidebar-section">
            <div className="rejection-banner">✗ {String(analysis.rejectionReason)}</div>
          </div>
        )}

        {/* ── NEWS CAUTION ──────────────────────────────────── */}
        {analysis.newsCaution && (
          <div className="news-caution-banner">
            ⚠️ <strong>NEWS CAUTION</strong> — {analysis.newsCautionReason}<br />
            <span style={{ opacity: 0.75 }}>Wait for 15m BOS confirmation post-event.</span>
          </div>
        )}

        {/* ── CONFLUENCE ────────────────────────────────────── */}
        <ConfluenceSection score={analysis.confluenceScore} />

        {/* ── AI ────────────────────────────────────────────── */}
        <AIOpinion aiAnalysis={analysis.aiAnalysis} />

        {/* ── TRADE BOX ─────────────────────────────────────── */}
        <TradeBox analysis={analysis} />

        {/* ── PROBABILITY ───────────────────────────────────── */}
        <ProbabilityBars
          up={analysis.upProbability || 50}
          down={analysis.downProbability || 50}
          range={analysis.rangeProbability || 0}
        />

        {/* ── SMC COUNTS ────────────────────────────────────── */}
        <SMCSection smcData={analysis.smcData} />

        {/* ── CME GAP ANALYSIS ────────────────────────────────── */}
        <CMEGapSection cmeGapData={analysis.cmeGapData} />

        {/* ── STEPS LOG ─────────────────────────────────────── */}
        <StepAccordion steps={analysis.analysisSteps} />

        {/* ── FOOTER ────────────────────────────────────────── */}
        <div className="engine-footer">ENGINE v10.0 · {analysis.symbol} · {analysis.analysisMode}</div>

      </div>
    </aside>
  );
}
