// ─────────────────────────────────────────────────────────
//  useSession — Live Session + UTC Clock
// ─────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { getCurrentSession } from '../engine/sessionFilter.js';
import { formatUTCTime } from '../utils/formatters.js';

export function useSession() {
  const [session, setSession] = useState(getCurrentSession());
  const [utcTime, setUtcTime] = useState(formatUTCTime());

  useEffect(() => {
    const interval = setInterval(() => {
      setSession(getCurrentSession());
      setUtcTime(formatUTCTime());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return { session, utcTime };
}
