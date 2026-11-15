ALTER TABLE document_renewals ADD COLUMN reviewed_by TEXT;
--> statement-breakpoint
CREATE TABLE document_review_history (
 id TEXT PRIMARY KEY,
 renewal_id TEXT NOT NULL UNIQUE REFERENCES document_renewals(id),
 captain_id TEXT NOT NULL REFERENCES captain_applications(id),
 kind TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
 reason TEXT NOT NULL,
 reviewer_id TEXT NOT NULL,
 reviewed_at TEXT NOT NULL,
 previous_document_json TEXT,
 previous_expiry TEXT,
 replacement_document_json TEXT NOT NULL,
 replacement_expiry TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX document_history_captain ON document_review_history(captain_id,reviewed_at);
