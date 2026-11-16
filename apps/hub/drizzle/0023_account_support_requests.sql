-- Reuse the existing support desk for account-level and trip-linked cases.
-- D1 applies migrations transactionally with foreign keys enabled. Keep the
-- child table until its data is copied, then drop the OLD child before parent.
-- Do not turn deferred checks OFF: the transaction must validate at commit.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE service_cases_next(id TEXT PRIMARY KEY,trip_id TEXT REFERENCES trips(id),role TEXT NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',assigned_to TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE case_messages_next(id INTEGER PRIMARY KEY AUTOINCREMENT,case_id TEXT NOT NULL REFERENCES service_cases_next(id),role TEXT NOT NULL,sender_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,client_request_id TEXT);
INSERT INTO service_cases_next SELECT id,trip_id,role,owner_id,kind,description,status,assigned_to,created_at,updated_at FROM service_cases;
INSERT INTO case_messages_next(id,case_id,role,sender_id,body,created_at) SELECT id,case_id,role,sender_id,body,created_at FROM case_messages;

-- Preserve the AUTOINCREMENT high-water even when its highest rows were deleted.
INSERT INTO sqlite_sequence(name,seq) SELECT 'case_messages_next',seq FROM sqlite_sequence WHERE name='case_messages' AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='case_messages_next');
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='case_messages'),0)) WHERE name='case_messages_next';

DROP TABLE case_messages;
DROP TABLE service_cases;
ALTER TABLE service_cases_next RENAME TO service_cases;
ALTER TABLE case_messages_next RENAME TO case_messages;
CREATE INDEX service_cases_owner_created ON service_cases(role,owner_id,created_at);
CREATE INDEX case_messages_cursor ON case_messages(case_id,id);
CREATE UNIQUE INDEX case_messages_client_request ON case_messages(case_id,role,sender_id,client_request_id) WHERE client_request_id IS NOT NULL;

ALTER TABLE trip_messages ADD COLUMN client_request_id TEXT;
CREATE UNIQUE INDEX trip_messages_client_request ON trip_messages(trip_id,role,sender_id,client_request_id) WHERE client_request_id IS NOT NULL;
