CREATE TABLE trip_expiry_claims(trip_id TEXT PRIMARY KEY NOT NULL REFERENCES trips(id),created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER validate_matching_expiry BEFORE INSERT ON trip_expiry_claims BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trips WHERE id=NEW.trip_id AND status='matching' AND is_demo=0 AND julianday(created_at)<=julianday('now','-3 minutes')) THEN RAISE(ABORT,'REQUEST_NOT_EXPIRED') END; END;
--> statement-breakpoint
CREATE TRIGGER reject_expired_accept BEFORE UPDATE OF driver_id ON trips WHEN NEW.driver_id IS NOT NULL AND NEW.driver_id IS NOT OLD.driver_id AND NEW.status='arriving' AND NEW.is_demo=0 BEGIN SELECT CASE WHEN julianday(OLD.created_at)<=julianday('now','-3 minutes') OR EXISTS(SELECT 1 FROM trip_expiry_claims WHERE trip_id=OLD.id) THEN RAISE(ABORT,'REQUEST_EXPIRED') END; END;
--> statement-breakpoint
CREATE TRIGGER unique_account_email_insert BEFORE INSERT ON public_accounts WHEN trim(NEW.email)<>'' BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM public_accounts WHERE role=NEW.role AND lower(trim(email))=lower(trim(NEW.email))) THEN RAISE(ABORT,'ACCOUNT_EMAIL_EXISTS') END; END;
--> statement-breakpoint
CREATE TRIGGER unique_account_email_update BEFORE UPDATE OF email ON public_accounts WHEN trim(NEW.email)<>'' AND lower(trim(NEW.email))<>lower(trim(OLD.email)) BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM public_accounts WHERE role=NEW.role AND actor<>OLD.actor AND lower(trim(email))=lower(trim(NEW.email))) THEN RAISE(ABORT,'ACCOUNT_EMAIL_EXISTS') END; END;
--> statement-breakpoint
CREATE TRIGGER unique_captain_email_insert BEFORE INSERT ON captain_applications WHEN trim(NEW.email)<>'' BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM captain_applications WHERE lower(trim(email))=lower(trim(NEW.email))) THEN RAISE(ABORT,'CAPTAIN_EMAIL_EXISTS') END; END;
