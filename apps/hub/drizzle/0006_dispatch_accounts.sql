ALTER TABLE captain_presence ADD COLUMN latitude REAL;
--> statement-breakpoint
ALTER TABLE captain_presence ADD COLUMN longitude REAL;
--> statement-breakpoint
ALTER TABLE captain_presence ADD COLUMN accuracy REAL;
--> statement-breakpoint
ALTER TABLE captain_presence ADD COLUMN location_at TEXT;
--> statement-breakpoint
CREATE TABLE dispatch_offers(trip_id TEXT PRIMARY KEY NOT NULL,captain_id TEXT NOT NULL UNIQUE,offered_at TEXT NOT NULL,expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE dispatch_attempts(trip_id TEXT NOT NULL,captain_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(trip_id,captain_id));
--> statement-breakpoint
CREATE TABLE public_accounts(role TEXT NOT NULL,phone TEXT NOT NULL,actor TEXT NOT NULL UNIQUE,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',salt TEXT NOT NULL,password_hash TEXT NOT NULL,phone_verified_at TEXT,verification_method TEXT,created_at TEXT NOT NULL,PRIMARY KEY(role,phone));
--> statement-breakpoint
CREATE TABLE public_sessions(token_hash TEXT PRIMARY KEY NOT NULL,actor TEXT NOT NULL,role TEXT NOT NULL,expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE access_rate_limits(bucket TEXT PRIMARY KEY NOT NULL,n INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE driver_payment_intents(id TEXT PRIMARY KEY NOT NULL,captain_id TEXT NOT NULL,method TEXT NOT NULL,amount_halalas INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',provider_id TEXT UNIQUE,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER enforce_driver_accept BEFORE UPDATE OF driver_id ON trips WHEN NEW.driver_id IS NOT NULL AND NEW.driver_id IS NOT OLD.driver_id AND NEW.status='arriving' AND NEW.is_demo=0 BEGIN SELECT CASE WHEN COALESCE((SELECT balance_halalas FROM wallet_accounts WHERE account_id='captain:'||NEW.driver_id),0)<0 THEN RAISE(ABORT,'NEGATIVE_DRIVER_BALANCE') END; SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dispatch_offers WHERE trip_id=NEW.id AND captain_id=NEW.driver_id AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN RAISE(ABORT,'OFFER_EXPIRED') END; END;
