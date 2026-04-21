// ─────────────────────────────────────────────────────────
//  Session Filter — Step 8 (Pillar 4) + News Filter (Step 9)
// ─────────────────────────────────────────────────────────

/**
 * Determine current trading session based on UTC time.
 */
export function getCurrentSession() {
  const now = new Date();
  const utcHour = now.getUTCHours();

  if (utcHour >= 0 && utcHour < 7) {
    return {
      name: 'Asian',
      status: 'low_probability',
      valid: false,
      description: 'Asian session — low volume, avoid entries unless explosive move >2%',
      color: '#6b7280',
    };
  }
  if (utcHour >= 7 && utcHour < 10) {
    return {
      name: 'London Open',
      status: 'best',
      valid: true,
      description: 'London Open — BEST entries, high probability window',
      color: '#10b981',
    };
  }
  if (utcHour >= 10 && utcHour < 12) {
    return {
      name: 'London',
      status: 'valid',
      valid: true,
      description: 'London session — valid entries',
      color: '#10b981',
    };
  }
  if (utcHour >= 12 && utcHour < 16) {
    return {
      name: 'London–NY Overlap',
      status: 'highest_volume',
      valid: true,
      description: 'London–NY Overlap — Highest volume, excellent entries',
      color: '#f59e0b',
    };
  }
  if (utcHour >= 16 && utcHour < 20) {
    return {
      name: 'NY Session',
      status: 'valid',
      valid: true,
      description: 'NY session — valid entries',
      color: '#3b82f6',
    };
  }
  // 20-24 UTC
  return {
    name: 'NY Close',
    status: 'caution',
    valid: false,
    description: 'NY Close — Only trade with strong confirmed momentum',
    color: '#ef4444',
  };
}

/**
 * Calculate time until next optimal session.
 */
export function getNextSessionStart() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();

  let hoursUntil;
  let nextSession;

  if (utcHour < 7) {
    hoursUntil = 7 - utcHour;
    nextSession = 'London Open';
  } else if (utcHour >= 20) {
    hoursUntil = 24 - utcHour + 7;
    nextSession = 'London Open';
  } else {
    hoursUntil = 0;
    nextSession = 'Current';
  }

  return {
    nextSession,
    hoursUntil,
    minutesUntil: hoursUntil * 60 - utcMinutes,
  };
}

/**
 * Format session status for display.
 */
export function getSessionDisplay() {
  const current = getCurrentSession();
  const next = getNextSessionStart();

  return {
    ...current,
    nextSession: next.nextSession,
    countdown: next.minutesUntil > 0
      ? `${Math.floor(next.minutesUntil / 60)}h ${next.minutesUntil % 60}m`
      : null,
    utcTime: new Date().toISOString().slice(11, 16) + ' UTC',
  };
}
