import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// This is an offline atomic-SQL regression for the exact-once claim. No real
// merchant API, bank, Cloudflare D1 or wallet is contacted by this test.
test('RDEV-006 a duplicate provider reconciliation cannot credit twice',()=>{
 const source=readFileSync(new URL('../worker/refunds.js',import.meta.url),'utf8');
 assert.match(source,/refund-finalization:/);
 assert.match(source,/INSERT INTO operation_events\(id,source,action,actor_id,entity_id,details_json,created_at\)/);
 const db=new DatabaseSync(':memory:');
 try {
  db.exec("CREATE TABLE refund_requests(id TEXT PRIMARY KEY,status TEXT);CREATE TABLE operation_events(id TEXT PRIMARY KEY,source TEXT,action TEXT,actor_id TEXT,entity_id TEXT,details_json TEXT,created_at TEXT);CREATE TABLE wallet_entries(id TEXT PRIMARY KEY,account_id TEXT,amount_halalas INTEGER)");
  db.prepare('INSERT INTO refund_requests VALUES(?,?)').run('refund-1','submitted_unknown');
  const reconcile=()=>{
   db.exec('BEGIN');
   try{
    db.prepare('INSERT INTO operation_events VALUES(?,?,?,?,?,?,?)').run('refund-finalization:refund-1','system','refund_finalization_claim','admin','refund-1','{}','2026-11-22T00:00:00Z');
    db.prepare("UPDATE refund_requests SET status='refunded' WHERE id='refund-1' AND status='submitted_unknown'").run();
    db.prepare('INSERT INTO wallet_entries VALUES(?,?,?)').run(crypto.randomUUID(),'refund:refund-1',-2500);
    db.prepare('INSERT INTO wallet_entries VALUES(?,?,?)').run(crypto.randomUUID(),'provider',2500);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error}
  };
  reconcile();assert.throws(reconcile,/UNIQUE constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_entries').get().n,2);
  assert.equal(db.prepare('SELECT SUM(amount_halalas) n FROM wallet_entries').get().n,0);
  assert.equal(db.prepare('SELECT status FROM refund_requests').get().status,'refunded');
 }finally{db.close()}
});
