// ─────────────────────────────────────────────────────────
//  Trade Journal — Signal Tracking & Win Rate Analytics
//  Persists to localStorage for cross-session tracking
// ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'terminus_trade_journal';

/**
 * Load trade journal from localStorage.
 * @returns {Array} Array of trade records
 */
export function loadJournal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save journal to localStorage.
 */
function saveJournal(journal) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
  } catch (err) {
    console.warn('[JOURNAL] Failed to save:', err.message);
  }
}

/**
 * Record a new trade signal from analysis results.
 * Called when a TAKE_NOW signal is generated.
 */
export function recordSignal(analysis) {
  if (!analysis || analysis.decision !== 'TAKE_NOW') return null;

  const journal = loadJournal();
  
  // Deduplicate: check if a signal for the same symbol and direction was logged in the last 10s
  const isDuplicate = journal.some(t => {
    const timeDiff = Math.abs(Date.now() - new Date(t.timestamp).getTime());
    return t.symbol === analysis.symbol && t.direction === analysis.direction && timeDiff < 10000;
  });
  if (isDuplicate) return null;

  const record = {
    id: `T${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    symbol: analysis.symbol,
    direction: analysis.direction,
    timeframe: analysis.primaryTimeframe,
    analysisMode: analysis.analysisMode,
    entry: analysis.entry,
    stopLoss: analysis.stopLoss?.value,
    tpLevels: (analysis.tpDetails || []).map(t => t.level),
    confluenceScore: analysis.confluenceScore?.total,
    confluenceMax: analysis.confluenceScore?.max,
    tier: analysis.confluenceScore?.tier,
    pillarsMet: analysis.confluenceScore?.pillarsMet,
    // Outcome tracking (filled later)
    outcome: null, // 'TP1' | 'TP2' | 'TP3' | 'SL' | 'BE' | 'MANUAL_CLOSE'
    exitPrice: null,
    exitTime: null,
    pnl: null,
    rrAchieved: null,
    notes: '',
  };

  journal.unshift(record); // newest first
  // Keep last 200 trades
  if (journal.length > 200) journal.length = 200;
  saveJournal(journal);

  return record;
}

/**
 * Update trade outcome.
 * @param {string} id - Trade record ID
 * @param {object} outcome - { outcome, exitPrice, pnl, rrAchieved, notes }
 */
export function updateOutcome(id, outcome) {
  const journal = loadJournal();
  const idx = journal.findIndex(t => t.id === id);
  if (idx === -1) return false;

  journal[idx] = {
    ...journal[idx],
    ...outcome,
    exitTime: outcome.exitTime || new Date().toISOString(),
  };
  saveJournal(journal);
  return true;
}

/**
 * Delete a trade record.
 */
export function deleteRecord(id) {
  const journal = loadJournal();
  const filtered = journal.filter(t => t.id !== id);
  saveJournal(filtered);
}

/**
 * Calculate performance metrics from completed trades.
 * @returns {object} { winRate, avgRRR, profitFactor, totalTrades, wins, losses, bestTrade, worstTrade }
 */
export function calculateMetrics() {
  const journal = loadJournal();
  const completed = journal.filter(t => t.outcome && t.outcome !== null);
  
  if (completed.length === 0) {
    return {
      totalSignals: journal.length,
      totalCompleted: 0,
      winRate: 0,
      avgRRR: 0,
      profitFactor: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      bestTrade: null,
      worstTrade: null,
      recentStreak: 0,
      expectancy: 0,
    };
  }

  const wins = completed.filter(t => t.pnl > 0);
  const losses = completed.filter(t => t.pnl < 0);
  const breakevens = completed.filter(t => t.pnl === 0);

  const totalWinPnl = wins.reduce((s, t) => s + (t.pnl || 0), 0);
  const totalLossPnl = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));
  const avgWin = wins.length > 0 ? totalWinPnl / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLossPnl / losses.length : 0;

  // Win streak / loss streak
  let streak = 0;
  for (const t of completed) {
    if (t.pnl > 0) { streak = streak > 0 ? streak + 1 : 1; }
    else if (t.pnl < 0) { streak = streak < 0 ? streak - 1 : -1; }
    else continue;
  }

  const rrs = completed.filter(t => t.rrAchieved != null).map(t => t.rrAchieved);
  
  return {
    totalSignals: journal.length,
    totalCompleted: completed.length,
    winRate: completed.length > 0 ? ((wins.length / completed.length) * 100).toFixed(1) : 0,
    avgRRR: rrs.length > 0 ? (rrs.reduce((a, b) => a + b, 0) / rrs.length).toFixed(2) : 0,
    profitFactor: totalLossPnl > 0 ? (totalWinPnl / totalLossPnl).toFixed(2) : '∞',
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    bestTrade: wins.length > 0 ? wins.reduce((best, t) => (t.pnl > best.pnl ? t : best)) : null,
    worstTrade: losses.length > 0 ? losses.reduce((worst, t) => (t.pnl < worst.pnl ? t : worst)) : null,
    recentStreak: streak,
    expectancy: completed.length > 0 ? ((avgWin * wins.length - avgLoss * losses.length) / completed.length).toFixed(2) : 0,
    totalPnl: (totalWinPnl - totalLossPnl).toFixed(2),
  };
}

/**
 * Get recent trade records.
 * @param {number} limit - Max records to return
 */
export function getRecentTrades(limit = 20) {
  return loadJournal().slice(0, limit);
}

/**
 * Export journal as JSON string for backup.
 */
export function exportJournal() {
  return JSON.stringify(loadJournal(), null, 2);
}

/**
 * Import journal from JSON string.
 */
export function importJournal(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) throw new Error('Invalid format');
    saveJournal(data);
    return true;
  } catch {
    return false;
  }
}
