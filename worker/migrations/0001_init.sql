CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','driver','admin')),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_profile ON sessions(profile_id);

CREATE TABLE drivers (
  profile_id INTEGER PRIMARY KEY REFERENCES profiles(id),
  vehicle_type TEXT,
  plate TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  is_online INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  location_updated_at INTEGER,
  owed_amount INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_drivers_online ON drivers(is_online, status, lat, lng);

CREATE TABLE fare_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_type TEXT NOT NULL,
  base_fare INTEGER NOT NULL,
  per_km INTEGER NOT NULL,
  commission_percent INTEGER NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO fare_rules (vehicle_type, base_fare, per_km, commission_percent)
VALUES ('taxi', 1500, 800, 10), ('bike', 800, 400, 10);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES profiles(id),
  driver_id INTEGER REFERENCES profiles(id),
  vehicle_type TEXT NOT NULL,
  pickup_lat REAL NOT NULL, pickup_lng REAL NOT NULL, pickup_text TEXT,
  drop_lat REAL NOT NULL, drop_lng REAL NOT NULL, drop_text TEXT,
  distance_km REAL,
  fare_estimate INTEGER,
  fare_final INTEGER,
  commission INTEGER,
  status TEXT NOT NULL DEFAULT 'searching'
    CHECK (status IN ('searching','driver_assigned','arrived','in_trip','completed','cancelled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_driver ON bookings(driver_id);

CREATE TABLE booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  event TEXT NOT NULL,
  actor_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_events_booking ON booking_events(booking_id);
