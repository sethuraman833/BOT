// ─────────────────────────────────────────────────────────
//  Challenge Tracker v1.0 — Funding Challenge DD Protection
//
//  localStorage-backed daily P&L tracker with:
//  - Daily DD budget enforcement
//  - Consecutive loss counter
//  - Overall P&L tracking across days
//  - IST midnight auto-reset
// ─────────────────────────────────────────────────────────

import { CHALLENGE_CONFIG } from '../utils/constants.js';

const STORAGE_KEY = 'terminus_challenge';

// ── IST Date Helper ────────────────────────────────────────
function getISTDateKey() {
  const now = new Date();
  // IST = UTC + 5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getISTTimestamp() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().replace('T', ' ').slice(0, 19) + ' IST';
}

// ── Storage Helpers ───────────────────────────────────────
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createFreshData();
    const data = JSON.parse(raw);
    // Auto-reset if day changed
    const today = getISTDateKey();
    if (data.currentDay !== today) {
      // Archive yesterday's data before resetting
      if (data.currentDay && data.dailyTrades.length > 0) {
        if (!data.dayHistory) data.dayHistory = [];
        data.dayHistory.push({
          date: data.currentDay,
          trades: data.dailyTrades,
          pnl: data.dailyPnl,
        });
      }
      data.currentDay = today;
      data.dailyPnl = 0;
      data.dailyTrades = [];
      data.consecLosses = 0;
      saveData(data);
    }
    return data;
  } catch (e) {
    console.error('Challenge tracker load error:', e);
    return createFreshData();
  }
}

function createFreshData() {
  const data = {
    currentDay:     getISTDateKey(),
    dailyPnl:       0,
    overallPnl:     0,
    dailyTrades:    [],
    dayHistory:     [],
    consecLosses:   0,
    totalWins:      0,
    totalLosses:    0,
    totalTrades:    0,
    startDate:      getISTDateKey(),
  };
  saveData(data);
  return data;
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Challenge tracker save error:', e);
  }
}

// ── Public API ────────────────────────────────────────────

/**
 * Record a trade result.
 * @param {'win'|'loss'|'skip'} result
 * @param {number} pnlAmount - Positive for wins, positive for losses (auto-negated)
 * @param {string} [note] - Optional note (e.g., symbol, timeframe)
 */
export function recordTrade(result, pnlAmount = 0, note = '') {
  const data = loadData();
  const amount = result === 'loss' ? -Math.abs(pnlAmount) : Math.abs(pnlAmount);

  const trade = {
    result,
    amount,
    timestamp: getISTTimestamp(),
    note,
  };

  data.dailyTrades.push(trade);
  data.totalTrades++;

  if (result === 'win') {
    data.dailyPnl += amount;
    data.overallPnl += amount;
    data.totalWins++;
    data.consecLosses = 0;
  } else if (result === 'loss') {
    data.dailyPnl += amount; // amount is already negative
    data.overallPnl += amount;
    data.totalLosses++;
    data.consecLosses++;
  }
  // 'skip' doesn't affect P&L

  saveData(data);
  return getChallengeStatus();
}

/**
 * Undo the last recorded trade.
 */
export function undoLastTrade() {
  const data = loadData();
  if (data.dailyTrades.length === 0) return getChallengeStatus();

  const last = data.dailyTrades.pop();
  data.totalTrades--;

  if (last.result === 'win') {
    data.dailyPnl -= last.amount;
    data.overallPnl -= last.amount;
    data.totalWins--;
  } else if (last.result === 'loss') {
    data.dailyPnl -= last.amount;
    data.overallPnl -= last.amount;
    data.totalLosses--;
    // Recalculate consecutive losses
    data.consecLosses = 0;
    for (let i = data.dailyTrades.length - 1; i >= 0; i--) {
      if (data.dailyTrades[i].result === 'loss') data.consecLosses++;
      else break;
    }
  }

  saveData(data);
  return getChallengeStatus();
}

/**
 * Check if trading is allowed under challenge rules.
 * @returns {{ allowed: boolean, reason: string|null, budget: number }}
 */
