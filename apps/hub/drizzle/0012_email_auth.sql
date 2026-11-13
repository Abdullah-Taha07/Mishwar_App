CREATE TABLE IF NOT EXISTS email_auth_tokens (id TEXT PRIMARY KEY, role TEXT NOT NULL, actor TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')), token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, consumed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_email_auth_actor ON email_auth_tokens(role,actor,purpose,expires_at);
CREATE TABLE IF NOT EXISTS verified_emails (role TEXT NOT NULL, actor TEXT NOT NULL, email TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY(role,actor));
