// ─────────────────────────────────────────────────────────
//  Analysis Panel — Step-by-step analysis display
//  Pillars, Confluence Score, Analysis Steps
// ─────────────────────────────────────────────────────────

import { useState } from 'react';

function PillarStatus({ factors }) {
  if (!factors) return null;

  const pillars = [
    { key: 'pillar1', label: '4H Trend' },
    { key: 'pillar2', label: 'Liquidity Event' },
    { key: 'pillar3', label: '15m BOS/CHOCH' },
    { key: 'pillar4', label: 'Session Active' },
    { key: 'pillar5', label: 'RRR ≥ 1:1.5' },
  ];

  return (
    <div className="pillars-grid stagger">
      {pillars.map(p => {
        const factor = factors[p.key];
        const isCaution = factor?.caution;
        return (
          <div className="pillar-item" key={p.key}>
            <div className={`pillar-icon ${factor?.met ? 'met' : isCaution ? 'caution' : 'unmet'}`}>
              {factor?.met ? '✓' : isCaution ? '⚠' : '✗'}
            </div>
            <span className="pillar-label">{factor?.name || p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ConflScore({ score, maxScore, rating }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / maxScore) * circumference;
  const offset = circumference - progress;

  const color = score >= 10 ? '#00d26a' :
                score >= 7 ? '#00c8ff' :
                score >= 5 ? '#ffb020' : '#ff3b5c';

  return (
    <div className="confluence-card glass-card">
      <div className="confluence-ring-container">
        <svg className="confluence-ring" viewBox="0 0 100 100">
          <circle className="confluence-ring-bg" cx="50" cy="50" r={radius} />
          <circle
            className="confluence-ring-progress"
            cx="50" cy="50" r={radius}
            stroke={color}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="confluence-score-value">{score}</span>
      </div>
      <div className="confluence-rating" style={{ color }}>{rating}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
        of {maxScore} confluence factors
      </div>
    </div>
  );
}

function AnalysisStep({ label, status, children }) {
  const statusMap = {
    pass: { label: 'PASS', className: 'pass' },
    fail: { label: 'FAIL', className: 'fail' },
    waiting: { label: 'WAIT', className: 'waiting' },
    neutral: { label: '—', className: 'neutral' },
  };

  const s = statusMap[status] || statusMap.neutral;

  return (
    <div className="analysis-step-card fade-in">
      <div className="analysis-step-card-header">
        <span className="analysis-step-card-title">{label}</span>
        <span className={`analysis-step-status ${s.className}`}>{s.label}</span>
      </div>
      <div className="analysis-step-card-content">
        {children}
      </div>
    </div>
  );
}

function ProbabilityBar({ up, down, range }) {
  return (
    <div>
      <div className="probability-bar">
        <div className="probability-segment up" style={{ width: `${up}%` }} />
        <div className="probability-segment range" style={{ width: `${range}%` }} />
        <div className="probability-segment down" style={{ width: `${down}%` }} />
      </div>
      <div className="probability-labels">
        <span style={{ color: 'var(--green)' }}>↑ {up}%</span>
        <span style={{ color: 'var(--text-muted)' }}>◼ {range}%</span>
        <span style={{ color: 'var(--red)' }}>↓ {down}%</span>
      </div>
    </div>
  );
}

export default function AnalysisPanel({ analysis, loading }) {
  if (!analysis) {
    return (
      <div className="analysis-panel">
        <div className="analysis-panel-header">
          <div className="analysis-panel-title">HUD Analysis</div>
        </div>
        <div className="analysis-panel-scroll" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'var(--bg-glass-active)', border: '1px solid var(--border-medium)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', marginBottom: '16px',
            boxShadow: '0 0 32px rgba(0,200,255,0.05)'
          }}>⚡</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', lineHeight: '1.5' }}>
            System standby.<br/>Click <strong>Run Analysis</strong> to initialize<br/>the 17-step confluence engine.
          </div>
        </div>
      </div>
    );
  }

  const { steps, confluenceScore, confluenceFactors, rejections, outlook } = analysis;

  return (
    <div className="analysis-panel">
      <div className="analysis-panel-header">
        <div className="analysis-panel-title">Engine Matrix</div>
      </div>
      <div className="analysis-panel-scroll">

      {/* Real-time Outlook Summary */}
      {outlook && Array.isArray(outlook) && (
        <div className="outlook-card fade-in">
          <div className="outlook-header">
            <div className="radar-ping" />
            <span className="outlook-label">Technical Outlook</span>
          </div>
          <ul className="outlook-bullets">
            {outlook.map((bullet, idx) => (
              <li key={idx}>{bullet}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Pillars */}
      <PillarStatus factors={confluenceFactors} />

      {/* Confluence Score */}
      {steps.step10 && (
        <ConflScore
          score={steps.step10.score}
          maxScore={steps.step10.maxScore}
          rating={steps.step10.rating}
        />
      )}

      {/* CAUTION Banner */}
      {analysis.decision?.action === 'CAUTION' && (
        <div className="caution-banner fade-in">
          <div className="caution-banner-icon">⚠️</div>
          <div>
            <div className="caution-banner-title">CAUTION — Reduced Confidence Trade</div>
            <div className="caution-banner-text">{analysis.decision.reason}</div>
            <div className="caution-banner-text" style={{ marginTop: '4px', opacity: 0.7 }}>Use 50% of your normal position size. Place a tighter stop.</div>
          </div>
        </div>
      )}

      {/* Direction Probability */}
      {steps.step13 && (
        <div style={{ padding: '0 4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 500 }}>
            Direction Probability
          </div>
          <ProbabilityBar
            up={steps.step13.upProb}
            down={steps.step13.downProb}
            range={steps.step13.rangeProb}
          />
        </div>
      )}

      {/* Analysis Steps */}
      <div className="analysis-cards-grid">
        <AnalysisStep
          label="Step 1 — Daily Bias"
          status={steps.step1?.bias !== 'neutral' ? 'pass' : 'neutral'}
        >
          <div>{steps.step1?.description}</div>
          <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
            Confidence: {steps.step1?.confidence}
          </div>
        </AnalysisStep>

        <AnalysisStep
          label="Step 2 — 4H Bias (Pillar 1)"
          status={confluenceFactors.pillar1?.met ? 'pass' : 'fail'}
        >
          <div>{steps.step2?.description}</div>
          <div style={{ marginTop: '4px' }}>
            EMA alignment: {steps.step2?.emaAlignment} | 
            Price vs EMA200: {steps.step2?.priceVsEma200}
          </div>
        </AnalysisStep>

        {steps.btcContext && (
          <AnalysisStep label="BTC Context" status="neutral">
            <div>{steps.btcContext.description}</div>
          </AnalysisStep>
        )}

        <AnalysisStep
          label="Step 3 — Smart Money Concepts (Pillar 2)"
          status={confluenceFactors.pillar2?.met ? 'pass' : 'fail'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>
              <strong>Active Order Blocks:</strong> {steps.step3?.activeOBs?.length || 0}
              {steps.step3?.activeOBs?.slice(-3).map((ob, i) => (
                <div key={i} style={{ marginLeft: '8px', fontSize: '0.72rem' }}>
                  • {ob.type} OB @ ${ob.entryBoundary?.toFixed(2)} (invalidation: ${ob.invalidation?.toFixed(2)})
                </div>
              ))}
            </div>
            <div>
              <strong>Unfilled FVGs:</strong> {steps.step3?.unfilledFVGs?.length || 0}
            </div>
            <div>
              <strong>Validated Sweeps:</strong> {steps.step3?.validatedSweeps?.length || 0}
              {steps.step3?.validatedSweeps?.map((sw, i) => (
                <div key={i} style={{ marginLeft: '8px', fontSize: '0.72rem' }}>
                  • {sw.type} sweep @ ${sw.sweptLevel?.toFixed(2)} (exceeded {sw.exceedPercent}%)
                </div>
              ))}
            </div>
          </div>
        </AnalysisStep>

        <AnalysisStep label="Step 5 — 1H Structure" status="neutral">
          <div>{steps.step5?.description}</div>
          {steps.step5?.divergence && (
            <div style={{ marginTop: '4px', color: 'var(--amber)' }}>
              ⚡ {steps.step5.divergence.description}
            </div>
          )}
        </AnalysisStep>

        <AnalysisStep
          label="Step 7 — 15m Entry (Pillar 3)"
          status={confluenceFactors.pillar3?.met ? 'pass' : 'fail'}
        >
          <div>
            BOS: {steps.step7?.hasBOS ? '✅ Confirmed' : '❌ Not found'} | 
            CHOCH: {steps.step7?.hasCHOCH ? '✅ Confirmed' : '❌ Not found'}
          </div>
          {steps.step7?.structureShifts?.map((s, i) => (
            <div key={i} style={{ marginTop: '2px', fontSize: '0.72rem' }}>
              • {s.description} @ ${s.level?.toFixed(2)}
            </div>
          ))}
        </AnalysisStep>

        <AnalysisStep
          label="Step 8 — Session Filter (Pillar 4)"
          status={confluenceFactors.pillar4?.met ? 'pass' : 'fail'}
        >
          <div>
            <strong>{steps.step8?.name}</strong> — {steps.step8?.description}
          </div>
        </AnalysisStep>

        <AnalysisStep
          label="Step 12 — Duration Check"
          status={steps.step12?.withinLimit ? 'pass' : steps.step12?.estimatedHours ? 'fail' : 'neutral'}
        >
          <div>
            Avg candle range: ${steps.step12?.avgCandleRange?.toFixed(2) || '—'}
          </div>
          <div>
            Estimated duration: {steps.step12?.estimatedHours?.toFixed(1) || '—'}h
            {steps.step12?.warning && (
              <span style={{ color: 'var(--amber)', marginLeft: '8px' }}>⚠ {steps.step12.warning}</span>
            )}
          </div>
        </AnalysisStep>
      </div>

      {/* Rejections */}
      {rejections && rejections.length > 0 && (
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--red)', fontWeight: 600, marginBottom: '6px' }}>
            Rejection Reasons
          </div>
          <ul className="rejection-list">
            {rejections.map((r, i) => (
              <li key={i} className="rejection-item">
                <span className="rejection-icon">✗</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </div>
  );
}
