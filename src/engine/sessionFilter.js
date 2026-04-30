// ─────────────────────────────────────────────────────────
//  Session Filter — London / NY / Asian Detection
// ─────────────────────────────────────────────────────────

export function getCurrentSession() {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const utcTime = utcH + utcM / 60;

  if (utcTime >= 7 && utcTime < 10) {
    return { name: 'London Open', status: 'optimal', color: 'var(--accent-green)' };
  }
  if (utcTime >= 12 && utcTime < 16) {
    return { name: 'London–NY Overlap', status: 'optimal', color: 'var(--accent-green)' };
  }
  if (utcTime >= 10 && utcTime < 12) {
    return { name: 'London Session', status: 'valid', color: 'var(--accent-green)' };
  }
  if (utcTime >= 16 && utcTime < 20) {
    return { name: 'NY Session', status: 'valid', color: 'var(--accent-green)' };
  }
  if (utcTime >= 20 && utcTime < 24) {
    return { name: 'NY Close', status: 'caution', color: 'var(--accent-yellow)' };
  }
  if (utcTime >= 0 && utcTime < 7) {
    return { name: 'Asian Session', status: 'avoid', color: 'var(--accent-red)' };
  }
  return { name: 'Pre-Market', status: 'avoid', color: 'var(--accent-red)' };
}

export function isSessionValid(session) {
  return session.status === 'optimal' || session.status === 'valid';
}
