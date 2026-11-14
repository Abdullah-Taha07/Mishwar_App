CREATE TABLE admin_members(email TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('support','accountant','operations')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE operating_cities(id TEXT PRIMARY KEY,name_ar TEXT NOT NULL,name_en TEXT NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,radius_km REAL NOT NULL,active INTEGER NOT NULL DEFAULT 0,base_halalas INTEGER NOT NULL DEFAULT 300,per_km_halalas INTEGER NOT NULL DEFAULT 90,per_min_halalas INTEGER NOT NULL DEFAULT 10,minimum_halalas INTEGER NOT NULL DEFAULT 1000,commission_bps INTEGER,surge_enabled INTEGER NOT NULL DEFAULT 0,surge_cap_bps INTEGER NOT NULL DEFAULT 15000,updated_at TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO operating_cities VALUES('riyadh','الرياض','Riyadh',24.7136,46.6753,70,1,300,90,10,1000,NULL,0,15000,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
CREATE TABLE smart_pickups(id TEXT PRIMARY KEY,city_id TEXT NOT NULL REFERENCES operating_cities(id),name TEXT NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,instructions TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE quote_market(quote_id TEXT PRIMARY KEY,city_id TEXT NOT NULL,multiplier_bps INTEGER NOT NULL,demand INTEGER NOT NULL,supply INTEGER NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE fraud_signals(id TEXT PRIMARY KEY,captain_id TEXT NOT NULL,kind TEXT NOT NULL,details_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE recovery_claims(recovery_id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
