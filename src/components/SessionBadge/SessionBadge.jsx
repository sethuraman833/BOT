import { useSession } from '../../hooks/useSession.js';
import './SessionBadge.css';

export default function SessionBadge() {
  const { session, killZone, utcTime } = useSession();

  const badgeClasses = [
    'session-badge',
    session.isOverlap ? 'session-overlap' : '',
    killZone.inKillZone ? 'session-killzone' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={badgeClasses}
      style={{ '--session-color': session.color }}
      aria-label={`Current session: ${session.name}, ${session.countdown}`}
      role="status"
    >
      <span className="session-dot" />
      <div className="session-info">
        <span className="session-name">{session.name}</span>
        {killZone.inKillZone && (
          <span className="session-kz-badge">⚡ {killZone.killZoneName}</span>
        )}
      </div>
      {session.countdown && (
        <span className="session-countdown">{session.countdown}</span>
      )}
      <span className="session-time">{utcTime}</span>
    </div>
  );
}
