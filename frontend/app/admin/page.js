'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, downloadCsv } from '../../lib/api';
import useAdmin from '../../components/useAdmin';
import { BASE_PRICE_SLABS, ROLES, ROLE_LABEL, fmtPrice, toLocalInput } from '../../lib/format';

export default function Dashboard() {
  const ready = useAdmin();
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [players, setPlayers] = useState(null);
  const [filters, setFilters] = useState({ role: '', capped: '', reg_status: '', q: '' });
  const [deadline, setDeadline] = useState('');
  const [auctionDate, setAuctionDate] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });

  const flash = (type, text) => setMsg({ type, text });

  const loadPlayers = useCallback(async (f, open) => {
    if (open) {
      setPlayers(null);
      return;
    }
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    try {
      setPlayers(await api(`/admin/players?${qs}`, { auth: true }));
    } catch (e) {
      flash('err', e.message);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([api('/admin/settings', { auth: true }), api('/admin/stats', { auth: true })]);
      setSettings(s);
      setStats(st);
      setDeadline(toLocalInput(s.registrationDeadline));
      setAuctionDate(s.auctionDate || '');
      return s;
    } catch (e) {
      flash('err', e.message);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadAll().then((s) => s && loadPlayers(filters, s.registrationOpen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function saveSettings(patch) {
    try {
      const s = await api('/admin/settings', { method: 'PUT', auth: true, body: patch });
      setSettings(s);
      flash('ok', 'Settings saved');
      await loadAll();
      loadPlayers(filters, s.registrationOpen);
    } catch (e) {
      flash('err', e.message);
    }
  }

  async function patchPlayer(id, body) {
    try {
      const updated = await api(`/admin/players/${id}`, { method: 'PATCH', auth: true, body });
      setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, ...updated } : p)));
      loadAll();
    } catch (e) {
      flash('err', e.message);
    }
  }

  async function approveAll() {
    if (!confirm('Approve all pending registrations?')) return;
    try {
      const r = await api('/admin/players/approve-all', { method: 'POST', auth: true });
      flash('ok', `${r.approved} players approved`);
      loadAll();
      loadPlayers(filters, settings.registrationOpen);
    } catch (e) {
      flash('err', e.message);
    }
  }

  const setFilter = (k) => (e) => {
    const f = { ...filters, [k]: e.target.value };
    setFilters(f);
    loadPlayers(f, settings?.registrationOpen);
  };

  if (!ready || !settings) return <div className="container muted">Loading…</div>;

  return (
    <div className="container">
      <h1>Admin dashboard</h1>
      {msg.text && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <h3>Registration window</h3>
        <p>
          Status: <span className={`badge ${settings.registrationOpen ? 'green' : 'red'}`}>{settings.registrationOpen ? 'OPEN' : 'CLOSED'}</span>
          {settings.manualOpen && !settings.registrationOpen && <span className="muted"> (deadline passed)</span>}
        </p>
        <div className="grid two">
          <div className="field">
            <label>Submission deadline (your local time)</label>
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div className="field">
            <label>Auction day (shown on home page)</label>
            <input value={auctionDate} onChange={(e) => setAuctionDate(e.target.value)} placeholder="e.g. 14 Dec 2026, Mumbai" />
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => saveSettings({
            registrationDeadline: deadline ? new Date(deadline).toISOString() : null,
            auctionDate,
          })}>Save deadline &amp; date</button>
          {settings.manualOpen ? (
            <button className="btn danger" onClick={() => confirm('Close registrations now?') && saveSettings({ registrationOpen: false })}>Close registration now</button>
          ) : (
            <button className="btn alt" onClick={() => saveSettings({ registrationOpen: true })}>Re-open registration</button>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid stats" style={{ marginBottom: 20 }}>
          <div className="stat">Registered<b>{stats.total}</b></div>
          <div className="stat">Pending<b>{stats.pending}</b></div>
          <div className="stat">Approved<b>{stats.approved}</b></div>
          <div className="stat">Rejected<b>{stats.rejected}</b></div>
          <div className="stat">Sold<b>{stats.sold}</b></div>
          <div className="stat">Unsold<b>{stats.unsold}</b></div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Registered players</h3>
          {!settings.registrationOpen && (
            <div className="row">
              <button className="btn alt small" onClick={() => downloadCsv().catch((e) => flash('err', e.message))}>Export CSV</button>
              <button className="btn small" onClick={approveAll}>Approve all pending</button>
            </div>
          )}
        </div>

        {settings.registrationOpen ? (
          <div className="msg info">
            Player details unlock once the registration window is closed. {stats?.total ?? 0} registrations received so far.
          </div>
        ) : (
          <>
            <div className="grid two" style={{ margin: '14px 0' }}>
              <input placeholder="Search name or email" value={filters.q} onChange={setFilter('q')} />
              <select value={filters.role} onChange={setFilter('role')}>
                <option value="">All roles</option>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <select value={filters.capped} onChange={setFilter('capped')}>
                <option value="">Capped &amp; uncapped</option>
                <option value="true">Capped</option>
                <option value="false">Uncapped</option>
              </select>
              <select value={filters.reg_status} onChange={setFilter('reg_status')}>
                <option value="">Any registration status</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            {!players ? <p className="muted">Loading…</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Name</th><th>Category</th><th>Nat.</th><th>Matches</th><th>Base price</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {players.map((p) => (
                      <tr key={p.id}>
                        <td><b>{p.full_name}</b><br /><span className="muted">{p.email}</span></td>
                        <td>{p.is_capped ? 'Capped' : 'Uncapped'} {ROLE_LABEL[p.role]}</td>
                        <td>{p.nationality}{p.is_overseas && <> <span className="badge blue">OS</span></>}</td>
                        <td>{p.matches_played}</td>
                        <td>
                          <select value={p.base_price_lakh} disabled={p.auction_status === 'SOLD'}
                            onChange={(e) => patchPlayer(p.id, { base_price_lakh: Number(e.target.value) })}>
                            {BASE_PRICE_SLABS.map((s) => <option key={s} value={s}>{fmtPrice(s)}</option>)}
                          </select>
                        </td>
                        <td><span className={`badge ${p.reg_status === 'APPROVED' ? 'green' : p.reg_status === 'REJECTED' ? 'red' : 'amber'}`}>{p.reg_status}</span></td>
                        <td>
                          <div className="row">
                            <button className="btn small" disabled={p.reg_status === 'APPROVED' || p.auction_status === 'SOLD'} onClick={() => patchPlayer(p.id, { reg_status: 'APPROVED' })}>Approve</button>
                            <button className="btn small danger" disabled={p.reg_status === 'REJECTED' || p.auction_status === 'SOLD'} onClick={() => patchPlayer(p.id, { reg_status: 'REJECTED' })}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {players.length === 0 && <tr><td colSpan={7} className="muted">No players match.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
