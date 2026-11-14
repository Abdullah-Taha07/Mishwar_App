CREATE UNIQUE INDEX one_refund_per_payment ON refund_requests(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE refund_claims(request_id TEXT PRIMARY KEY REFERENCES refund_requests(id),claimed_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE native_device_tokens(token_hash TEXT PRIMARY KEY,token TEXT NOT NULL,role TEXT NOT NULL,actor_id TEXT NOT NULL,platform TEXT NOT NULL,session_hash TEXT NOT NULL,created_at TEXT NOT NULL);
