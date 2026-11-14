CREATE TABLE document_renewals(id TEXT PRIMARY KEY,captain_id TEXT NOT NULL REFERENCES captain_applications(id),kind TEXT NOT NULL,expires_at TEXT NOT NULL,object_key TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,reviewed_at TEXT);
--> statement-breakpoint
CREATE UNIQUE INDEX one_pending_renewal ON document_renewals(captain_id,kind) WHERE status='pending';
