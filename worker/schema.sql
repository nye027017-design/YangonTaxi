-- Win Go Demo — D1 schema
-- Run: wrangler d1 execute wingo-demo-db --file=./schema.sql          (cloud)
--      wrangler d1 execute wingo-demo-db --local --file=./schema.sql  (local)

PRAGMA foreign_keys = ON;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id   TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  avatar      TEXT,
  balance     INTEGER NOT NULL DEFAULT 10000,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------- rounds ----------
CREATE TABLE IF NOT EXISTS rounds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  round_no       TEXT NOT NULL UNIQUE,           -- e.g. 20261125010001
  duration       INTEGER NOT NULL CHECK (duration IN (1, 3, 5)),
  start_time     INTEGER NOT NULL,               -- unix seconds
  end_time       INTEGER NOT NULL,
  result_number  INTEGER CHECK (result_number BETWEEN 0 AND 9),
  result_color   TEXT,                           -- green | red | green+violet | red+violet
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'result')),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_rounds_duration_start ON rounds (duration, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds (status);

-- ---------- bets ----------
CREATE TABLE IF NOT EXISTS bets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id),
  round_id    INTEGER NOT NULL REFERENCES rounds (id),
  bet_type    TEXT NOT NULL CHECK (bet_type IN ('green', 'red', 'violet', 'number', 'big', 'small', 'odd', 'even')),
  bet_value   INTEGER CHECK (bet_value BETWEEN 0 AND 9),   -- number bet အတွက်သာ
  amount      INTEGER NOT NULL CHECK (amount > 0),
  payout      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_round ON bets (round_id);

-- ---------- transactions ----------
CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users (id),
  type           TEXT NOT NULL CHECK (type IN ('bet', 'payout', 'reset', 'deposit')),
  amount         INTEGER NOT NULL,               -- bet = အနှုတ်၊ payout/deposit = အပေါင်း
  balance_after  INTEGER NOT NULL,
  ref_id         INTEGER,                        -- bet id / round id
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions (user_id, created_at DESC);

-- ---------- admin_overrides ----------
CREATE TABLE IF NOT EXISTS admin_overrides (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id       INTEGER NOT NULL REFERENCES rounds (id),
  forced_number  INTEGER NOT NULL CHECK (forced_number BETWEEN 0 AND 9),
  created_by     INTEGER NOT NULL REFERENCES users (id),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_override_round ON admin_overrides (round_id);

-- ---------- settings ----------
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Default settings (သတ်မှတ်ချက်အတိုင်း)
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('start_balance',   '10000'),
  ('bet_min',         '10'),
  ('bet_max',         '1000'),
  ('max_bets_per_round', '3'),
  ('lock_seconds',    '5'),
  ('break_seconds',   '5'),
  ('payout_green',    '2'),
  ('payout_red',      '2'),
  ('payout_violet',   '4.5'),
  ('payout_number',   '9'),
  ('payout_big',      '2'),
  ('payout_small',    '2'),
  ('payout_odd',      '2'),
  ('payout_even',     '2');
