CREATE TABLE account_changes(id TEXT PRIMARY KEY,role TEXT NOT NULL,actor TEXT NOT NULL,session_hash TEXT NOT NULL,kind TEXT NOT NULL,old_phone TEXT NOT NULL,new_value TEXT NOT NULL DEFAULT '',new_salt TEXT,new_hash TEXT,old_hash TEXT NOT NULL,stage TEXT NOT NULL DEFAULT 'old',mode TEXT NOT NULL DEFAULT 'manual',attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT);
--> statement-breakpoint
CREATE INDEX account_changes_owner ON account_changes(actor,role,created_at);
--> statement-breakpoint
CREATE TRIGGER account_change_consume BEFORE UPDATE OF consumed_at ON account_changes WHEN NEW.consumed_at IS NOT NULL BEGIN SELECT CASE WHEN OLD.consumed_at IS NOT NULL OR OLD.stage<>'approved' OR OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM public_accounts a WHERE a.actor=OLD.actor AND a.role=OLD.role AND a.phone=OLD.old_phone AND a.password_hash=OLD.old_hash) THEN RAISE(ABORT,'CHANGE_EXPIRED') END; END;
--> statement-breakpoint
CREATE TABLE recharge_cards(id TEXT PRIMARY KEY,code_hash TEXT NOT NULL UNIQUE,last_four TEXT NOT NULL,amount_halalas INTEGER NOT NULL CHECK(amount_halalas BETWEEN 100 AND 100000),role TEXT NOT NULL CHECK(role IN ('rider','captain','either')),created_at TEXT NOT NULL,expires_at TEXT NOT NULL,created_by TEXT NOT NULL,redeemed_by TEXT,redeemed_at TEXT);
--> statement-breakpoint
CREATE TRIGGER recharge_once BEFORE UPDATE OF redeemed_by ON recharge_cards WHEN NEW.redeemed_by IS NOT NULL BEGIN SELECT CASE WHEN OLD.redeemed_by IS NOT NULL OR OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN RAISE(ABORT,'RECHARGE_UNAVAILABLE') END; END;
