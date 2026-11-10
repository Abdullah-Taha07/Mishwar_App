CREATE TABLE captain_reviews (
 application_id TEXT PRIMARY KEY NOT NULL REFERENCES captain_applications(id),
 reviewer_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK (decision IN ('active','rejected')),
 reason TEXT NOT NULL DEFAULT '',
 reviewed_documents_json TEXT NOT NULL,
 reviewed_at TEXT NOT NULL
);
