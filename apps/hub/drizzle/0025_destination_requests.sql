-- Local RDEV-004 schema. Quotes and consent are immutable business evidence;
-- applying a captain decision, cash total and audit record is one SQLite write.
CREATE TABLE trip_destination_changes (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  rider_id TEXT NOT NULL,
  captain_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('quoted','pending','accepted','rejected','withdrawn','expired','invalidated')),
  pickup_json TEXT NOT NULL,
  old_destination_json TEXT NOT NULL,
  destination_json TEXT NOT NULL,
  old_fare_halalas INTEGER NOT NULL,
  new_fare_halalas INTEGER NOT NULL CHECK(new_fare_halalas BETWEEN 1000 AND 10000000),
  old_cash_due_halalas INTEGER NOT NULL,
  new_cash_due_halalas INTEGER NOT NULL CHECK(new_cash_due_halalas=new_fare_halalas),
  old_quote_id TEXT NOT NULL,
  quote_id TEXT NOT NULL UNIQUE REFERENCES ride_quotes(id),
  route_json TEXT NOT NULL,
  category TEXT NOT NULL,
  commission_bps INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consented_at TEXT,
  decided_at TEXT
);
CREATE INDEX destination_changes_trip ON trip_destination_changes(trip_id,created_at);
CREATE UNIQUE INDEX one_open_destination_change ON trip_destination_changes(trip_id) WHERE status IN ('quoted','pending');

CREATE TRIGGER destination_change_insert BEFORE INSERT ON trip_destination_changes BEGIN
  SELECT CASE WHEN NEW.status<>'quoted' OR NEW.consented_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM trips t JOIN trip_commerce c ON c.trip_id=t.id JOIN ride_quotes q ON q.id=c.quote_id
    WHERE t.id=NEW.trip_id AND t.rider_id=NEW.rider_id AND t.driver_id=NEW.captain_id
      AND t.is_demo=0 AND t.status IN ('arriving','arrived','riding') AND t.payment_status='cash_due'
      AND t.pickup_json=NEW.pickup_json AND t.destination_json=NEW.old_destination_json
      AND t.fare_halalas=NEW.old_fare_halalas AND t.commission_bps=NEW.commission_bps
      AND c.method='cash' AND c.discount_halalas=0 AND c.coupon IS NULL
      AND c.cash_due_halalas=NEW.old_cash_due_halalas AND c.cash_due_halalas=t.fare_halalas
      AND c.quote_id=NEW.old_quote_id AND q.category=NEW.category
      AND NOT EXISTS(SELECT 1 FROM trip_settlements WHERE trip_id=t.id)
      AND NOT EXISTS(SELECT 1 FROM trip_negotiations WHERE trip_id=t.id)
      AND NOT EXISTS(SELECT 1 FROM trip_options WHERE trip_id=t.id AND json_array_length(stops_json)>0)
  ) THEN RAISE(ABORT,'DESTINATION_TRIP_CHANGED') END;
END;

CREATE TRIGGER destination_change_immutable BEFORE UPDATE ON trip_destination_changes BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.trip_id IS NOT OLD.trip_id OR NEW.rider_id IS NOT OLD.rider_id
    OR NEW.captain_id IS NOT OLD.captain_id OR NEW.pickup_json IS NOT OLD.pickup_json
    OR NEW.old_destination_json IS NOT OLD.old_destination_json OR NEW.destination_json IS NOT OLD.destination_json
    OR NEW.old_fare_halalas IS NOT OLD.old_fare_halalas OR NEW.new_fare_halalas IS NOT OLD.new_fare_halalas
    OR NEW.old_cash_due_halalas IS NOT OLD.old_cash_due_halalas OR NEW.new_cash_due_halalas IS NOT OLD.new_cash_due_halalas
    OR NEW.old_quote_id IS NOT OLD.old_quote_id OR NEW.quote_id IS NOT OLD.quote_id OR NEW.route_json IS NOT OLD.route_json
    OR NEW.category IS NOT OLD.category OR NEW.commission_bps IS NOT OLD.commission_bps
    OR NEW.created_at IS NOT OLD.created_at OR (OLD.consented_at IS NOT NULL AND NEW.consented_at IS NOT OLD.consented_at)
    THEN RAISE(ABORT,'DESTINATION_IMMUTABLE') END;
  SELECT CASE WHEN NOT (
    (OLD.status='quoted' AND NEW.status IN ('pending','withdrawn','expired','invalidated')) OR
    (OLD.status='pending' AND NEW.status IN ('accepted','rejected','withdrawn','expired','invalidated'))
  ) THEN RAISE(ABORT,'DESTINATION_REQUEST_CONFLICT') END;
  SELECT CASE WHEN NEW.status IN ('pending','accepted') AND (
    julianday(NEW.expires_at)<=julianday('now') OR NEW.consented_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM trips t JOIN trip_commerce c ON c.trip_id=t.id
      WHERE t.id=NEW.trip_id AND t.rider_id=NEW.rider_id AND t.driver_id=NEW.captain_id
        AND t.is_demo=0 AND t.status IN ('arriving','arrived','riding') AND t.payment_status='cash_due'
        AND t.pickup_json=NEW.pickup_json AND t.destination_json=NEW.old_destination_json
        AND t.fare_halalas=NEW.old_fare_halalas AND t.commission_bps=NEW.commission_bps
        AND c.method='cash' AND c.discount_halalas=0 AND c.coupon IS NULL
        AND c.cash_due_halalas=NEW.old_cash_due_halalas AND c.quote_id=NEW.old_quote_id
        AND NOT EXISTS(SELECT 1 FROM trip_settlements WHERE trip_id=t.id)
        AND NOT EXISTS(SELECT 1 FROM trip_negotiations WHERE trip_id=t.id)
        AND NOT EXISTS(SELECT 1 FROM trip_options WHERE trip_id=t.id AND json_array_length(stops_json)>0)
        AND NOT EXISTS(SELECT 1 FROM account_controls WHERE role='rider' AND account_id=t.rider_id AND suspended=1)
        AND NOT EXISTS(SELECT 1 FROM account_controls WHERE role='captain' AND account_id=t.driver_id AND suspended=1)
    )
  ) THEN RAISE(ABORT,'DESTINATION_TRIP_CHANGED') END;
