CREATE TABLE IF NOT EXISTS public_phone_otp (
 id TEXT PRIMARY KEY, role TEXT NOT NULL, actor TEXT NOT NULL, phone TEXT NOT NULL,
 session_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_public_phone_otp_actor ON public_phone_otp(role,actor,created_at);
