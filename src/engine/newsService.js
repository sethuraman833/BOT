// ─────────────────────────────────────────────────────────
//  News Service — Economic Calendar Filter
//  Vetoes trades during High-Impact News Events
// ─────────────────────────────────────────────────────────

/**
 * Checks if there is a high-impact news event within the exclusion window.
 * Default window: 2 hours before and after.
 * 
 * Note: In a production environment, this would fetch from ForexFactory 
 * or FinancialModelingPrep API. For this version, we implement the 
 * exclusion logic and a "Volatility Hour" safety check.
 */
export async function checkNewsVeto(symbol) {
  // 1. Production API Fetch (Placeholder for integration)
  // const news = await fetch('https://api.example.com/calendar');
  
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcDay   = now.getUTCDay(); // 0=Sun, 1=Mon... 5=Fri

  // 2. Structural High-Volatility "Danger Zones" (UTC)
  // Many high-impact USD events happen at 12:30 or 14:00 UTC
  const isDangerTime = (utcHours >= 12 && utcHours <= 15);
  
  // 3. Weekend Gap Risk (Friday close)
  const isFridayClose = (utcDay === 5 && utcHours >= 20);

  if (isFridayClose) {
    return {
      veto: true,
      reason: 'Friday Market Close — Weekend Gap Risk',
      impact: 'HIGH'
    };
  }

  // If it's a known high-volatility window and we don't have live API data,
  // we flag it as a "Caution" state.
  if (isDangerTime) {
    return {
      veto: false, // We don't hard veto without API proof, but we flag it
      caution: true,
      reason: 'Standard NY Economic Release Window (12:30-15:00 UTC)',
      impact: 'MEDIUM'
    };
  }

  return { veto: false, caution: false };
}
