// ─────────────────────────────────────────────────────────
//  useSession — Live Session + Kill Zone + UTC Clock
// ─────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { getCurrentSession, getKillZone } from '../engine/sessionFilter.js';
import { formatUTCTime } from '../utils/formatters.js';

export function useSession() {
  const [session, setSession] = useState(getCurrentSession());
  const [killZone, setKillZone] = useState(getKillZone());
  const [utcTime, setUtcTime] = useState(formatUTCTime());

  useEffect(() => {
    const interval = setInterval(() => {
      setSession(getCurrentSession());
      setKillZone(getKillZone());
      setUtcTime(formatUTCTime());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return { session, killZone, utcTime };
}
