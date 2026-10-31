import { fmtPrice } from '../lib/format';

export default function TeamPurses({ teams }) {
  return (
    <div className="card">
      <h3>Team purses</h3>
      <table>
        <thead><tr><th>Team</th><th>Left</th><th>Squad</th></tr></thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id}>
              <td><b>{t.short_name}</b></td>
              <td>{fmtPrice(t.remaining_lakh)}</td>
              <td>{t.squad_size}/{t.max_squad} <span className="muted">(OS {t.overseas_count}/{t.max_overseas})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
