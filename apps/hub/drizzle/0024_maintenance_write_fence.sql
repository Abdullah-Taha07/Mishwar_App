-- This migration is required before deploying the maintenance-aware Worker.
-- It changes no business rows. Missing control schema fails closed at runtime.
CREATE TABLE maintenance_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  mode TEXT NOT NULL CHECK(mode IN ('open','draining','frozen','validating')),
  epoch INTEGER NOT NULL CHECK(epoch>0),
  updated_at TEXT NOT NULL
);
INSERT INTO maintenance_state VALUES(1,'open',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Leases deliberately have no automatic expiry: a lost isolate cannot prove
-- that a provider or R2 request stopped. An unresolved lease blocks freezing.
CREATE TABLE maintenance_leases (
  id TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('request','scheduled')),
  started_at TEXT NOT NULL
);
CREATE TABLE maintenance_effects (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','settled','unknown','resolved')),
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX maintenance_effects_pending ON maintenance_effects(state);
CREATE TABLE maintenance_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_mode TEXT NOT NULL,
  to_mode TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE TABLE maintenance_write_fences (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  epoch INTEGER NOT NULL
);
CREATE TRIGGER maintenance_require_current_lease BEFORE INSERT ON maintenance_write_fences BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM maintenance_state s JOIN maintenance_leases l
      ON l.epoch=s.epoch
    WHERE s.id=1 AND s.mode IN ('open','draining')
      AND l.id=NEW.lease_id AND l.epoch=NEW.epoch
  ) THEN RAISE(ABORT,'MAINTENANCE_WRITE_FENCED') END;
END;
CREATE TRIGGER maintenance_transition_record AFTER UPDATE ON maintenance_state BEGIN
  INSERT INTO maintenance_transitions(from_mode,to_mode,epoch,changed_at)
    VALUES(OLD.mode,NEW.mode,NEW.epoch,NEW.updated_at);
END;

-- State changes are operator actions, never exposed as an HTTP endpoint.
-- A drain stops new admission; admitted work may finish. A freeze requires
-- durable proof that no admitted/uncertain work or live business remains.
CREATE TRIGGER maintenance_state_transition BEFORE UPDATE ON maintenance_state BEGIN
  SELECT CASE WHEN NOT (
    (OLD.mode='open' AND NEW.mode='draining' AND NEW.epoch=OLD.epoch) OR
    (OLD.mode='draining' AND NEW.mode='open' AND NEW.epoch=OLD.epoch) OR
    (OLD.mode='draining' AND NEW.mode='frozen' AND NEW.epoch=OLD.epoch+1) OR
    (OLD.mode='frozen' AND NEW.mode='validating' AND NEW.epoch=OLD.epoch) OR
    (OLD.mode='validating' AND NEW.mode='frozen' AND NEW.epoch=OLD.epoch) OR
    (OLD.mode IN ('frozen','validating') AND NEW.mode='open' AND NEW.epoch=OLD.epoch+1)
  ) THEN RAISE(ABORT,'MAINTENANCE_INVALID_TRANSITION') END;
  -- This is a strict HTTP admission drain, not a selective booking pause.
  -- Existing journeys needing later HTTP calls must finish before starting it.
  SELECT CASE WHEN NEW.mode='draining' AND (
    EXISTS(SELECT 1 FROM trips WHERE is_demo=0 AND status IN ('matching','arriving','arrived','riding')) OR
    EXISTS(SELECT 1 FROM payment_intents WHERE status='pending') OR
    EXISTS(SELECT 1 FROM driver_payment_intents WHERE status='pending') OR
    EXISTS(SELECT 1 FROM refund_requests WHERE status IN ('requested','submitted_unknown')) OR
    EXISTS(SELECT 1 FROM withdrawal_requests WHERE status='pending') OR
    EXISTS(SELECT 1 FROM reservations WHERE status IN ('scheduled','dispatching'))
  ) THEN RAISE(ABORT,'MAINTENANCE_DRAIN_NOT_EMPTY') END;
  SELECT CASE WHEN NEW.mode='frozen' AND (
    EXISTS(SELECT 1 FROM maintenance_leases) OR
    EXISTS(SELECT 1 FROM maintenance_write_fences) OR
    EXISTS(SELECT 1 FROM maintenance_effects WHERE state IN ('pending','unknown')) OR
    EXISTS(SELECT 1 FROM trips WHERE is_demo=0 AND status IN ('matching','arriving','arrived','riding')) OR
    EXISTS(SELECT 1 FROM payment_intents WHERE status='pending') OR
    EXISTS(SELECT 1 FROM driver_payment_intents WHERE status='pending') OR
    EXISTS(SELECT 1 FROM refund_requests WHERE status IN ('requested','submitted_unknown')) OR
    EXISTS(SELECT 1 FROM withdrawal_requests WHERE status='pending') OR
    EXISTS(SELECT 1 FROM reservations WHERE status IN ('scheduled','dispatching'))
  ) THEN RAISE(ABORT,'MAINTENANCE_DRAIN_NOT_EMPTY') END;
END;
