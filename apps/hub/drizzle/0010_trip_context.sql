CREATE TABLE trip_context (
 trip_id TEXT PRIMARY KEY NOT NULL REFERENCES trips(id),
 arrival_note TEXT NOT NULL DEFAULT '',
 cancel_reason TEXT,
 cancel_detail TEXT,
 cancelled_by TEXT,
 cancelled_at TEXT
);
