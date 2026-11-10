CREATE TABLE account_controls (role TEXT NOT NULL, account_id TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(role,account_id));
--> statement-breakpoint
CREATE TABLE ride_quotes (id TEXT PRIMARY KEY NOT NULL, rider_id TEXT NOT NULL, pickup_json TEXT NOT NULL, destination_json TEXT NOT NULL, category TEXT NOT NULL, fare_halalas INTEGER NOT NULL, discount_halalas INTEGER NOT NULL DEFAULT 0, coupon TEXT, commission_bps INTEGER NOT NULL, expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE trip_commerce (trip_id TEXT PRIMARY KEY NOT NULL REFERENCES trips(id), quote_id TEXT NOT NULL UNIQUE, method TEXT NOT NULL, discount_halalas INTEGER NOT NULL DEFAULT 0, cash_due_halalas INTEGER NOT NULL DEFAULT 0, coupon TEXT);
--> statement-breakpoint
CREATE UNIQUE INDEX one_live_trip_per_rider ON trips(rider_id) WHERE is_demo=0 AND status IN ('matching','arriving','arrived','riding');
--> statement-breakpoint
CREATE UNIQUE INDEX one_trip_per_driver ON trips(driver_id) WHERE driver_id IS NOT NULL AND status IN ('arriving','arrived','riding');
--> statement-breakpoint
CREATE TABLE wallet_accounts (account_id TEXT PRIMARY KEY NOT NULL, balance_halalas INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE wallet_entries (id TEXT PRIMARY KEY NOT NULL, transaction_id TEXT NOT NULL, account_id TEXT NOT NULL, amount_halalas INTEGER NOT NULL, enforce_funds INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL, reference TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(transaction_id,account_id));
--> statement-breakpoint
CREATE TRIGGER wallet_funds BEFORE INSERT ON wallet_entries WHEN NEW.enforce_funds=1 AND COALESCE((SELECT balance_halalas FROM wallet_accounts WHERE account_id=NEW.account_id),0)+NEW.amount_halalas<0 BEGIN SELECT RAISE(ABORT,'INSUFFICIENT_FUNDS'); END;
--> statement-breakpoint
CREATE TRIGGER wallet_balance AFTER INSERT ON wallet_entries BEGIN INSERT INTO wallet_accounts(account_id,balance_halalas) VALUES(NEW.account_id,NEW.amount_halalas) ON CONFLICT(account_id) DO UPDATE SET balance_halalas=balance_halalas+NEW.amount_halalas; END;
--> statement-breakpoint
CREATE TABLE trip_settlements (trip_id TEXT PRIMARY KEY NOT NULL, operation TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER settlement_state BEFORE INSERT ON trip_settlements WHEN (NEW.operation='cancel' AND (SELECT status FROM trips WHERE id=NEW.trip_id) NOT IN ('matching','arriving','arrived')) OR (NEW.operation='complete' AND (SELECT status FROM trips WHERE id=NEW.trip_id)<>'riding') BEGIN SELECT RAISE(ABORT,'TRIP_STATE_CHANGED'); END;
--> statement-breakpoint
CREATE TABLE coupons (code TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, value INTEGER NOT NULL, max_uses INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE coupon_redemptions (code TEXT NOT NULL REFERENCES coupons(code), rider_id TEXT NOT NULL, trip_id TEXT NOT NULL UNIQUE, PRIMARY KEY(code,rider_id));
--> statement-breakpoint
CREATE TRIGGER coupon_limit BEFORE INSERT ON coupon_redemptions WHEN NOT EXISTS(SELECT 1 FROM coupons WHERE code=NEW.code AND active=1 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (SELECT count(*) FROM coupon_redemptions WHERE code=NEW.code)>=(SELECT max_uses FROM coupons WHERE code=NEW.code) BEGIN SELECT RAISE(ABORT,'COUPON_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TABLE payout_destinations (id TEXT PRIMARY KEY NOT NULL, captain_id TEXT NOT NULL, method TEXT NOT NULL, holder_name TEXT NOT NULL, account_value TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE withdrawal_requests (id TEXT PRIMARY KEY NOT NULL, captain_id TEXT NOT NULL, destination_id TEXT NOT NULL, destination_json TEXT NOT NULL, amount_halalas INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', transfer_reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, reviewed_at TEXT);
--> statement-breakpoint
CREATE TABLE withdrawal_decisions (request_id TEXT PRIMARY KEY NOT NULL REFERENCES withdrawal_requests(id), decision TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE payment_intents (id TEXT PRIMARY KEY NOT NULL, rider_id TEXT NOT NULL, quote_id TEXT, purpose TEXT NOT NULL, method TEXT NOT NULL, amount_halalas INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', provider_id TEXT UNIQUE, used_trip_id TEXT UNIQUE, created_at TEXT NOT NULL);
