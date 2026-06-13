// ─────────────────────────────────────────────────────────
//  OTE Calculator v2.0 — Fibonacci OTE + Premium/Discount Zones
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

// ─── Premium / Discount Zone Detection ─────────────────────
// Core ICT concept: the 50% equilibrium of a swing range divides
// the market into premium (above) and discount (below) zones.
// Longs should be entered in discount, shorts in premium.

/**
 * Calculate premium/discount zones from a swing range.
 * @returns {{ equilibrium, premiumZone: {lower,upper}, discountZone: {lower,upper} }}
 */
export function calculatePremiumDiscount(impulseHigh, impulseLow) {
  const range = impulseHigh - impulseLow;
  const equilibrium = impulseLow + range * 0.5;
  return {
    equilibrium,
    premiumZone: { lower: equilibrium, upper: impulseHigh },
    discountZone: { lower: impulseLow, upper: equilibrium },
    range,
  };
}

/**
 * Check if price is in the discount zone (below 50% of range).
 * Longs should ideally be entered here.
 */
export function isInDiscount(price, zones) {
  if (!zones || !zones.discountZone) return false;
  return price >= zones.discountZone.lower && price <= zones.discountZone.upper;
}

/**
 * Check if price is in the premium zone (above 50% of range).
 * Shorts should ideally be entered here.
 */
export function isInPremium(price, zones) {
  if (!zones || !zones.premiumZone) return false;
  return price >= zones.premiumZone.lower && price <= zones.premiumZone.upper;
}
