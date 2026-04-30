// ─────────────────────────────────────────────────────────
//  OTE Calculator — Fibonacci Optimal Trade Entry Zone
// ─────────────────────────────────────────────────────────

export function calculateOTE(impulseHigh, impulseLow, direction) {
  const range = impulseHigh - impulseLow;

  if (direction === 'long') {
    return {
      lower: impulseHigh - 0.786 * range,
      upper: impulseHigh - 0.618 * range,
      midpoint: impulseHigh - 0.702 * range,
    };
  }

  // short
  return {
    lower: impulseLow + 0.618 * range,
    upper: impulseLow + 0.786 * range,
    midpoint: impulseLow + 0.702 * range,
  };
}

export function isInOTE(currentPrice, oteZone) {
  if (!oteZone) return false;
  return currentPrice >= oteZone.lower && currentPrice <= oteZone.upper;
}

export function fibExtension(swingLow, swingHigh) {
  const range = swingHigh - swingLow;
  return {
    ext_1000: swingHigh,
    ext_1272: swingHigh + range * 0.272,
    ext_1618: swingHigh + range * 0.618,
    ext_2000: swingHigh + range,
  };
}
