const pool = require('./db');

// Teams with purse used, squad size and overseas count (computed from SOLD players)
async function teamsWithStats(client = pool, teamId = null) {
  const params = [];
  let where = '';
  if (teamId) {
    params.push(teamId);
    where = 'WHERE t.id = $1';
  }
  const { rows } = await client.query(
    `SELECT t.id, t.name, t.short_name, t.purse_lakh, t.max_squad, t.max_overseas, t.color, t.owner_name,
            (t.access_hash IS NOT NULL) AS has_passcode,
            COALESCE(SUM(p.sold_price_lakh), 0)::int AS spent_lakh,
            COUNT(p.id)::int AS squad_size,
            (COUNT(p.id) FILTER (WHERE p.is_overseas))::int AS overseas_count,
            (COUNT(p.id) FILTER (WHERE p.role = 'BATSMAN'))::int AS c_bat,
            (COUNT(p.id) FILTER (WHERE p.role = 'WICKETKEEPER'))::int AS c_keep,
            (COUNT(p.id) FILTER (WHERE p.role = 'ALLROUNDER'))::int AS c_ar,
            (COUNT(p.id) FILTER (WHERE p.role = 'BOWLER' AND p.bowling_style !~* '(spin|orthodox|chinaman|break)'))::int AS c_fast,
            (COUNT(p.id) FILTER (WHERE p.role = 'BOWLER' AND p.bowling_style ~* '(spin|orthodox|chinaman|break)'))::int AS c_spin
       FROM teams t
       LEFT JOIN players p ON p.team_id = t.id AND p.auction_status = 'SOLD'
       ${where}
      GROUP BY t.id
      ORDER BY t.name`,
    params
  );
  return rows.map(({ c_bat, c_keep, c_ar, c_fast, c_spin, ...r }) => ({
    ...r,
    remaining_lakh: r.purse_lakh - r.spent_lakh,
    composition: { batsman: c_bat, keeper: c_keep, allrounder: c_ar, fast: c_fast, spin: c_spin },
  }));
}

module.exports = { teamsWithStats };
