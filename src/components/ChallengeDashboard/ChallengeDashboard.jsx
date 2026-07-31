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

  const budgetColor = status.budgetPct > 60 ? '#00e5b4'
    : status.budgetPct > 30 ? '#f7c948'
    : '#ff3f5e';

  const pnlColor = status.dailyPnl >= 0 ? '#00e5b4' : '#ff3f5e';
  const overallColor = status.overallPnl >= 0 ? '#00e5b4' : '#ff3f5e';

  return (
    <div className={`challenge-dashboard ${!status.canTrade ? 'locked' : ''}`}>
      {/* Header */}
      <div className="cd-header">
        <span className="cd-title">🏆 FUNDING CHALLENGE</span>
        <span className={`cd-status-pill ${status.canTrade ? 'active' : 'locked'}`}>
          {status.canTrade ? '✓ ACTIVE' : '🔒 LOCKED'}
        </span>
      </div>

      {/* Lock Banner */}
      {!status.canTrade && (
        <div className="cd-lock-banner">
          🛡️ {status.reason}
        </div>
      )}

      {/* Profit Progress */}
      <div className="cd-section">
        <div className="cd-row">
          <span className="cd-label">Profit Target</span>
          <span className="cd-val mono" style={{ color: overallColor }}>
            ${status.overallPnl >= 0 ? '+' : ''}{status.overallPnl.toFixed(0)} / ${status.profitTarget.toLocaleString()}
          </span>
        </div>
        <div className="cd-bar-track">
          <div
            className="cd-bar-fill profit-bar"
            style={{ width: `${Math.min(100, status.profitProgress)}%` }}
          />
        </div>
        <div className="cd-sub-row">
          <span className="cd-dim">${status.profitRemaining.toFixed(0)} remaining</span>
          <span className="cd-dim">{status.profitProgress.toFixed(1)}%</span>
        </div>
      </div>

      {/* Daily P&L + DD Budget */}
      <div className="cd-section">
        <div className="cd-row">
          <span className="cd-label">Today's P&L</span>
          <span className="cd-val mono" style={{ color: pnlColor }}>
            {status.dailyPnl >= 0 ? '+' : ''}${status.dailyPnl.toFixed(0)}
          </span>
        </div>
        <div className="cd-row">
          <span className="cd-label">DD Budget Left</span>
          <span className="cd-val mono" style={{ color: budgetColor }}>
            ${status.remainingBudget.toFixed(0)} / ${status.dailyBudget.toFixed(0)}
          </span>
        </div>
        <div className="cd-bar-track">
          <div
            className="cd-bar-fill budget-bar"
            style={{
              width: `${Math.min(100, status.budgetPct)}%`,
              background: budgetColor,
              boxShadow: `0 0 8px ${budgetColor}40`,
            }}
          />
        </div>
      </div>

      {/* Stats Row */}
      <div className="cd-stats-row">
        <div className="cd-stat">
          <span className="cd-stat-val text-green">{status.todayWins}W</span>
          <span className="cd-stat-lbl">Wins</span>
        </div>
        <div className="cd-stat">
          <span className="cd-stat-val text-red">{status.todayLosses}L</span>
          <span className="cd-stat-lbl">Losses</span>
        </div>
        <div className="cd-stat">
          <span className="cd-stat-val" style={{ color: status.consecLosses >= 3 ? '#ff3f5e' : 'var(--text-secondary)' }}>
            {status.consecLosses}/{status.maxConsecLosses}
          </span>
          <span className="cd-stat-lbl">Consec</span>
        </div>
        <div className="cd-stat">
          <span className="cd-stat-val">{status.winRate}%</span>
          <span className="cd-stat-lbl">Win Rate</span>
        </div>
      </div>

      {/* Trade Logging Buttons */}
      <div className="cd-actions">
        <div className="cd-win-row">
          <input
            type="number"
            className="cd-win-input"
            placeholder="Win $"
            value={winAmount}
            onChange={e => setWinAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleWin()}
            min="0"
            step="1"
          />
          <button className="cd-btn cd-btn-win" onClick={handleWin} disabled={!winAmount}>
            ✅ Won
          </button>
        </div>
        <div className="cd-btn-row">
          <button className="cd-btn cd-btn-loss" onClick={handleLoss}>
            ❌ Lost ${CHALLENGE_CONFIG.riskPerTrade}
          </button>
          <button className="cd-btn cd-btn-skip" onClick={handleSkip}>
            ⏭ Skip
          </button>
        </div>
        {status.todayTradeCount > 0 && (
          <button className="cd-btn cd-btn-undo" onClick={handleUndo}>
            ↩ Undo Last
          </button>
        )}
      </div>

      {/* Trade Log Accordion */}
      {status.dailyTrades.length > 0 && (
        <div className="cd-log-section">
          <button className="cd-log-toggle" onClick={() => setShowLog(!showLog)}>
            Trade Log {showLog ? '▾' : '▸'} ({status.dailyTrades.length})
          </button>
          {showLog && (
            <div className="cd-log-list">
              {status.dailyTrades.map((t, i) => (
                <div key={i} className={`cd-log-item ${t.result}`}>
                  <span className="cd-log-icon">
                    {t.result === 'win' ? '✅' : t.result === 'loss' ? '❌' : '⏭'}
                  </span>
                  <span className="cd-log-amount mono">
                    {t.result === 'skip' ? '—' : `${t.amount >= 0 ? '+' : ''}$${t.amount.toFixed(0)}`}
                  </span>
                  <span className="cd-log-time">{t.timestamp.slice(11, 19)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Overall Footer */}
      <div className="cd-footer">
        <span>Overall: <strong style={{ color: overallColor }}>${status.overallPnl >= 0 ? '+' : ''}{status.overallPnl.toFixed(0)}</strong></span>
        <span>Max Loss Cap: <strong>-${status.maxOverallLoss}</strong></span>
      </div>
    </div>
  );
}