END;

CREATE TRIGGER destination_change_apply AFTER UPDATE OF status ON trip_destination_changes WHEN NEW.status='accepted' BEGIN
  UPDATE trip_commerce SET quote_id=NEW.quote_id,cash_due_halalas=NEW.new_cash_due_halalas WHERE trip_id=NEW.trip_id;
  UPDATE trips SET destination_json=NEW.destination_json,fare_halalas=NEW.new_fare_halalas,updated_at=NEW.decided_at WHERE id=NEW.trip_id;
  DELETE FROM road_route_cache WHERE cache_key='live-eta:'||NEW.trip_id;
END;

CREATE TRIGGER destination_change_invalidate AFTER UPDATE OF status,driver_id,rider_id,destination_json,fare_halalas ON trips BEGIN
  UPDATE trip_destination_changes SET status='invalidated',decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE trip_id=NEW.id AND status IN ('quoted','pending') AND (
      NEW.status NOT IN ('arriving','arrived','riding') OR NEW.driver_id IS NOT captain_id OR NEW.rider_id IS NOT rider_id
      OR NEW.destination_json<>old_destination_json OR NEW.fare_halalas<>old_fare_halalas
    );
END;

CREATE TRIGGER destination_change_audit_insert AFTER INSERT ON trip_destination_changes BEGIN
  INSERT INTO operation_events VALUES('destination:'||NEW.id||':quoted','rider','destination_change_quoted',NEW.rider_id,NEW.trip_id,
    json_object('changeId',NEW.id,'destination',json(NEW.destination_json),'oldFare',NEW.old_fare_halalas,'newFare',NEW.new_fare_halalas,'fareDifference',NEW.new_fare_halalas-NEW.old_fare_halalas,'provider',json_extract(NEW.route_json,'$.provider')),NEW.created_at);
END;
CREATE TRIGGER destination_change_audit_update AFTER UPDATE OF status ON trip_destination_changes BEGIN
  INSERT INTO operation_events VALUES('destination:'||NEW.id||':'||NEW.status,
    CASE WHEN NEW.status IN ('accepted','rejected') THEN 'captain' WHEN NEW.status IN ('expired','invalidated') THEN 'system' ELSE 'rider' END,
    'destination_change_'||NEW.status,
    CASE WHEN NEW.status IN ('accepted','rejected') THEN NEW.captain_id ELSE NEW.rider_id END,NEW.trip_id,
    json_object('changeId',NEW.id,'oldDestination',json(NEW.old_destination_json),'destination',json(NEW.destination_json),'oldFare',NEW.old_fare_halalas,'newFare',NEW.new_fare_halalas,'fareDifference',NEW.new_fare_halalas-NEW.old_fare_halalas,'consentedAt',NEW.consented_at),
    COALESCE(NEW.decided_at,NEW.consented_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')));
END;

-- A completion that read the former destination/fare must not settle after an
-- accepted change. The caller retries with the synchronized cash total.
CREATE TRIGGER destination_completion_snapshot BEFORE INSERT ON operation_events
WHEN NEW.action='trip_completion_snapshot' BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM trips t JOIN trip_commerce c ON c.trip_id=t.id WHERE t.id=NEW.entity_id AND t.status='riding'
      AND t.driver_id=json_extract(NEW.details_json,'$.driver')
      AND t.destination_json=json_extract(NEW.details_json,'$.destination')
      AND t.fare_halalas=json_extract(NEW.details_json,'$.fare')
      AND t.commission_bps=json_extract(NEW.details_json,'$.commission')
      AND c.cash_due_halalas=json_extract(NEW.details_json,'$.cashDue')
      AND c.quote_id=json_extract(NEW.details_json,'$.quoteId')
      AND c.method=json_extract(NEW.details_json,'$.method')
      AND c.discount_halalas=json_extract(NEW.details_json,'$.discount')
  ) THEN RAISE(ABORT,'DESTINATION_TRIP_CHANGED') END;
END;