export function canTrade() {
  if (!CHALLENGE_CONFIG.enabled) return { allowed: true, reason: null, budget: Infinity };

  const data = loadData();
  const cfg = CHALLENGE_CONFIG;
  const ddBudget = cfg.dailyDDLimit * cfg.ddBudgetPct; // e.g. $200
  const remainingBudget = ddBudget + data.dailyPnl;     // e.g. $200 + (-$33) = $167

  // Check 1: Daily DD budget blown
  if (data.dailyPnl <= -ddBudget) {
    return {
      allowed: false,
      reason: `Daily DD budget exhausted: $${Math.abs(data.dailyPnl).toFixed(0)} lost today (limit: $${ddBudget.toFixed(0)})`,
      budget: 0,
    };
  }

  // Check 2: Next trade would exceed budget
  if (remainingBudget < cfg.riskPerTrade) {
    return {
      allowed: false,
      reason: `Remaining DD budget ($${remainingBudget.toFixed(0)}) is less than risk per trade ($${cfg.riskPerTrade})`,
      budget: remainingBudget,
    };
  }

  // Check 3: Consecutive losses
  if (data.consecLosses >= cfg.maxConsecLosses) {
    return {
      allowed: false,
      reason: `${data.consecLosses} consecutive losses — stop trading, reset tomorrow`,
      budget: remainingBudget,
    };
  }

  // Check 4: Overall max loss
  if (data.overallPnl <= -cfg.maxOverallLoss) {
    return {
      allowed: false,
      reason: `Overall loss limit hit: $${Math.abs(data.overallPnl).toFixed(0)} total loss (max: $${cfg.maxOverallLoss})`,
      budget: remainingBudget,
    };
  }

  // Check 5: Overall max loss approaching — next loss would breach
  if (data.overallPnl - cfg.riskPerTrade <= -cfg.maxOverallLoss) {
    return {
      allowed: false,
      reason: `Next loss ($${cfg.riskPerTrade}) would breach max loss limit ($${cfg.maxOverallLoss})`,
      budget: remainingBudget,
    };
  }

  return { allowed: true, reason: null, budget: remainingBudget };
}

/**
 * Get comprehensive challenge status for UI display.
 */
export function getChallengeStatus() {
  const data = loadData();
  const cfg = CHALLENGE_CONFIG;
  const tradeCheck = canTrade();

  const ddBudget = cfg.dailyDDLimit * cfg.ddBudgetPct;
  const remainingBudget = Math.max(0, ddBudget + data.dailyPnl);
  const budgetPct = ddBudget > 0 ? (remainingBudget / ddBudget) * 100 : 0;

  const profitProgress = cfg.profitTarget > 0
    ? Math.max(0, Math.min(100, (data.overallPnl / cfg.profitTarget) * 100))
    : 0;

  const todayWins = data.dailyTrades.filter(t => t.result === 'win').length;
  const todayLosses = data.dailyTrades.filter(t => t.result === 'loss').length;
  const todaySkips = data.dailyTrades.filter(t => t.result === 'skip').length;
  const winRate = (data.totalWins + data.totalLosses) > 0
    ? ((data.totalWins / (data.totalWins + data.totalLosses)) * 100).toFixed(0)
    : '—';

  return {
    // Can trade?
    canTrade: tradeCheck.allowed,
    reason: tradeCheck.reason,

    // Daily
    dailyPnl: data.dailyPnl,
    dailyBudget: ddBudget,
    remainingBudget,
    budgetPct,
    todayWins,
    todayLosses,
    todaySkips,
    todayTradeCount: data.dailyTrades.length,
    consecLosses: data.consecLosses,
    maxConsecLosses: cfg.maxConsecLosses,

    // Overall
    overallPnl: data.overallPnl,
    profitTarget: cfg.profitTarget,
    profitProgress,
    profitRemaining: Math.max(0, cfg.profitTarget - data.overallPnl),
    totalWins: data.totalWins,
    totalLosses: data.totalLosses,
    totalTrades: data.totalTrades,
    winRate,
    maxOverallLoss: cfg.maxOverallLoss,

    // Config
    riskPerTrade: cfg.riskPerTrade,
    dailyDDLimit: cfg.dailyDDLimit,

    // History
    dailyTrades: data.dailyTrades,
    dayHistory: data.dayHistory || [],
    startDate: data.startDate,
    currentDay: data.currentDay,
  };
}

/**
 * Force reset today's data (manual reset button).
 */
export function resetToday() {
  const data = loadData();
  // Archive current day
  if (data.dailyTrades.length > 0) {
    if (!data.dayHistory) data.dayHistory = [];
    data.dayHistory.push({
      date: data.currentDay,
      trades: data.dailyTrades,
      pnl: data.dailyPnl,
    });
  }
  data.currentDay = getISTDateKey();
  data.dailyPnl = 0;
  data.dailyTrades = [];
  data.consecLosses = 0;
  saveData(data);
  return getChallengeStatus();
}

/**
 * Fully reset all challenge data (danger zone).
 */
export function resetAll() {
  localStorage.removeItem(STORAGE_KEY);
  return getChallengeStatus();
}
