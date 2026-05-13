import { useMarket } from '../../context/MarketContext.jsx';
import TradeBox from '../TradeBox/TradeBox.jsx';
import { useState } from 'react';
import './AnalysisSidebar.css';

function ConfluenceSection({ score }) {
  if (!score) return null;
  const pct = (score.total / score.max) * 100;
  return (
    <div className="sidebar-section">
      <div className="section-header">CONFLUENCE SCORE</div>
      <div className="score-display">
        <span className="score-number mono">{score.total}</span>
        <span className="score-divider">/</span>
        <span className="score-max mono">{score.max}</span>
        <span className={`score-tier ${score.tier.toLowerCase()}`}>{score.tier}</span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: pct >= 70 ? 'var(--accent-green)' : pct >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)' }} />
      </div>
      <ul className="check-list">
        {score.checks.map((c, i) => (
          <li key={i} className={`check-item ${c.pillar ? 'pillar' : ''}`}>
            <span className={`check-icon ${c.met ? 'met' : 'unmet'}`}>{c.met ? '✓' : '✗'}</span>
            <span className="check-label">{c.label}</span>
            {c.pillar && <span className="pillar-tag">PILLAR</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionBadge({ decision, waitCondition }) {
  const colorMap = { TAKE_NOW: 'var(--accent-green)', WAIT: 'var(--accent-yellow)', NO_TRADE: 'var(--accent-red)' };
  const labelMap = { TAKE_NOW: 'TAKE NOW', WAIT: 'WAIT', NO_TRADE: 'NO TRADE' };
  return (
    <div className="sidebar-section">
      <div className="decision-badge" style={{ borderColor: colorMap[decision], color: colorMap[decision] }}>
        {labelMap[decision] || decision}
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
        ANALYSIS STEPS {open ? '▾' : '▸'}
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
  return (
    <div className="sidebar-section">
      <div className="section-header">SMC DETECTED</div>
      <div className="smc-grid">
        <div className="smc-stat"><span className="smc-count">{orderBlocks?.length || 0}</span><span className="smc-label">Order Blocks</span></div>
        <div className="smc-stat"><span className="smc-count">{fvgs?.length || 0}</span><span className="smc-label">Active FVGs</span></div>
        <div className="smc-stat"><span className="smc-count">{sweeps?.length || 0}</span><span className="smc-label">Sweeps</span></div>
        <div className="smc-stat"><span className="smc-count">{structureShifts?.length || 0}</span><span className="smc-label">BOS/CHOCH</span></div>
      </div>
    </div>
  );
}

function ProbabilityBars({ up, down, range }) {
  return (
    <div className="sidebar-section">
      <div className="section-header">DIRECTION PROBABILITY</div>
      <div className="prob-row"><span className="prob-label text-green">↑ {up}%</span><div className="prob-track"><div className="prob-fill" style={{ width: `${up}%`, background: 'var(--accent-green)' }} /></div></div>
      <div className="prob-row"><span className="prob-label text-secondary">◼ {range}%</span><div className="prob-track"><div className="prob-fill" style={{ width: `${range}%`, background: 'var(--text-dim)' }} /></div></div>
      <div className="prob-row"><span className="prob-label text-red">↓ {down}%</span><div className="prob-track"><div className="prob-fill" style={{ width: `${down}%`, background: 'var(--accent-red)' }} /></div></div>
    </div>
  );
}

function AIOpinion({ aiAnalysis }) {
  if (!aiAnalysis) return null;

  let colorClass = 'text-dim';
  if (aiAnalysis.decision === 'AGREE') colorClass = 'text-green';
  if (aiAnalysis.decision === 'DISAGREE') colorClass = 'text-red';
  if (aiAnalysis.decision === 'CAUTION') colorClass = 'text-yellow';
  if (aiAnalysis.decision === 'ERROR') colorClass = 'text-red';

  return (
    <div className="sidebar-section">
      <div className="section-header">🧠 AI SECOND OPINION</div>
      <div style={{ padding: '12px 14px', fontSize: '0.8rem', lineHeight: '1.5' }}>
        <div style={{ marginBottom: '6px', fontWeight: 'bold' }} className={colorClass}>
          {aiAnalysis.decision}
        </div>
        <div className="text-secondary">{aiAnalysis.reasoning}</div>
      </div>
    </div>
  );
}

export default function AnalysisSidebar() {
  const { analysis, isAnalyzing } = useMarket();

  if (isAnalyzing) {
    return (
      <aside className="analysis-sidebar">
        <div className="sidebar-empty"><div className="spinner" style={{ width: 24, height: 24 }} /><p>Running 17-step analysis...</p></div>
      </aside>
    );
  }

  if (!analysis) {
    return (
      <aside className="analysis-sidebar">
        <div className="sidebar-empty">
          <div className="empty-icon">⚡</div>
          <p>System standby</p>
          <p className="text-dim" style={{ fontSize: '0.75rem' }}>Run analysis to initialize the confluence engine</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="analysis-sidebar">
      <div className="sidebar-scroll">
        <DecisionBadge decision={analysis.decision} waitCondition={analysis.waitCondition} />
        
        {analysis.rejectionReason && (
          <div className="sidebar-section"><div className="rejection-banner">✗ {analysis.rejectionReason}</div></div>
        )}

        <ConfluenceSection score={analysis.confluenceScore} />
        
        <AIOpinion aiAnalysis={analysis.aiAnalysis} />

        {analysis.upProbability !== undefined && (
          <ProbabilityBars 
            up={analysis.upProbability} 
            down={analysis.downProbability} 
            range={analysis.rangeProbability} 
          />
        )}

        <SMCSection smcData={analysis.smcData} />
        
        <TradeBox analysis={analysis} />
        
        <StepAccordion steps={analysis.analysisSteps} />
      </div>
    </aside>
  );
}
