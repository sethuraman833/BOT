// ── EMA Market Regime Detection Engine ──────────────────────────────────────
// Uses EMA20/50/200 stack ordering + per-EMA slope thresholds
// Slope = % change of EMA over last 5 candles (bias timeframe)

export function computeRegime(indicators, currentPrice) {
  if (!indicators || !indicators.ema20 || !indicators.ema50 || !indicators.ema200) {
    return { regime: 'SIDEWAYS', strength: 'UNKNOWN', label: 'SIDEWAYS MARKET', rec: 'RANGE TRADE', icon: '〰️', reason: 'Insufficient EMA data' };
  }

  const { ema20, ema50, ema200, ema20_slope, ema50_slope, ema200_slope } = indicators;

  // ── Stack ordering (primary signal) ──────────────────────────────
  const bullStack = ema20 > ema50 && ema50 > ema200;   // golden alignment
  const bearStack = ema20 < ema50 && ema50 < ema200;   // death alignment
  const earlyBull = ema20 > ema50 && ema20 < ema200;   // recovering — EMA20 above 50 but below 200
  const earlyBear = ema20 < ema50 && ema20 > ema200;   // rolling over — EMA20 below 50 but above 200

  // ── Slope thresholds (per-EMA, not uniform) ────────────────────
  // EMA200 is slow — even 0.008%/5c is meaningful; EMA20 needs 0.05%/5c
  const e20_up   = ema20_slope  >  0.05;
  const e20_dn   = ema20_slope  < -0.05;
  const e50_up   = ema50_slope  >  0.02;
  const e50_dn   = ema50_slope  < -0.02;

  // ── Regime classification ─────────────────────────────────────
  if (bullStack && e20_up && e50_up) {
    return { regime: 'BULL', strength: 'STRONG',  label: 'STRONG BULL', rec: 'LONGS ONLY',   icon: '🐂' };
  }
  if (bullStack && (e20_up || e50_up) && !e20_dn) {
    return { regime: 'BULL', strength: 'MODERATE', label: 'BULL MARKET', rec: 'PREFER LONGS', icon: '🐂' };
  }
  if (bullStack && !e20_dn) {
    return { regime: 'BULL', strength: 'WEAK',    label: 'WEAK BULL',   rec: 'PREFER LONGS', icon: '🐂' };
  }
  if (bearStack && e20_dn && e50_dn) {
    return { regime: 'BEAR', strength: 'STRONG',  label: 'STRONG BEAR', rec: 'SHORTS ONLY',  icon: '🐻' };
  }
  if (bearStack && (e20_dn || e50_dn) && !e20_up) {
    return { regime: 'BEAR', strength: 'MODERATE', label: 'BEAR MARKET', rec: 'PREFER SHORTS', icon: '🐻' };
  }
  if (bearStack && !e20_up) {
    return { regime: 'BEAR', strength: 'WEAK',    label: 'WEAK BEAR',   rec: 'PREFER SHORTS', icon: '🐻' };
  }
  if (earlyBull) {
    return { regime: 'BULL', strength: 'TRANSITION', label: 'RECOVERING', rec: 'CAUTIOUS LONGS', icon: '🌱' };
  }
  if (earlyBear) {
    return { regime: 'BEAR', strength: 'TRANSITION', label: 'ROLLING OVER', rec: 'CAUTIOUS SHORTS', icon: '⚠️' };
  }
  return { regime: 'SIDEWAYS', strength: 'MODERATE', label: 'RANGING', rec: 'RANGE TRADE', icon: '〰️' };
}
