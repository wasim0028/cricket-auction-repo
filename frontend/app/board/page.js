'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ROLE_LABEL, fmtPrice } from '../../lib/format';
import TeamPurses from '../../components/TeamPurses';

export default function Board() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api('/public/board').then(setData).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="container"><div className="msg err">{error}</div></div>;
  if (!data) return <div className="container muted">Loading…</div>;

  return (
    <div className="container">
      <h1>Auction board</h1>
      <p className="muted">Refreshes every 10 seconds.</p>
      <div className="split">
        <div className="card">
          <h3>Sold players ({data.sold.length})</h3>
          {data.sold.length === 0 ? <p className="muted">No players sold yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Player</th><th>Category</th><th>Team</th><th>Base</th><th>Sold for</th></tr></thead>
                <tbody>
                  {data.sold.map((p) => (
                    <tr key={p.id}>
                      <td>{p.full_name} {p.is_overseas && <span className="badge blue">OS</span>}</td>
                      <td>{p.is_capped ? 'Capped' : 'Uncapped'} {ROLE_LABEL[p.role]}</td>
                      <td><b>{p.team}</b></td>
                      <td>{fmtPrice(p.base_price_lakh)}</td>
                      <td><b>{fmtPrice(p.sold_price_lakh)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <TeamPurses teams={data.teams} />
      </div>
    </div>
  );
}
