CREATE TABLE rider_phone_accounts (phone TEXT PRIMARY KEY NOT NULL, actor TEXT NOT NULL UNIQUE, verified_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE phone_challenges (id TEXT PRIMARY KEY NOT NULL, phone TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', platform_actor TEXT NOT NULL DEFAULT '', ip_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX phone_rate ON phone_challenges(phone,created_at);
--> statement-breakpoint
CREATE INDEX phone_ip_rate ON phone_challenges(ip_hash,created_at);
--> statement-breakpoint
CREATE TABLE rider_sessions (token_hash TEXT PRIMARY KEY NOT NULL, actor TEXT NOT NULL, phone TEXT NOT NULL, expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE push_subscriptions (endpoint_hash TEXT PRIMARY KEY NOT NULL, endpoint TEXT NOT NULL, role TEXT NOT NULL, actor_id TEXT NOT NULL, session_hash TEXT, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX push_actor ON push_subscriptions(role,actor_id);
--> statement-breakpoint
CREATE TABLE app_notifications (id TEXT PRIMARY KEY NOT NULL, role TEXT NOT NULL, actor_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
--> statement-breakpoint
CREATE INDEX notifications_actor ON app_notifications(role,actor_id,created_at);
--> statement-breakpoint
CREATE TABLE phone_challenge_uses (challenge_id TEXT PRIMARY KEY NOT NULL);
--> statement-breakpoint
CREATE TRIGGER otp_rate_limit BEFORE INSERT ON phone_challenges WHEN EXISTS(SELECT 1 FROM phone_challenges WHERE phone=NEW.phone AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds')) OR (SELECT count(*) FROM phone_challenges WHERE phone=NEW.phone AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=5 OR (SELECT count(*) FROM phone_challenges WHERE ip_hash=NEW.ip_hash AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=20 BEGIN SELECT RAISE(ABORT,'RATE_LIMIT'); END;
