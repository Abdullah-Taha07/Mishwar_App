ALTER TABLE ride_quotes ADD COLUMN route_json TEXT;
--> statement-breakpoint
CREATE TABLE road_route_cache(cache_key TEXT PRIMARY KEY NOT NULL,route_json TEXT NOT NULL,expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE route_rate_limits(bucket TEXT PRIMARY KEY NOT NULL,n INTEGER NOT NULL);
