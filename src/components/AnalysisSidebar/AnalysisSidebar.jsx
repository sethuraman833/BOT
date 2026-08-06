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

// ── SMC Institutional Analysis Block ─────────────────────────────
function SMCAnalysisBlock({ smcAnalysis, direction, confluenceScore, staggerIndex }) {
  if (!smcAnalysis) return null;
  const isLong = direction === 'long';
  const confidence = confluenceScore?.aiConfidence || 0;

  const fmt = (val) => val != null ? `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—';

  const rows = [
    {
      label: 'BOS',
      value: smcAnalysis.bos?.confirmed
        ? `✅ Confirmed ${smcAnalysis.bos.type || ''} at ${fmt(smcAnalysis.bos.level)} (${smcAnalysis.bos.tf || ''})`
        : '— Not detected',
      met: smcAnalysis.bos?.confirmed,
    },
    {
      label: 'CHoCH',
      value: smcAnalysis.choch?.confirmed
        ? `✅ Confirmed at ${fmt(smcAnalysis.choch.level)}`
        : '— Not detected',
      met: smcAnalysis.choch?.confirmed,
    },
    {
      label: 'Liquidity Sweep',
      value: smcAnalysis.liquiditySweep?.confirmed
        ? `✅ ${smcAnalysis.liquiditySweep.direction || ''} sweep at ${fmt(smcAnalysis.liquiditySweep.level)}`
        : '— Not detected',
      met: smcAnalysis.liquiditySweep?.confirmed,
    },
    {
      label: 'Order Block',
      value: smcAnalysis.orderBlock?.confirmed
        ? `✅ ${smcAnalysis.orderBlock.type === 'demand' ? 'Demand' : 'Supply'} OB  ${fmt(smcAnalysis.orderBlock.low)}–${fmt(smcAnalysis.orderBlock.high)}`
        : '— Not detected',
      met: smcAnalysis.orderBlock?.confirmed,
    },
    {
      label: 'FVG',
      value: smcAnalysis.fvg?.confirmed
        ? `✅ ${smcAnalysis.fvg.type === 'bullish' ? 'Bullish' : 'Bearish'} FVG  ${fmt(smcAnalysis.fvg.lower)}–${fmt(smcAnalysis.fvg.upper)}`
        : '— Not detected',
      met: smcAnalysis.fvg?.confirmed,
    },
    {
      label: 'Structural Target',
      value: smcAnalysis.structuralTarget
        ? `${smcAnalysis.structuralTarget.description || 'Liquidity Draw'} at ${fmt(smcAnalysis.structuralTarget.level)}`
        : '— None identified',
      met: !!smcAnalysis.structuralTarget,
    },
  ];

  const tp4RAchievable = smcAnalysis.tp4RAchievable;
  const obstacleText = smcAnalysis.obstacles?.length > 0
    ? smcAnalysis.obstacles.map(o => `${o.reason} @ ${fmt(o.level)}`).join(' · ')
    : null;

  return (
    <div className="sidebar-section animate-fade-in-up glass-card smc-analysis-block" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="section-header accent-border">⚔️ SMC Structural Validation</div>

      <div className="smc-rows">
        {rows.map(({ label, value, met }) => (
          <div className={`smc-row ${met ? 'met' : 'unmet'}`} key={label}>
            <span className="smc-row-label">{label}</span>
            <span className="smc-row-value">{value}</span>
          </div>
        ))}
      </div>

      {/* 1:4 TP achievability */}
      <div className={`smc-tp4r-block ${tp4RAchievable ? 'achievable' : 'blocked'}`}>
        <div className="smc-tp4r-header">
          <span className="smc-tp4r-label">1:4 Target ({fmt(smcAnalysis.tp4R)})</span>
          <span className={`smc-tp4r-badge ${tp4RAchievable ? 'yes' : 'no'}`}>
            {tp4RAchievable ? '✅ CLEAR PATH' : '🚧 BLOCKED'}
          </span>
        </div>
        {!tp4RAchievable && obstacleText && (
          <div className="smc-obstacle-text">Obstacle: {obstacleText}</div>
        )}
        {tp4RAchievable && (
          <div className="smc-clear-text">No structural obstacles between entry and 1:4 TP</div>
        )}
      </div>

      {/* Probability + verdict */}
      <div className="smc-verdict-row">
        <div className="smc-confidence">
          <span className="smc-conf-label">Confidence</span>
          <span className="smc-conf-val">{confidence}%</span>
        </div>
        <div className={`smc-verdict-pill ${tp4RAchievable ? (direction ? 'take' : 'skip') : 'skip'}`}>
          {tp4RAchievable && direction
            ? `TAKE ${isLong ? 'LONG' : 'SHORT'}`
            : 'SKIP TRADE'}
        </div>
      </div>
    </div>
  );
}

function CMEGapSection({ cmeGapData, staggerIndex }) {
  if (!cmeGapData) return null;

  const tierColor = (tier) => {
    if (tier === 'VERY_HIGH') return 'var(--accent-green)';
    if (tier === 'HIGH') return 'var(--accent-blue)';
    if (tier === 'MODERATE') return 'var(--accent-yellow)';
    return 'var(--accent-red)';
  };

  const stats = cmeGapData.stats || {};
  // Use allGaps for 4-week timeline; fallback to combining filled+unfilled
  const allGaps = cmeGapData.allGaps
    || [...(cmeGapData.unfilledGaps || []), ...(cmeGapData.filledGaps || [])]
        .sort((a, b) => (b.fridayCloseTime || 0) - (a.fridayCloseTime || 0));

  const formatAge = (hrs) => {
    if (!hrs && hrs !== 0) return '?';
    if (hrs < 24)  return `${Math.round(hrs)}h`;
    if (hrs < 168) return `${(hrs / 24).toFixed(1)}d`;
    return `${(hrs / 168).toFixed(1)}w`;
  };

  return (
    <div className="sidebar-section animate-fade-in-up glass-card" style={{ animationDelay: `${staggerIndex * 60}ms` }}>
      <div className="section-header gradient-header">📊 CME Gap Analysis — Last 4 Weeks</div>

      {/* Bias pill */}
      {cmeGapData.gapFillBias && (
        <div className="cme-bias-pill" style={{
          background: cmeGapData.gapFillBias === 'bullish' ? 'rgba(0,229,180,0.10)' : 'rgba(255,63,94,0.10)',
          color: cmeGapData.gapFillBias === 'bullish' ? 'var(--accent-green)' : 'var(--accent-red)',
          border: `1px solid ${cmeGapData.gapFillBias === 'bullish' ? 'rgba(0,229,180,0.25)' : 'rgba(255,63,94,0.25)'}`,
        }}>
          Gap Fill Bias: {cmeGapData.gapFillBias === 'bullish' ? '↑ BULLISH' : '↓ BEARISH'}
        </div>
      )}

      {/* All gaps timeline */}
      {allGaps.length > 0 ? (
        <div className="cme-all-gaps-list">
          {allGaps.map((g, i) => {
            const fillProb = g.fillProbability || null;
            const nodeColor = g.direction === 'up' ? 'var(--accent-green)' : 'var(--accent-red)';
            return (
              <div className={`cme-gap-row ${g.filled ? 'filled' : 'unfilled'}`} key={i}>
                <div className="cme-gap-node" style={{ background: nodeColor }} />
                <div className="cme-gap-row-body">
                  <div className="cme-gap-row-top">
                    <span className="cme-gap-dir-badge" style={{ color: nodeColor }}>
                      {g.direction === 'up' ? '⬆' : '⬇'} {g.direction.toUpperCase()} {g.gapPct ? `${(g.gapPct * 100).toFixed(2)}%` : ''}
                    </span>
                    <span className="cme-gap-range-inline mono">
                      ${(g.gapLower || 0).toFixed(0)}–${(g.gapUpper || 0).toFixed(0)}
                    </span>
                    <span className={`cme-gap-status-badge ${g.filled ? 'filled' : 'open'}`}>
                      {g.filled ? '✅ Filled' : '⏳ Open'}
                    </span>
                  </div>
                  <div className="cme-gap-row-meta">
                    <span className="cme-meta-item">Age: {formatAge(g.ageHours)}</span>
                    {g.filled && g.timeToFillHours != null && (
                      <span className="cme-meta-item">Filled in: {formatAge(g.timeToFillHours)}</span>
                    )}
                    {!g.filled && fillProb != null && (
                      <span className="cme-meta-item" style={{ color: tierColor(g.fillTier) }}>
                        {fillProb}% fill prob
                      </span>
                    )}
                  </div>
                  {!g.filled && fillProb != null && (
                    <div className="cme-prob-track-v2">
                      <div className="cme-prob-fill-v2" style={{
                        width: `${fillProb}%`,
                        background: tierColor(g.fillTier),
                        boxShadow: `0 0 6px ${tierColor(g.fillTier)}60`,
                      }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cme-all-filled">
          <span className="cme-filled-icon">✅</span>
          <span>No CME gap data available</span>
        </div>
      )}

      {/* Stats row */}
      {(stats.fillRate !== undefined || stats.gapsFilled !== undefined) && (
        <div className="cme-stats-row">
          {stats.fillRate !== undefined && (
            <div className="cme-stat"><span className="cme-stat-val text-green">{stats.fillRate}%</span><span className="cme-stat-lbl">Fill Rate</span></div>
          )}
          {stats.totalFilled !== undefined && (
            <div className="cme-stat"><span className="cme-stat-val">{stats.totalFilled}/{stats.totalGaps ?? '?'}</span><span className="cme-stat-lbl">Filled</span></div>
          )}
          {stats.avgFillTimeHours != null && (
            <div className="cme-stat"><span className="cme-stat-val">{stats.avgFillTimeHours}h</span><span className="cme-stat-lbl">Avg Fill</span></div>
          )}
          {stats.consecutiveDir && (
            <div className="cme-stat"><span className="cme-stat-val text-green">{stats.consecutiveCount}× {stats.consecutiveDir === 'up' ? '↑' : '↓'}</span><span className="cme-stat-lbl">Streak</span></div>
          )}
        </div>
      )}
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

        {/* ── SMC STRUCTURAL VALIDATION ──────────────────── */}
        <SMCAnalysisBlock
          smcAnalysis={analysis.smcAnalysis}
          direction={analysis.direction}
          confluenceScore={analysis.confluenceScore}
          staggerIndex={nextDelay()}
        />

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
