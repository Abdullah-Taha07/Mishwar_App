CREATE TABLE captain_applications (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL UNIQUE,
 phone TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL,
 personal_json TEXT NOT NULL,
 vehicle_json TEXT NOT NULL,
 documents_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected')),
 submitted_at TEXT NOT NULL,
 reviewed_at TEXT
);
