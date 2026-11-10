CREATE TABLE riders (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, last_seen TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE trips (id TEXT PRIMARY KEY NOT NULL, rider_id TEXT NOT NULL REFERENCES riders(id), driver_id TEXT, status TEXT NOT NULL, pickup_json TEXT NOT NULL, destination_json TEXT NOT NULL, fare_halalas INTEGER NOT NULL DEFAULT 0, commission_bps INTEGER NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'demo', is_demo INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX trips_rider ON trips(rider_id, created_at);
--> statement-breakpoint
CREATE INDEX trips_status ON trips(status, updated_at);
--> statement-breakpoint
CREATE TABLE captain_presence (application_id TEXT PRIMARY KEY NOT NULL REFERENCES captain_applications(id), available INTEGER NOT NULL DEFAULT 0, last_seen TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE operation_events (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT NOT NULL, entity_id TEXT, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX events_time ON operation_events(created_at);
--> statement-breakpoint
CREATE TABLE platform_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE support_tickets (id TEXT PRIMARY KEY NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
