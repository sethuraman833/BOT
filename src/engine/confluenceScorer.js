// ─────────────────────────────────────────────────────────
//  Confluence Scorer — 11-Point Institutional Check System
// ─────────────────────────────────────────────────────────

export const CONFLUENCE_CHECKS = {
  TREND_4H_ALIGNED:    { label: '4H Trend Aligned',           points: 1, pillar: true },
  LIQUIDITY_EVENT:     { label: 'Liquidity Sweep / FVG Fill', points: 1, pillar: true },
  STRUCTURE_SHIFT_15M: { label: '15m BOS / CHOCH',            points: 1, pillar: true },
  SESSION_ACTIVE:      { label: 'London / NY Session',        points: 1, pillar: true },
  RRR_MINIMUM:         { label: 'RRR ≥ 1:3',                 points: 1, pillar: true },
  DAILY_ALIGNED:       { label: 'Daily Bias Aligned',         points: 1, pillar: false },
  RSI_DIVERGENCE:      { label: 'RSI Divergence Present',     points: 1, pillar: false },
  PATTERN_ALIGNED:     { label: 'Chart Pattern Confirmed',    points: 1, pillar: false },
  EMA200_SUPPORT:      { label: 'EMA200 Acting as S/R',       points: 1, pillar: false },
  ORDER_FLOW_ALIGNED:  { label: 'Order Flow Signal Aligned',  points: 1, pillar: false },
  OTE_ENTRY:           { label: 'Entry in OTE Zone (Fib)',    points: 1, pillar: false },
};

/**
 * Score confluence from analysis results.
 * Returns total, checks array, and pillar status.
 */
export function scoreConfluence(results) {
  const {
    trend4HAligned,
    liquidityEvent,
    structureShift15m,
    sessionActive,
    rrrMeetsMinimum,
    dailyAligned,
    rsiDivergence,
    patternAligned,
    ema200Support,
    orderFlowAligned,
    oteEntry,
  } = results;

  const checks = [
    { key: 'TREND_4H_ALIGNED',    met: !!trend4HAligned,      ...CONFLUENCE_CHECKS.TREND_4H_ALIGNED },
    { key: 'LIQUIDITY_EVENT',     met: !!liquidityEvent,      ...CONFLUENCE_CHECKS.LIQUIDITY_EVENT },
    { key: 'STRUCTURE_SHIFT_15M', met: !!structureShift15m,   ...CONFLUENCE_CHECKS.STRUCTURE_SHIFT_15M },
    { key: 'SESSION_ACTIVE',      met: !!sessionActive,       ...CONFLUENCE_CHECKS.SESSION_ACTIVE },
    { key: 'RRR_MINIMUM',         met: !!rrrMeetsMinimum,     ...CONFLUENCE_CHECKS.RRR_MINIMUM },
    { key: 'DAILY_ALIGNED',       met: !!dailyAligned,        ...CONFLUENCE_CHECKS.DAILY_ALIGNED },
    { key: 'RSI_DIVERGENCE',      met: !!rsiDivergence,       ...CONFLUENCE_CHECKS.RSI_DIVERGENCE },
    { key: 'PATTERN_ALIGNED',     met: !!patternAligned,      ...CONFLUENCE_CHECKS.PATTERN_ALIGNED },
    { key: 'EMA200_SUPPORT',      met: !!ema200Support,       ...CONFLUENCE_CHECKS.EMA200_SUPPORT },
    { key: 'ORDER_FLOW_ALIGNED',  met: !!orderFlowAligned,    ...CONFLUENCE_CHECKS.ORDER_FLOW_ALIGNED },
    { key: 'OTE_ENTRY',           met: !!oteEntry,            ...CONFLUENCE_CHECKS.OTE_ENTRY },
  ];

  const total = checks.filter(c => c.met).reduce((sum, c) => sum + c.points, 0);
  const pillarsAllMet = checks.filter(c => c.pillar).every(c => c.met);
  const pillarsMet = checks.filter(c => c.pillar && c.met).length;
  const pillarsTotal = checks.filter(c => c.pillar).length;

  let tier;
  if (total >= 10)     tier = 'EXCEPTIONAL';
  else if (total >= 7) tier = 'HIGH';
  else if (total >= 5) tier = 'MEDIUM';
  else                 tier = 'REJECT';

  // Override: if any pillar is missing, force REJECT
  if (!pillarsAllMet && tier !== 'REJECT') {
    tier = 'REJECT';
  }

  return {
    total,
    max: 11,
    tier,
    checks,
    pillarsAllMet,
    pillarsMet,
    pillarsTotal,
  };
}
