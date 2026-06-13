// ─────────────────────────────────────────────────────────
//  Session Filter v2.0 — Sessions + ICT Kill Zones + Countdown
// ─────────────────────────────────────────────────────────

// Session boundaries in UTC hours
const SESSIONS = [
  { name: 'London Open',       start: 7,  end: 10, status: 'optimal', color: 'var(--accent-green)' },
  { name: 'London Session',    start: 10, end: 12, status: 'valid',   color: 'var(--accent-green)' },
  { name: 'London–NY Overlap', start: 12, end: 16, status: 'optimal', color: 'var(--accent-green)' },
  { name: 'NY Session',        start: 16, end: 20, status: 'valid',   color: 'var(--accent-green)' },
  { name: 'NY Close',          start: 20, end: 24, status: 'caution', color: 'var(--accent-yellow)' },
  { name: 'Asian Session',     start: 0,  end: 7,  status: 'avoid',   color: 'var(--accent-red)' },
];

// ICT Kill Zones — specific sub-windows with peak institutional activity
const KILL_ZONES = [
  { name: 'London Kill Zone',  start: 7,  end: 10 },   // 2–5 AM EST
  { name: 'NY Kill Zone',      start: 12, end: 15 },   // 7–10 AM EST
  { name: 'Asian Kill Zone',   start: 0,  end: 3  },   // 8–10 PM EST
];

function formatCountdown(minutesLeft) {
  if (minutesLeft <= 0) return '';
  const h = Math.floor(minutesLeft / 60);
  const m = Math.round(minutesLeft % 60);
  if (h > 0) return `Closes in ${h}h ${m}m`;
  return `Closes in ${m}m`;
}

export function getCurrentSession() {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const utcTime = utcH + utcM / 60;

  // Find matching session
  let matched = null;
  for (const s of SESSIONS) {
    if (utcTime >= s.start && utcTime < s.end) {
      matched = s;
      break;
    }
  }

  if (!matched) {
    matched = { name: 'Pre-Market', start: 0, end: 7, status: 'avoid', color: 'var(--accent-red)' };
  }

  // Countdown until session ends
  const minutesUntilEnd = (matched.end * 60) - (utcH * 60 + utcM);
  const countdown = formatCountdown(minutesUntilEnd);

  // London–NY Overlap detection (12:00–16:00 UTC)
  const isOverlap = utcTime >= 12 && utcTime < 16;

  return {
    name: matched.name,
    status: matched.status,
    color: matched.color,
    countdown,
    isOverlap,
  };
}

/**
 * ICT Kill Zone detection — specific sub-windows where institutional
 * activity peaks, providing the highest-probability entries.
 */
export function getKillZone() {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const utcTime = utcH + utcM / 60;

  for (const kz of KILL_ZONES) {
    if (utcTime >= kz.start && utcTime < kz.end) {
      const minutesLeft = (kz.end * 60) - (utcH * 60 + utcM);
      return {
        inKillZone: true,
        killZoneName: kz.name,
        killZoneStatus: 'active',
        countdown: formatCountdown(minutesLeft),
      };
    }
  }

  return {
    inKillZone: false,
    killZoneName: null,
    killZoneStatus: 'inactive',
    countdown: '',
  };
}

export function isSessionValid(session) {
  return session.status === 'optimal' || session.status === 'valid';
}
