CREATE TABLE account_recovery(id TEXT PRIMARY KEY,role TEXT NOT NULL,actor TEXT,phone TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,code_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,expires_at TEXT NOT NULL,approved_at TEXT,consumed_at TEXT);
--> statement-breakpoint
CREATE TRIGGER recovery_consume BEFORE UPDATE OF consumed_at ON account_recovery WHEN NEW.consumed_at IS NOT NULL BEGIN SELECT CASE WHEN OLD.consumed_at IS NOT NULL OR OLD.status<>'approved' OR OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN RAISE(ABORT,'RECOVERY_EXPIRED') END; END;
--> statement-breakpoint
CREATE TABLE negotiated_quotes(quote_id TEXT PRIMARY KEY REFERENCES ride_quotes(id),minimum_halalas INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE trip_negotiations(trip_id TEXT PRIMARY KEY REFERENCES trips(id),minimum_halalas INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE fare_counters(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),captain_id TEXT NOT NULL,amount_halalas INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,expires_at TEXT NOT NULL,UNIQUE(trip_id,captain_id));
--> statement-breakpoint
CREATE TRIGGER counter_accept_guard BEFORE UPDATE OF status ON fare_counters WHEN NEW.status='accepted' BEGIN SELECT CASE WHEN OLD.status<>'pending' OR OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM trips t JOIN dispatch_offers o ON o.trip_id=t.id WHERE t.id=OLD.trip_id AND t.status='matching' AND t.driver_id IS NULL AND o.captain_id=OLD.captain_id AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN RAISE(ABORT,'COUNTER_EXPIRED') END; END;
--> statement-breakpoint
CREATE TABLE trip_safety(trip_id TEXT PRIMARY KEY REFERENCES trips(id),start_pin TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_attempt TEXT);
--> statement-breakpoint
CREATE TABLE trip_ratings(trip_id TEXT NOT NULL REFERENCES trips(id),role TEXT NOT NULL,score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),comment TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(trip_id,role));

--> statement-breakpoint
CREATE TRIGGER counter_driver_eligible BEFORE UPDATE OF status ON fare_counters WHEN NEW.status='accepted' BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM captain_applications a JOIN captain_presence p ON p.application_id=a.id WHERE a.id=OLD.captain_id AND a.status='active' AND p.available=1 AND p.accuracy<=150 AND p.location_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes') AND COALESCE((SELECT balance_halalas FROM wallet_accounts WHERE account_id='captain:'||a.id),0)>=0 AND NOT EXISTS(SELECT 1 FROM account_controls co WHERE co.role='captain' AND co.account_id=a.id AND co.suspended=1) AND NOT EXISTS(SELECT 1 FROM trips t WHERE t.driver_id=a.id AND t.status IN ('arriving','arrived','riding'))) THEN RAISE(ABORT,'CAPTAIN_UNAVAILABLE') END; END;
