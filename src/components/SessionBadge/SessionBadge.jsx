import { useSession } from '../../hooks/useSession.js';
import './SessionBadge.css';

export default function SessionBadge() {
  const { session, utcTime } = useSession();
  return (
    <div className="session-badge">
      <span className="session-dot" style={{ backgroundColor: session.color }} />
      <span className="session-name" style={{ color: session.color }}>{session.name}</span>
      <span className="session-time">{utcTime}</span>
    </div>
  );
}
