export const ROLE_LABEL = {
  BATSMAN: 'Batsman',
  BOWLER: 'Bowler',
  WICKETKEEPER: 'Wicketkeeper',
  ALLROUNDER: 'All-rounder',
};
export const ROLES = Object.keys(ROLE_LABEL);
const ROLE_PLURAL = {
  BATSMAN: 'Batsmen',
  BOWLER: 'Bowlers',
  WICKETKEEPER: 'Wicketkeepers',
  ALLROUNDER: 'All-rounders',
};

// IPL-style set order: capped first, then uncapped
export const CATEGORIES = [true, false].flatMap((isCapped) =>
  ROLES.map((role) => ({
    key: `${isCapped ? 'C' : 'U'}-${role}`,
    role,
    isCapped,
    label: `${isCapped ? 'Capped' : 'Uncapped'} ${ROLE_PLURAL[role]}`,
  }))
);

export const BASE_PRICE_SLABS = [20, 30, 40, 50, 75, 100, 150, 200];

export function fmtPrice(lakh) {
  if (lakh === null || lakh === undefined) return '-';
  if (lakh >= 100) return `₹${(lakh / 100).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  return `₹${lakh} L`;
}

export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '-';
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const ISO = {
  india: 'IN', australia: 'AU', england: 'ENG', 'south africa': 'SA', 'new zealand': 'NZ', 'sri lanka': 'SL',
  bangladesh: 'BAN', afghanistan: 'AFG', zimbabwe: 'ZIM', usa: 'USA', 'united states': 'USA', ireland: 'IRL',
  netherlands: 'NED', 'west indies': 'WI', pakistan: 'PAK', nepal: 'NEP', scotland: 'SCO', uae: 'UAE',
};
export const flagCode = (nat = '') => ISO[nat.trim().toLowerCase()] || nat.slice(0, 3).toUpperCase();

export function timeAgo(iso, nowMs) {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} Second${s === 1 ? '' : 's'} Ago`;
  const m = Math.floor(s / 60);
  return `${m} Minute${m === 1 ? '' : 's'} Ago`;
}

export const BOWLING_STYLES = [
  'Right-arm fast', 'Right-arm fast-medium', 'Right-arm medium', 'Left-arm fast', 'Left-arm medium',
  'Right-arm off-spin', 'Right-arm leg-spin', 'Left-arm orthodox spin', 'Left-arm wrist-spin (chinaman)',
];
export const isSpinStyle = (s = '') => /(spin|orthodox|chinaman|break)/i.test(s);

// Squad composition a team aims for (shown as have / need in the live room)
export const SQUAD_NEEDS = [
  { key: 'batsman', label: 'Batsman', need: 6 },
  { key: 'keeper', label: 'Keepers', need: 2 },
  { key: 'allrounder', label: 'All Rounders', need: 4 },
  { key: 'fast', label: 'Fast Bowlers', need: 5 },
  { key: 'spin', label: 'Spinners', need: 3 },
];
