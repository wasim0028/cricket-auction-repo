'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import useAdmin from '../../../components/useAdmin';
import TeamPurses from '../../../components/TeamPurses';
import { CATEGORIES, ROLE_LABEL, fmtPrice } from '../../../lib/format';

export default function AuctionConsole() {
  const ready = useAdmin();
  const [counts, setCounts] = useState([]);
  const [teams, setTeams] = useState([]);
  const [cat, setCat] = useState(CATEGORIES[0]);
  const [statusFilter, setStatusFilter] = useState('AVAILABLE');
  const [players, setPlayers] = useState([]);
  const [selling, setSelling] = useState(null); // { playerId, teamId, price }
  const [blocked, setBlocked] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });

  const loadMeta = useCallback(async () => {
    const [c, t] = await Promise.all([
      api('/admin/auction/categories', { auth: true }),
      api('/admin/teams', { auth: true }),
    ]);
    setCounts(c);
    setTeams(t);
  }, []);

  const loadPlayers = useCallback(async (category, status) => {
    const qs = new URLSearchParams({ role: category.role, capped: String(category.isCapped) });
    if (status) qs.set('auction_status', status);
    setPlayers(await api(`/admin/auction/players?${qs}`, { auth: true }));
  }, []);

  const refresh = useCallback(async (category = cat, status = statusFilter) => {
    try {
      await Promise.all([loadMeta(), loadPlayers(category, status)]);
    } catch (e) {
      if (e.data?.code === 'REGISTRATION_OPEN') setBlocked(e.message);
      else setMsg({ type: 'err', text: e.message });
    }
  }, [cat, statusFilter, loadMeta, loadPlayers]);

  useEffect(() => {
    if (ready) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const countFor = (c) => counts.find((x) => x.role === c.role && x.is_capped === c.isCapped);

  async function act(path, body, okText) {
    setMsg({ type: '', text: '' });
    try {
      await api(`/admin/auction/${path}`, { method: 'POST', auth: true, body });
      setSelling(null);
      if (okText) setMsg({ type: 'ok', text: okText });
      await refresh();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }

  const pickCat = (c) => {
    setCat(c);
    setSelling(null);
    refresh(c, statusFilter);
  };
  const pickStatus = (s) => {
    setStatusFilter(s);
    refresh(cat, s);
  };

  if (!ready) return <div className="container muted">Loading…</div>;
  if (blocked)
    return (
      <div className="container">
        <div className="msg info">{blocked}. Close the registration window from the dashboard first.</div>
      </div>
    );

  const cc = countFor(cat);

  return (
    <div className="container">
      <h1>Auction console</h1>
      <div className="tabs">
        {CATEGORIES.map((c) => {
          const n = countFor(c);
          return (
            <button key={c.key} className={`tab ${c.key === cat.key ? 'active' : ''}`} onClick={() => pickCat(c)}>
              {c.label}<small>{n ? `${n.available} left` : '0'}</small>
            </button>
          );
        })}
      </div>

      {msg.text && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="split">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              {cat.label} {cc && <span className="muted" style={{ fontSize: 14 }}>
                ({cc.sold} sold · {cc.unsold} unsold · {cc.available} available)
              </span>}
            </h3>
            <div className="row">
              <select value={statusFilter} onChange={(e) => pickStatus(e.target.value)}>
                <option value="AVAILABLE">Available</option>
                <option value="SOLD">Sold</option>
                <option value="UNSOLD">Unsold</option>
                <option value="">All</option>
              </select>
              {cc?.unsold > 0 && (
                <button className="btn alt small" onClick={() => act('accelerate', { role: cat.role, isCapped: cat.isCapped }, 'Unsold players are back in the pool (accelerated round)')}>
                  Re-open unsold ({cc.unsold})
                </button>
              )}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Player</th><th>Matches</th><th>Base</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.full_name}</b> {p.is_overseas && <span className="badge blue">OS</span>}
                      <br /><span className="muted">{p.state || p.nationality} · {p.batting_style === 'LEFT_HAND' ? 'LHB' : 'RHB'}{p.bowling_style ? ` · ${p.bowling_style}` : ''}</span>
                      {selling?.playerId === p.id && (
                        <div className="inline-form">
                          <div className="row">
                            <select value={selling.teamId} onChange={(e) => setSelling({ ...selling, teamId: e.target.value })}>
                              <option value="">Select team…</option>
                              {teams.map((t) => (
                                <option key={t.id} value={t.id}>{t.short_name} · {fmtPrice(t.remaining_lakh)} left</option>
                              ))}
                            </select>
                            <input type="number" style={{ width: 130 }} min={p.base_price_lakh} value={selling.price}
                              onChange={(e) => setSelling({ ...selling, price: e.target.value })} />
                            <span className="muted">lakh = {fmtPrice(Number(selling.price))}</span>
                          </div>
                          <div className="row" style={{ marginTop: 8 }}>
                            <button className="btn small" disabled={!selling.teamId || !selling.price}
                              onClick={() => act('sell', { playerId: p.id, teamId: Number(selling.teamId), priceLakh: Number(selling.price) }, `${p.full_name} sold`)}>
                              Confirm sale
                            </button>
                            <button className="btn alt small" onClick={() => setSelling(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td>{p.matches_played}</td>
                    <td>{fmtPrice(p.base_price_lakh)}</td>
                    <td>
                      {p.auction_status === 'SOLD' ? <span className="badge green">SOLD · {p.team_short} · {fmtPrice(p.sold_price_lakh)}</span>
                        : p.auction_status === 'UNSOLD' ? <span className="badge red">UNSOLD</span>
                        : <span className="badge amber">AVAILABLE</span>}
                    </td>
                    <td>
                      <div className="row">
                        {p.auction_status === 'AVAILABLE' && (
                          <>
                            <button className="btn small" onClick={() => setSelling({ playerId: p.id, teamId: '', price: p.base_price_lakh })}>Sell</button>
                            <button className="btn small danger" onClick={() => act('unsold', { playerId: p.id })}>Unsold</button>
                          </>
                        )}
                        {p.auction_status !== 'AVAILABLE' && (
                          <button className="btn alt small" onClick={() => confirm(`Undo for ${p.full_name}?`) && act('undo', { playerId: p.id })}>Undo</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {players.length === 0 && <tr><td colSpan={5} className="muted">No players in this view.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>Only approved registrations appear here. {ROLE_LABEL[cat.role]}s are listed by base price, then experience.</p>
        </div>
        <TeamPurses teams={teams} />
      </div>
    </div>
  );
}
