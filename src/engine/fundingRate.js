// ─────────────────────────────────────────────────────────
//  Funding Rate & Open Interest — Institutional Sentiment
//  Fetches live data from Binance Futures API
// ─────────────────────────────────────────────────────────

const BINANCE_REST = 'https://fapi.binance.com/fapi/v1';

/**
 * Fetch the latest funding rate for a symbol.
 * Positive rate → overleveraged longs (contrarian short bias).
 * Negative rate → overleveraged shorts (contrarian long bias).
 */
export async function fetchFundingRate(symbol) {
  try {
    const res = await fetch(`${BINANCE_REST}/fundingRate?symbol=${symbol}&limit=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { rate: 0, nextFundingTime: 0, sentiment: 'neutral' };
    }
    const rate = parseFloat(data[0].fundingRate);
    const nextFundingTime = data[0].fundingTime;
    let sentiment = 'neutral';
    if (rate > 0.0001)       sentiment = 'overleveraged_longs';   // > 0.01%
    else if (rate < -0.0001) sentiment = 'overleveraged_shorts';  // < -0.01%
    return { rate, nextFundingTime, sentiment };
  } catch (err) {
    console.warn(`[FUNDING] Failed to fetch funding rate for ${symbol}:`, err.message);
    return { rate: 0, nextFundingTime: 0, sentiment: 'neutral' };
  }
}

/**
 * Fetch current open interest for a symbol.
 * Rising OI + rising price = strong trend (new longs entering).
 * Rising OI + falling price = new shorts entering.
 */
export async function fetchOpenInterest(symbol) {
  try {
    const res = await fetch(`${BINANCE_REST}/openInterest?symbol=${symbol}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      openInterest: parseFloat(data.openInterest || 0),
      symbol: data.symbol || symbol,
    };
  } catch (err) {
    console.warn(`[FUNDING] Failed to fetch OI for ${symbol}:`, err.message);
    return { openInterest: 0, symbol };
  }
}

/**
 * Combined sentiment analysis from funding rate + open interest.
 * Returns a confluence-ready object with directional bias.
 *
 * @param {string} symbol   - e.g. 'BTCUSDT'
 * @param {string} direction - 'long' or 'short' (the proposed trade direction)
 * @returns {object} { fundingRate, openInterest, sentiment, aligned, confluenceWeight }
 */
export async function getFundingOISentiment(symbol, direction = null) {
  const [fr, oi] = await Promise.all([
    fetchFundingRate(symbol),
    fetchOpenInterest(symbol),
  ]);

  // Determine if funding rate supports the trade direction
  // Contrarian logic: high positive funding → shorts are favorable, high negative → longs favorable
  let aligned = false;
  let confluenceWeight = 0.5; // neutral default

  if (direction === 'long' && fr.sentiment === 'overleveraged_shorts') {
    aligned = true;
    confluenceWeight = 1.0;
  } else if (direction === 'short' && fr.sentiment === 'overleveraged_longs') {
    aligned = true;
    confluenceWeight = 1.0;
  } else if (
    (direction === 'long' && fr.sentiment === 'overleveraged_longs') ||
    (direction === 'short' && fr.sentiment === 'overleveraged_shorts')
  ) {
    aligned = false;
    confluenceWeight = -0.5; // against the trade
  }

  return {
    fundingRate: fr.rate,
    fundingRatePct: (fr.rate * 100).toFixed(4) + '%',
    sentiment: fr.sentiment,
    openInterest: oi.openInterest,
    nextFundingTime: fr.nextFundingTime,
    aligned,
    confluenceWeight,
  };
}
