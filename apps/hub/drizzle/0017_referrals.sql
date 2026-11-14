CREATE TABLE referral_codes(rider_id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE referral_links(invitee_id TEXT PRIMARY KEY,inviter_id TEXT NOT NULL,code TEXT NOT NULL,reward_halalas INTEGER NOT NULL,created_at TEXT NOT NULL,CHECK(invitee_id<>inviter_id));
--> statement-breakpoint
CREATE TABLE referral_rewards(invitee_id TEXT PRIMARY KEY,trip_id TEXT NOT NULL UNIQUE,amount_halalas INTEGER NOT NULL,created_at TEXT NOT NULL);
