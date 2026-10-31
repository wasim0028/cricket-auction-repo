'use client';
import LiveRoom from '../../../components/LiveRoom';
import useAdmin from '../../../components/useAdmin';

export default function AdminLive() {
  const ready = useAdmin();
  if (!ready) return <div className="container muted">Loading…</div>;
  return <LiveRoom mode="admin" />;
}
