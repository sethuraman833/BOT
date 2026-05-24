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
  const pct = (score.total / score.max) * 100;
  const barColor = pct >= 72 ? 'var(--accent-green)' : pct >= 50 ? 'var(--accent-blue)' : pct >= 36 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  return (
    <div className="sidebar-section">
      <div className="section-header">Confluence Score</div>
      <div className="score-display">
        <span className="score-number mono">{score.total}</span>
        <span className="score-divider">/</span>
        <span className="score-max mono">{score.max}</span>
        <span className={`score-tier ${score.tier.toLowerCase()}`}>{score.tier}</span>
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
  const { orderBlocks, fvgs, sweeps, structureShifts } = smcData;
  const counts = [
    { label: 'Order Blocks', val: orderBlocks?.length || 0, color: 'var(--accent-purple)' },
    { label: 'Active FVGs',  val: fvgs?.length || 0,        color: 'var(--accent-blue)' },
    { label: 'Sweeps',       val: sweeps?.length || 0,       color: 'var(--accent-yellow)' },
    { label: 'BOS / CHOCH',  val: structureShifts?.length || 0, color: 'var(--accent-green)' },
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
      <div className="sidebar-scroll fade-in">

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

        {/* ── STEPS LOG ─────────────────────────────────────── */}
        <StepAccordion steps={analysis.analysisSteps} />

        {/* ── FOOTER ────────────────────────────────────────── */}
        <div className="engine-footer">ENGINE v8.0 · {analysis.symbol} · {analysis.analysisMode}</div>

      </div>
    </aside>
  );
}
