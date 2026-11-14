CREATE TABLE trip_options(trip_id TEXT PRIMARY KEY REFERENCES trips(id),stops_json TEXT NOT NULL DEFAULT '[]',guest_name TEXT NOT NULL DEFAULT '',business_note TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE quote_options(quote_id TEXT PRIMARY KEY REFERENCES ride_quotes(id),stops_json TEXT NOT NULL DEFAULT '[]',guest_name TEXT NOT NULL DEFAULT '',business_note TEXT NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE TABLE trip_shares(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),owner_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE trusted_contacts(id TEXT PRIMARY KEY,role TEXT NOT NULL,owner_id TEXT NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(role,owner_id,phone));
--> statement-breakpoint
CREATE TABLE safety_incidents(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),role TEXT NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE trip_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,trip_id TEXT NOT NULL REFERENCES trips(id),role TEXT NOT NULL,sender_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX trip_messages_cursor ON trip_messages(trip_id,id);
--> statement-breakpoint
CREATE TABLE service_cases(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),role TEXT NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',assigned_to TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE case_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,case_id TEXT NOT NULL REFERENCES service_cases(id),role TEXT NOT NULL,sender_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE reservations(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES riders(id),quote_id TEXT NOT NULL UNIQUE REFERENCES ride_quotes(id),pickup_at TEXT NOT NULL,dispatch_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',trip_id TEXT UNIQUE,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE reservation_claims(reservation_id TEXT PRIMARY KEY REFERENCES reservations(id),claimed_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE trip_receipts(trip_id TEXT PRIMARY KEY REFERENCES trips(id),receipt_number TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE refund_requests(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL,amount_halalas INTEGER NOT NULL CHECK(amount_halalas>0),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'requested',provider_payment_id TEXT,provider_response_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE refund_entries(request_id TEXT PRIMARY KEY REFERENCES refund_requests(id),wallet_tx TEXT NOT NULL UNIQUE);
--> statement-breakpoint
CREATE TABLE ops_checks(key TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('pending','verified','blocked')),note TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL DEFAULT '',verified_by TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE job_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE backup_runs(id TEXT PRIMARY KEY,object_key TEXT NOT NULL,status TEXT NOT NULL,table_counts_json TEXT NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE request_metrics(id TEXT PRIMARY KEY,path TEXT NOT NULL,status INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX request_metrics_at ON request_metrics(created_at);
--> statement-breakpoint
CREATE TRIGGER reservation_status_guard BEFORE UPDATE OF status ON reservations WHEN NEW.status='dispatching' BEGIN SELECT CASE WHEN OLD.status<>'scheduled' THEN RAISE(ABORT,'RESERVATION_CLAIMED') END; END;
