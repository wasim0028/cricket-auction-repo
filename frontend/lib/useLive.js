'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';

// Live auction feed: WebSocket first, with automatic polling fallback and reconnect.
// Returns the latest snapshot, connection state and a ticking, server-synced clock.
export default function useLive() {
  const [snap, setSnap] = useState(null);
  const [conn, setConn] = useState('connecting'); // live | polling | connecting
  const [tick, setTick] = useState(0);
  const endsAt = useRef(0);
  const skew = useRef(0);

  useEffect(() => {
    let ws;
    let poll = null;
    let retry = null;
    let closed = false;

    const apply = (d) => {
      skew.current = d.serverTime - Date.now();
      endsAt.current = d.state.status === 'BIDDING' && d.state.remainingMs != null ? Date.now() + d.state.remainingMs : 0;
      setSnap(d);
    };
    const startPolling = () => {
      if (poll) return;
      setConn('polling');
      const f = () => api('/live/state').then(apply).catch(() => {});
      f();
      poll = setInterval(f, 2000);
    };
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const connect = () => {
      try {
        const url = process.env.NEXT_PUBLIC_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
        ws = new WebSocket(url);
      } catch {
        startPolling();
        return;
      }
      ws.onopen = () => {
        setConn('live');
        stopPolling();
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'snapshot') apply(m.data);
        } catch {}
      };
      ws.onclose = () => {
        if (closed) return;
        startPolling();
        retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    const clock = setInterval(() => setTick((n) => n + 1), 200);
    return () => {
      closed = true;
      clearTimeout(retry);
      stopPolling();
      clearInterval(clock);
      if (ws) ws.close();
    };
  }, []);

  const nowMs = Date.now() + skew.current;
  let remaining = 0;
  if (snap?.state.status === 'BIDDING') remaining = Math.max(0, endsAt.current - Date.now());
  else if (snap?.state.status === 'PAUSED') remaining = snap.state.remainingMs || 0;
  return { snap, conn, remaining, nowMs, tick };
}
