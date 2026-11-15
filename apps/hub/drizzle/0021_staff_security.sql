-- Additive only. Apply locally first; never run remotely during development.
CREATE TABLE staff_accounts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 role TEXT NOT NULL, password_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','rejected','suspended')),
 permissions TEXT NOT NULL DEFAULT '[]', policy TEXT NOT NULL DEFAULT 'device' CHECK(policy IN ('device','always','account')),
 max_seconds INTEGER NOT NULL DEFAULT 14400 CHECK(max_seconds BETWEEN 3600 AND 28800),
 idle_seconds INTEGER NOT NULL DEFAULT 900 CHECK(idle_seconds BETWEEN 600 AND 1800),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE staff_devices (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_accounts(id), approved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE TABLE staff_sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_accounts(id), device_hash TEXT, version INTEGER NOT NULL, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_activity INTEGER NOT NULL, revoked_at INTEGER, agent TEXT NOT NULL);
CREATE INDEX staff_sessions_employee ON staff_sessions(staff_id, expires_at);
CREATE TABLE staff_approvals (id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_accounts(id), kind TEXT NOT NULL CHECK(kind IN ('login','operation')), challenge_hash TEXT, device_hash TEXT, fingerprint TEXT, summary TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','consumed')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, approved_by TEXT, approved_at INTEGER);
CREATE INDEX staff_approval_pending ON staff_approvals(status,expires_at);
CREATE TABLE staff_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, section TEXT NOT NULL, result TEXT NOT NULL, reference TEXT, approver TEXT, created_at INTEGER NOT NULL);
CREATE INDEX staff_audit_time ON staff_audit(created_at);
CREATE TABLE staff_login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
