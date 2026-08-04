import { useState, useCallback } from 'react';
import { getChallengeStatus, recordTrade, undoLastTrade } from '../../engine/challengeTracker.js';
import { CHALLENGE_CONFIG } from '../../utils/constants.js';
import './ChallengeDashboard.css';

export default function ChallengeDashboard() {
  if (!CHALLENGE_CONFIG.enabled) return null;

  const [status, setStatus] = useState(() => getChallengeStatus());
  const [winAmount, setWinAmount] = useState('');
  const [showLog, setShowLog] = useState(false);

  const refresh = useCallback(() => setStatus(getChallengeStatus()), []);

  const handleWin = () => {
    const amt = parseFloat(winAmount) || 0;
    if (amt <= 0) return;
    recordTrade('win', amt);
    setWinAmount('');
    refresh();
  };

  const handleLoss = () => {
    recordTrade('loss', CHALLENGE_CONFIG.riskPerTrade);
    refresh();
  };

  const handleSkip = () => {
    recordTrade('skip', 0);
    refresh();
  };

  const handleUndo = () => {
    undoLastTrade();
    refresh();
  };

  const budgetColor = status.budgetPct > 60 ? 'var(--accent-green)'
    : status.budgetPct > 30 ? 'var(--accent-yellow)'
    : 'var(--accent-red)';

  const overallColor = status.overallPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  // SVG Ring logic (radius=30, circ~188.5)
  const circ = 188.5;
  const profitOffset = circ - (circ * Math.min(100, status.profitProgress)) / 100;
  const budgetOffset = circ - (circ * Math.min(100, status.budgetPct)) / 100;

  return (
    <div className={`challenge-dashboard ${!status.canTrade ? 'locked' : ''}`}>
      <div className="cd-header">
        <span className="cd-title">🏆 FUNDING CHALLENGE</span>
        <span className={`cd-status-pill ${status.canTrade ? 'active' : 'locked'}`}>
          {status.canTrade ? '✓ ACTIVE' : '🔒 LOCKED'}
        </span>
      </div>

      {!status.canTrade && (
        <div className="cd-lock-banner">
          🛡️ {status.reason}
        </div>
      )}

      {/* SVG Rings Dashboard */}
      <div className="cd-rings-container">
        {/* Profit Ring */}
        <div className="cd-ring-card">
          <svg width="80" height="80" className="cd-svg-ring">
            <circle cx="40" cy="40" r="30" className="cd-ring-bg" />
            <circle cx="40" cy="40" r="30" className="cd-ring-progress" style={{ strokeDashoffset: profitOffset, stroke: 'url(#profitGradient)' }} />
            <defs>
              <linearGradient id="profitGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#00e5b4" />
                <stop offset="100%" stopColor="#00d4ff" />
              </linearGradient>
            </defs>
          </svg>
          <div className="cd-ring-text">
            <span className="cd-ring-pct">{status.profitProgress.toFixed(0)}%</span>
          </div>
          <div className="cd-ring-label">Profit Target</div>
          <div className="cd-ring-val mono" style={{ color: overallColor }}>${status.overallPnl.toFixed(0)}</div>
        </div>

        {/* Budget Ring */}
        <div className="cd-ring-card">
          <svg width="80" height="80" className="cd-svg-ring">
            <circle cx="40" cy="40" r="30" className="cd-ring-bg" />
            <circle cx="40" cy="40" r="30" className="cd-ring-progress" style={{ strokeDashoffset: budgetOffset, stroke: budgetColor }} />
          </svg>
          <div className="cd-ring-text">
            <span className="cd-ring-pct" style={{ color: budgetColor }}>{status.budgetPct.toFixed(0)}%</span>
          </div>
          <div className="cd-ring-label">DD Budget Left</div>
          <div className="cd-ring-val mono">${status.remainingBudget.toFixed(0)}</div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="cd-stats-grid">
        <div className="cd-stat-badge">
          <span className="stat-num text-green">{status.todayWins}W</span>
          <span className="stat-lbl">Wins</span>
        </div>
        <div className="cd-stat-badge">
          <span className="stat-num text-red">{status.todayLosses}L</span>
          <span className="stat-lbl">Losses</span>
        </div>
        <div className={`cd-stat-badge ${status.consecLosses >= 3 ? 'warning' : ''}`}>
          <span className="stat-num">{status.consecLosses}/{status.maxConsecLosses}</span>
          <span className="stat-lbl">Consec</span>
        </div>
        <div className="cd-stat-badge">
          <span className="stat-num">{status.winRate}%</span>
          <span className="stat-lbl">Win Rate</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="cd-actions">
        <div className="cd-win-row">
          <input
            type="number"
            className="cd-input"
            placeholder="Win $"
            value={winAmount}
            onChange={e => setWinAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleWin()}
            min="0"
          />
          <button className="cd-btn cd-btn-win" onClick={handleWin} disabled={!winAmount}>✅ WON</button>
        </div>
        <div className="cd-btn-row">
          <button className="cd-btn cd-btn-loss" onClick={handleLoss}>❌ LOST ${CHALLENGE_CONFIG.riskPerTrade}</button>
          <button className="cd-btn cd-btn-skip" onClick={handleSkip}>⏭ SKIP</button>
        </div>
        {status.todayTradeCount > 0 && (
          <button className="cd-undo" onClick={handleUndo}>↩ Undo Last</button>
        )}
      </div>

      {/* Trade Log */}
      {status.dailyTrades.length > 0 && (
        <div className="cd-log-section">
          <button className="cd-log-toggle" onClick={() => setShowLog(!showLog)}>
            Trade Log {showLog ? '▾' : '▸'} ({status.dailyTrades.length})
          </button>
          {showLog && (
            <div className="cd-log-list">
              {status.dailyTrades.map((t, i) => (
                <div key={i} className={`cd-log-pill ${t.result}`}>
                  <span className="log-icon">{t.result === 'win' ? '✅' : t.result === 'loss' ? '❌' : '⏭'}</span>
                  <span className="log-amt mono">{t.result === 'skip' ? '—' : `${t.amount >= 0 ? '+' : ''}$${t.amount.toFixed(0)}`}</span>
                  <span className="log-time mono">{t.timestamp.slice(11, 19)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="cd-footer">
        <span className="cd-footer-item">Max Cap: <strong>-${status.maxOverallLoss}</strong></span>
        <span className="cd-footer-item">Daily PNL: <strong style={{ color: status.dailyPnl >= 0 ? '#00e5b4' : '#ff3f5e' }}>{status.dailyPnl >= 0 ? '+' : ''}${status.dailyPnl.toFixed(0)}</strong></span>
      </div>
    </div>
  );
}
