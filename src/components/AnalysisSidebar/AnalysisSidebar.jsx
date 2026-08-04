import { useMarket } from '../../context/MarketContext.jsx';
import TradeBox from '../TradeBox/TradeBox.jsx';
import MarketRegime from '../MarketRegime/MarketRegime.jsx';
import { useState } from 'react';
import './AnalysisSidebar.css';

// AI Confluence Score section
function ConfluenceSection({ score, signalGrade, staggerIndex }) {
  if (!score) return null;
  const pct = score.aiConfidence || 0;
  const metCount = score.checks.filter(c => c.met).length;
  
  const displayPct = signalGrade ? signalGrade.score : pct;
  const displayGrade = signalGrade ? signalGrade.grade : (score.aiGrade || 'SKIP');
  const displayLabel = signalGrade ? signalGrade.label : (score.aiGrade || 'SKIP');
  
  const barColor = displayPct >= 85 ? 'var(--accent-green)' : displayPct >= 70 ? 'var(--accent-blue)' : displayPct >= 55 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  const offset = 251.2 - (251.2 * displayPct) / 100; // SVG circle r=40
  
  return (
    <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="section-header gradient-header">{signalGrade ? 'Institutional Confluence' : 'AI Confluence'}</div>
      
      <div className="score-ring-container">
        <svg className="score-svg-ring" width="100" height="100">
           <circle className="score-ring-bg" cx="50" cy="50" r="40" />
           <circle className="score-ring-progress" cx="50" cy="50" r="40" style={{ strokeDashoffset: offset, stroke: barColor }} />
        </svg>
        <div className="score-ring-content">
          <span className="score-number mono">{displayPct}</span>
          {!signalGrade && <span className="score-divider">%</span>}
        </div>
      </div>
      
      <div className="score-tier-wrap">
        <span className={`score-tier ${displayGrade?.toLowerCase() || 'skip'}`}>{displayGrade} {signalGrade ? `— ${displayLabel}` : ''}</span>
      </div>

      <div className="pillar-count-box">
        <span className="pillar-count">{metCount}/{score.checks.length} signals met</span>
      </div>
      <ul className="check-list-grid">
        {score.checks.map((c, i) => (
          <li key={i} className={`check-item-card ${c.met ? 'met' : 'unmet'}`}>
            <div className="check-icon">{c.met ? '✓' : '✗'}</div>
            <span className="check-label">{c.label}</span>
            {c.weight >= 1.5 && <span className="pillar-tag-key">KEY</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionBadge({ decision, waitCondition, staggerIndex }) {
  const isTakeNow = decision === 'TAKE_NOW';
  const isWait = decision === 'WAIT';
  
  const map = {
    TAKE_NOW: { label: '⚡ TAKE TRADE NOW', color: 'var(--accent-green)' },
    WAIT:     { label: '⏳ WAIT FOR SETUP', color: 'var(--accent-yellow)' },
    NO_TRADE: { label: '✗ NO TRADE',        color: 'var(--accent-red)' },
  };
  const cfg = map[decision] || { label: decision, color: 'var(--text-secondary)' };
  
  return (
    <div className={`sidebar-section animate-fade-in-up badge-container ${isTakeNow ? 'badge-take-now' : isWait ? 'badge-wait' : 'badge-normal'}`} style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="decision-badge" style={{ color: cfg.color }}>
        {cfg.label}
      </div>
      {waitCondition && <div className="wait-note">{waitCondition}</div>}
    </div>
  );
}

function StepAccordion({ steps, staggerIndex }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;
  return (
    <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <button className="section-header clickable" onClick={() => setOpen(!open)}>
        Analysis Log {open ? '▾' : '▸'} ({steps.length} steps)
      </button>
      {open && (
        <div className="terminal-log">
          {steps.map((s, i) => (
            <div key={i} className="terminal-line">
              <span className="terminal-line-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="terminal-line-text">{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SMCSection({ smcData, staggerIndex }) {
  if (!smcData) return null;
  const { orderBlocks, breakerBlocks, fvgs, sweeps, structureShifts, vwap } = smcData;
  const activeOBs = (orderBlocks || []).filter(ob => ob.status === 'active');
  const counts = [
    { label: 'OBs', icon: '📦', val: activeOBs.length, color: 'var(--accent-purple)' },
    { label: 'BBs', icon: '🧱', val: breakerBlocks?.length || 0, color: 'var(--accent-cyan)' },
    { label: 'FVGs', icon: '🔷', val: fvgs?.length || 0,        color: 'var(--accent-blue)' },
    { label: 'Sweeps', icon: '💥', val: sweeps?.length || 0,       color: 'var(--accent-yellow)' },
    { label: 'BOS', icon: '🔄', val: structureShifts?.length || 0, color: 'var(--accent-green)' },
    ...(vwap ? [{ label: 'VWAP', icon: '📈', val: `$${vwap.toFixed(0)}`, color: 'var(--accent-cyan)' }] : []),
  ];
  return (
    <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="section-header accent-border">SMC Detected</div>
      <div className="smc-glass-grid">
        {counts.map(({ label, icon, val, color }) => (
          <div className="smc-glass-card" key={label} style={{ '--hover-color': color }}>
            <span className="smc-card-icon">{icon}</span>
            <span className="smc-card-val" style={{ color }}>{val}</span>
            <span className="smc-card-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProbabilityBars({ up, down, range, staggerIndex }) {
  return (
    <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="section-header gradient-header">Direction Probability</div>
      {[
        { label: `↑ LONG`, pct: up, color: 'var(--accent-green)' },
        { label: `◼ RANGE`, pct: range, color: 'var(--text-dim)' },
        { label: `↓ SHORT`, pct: down, color: 'var(--accent-red)' },
      ].map(({ label, pct, color }) => (
        <div className="prob-row-v2" key={label}>
          <div className="prob-info-v2">
            <span className="prob-label-v2" style={{ color }}>{label}</span>
            <span className="prob-pct-v2">{pct}%</span>
          </div>
          <div className="prob-track-v2">
            <div className="prob-fill-v2" style={{ width: `${pct}%`, background: `linear-gradient(90deg, transparent, ${color})`, boxShadow: `0 0 10px ${color}80` }}>
               <div className="prob-glow-tip" style={{ background: color }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AIOpinion({ aiAnalysis, staggerIndex }) {
  if (!aiAnalysis) return null;
  const decision  = String(aiAnalysis.decision || 'ERROR');
  const reasoning = String(aiAnalysis.reasoning || 'No reasoning provided');
  const colorMap  = { AGREE: 'var(--accent-green)', DISAGREE: 'var(--accent-red)', CAUTION: 'var(--accent-yellow)', ERROR: 'var(--text-dim)' };
  return (
    <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="section-header accent-border">🧠 AI Second Opinion</div>
      <div className="ai-opinion-card">
        <div className="ai-verdict" style={{ color: colorMap[decision] || 'var(--text-dim)' }}>{decision}</div>
        <div className="ai-reasoning">{reasoning}</div>
      </div>
    </div>
  );
}

function CMEGapSection({ cmeGapData, staggerIndex }) {
  if (!cmeGapData || (!cmeGapData.hasUnfilledGaps && (!cmeGapData.filledGaps || cmeGapData.filledGaps.length === 0))) return null;

  const tierColor = (tier) => {
    if (tier === 'VERY_HIGH') return 'var(--accent-green)';
    if (tier === 'HIGH') return 'var(--accent-blue)';
    if (tier === 'MODERATE') return 'var(--accent-yellow)';
    return 'var(--accent-red)';
  };

  return (
    <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="section-header gradient-header">📊 CME Gap Analysis</div>
      <div className="cme-timeline">
        {cmeGapData.gapFillBias && (
          <div className="cme-bias-pill" style={{
            background: cmeGapData.gapFillBias === 'bullish' ? 'rgba(0,212,100,0.12)' : 'rgba(255,63,94,0.12)',
            color: cmeGapData.gapFillBias === 'bullish' ? 'var(--accent-green)' : 'var(--accent-red)',
            border: `1px solid ${cmeGapData.gapFillBias === 'bullish' ? 'var(--accent-green)' : 'var(--accent-red)'}30`,
          }}>
            Gap Fill Bias: {cmeGapData.gapFillBias === 'bullish' ? '↑ BULLISH' : '↓ BEARISH'}
          </div>
        )}

        {cmeGapData.unfilledGaps && cmeGapData.unfilledGaps.length > 0 && (
          <div className="cme-gaps-list">
            {cmeGapData.unfilledGaps.map((g, i) => (
              <div className="cme-gap-compact-card" key={i}>
                <div className="cme-timeline-node" style={{ background: g.direction === 'up' ? 'var(--accent-green)' : 'var(--accent-red)' }}></div>
                <div className="cme-gap-compact-content">
                  <div className="cme-gap-header">
                    <span className={`cme-gap-dir ${g.direction}`}>
                      {g.direction === 'up' ? '⬆' : '⬇'} Gap {g.direction.toUpperCase()} ({g.gapPct.toFixed(2)}%)
                    </span>
                    <span className="cme-prob-pct" style={{ color: tierColor(g.fillTier) }}>{g.fillProbability}% Fill</span>
                  </div>
                  <div className="cme-gap-range mono">
                    ${g.gapLower.toFixed(2)} — ${g.gapUpper.toFixed(2)}
                  </div>
                  <div className="cme-prob-track-v2">
                    <div className="cme-prob-fill-v2" style={{ width: `${g.fillProbability}%`, background: tierColor(g.fillTier), boxShadow: `0 0 6px ${tierColor(g.fillTier)}80` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TradeDurationInsight({ duration, timeframe, staggerIndex }) {
  if (!duration) return null;
  const tfLabels = { '5m': 'Scalp', '15m': 'Intraday', '1h': 'Swing', '4h': 'Position', '1d': 'Trend' };
  const speed = parseFloat(duration.compositeScore || '1');
  const speedLabel = speed < 0.65 ? { text: 'Very Fast', color: '#00e5b4' }
    : speed < 0.85 ? { text: 'Fast',      color: '#00d4ff' }
    : speed < 1.10 ? { text: 'Moderate',  color: '#f7c948' }
    : speed < 1.35 ? { text: 'Slow',      color: '#ff9f43' }
    :               { text: 'Very Slow',  color: '#ff3f5e' };
    
  const progressPct = Math.max(10, Math.min(100, (2 - speed) * 50));

  return (
    <div className="sidebar-section duration-glass-card animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="duration-header">
        <span className="duration-title">⏱ Est. Duration</span>
        <span className="duration-tf-tag">{tfLabels[timeframe] || (timeframe || '').toUpperCase()}</span>
      </div>
      <div className="duration-main-display">
        <div className="duration-time-value mono">{duration.typicalLabel}</div>
        <div className="duration-sub-range mono">{duration.formattedRange}</div>
      </div>
      <div className="duration-progress-container">
        <div className="duration-progress-track">
           <div className="duration-progress-fill" style={{ width: `${progressPct}%`, background: speedLabel.color }} />
        </div>
        <span className="duration-speed-badge" style={{ color: speedLabel.color }}>{speedLabel.text}</span>
      </div>
    </div>
  );
}

const MODE_COLORS = { '5m':  '#00d4ff', '15m': '#3b8ef0', '1h':  '#f7c948', '4h':  '#9d6fff', '1d':  '#ff3f5e' };

export default function AnalysisSidebar() {
  const { analysis, isAnalyzing, timeframe } = useMarket();

  if (isAnalyzing) {
    return (
      <aside className="analysis-sidebar">
        <div className="sidebar-empty">
          <div className="empty-icon"><span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>
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

  let staggerIdx = 0;
  const nextDelay = () => staggerIdx++;

  return (
    <aside className="analysis-sidebar">
      <div className="sidebar-scroll">

        {/* ── MARKET REGIME (TOP) ───────────────────────── */}
        <div className="animate-fade-in-up" style={{ animationDelay: `${nextDelay() * 60}ms` }}>
           <MarketRegime analysis={analysis} />
        </div>

        {/* ── ANALYSIS MODE HEADER ───────────────────────── */}
        <div className="analysis-mode-header animate-fade-in-up glass-card" style={{ animationDelay: `${nextDelay() * 60}ms` }}>
          <span className="amh-tf-badge" style={{ background: `${modeColor}18`, color: modeColor, border: `1px solid ${modeColor}40` }}>
            {(analysis.primaryTimeframe || 'N/A').toUpperCase()}
          </span>
          <span className="amh-label">Analysis</span>
          <span className="amh-mode">{analysis.analysisMode || '—'}</span>
          {analysis.emaSignal?.active && analysis.emaSignal?.aligned && (
            <span className="ema-signal-pill">⚡ {analysis.emaSignal.type}</span>
          )}
        </div>

        {/* ── QUICK STATS ────────────────────────────────── */}
        <div className="quick-stats-bar animate-fade-in-up glass-card" style={{ animationDelay: `${nextDelay() * 60}ms` }}>
          <div className="qs-item">
            <span className="qs-label">Entry</span>
            <span className="qs-val mono text-blue">{analysis.entry?.toLocaleString() || '—'}</span>
          </div>
          <div className="qs-item">
            <span className="qs-label">SL (-$50)</span>
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

        {/* ── DECISION ───────────────────────────────────── */}
        <DecisionBadge decision={analysis.decision} waitCondition={analysis.waitCondition} staggerIndex={nextDelay()} />

        {/* ── TRADE BOX ──────────────────────────────────── */}
        <div className="animate-fade-in-up" style={{ animationDelay: `${nextDelay() * 60}ms` }}>
           <TradeBox analysis={analysis} />
        </div>

        {/* ── ESTIMATED TRADE DURATION INSIGHT ───────────── */}
        <TradeDurationInsight duration={analysis.estimatedDuration} timeframe={analysis.primaryTimeframe} staggerIndex={nextDelay()} />

        {/* ── REJECTION REASON ───────────────────────────── */}
        {analysis.rejectionReason && (
          <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${nextDelay() * 60}ms` }}>
            <div className="rejection-banner">✗ {String(analysis.rejectionReason)}</div>
          </div>
        )}

        {/* ── NEWS CAUTION ───────────────────────────────── */}
        {analysis.newsCaution && (
          <div className="news-caution-banner animate-fade-in-up glass-card" style={{ animationDelay: `${nextDelay() * 60}ms` }}>
            ⚠️ <strong>NEWS CAUTION</strong> — {analysis.newsCautionReason}<br />
            <span style={{ opacity: 0.75 }}>Wait for 15m BOS confirmation post-event.</span>
          </div>
        )}

        {/* ── CONFLUENCE ─────────────────────────────────── */}
        <ConfluenceSection score={analysis.confluenceScore} signalGrade={analysis.signalGrade} staggerIndex={nextDelay()} />

        {/* ── AI ─────────────────────────────────────────── */}
        <AIOpinion aiAnalysis={analysis.aiAnalysis} staggerIndex={nextDelay()} />

        {/* ── PROBABILITY ────────────────────────────────── */}
        <ProbabilityBars up={analysis.upProbability || 50} down={analysis.downProbability || 50} range={analysis.rangeProbability || 0} staggerIndex={nextDelay()} />

        {/* ── SMC COUNTS ─────────────────────────────────── */}
        <SMCSection smcData={analysis.smcData} staggerIndex={nextDelay()} />

        {/* ── CME GAP ANALYSIS ───────────────────────────── */}
        <CMEGapSection cmeGapData={analysis.cmeGapData} staggerIndex={nextDelay()} />

        {/* ── STEPS LOG ──────────────────────────────────── */}
        <StepAccordion steps={analysis.analysisSteps} staggerIndex={nextDelay()} />

        {/* ── FOOTER ─────────────────────────────────────── */}
        <div className="engine-footer animate-fade-in-up" style={{ animationDelay: `${nextDelay() * 60}ms` }}>
          ENGINE v11.0 · {analysis.symbol} · {analysis.analysisMode}
        </div>

      </div>
    </aside>
  );
}
