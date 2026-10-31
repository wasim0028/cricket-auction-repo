CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('registration_open', 'true'),
  ('registration_deadline', ''),
  ('auction_date', '')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS teams (
  id           SERIAL PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL,
  short_name   TEXT UNIQUE NOT NULL,
  purse_lakh   INTEGER NOT NULL DEFAULT 12000,  -- 120 Cr
  max_squad    INTEGER NOT NULL DEFAULT 25,
  max_overseas INTEGER NOT NULL DEFAULT 8
);

CREATE TABLE IF NOT EXISTS players (
  id              SERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  phone           TEXT NOT NULL,
  date_of_birth   DATE NOT NULL,
  state           TEXT NOT NULL DEFAULT '',
  nationality     TEXT NOT NULL DEFAULT 'India',
  is_overseas     BOOLEAN NOT NULL DEFAULT FALSE,
  role            TEXT NOT NULL CHECK (role IN ('BATSMAN','BOWLER','WICKETKEEPER','ALLROUNDER')),
  batting_style   TEXT,
  bowling_style   TEXT NOT NULL DEFAULT '',
  is_capped       BOOLEAN NOT NULL DEFAULT FALSE,
  matches_played  INTEGER NOT NULL DEFAULT 0,
  achievements    TEXT NOT NULL DEFAULT '',
  base_price_lakh INTEGER NOT NULL DEFAULT 20,
  reg_status      TEXT NOT NULL DEFAULT 'PENDING'   CHECK (reg_status IN ('PENDING','APPROVED','REJECTED')),
  auction_status  TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (auction_status IN ('AVAILABLE','SOLD','UNSOLD')),
  team_id         INTEGER REFERENCES teams(id),
  sold_price_lakh INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_category ON players (is_capped, role);
CREATE INDEX IF NOT EXISTS idx_players_team ON players (team_id);

CREATE TABLE IF NOT EXISTS auction_log (
  id         SERIAL PRIMARY KEY,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  team_id    INTEGER REFERENCES teams(id),
  action     TEXT NOT NULL,           -- SOLD | UNSOLD | UNDO | ACCELERATE
  price_lakh INTEGER,
  admin      TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- v2: live bidding, player stats/photo, team branding & logins ----
ALTER TABLE players ADD COLUMN IF NOT EXISTS runs        INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS batting_avg NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS strike_rate NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS wickets     INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS economy     NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS photo       TEXT;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS color       TEXT NOT NULL DEFAULT '#0b5d3b';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS access_hash TEXT;

INSERT INTO settings (key, value) VALUES ('bid_timer_seconds', '20') ON CONFLICT (key) DO NOTHING;

-- single-row state machine for the live auction
CREATE TABLE IF NOT EXISTS auction_state (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status              TEXT NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE','BIDDING','PAUSED')),
  player_id           INTEGER REFERENCES players(id),
  current_price_lakh  INTEGER,
  leading_team_id     INTEGER REFERENCES teams(id),
  timer_ends_at       TIMESTAMPTZ,
  paused_remaining_ms INTEGER,
  last_result         JSONB,
  version             INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO auction_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bids (
  id         SERIAL PRIMARY KEY,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  team_id    INTEGER NOT NULL REFERENCES teams(id),
  price_lakh INTEGER NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bids_player ON bids (player_id, id DESC);
