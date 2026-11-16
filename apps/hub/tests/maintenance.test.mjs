import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import worker from '../worker/index.js';
import {acquireMaintenanceScope,maintenanceFetch,maintenanceSnapshot,transitionMaintenance} from '../worker/maintenance.js';
import {freeAuth} from '../worker/free-auth.js';
import {confirmWebhookPayment} from '../worker/commerce.js';

const setup=t=>{const env=makeEnv();t.after(()=>env.db.close());return env};
const transition=(env,targetMode)=>{const state=env.db.prepare('SELECT mode,epoch FROM maintenance_state').get();return transitionMaintenance(env.DB,{expectedMode:state.mode,expectedEpoch:state.epoch,targetMode})};
const freeze=async env=>{await transition(env,'draining');await transition(env,'frozen')};
const count=(env,table)=>env.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const unavailable=error=>error?.code==='MAINTENANCE_UNAVAILABLE';

test('all SQL methods including RETURNING, CTEs and concurrent batches use the atomic fence',async t=>{
  const env=setup(t);env.db.exec('CREATE TABLE maintenance_test_payload(id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
  const scope=await acquireMaintenanceScope(env);
  const first=await scope.env.DB.prepare('INSERT INTO maintenance_test_payload VALUES(?,?) RETURNING id,amount').bind(1,25).first();
  assert.deepEqual({...first},{id:1,amount:25});
  const second=await scope.env.DB.prepare('WITH input(v) AS (SELECT ?) INSERT INTO maintenance_test_payload SELECT 2,v FROM input RETURNING amount').bind(35).all();
  assert.deepEqual(second.results.map(row=>({...row})),[{amount:35}]);
  const changed=await scope.env.DB.prepare('UPDATE maintenance_test_payload SET amount=amount+1 WHERE id=?').bind(1).run();assert.equal(changed.meta.changes,1);
  await Promise.all([3,4].map(id=>scope.env.DB.batch([scope.env.DB.prepare('INSERT INTO maintenance_test_payload VALUES(?,?)').bind(id,10)])));
  assert.equal(await scope.env.DB.prepare('SELECT SUM(amount) AS n FROM maintenance_test_payload').first('n'),81);
  assert.equal(count(env,'maintenance_write_fences'),0);await scope.finish();assert.equal(count(env,'maintenance_leases'),0);
});

test('a failed multi-statement mutation rolls back payload and fence together',async t=>{
  const env=setup(t);env.db.exec('CREATE TABLE maintenance_test_payload(id INTEGER PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount>=0))');
  const scope=await acquireMaintenanceScope(env);
  await assert.rejects(scope.env.DB.batch([
    scope.env.DB.prepare('INSERT INTO maintenance_test_payload VALUES(1,10)'),
    scope.env.DB.prepare('INSERT INTO maintenance_test_payload VALUES(2,-1)')
  ]));
  assert.equal(count(env,'maintenance_test_payload'),0);assert.equal(count(env,'maintenance_write_fences'),0);await scope.finish();
});

test('draining blocks new admission, preserves admitted work and refuses an early freeze',async t=>{
  const env=setup(t),a=await acquireMaintenanceScope(env),b=await acquireMaintenanceScope(env);
  await transition(env,'draining');await assert.rejects(acquireMaintenanceScope(env),unavailable);
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  await a.env.DB.prepare("INSERT INTO platform_settings VALUES('maintenance-test','saved',?,'local')").bind(new Date().toISOString()).run();
  await a.finish();assert.equal((await maintenanceSnapshot(env.DB)).active,1);
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  await b.finish();const state=await transition(env,'frozen');assert.equal(state.mode,'frozen');assert.equal(state.epoch,2);
});

test('stale scope handles and cross-scope prepared statements cannot write or start effects',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env),other=await acquireMaintenanceScope(env);
  const old=scope.env.DB.prepare('INSERT INTO request_metrics VALUES(?,?,?,?,?)').bind('old','/local',200,1,new Date().toISOString());
  await assert.rejects(other.env.DB.batch([old]),unavailable);await scope.finish();await other.finish();await freeze(env);
  assert.throws(()=>old.run(),unavailable);assert.throws(()=>old.first(),unavailable);
  assert.throws(()=>scope.env.DB.prepare('SELECT 1'),unavailable);assert.throws(()=>scope.env.BUCKET.put('local',new Uint8Array()),unavailable);
  assert.equal(count(env,'request_metrics'),0);
});

test('a removed or wrong-epoch lease cannot commit any part of a batch',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env);
  // Simulates a stale handle after an operator recovery, without publishing a
  // force/override endpoint. The commit fence must remain independently safe.
  env.db.prepare('UPDATE maintenance_leases SET epoch=epoch+1 WHERE id=?').run(scope.id);
  await assert.rejects(scope.env.DB.batch([
    scope.env.DB.prepare("INSERT INTO platform_settings VALUES('old-epoch','bad',?,'local')").bind(new Date().toISOString()),
    scope.env.DB.prepare("INSERT INTO request_metrics VALUES('stale','/local',200,1,?)").bind(new Date().toISOString())
  ]),unavailable);
  assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM platform_settings WHERE key='old-epoch'").get().n,0);assert.equal(count(env,'request_metrics'),0);
  env.db.prepare('UPDATE maintenance_leases SET epoch=? WHERE id=?').run(scope.epoch,scope.id);await scope.finish();
});

test('no wrapper exec/session escape or access to maintenance control tables is available',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env);
  for(const method of ['exec','dump','withSession'])assert.throws(()=>scope.env.DB[method]('SELECT 1'),unavailable);
  for(const sql of ['DELETE FROM maintenance_leases','SELECT * FROM maintenance_state','WITH input AS (SELECT * FROM maintenance_effects) SELECT * FROM input'])assert.throws(()=>scope.env.DB.prepare(sql),unavailable);
  await scope.finish();
});

test('frozen API/internal routes, GET polling, admin runNow and Cron cannot change data or metrics',async t=>{
  const env=setup(t);env.SCHEDULER_ENABLED='true';await freeze(env);
  const changes=env.db.prepare('SELECT total_changes() AS n').get().n,originalRandom=Math.random;Math.random=()=>0;t.after(()=>{Math.random=originalRandom});
  const ctx={waitUntil(p){p.catch(()=>{})}};
  for(const [path,method] of [['/api/auth/session','GET'],['/api/background','GET'],['/api/driver','POST'],['/internal/live-rider','POST'],['/internal/administration/reservations','POST'],['/api/payments/moyasar-webhook','POST'],['/dashboard','GET']]){
    const response=await worker.fetch(new Request('https://local.test'+path,{method,headers:{origin:'https://local.test','x-mishwar-key':'test-admin-key','x-maintenance-bypass':'true'},...(method==='POST'?{body:JSON.stringify({action:'runNow'}),headers:{origin:'https://local.test','Content-Type':'application/json','x-mishwar-key':'test-admin-key','x-maintenance-bypass':'true'}}:{})}),env,ctx);
    assert.equal(response.status,503,path);assert.equal(response.headers.get('Retry-After'),'60');assert.equal((await response.json()).code,'MAINTENANCE_UNAVAILABLE');
  }
  await worker.scheduled({},env,ctx);
  assert.equal(env.db.prepare('SELECT total_changes() AS n').get().n,changes);assert.equal(count(env,'job_runs'),0);assert.equal(count(env,'request_metrics'),0);assert.equal(count(env,'maintenance_leases'),0);
});

test('exact maintenance and health paths read without metrics and advertise non-readiness while frozen',async t=>{
  const env=setup(t);await freeze(env);const before=env.db.prepare('SELECT total_changes() AS n').get().n;
  for(const path of ['/api/maintenance','/api/health']){
    const response=await worker.fetch(new Request('https://local.test'+path),env,{waitUntil(){throw Error('Read-only status must not enqueue work')}});
    assert.equal(response.status,503);const data=await response.json();assert.equal(data.ready,false);assert.equal(data.mode,'frozen');
  }
  assert.equal(env.db.prepare('SELECT total_changes() AS n').get().n,before);
  const post=await worker.fetch(new Request('https://local.test/api/maintenance',{method:'POST',body:'{}'}),env,{});assert.equal(post.status,503);
});

test('missing or broken coordination schema fails closed before authentication or side effects',async t=>{
  const env=setup(t);env.db.exec('DROP TABLE maintenance_state');let provider=0;const original=globalThis.fetch;globalThis.fetch=async()=>{provider++;throw Error('Unexpected external call')};t.after(()=>{globalThis.fetch=original});
  const response=await worker.fetch(new Request('https://local.test/api/auth/register',{method:'POST',body:JSON.stringify({name:'Local test',phone:'0500000000',password:'local-password'})}),env,{});
  assert.equal(response.status,503);assert.equal(provider,0);assert.equal(count(env,'public_accounts'),0);assert.equal(count(env,'request_metrics'),0);
  assert.equal((await worker.fetch(new Request('https://local.test/api/health'),env,{})).status,503);
});

test('state transitions use expected epoch and require draining before freeze or validation',async t=>{
  const env=setup(t);await assert.rejects(transition(env,'frozen'),/MAINTENANCE_INVALID_TRANSITION/);
  await assert.rejects(transitionMaintenance(env.DB,{expectedMode:'open',expectedEpoch:7,targetMode:'draining'}),unavailable);
  await freeze(env);await transition(env,'validating');await assert.rejects(acquireMaintenanceScope(env),unavailable);
  await transition(env,'frozen');const opened=await transition(env,'open');assert.equal(opened.epoch,3);
  const scope=await acquireMaintenanceScope(env);await scope.finish();
});

test('state transitions do not mistake audit-trigger changes for a rejected conditional update',async t=>{
  const env=setup(t),prepare=env.DB.prepare.bind(env.DB);
  env.DB.prepare=sql=>{const statement=prepare(sql);return {...statement,bind(...values){const bound=statement.bind(...values);return {...bound,async run(){const result=await bound.run();return {...result,meta:{...result.meta,changes:result.meta.changes+1}}}}}}};
  const state=await transition(env,'draining');assert.equal(state.mode,'draining');assert.equal(state.epoch,1);
  assert.equal(count(env,'maintenance_transitions'),1);
  await assert.rejects(transitionMaintenance(env.DB,{expectedMode:'open',expectedEpoch:1,targetMode:'draining'}),unavailable);
  assert.equal(count(env,'maintenance_transitions'),1);
});

test('waitUntil work holds a durable lease after the foreground handler completes',async t=>{
  const env=setup(t),gate=deferred(),forwarded=[];const scope=await acquireMaintenanceScope(env,{waitUntil:p=>forwarded.push(p)});
  scope.ctx.waitUntil((async()=>{await gate.promise;await scope.env.DB.prepare("INSERT INTO platform_settings VALUES('background-complete','yes',?,'local')").bind(new Date().toISOString()).run()})());
  const finished=scope.finish();await transition(env,'draining');assert.equal(count(env,'maintenance_leases'),1);await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  gate.resolve();await finished;await Promise.all(forwarded);assert.equal(count(env,'maintenance_leases'),0);await transition(env,'frozen');
  assert.equal(env.db.prepare("SELECT value FROM platform_settings WHERE key='background-complete'").get().value,'yes');
});

test('a pending R2 operation prevents freeze and finishes before the durable lease is released',async t=>{
  const env=setup(t),gate=deferred(),entered=deferred();env.BUCKET.put=async(key,value)=>{entered.resolve();await gate.promise;env.objects.set(key,value)};
  const scope=await acquireMaintenanceScope(env),put=scope.env.BUCKET.put('local-only',new Uint8Array([1]));await entered.promise;
  const finished=scope.finish();await transition(env,'draining');assert.equal((await maintenanceSnapshot(env.DB)).uncertain,1);await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  gate.resolve();await put;await finished;assert.equal(env.objects.size,1);await transition(env,'frozen');assert.equal((await maintenanceSnapshot(env.DB)).uncertain,0);
});

test('unknown R2 or mutating-provider outcomes survive lease completion and never expire silently',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env);env.BUCKET.put=async()=>{throw Error('private-fixture-object-path')};
  await assert.rejects(scope.env.BUCKET.put('private-fixture-object-path',new Uint8Array([1])));await scope.finish();await transition(env,'draining');
  env.db.prepare('UPDATE maintenance_effects SET started_at=?').run('2000-01-01T00:00:00Z');
  assert.equal((await maintenanceSnapshot(env.DB)).uncertain,1);await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  const rows=env.db.prepare('SELECT * FROM maintenance_effects').all();assert.doesNotMatch(JSON.stringify(rows),/private-fixture-object-path/);assert.equal(rows[0].kind,'r2.put');
});

test('provider completion includes its body and a delayed response blocks freeze until drained',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env),body=deferred(),entered=deferred(),original=globalThis.fetch;
  globalThis.fetch=async()=>{entered.resolve();return new Response(new ReadableStream({async start(controller){await body.promise;controller.enqueue(new TextEncoder().encode('{"ok":true}'));controller.close()}}),{status:200,headers:{'Content-Type':'application/json'}})};t.after(()=>{globalThis.fetch=original});
  const request=maintenanceFetch(scope.env,'https://offline-provider.test/send',{method:'POST',body:'local fixture'});await entered.promise;
  const finished=scope.finish();await transition(env,'draining');assert.equal((await maintenanceSnapshot(env.DB)).uncertain,1);await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  body.resolve();assert.deepEqual(await(await request).json(),{ok:true});await finished;await transition(env,'frozen');
});

test('provider timeout is recorded without credentials, URLs or payload and blocks freeze',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env),original=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('private-fixture-token-body-and-url')};t.after(()=>{globalThis.fetch=original});
  await assert.rejects(maintenanceFetch(scope.env,'https://offline-provider.test/private-fixture-token-body-and-url',{method:'POST',headers:{Authorization:'Bearer private-fixture-token-body-and-url'},body:'private-fixture-token-body-and-url'}));
  await scope.finish();const effects=env.db.prepare('SELECT * FROM maintenance_effects').all();assert.equal(effects[0].state,'unknown');assert.doesNotMatch(JSON.stringify(effects),/private-fixture-token-body-and-url|offline-provider|Bearer/);
  await transition(env,'draining');await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
});

test('failed read-only provider requests do not create false unknown financial outcomes',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env),original=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('Offline read failure')};t.after(()=>{globalThis.fetch=original});
  await assert.rejects(maintenanceFetch(scope.env,'https://offline-provider.test/read',{method:'GET'}));await scope.finish();await freeze(env);assert.equal((await maintenanceSnapshot(env.DB)).uncertain,0);
});

test('ambiguous mutating provider HTTP 5xx or 408 is an unresolved outcome even when its body arrived',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env),original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  for(const status of [500,503,408]){
    globalThis.fetch=async()=>Response.json({privateBody:'local fixture'},{status});
    await assert.rejects(maintenanceFetch(scope.env,'https://offline-provider.test/send',{method:'POST'}),error=>error.code==='EXTERNAL_OUTCOME_UNKNOWN');
  }
  await scope.finish();assert.equal((await maintenanceSnapshot(env.DB)).uncertain,3);await transition(env,'draining');await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
});

test('an orphaned lease remains a blocker rather than being reaped by elapsed time',async t=>{
  const env=setup(t),scope=await acquireMaintenanceScope(env);await transition(env,'draining');env.db.prepare('UPDATE maintenance_leases SET started_at=?').run('2000-01-01T00:00:00Z');
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);assert.equal(count(env,'maintenance_leases'),1);await scope.finish();await transition(env,'frozen');
});

test('unknown financial outcomes and live trips block freeze even with zero request leases',async t=>{
  const env=setup(t);await transition(env,'draining');
  const insert=env.db.prepare("INSERT INTO payment_intents(id,rider_id,purpose,method,amount_halalas,status,created_at) VALUES(?,?,'wallet_topup','card',1000,'pending',?)");
  // The fixture uses an actual business schema; introspection below keeps this
  // check focused on the existing pending status, not an invented data model.
  const columns=env.db.prepare('PRAGMA table_info(payment_intents)').all();assert.ok(columns.some(c=>c.name==='status'));
  env.db.prepare("INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES('maintenance-rider','Local','+966500000000','local@example.test',?,?)").run(new Date().toISOString(),new Date().toISOString());
  insert.run('maintenance-intent','maintenance-rider',new Date().toISOString());
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  env.db.prepare("UPDATE payment_intents SET status='failed' WHERE id='maintenance-intent'").run();
  const at=new Date().toISOString();
  env.db.prepare("INSERT INTO trips(id,rider_id,status,pickup_json,destination_json,is_demo,created_at,updated_at) VALUES('maintenance-trip','maintenance-rider','riding','{}','{}',0,?,?)").run(at,at);
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);env.db.prepare("UPDATE trips SET status='completed' WHERE id='maintenance-trip'").run();
  env.db.prepare("INSERT INTO driver_payment_intents(id,captain_id,method,amount_halalas,created_at) VALUES('maintenance-driver-intent','local-captain','card',1000,?)").run(at);
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);env.db.prepare("UPDATE driver_payment_intents SET status='failed' WHERE id='maintenance-driver-intent'").run();
  env.db.prepare("INSERT INTO refund_requests(id,rider_id,amount_halalas,reason,status,created_at,updated_at) VALUES('maintenance-refund','maintenance-rider',1000,'Local fixture','submitted_unknown',?,?)").run(at,at);
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);env.db.prepare("UPDATE refund_requests SET status='refunded' WHERE id='maintenance-refund'").run();
  env.db.prepare("INSERT INTO wallet_accounts(account_id,balance_halalas) VALUES('captain:maintenance-captain',5000)").run();
  env.db.prepare("INSERT INTO withdrawal_requests(id,captain_id,destination_id,destination_json,amount_halalas,created_at) VALUES('maintenance-withdrawal','maintenance-captain','local-destination','{}',5000,?)").run(at);
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);env.db.prepare("UPDATE withdrawal_requests SET status='rejected' WHERE id='maintenance-withdrawal'").run();
  env.db.prepare("INSERT INTO ride_quotes(id,rider_id,pickup_json,destination_json,category,fare_halalas,commission_bps,expires_at) VALUES('maintenance-reservation-quote','maintenance-rider','{}','{}','economy',1000,1500,?)").run(at);
  env.db.prepare("INSERT INTO reservations(id,rider_id,quote_id,pickup_at,dispatch_at,created_at,updated_at) VALUES('maintenance-reservation','maintenance-rider','maintenance-reservation-quote',?,?,?,?)").run(at,at,at,at);
  await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);env.db.prepare("UPDATE reservations SET status='cancelled' WHERE id='maintenance-reservation'").run();await transition(env,'frozen');
});

test('strict HTTP drain refuses live business first and aborts safely if an admitted request creates a trip',async t=>{
  const env=setup(t),at=new Date().toISOString();
  env.db.prepare("INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES('drain-rider','Local','+966500000000','local@example.test',?,?)").run(at,at);
  env.db.prepare("INSERT INTO trips(id,rider_id,status,pickup_json,destination_json,is_demo,created_at,updated_at) VALUES('drain-trip','drain-rider','riding','{}','{}',0,?,?)").run(at,at);
  await assert.rejects(transition(env,'draining'),/MAINTENANCE_DRAIN_NOT_EMPTY/);assert.equal((await maintenanceSnapshot(env.DB)).mode,'open');
  env.db.prepare("UPDATE trips SET status='completed' WHERE id='drain-trip'").run();
  const scope=await acquireMaintenanceScope(env);await transition(env,'draining');
  await scope.env.DB.prepare("INSERT INTO trips(id,rider_id,status,pickup_json,destination_json,is_demo,created_at,updated_at) VALUES('late-admitted-trip','drain-rider','matching','{}','{}',0,?,?)").bind(at,at).run();
  await scope.finish();await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);
  // Reopen deliberately so the admitted business can be completed/cancelled by
  // its normal API. No force-freeze or artificial deletion is offered.
  await transition(env,'open');assert.equal((await maintenanceSnapshot(env.DB)).mode,'open');
});

test('nested waitUntil work is drained before release and concurrent finish callers await the same boundary',async t=>{
  const env=setup(t),outer=deferred(),inner=deferred(),entered=deferred(),scope=await acquireMaintenanceScope(env);
  scope.ctx.waitUntil((async()=>{await outer.promise;scope.ctx.waitUntil((async()=>{entered.resolve();await inner.promise;await scope.env.DB.prepare("INSERT INTO platform_settings VALUES('nested-work','done',?,'local')").bind(new Date().toISOString()).run()})())})());
  const first=scope.finish(),second=scope.finish();assert.equal(first,second);outer.resolve();await entered.promise;
  await transition(env,'draining');await assert.rejects(transition(env,'frozen'),/MAINTENANCE_DRAIN_NOT_EMPTY/);inner.resolve();await Promise.all([first,second]);await transition(env,'frozen');
  assert.equal(env.db.prepare("SELECT value FROM platform_settings WHERE key='nested-work'").get().value,'done');
});

test('lease finalization seals new work before the asynchronous DELETE response completes',async t=>{
  const env=setup(t),gate=deferred(),entered=deferred(),prepare=env.DB.prepare.bind(env.DB);
  env.DB.prepare=sql=>{const original=prepare(sql);if(!sql.startsWith('DELETE FROM maintenance_leases'))return original;return {bind(...values){const bound=original.bind(...values);return {async run(){entered.resolve();await gate.promise;return bound.run()}}}}};
  const scope=await acquireMaintenanceScope(env),old=scope.env.DB.prepare('SELECT 1');const finished=scope.finish();await entered.promise;
  assert.throws(()=>old.run(),unavailable);assert.throws(()=>scope.env.BUCKET.delete('local'),unavailable);
  assert.throws(()=>scope.ctx.waitUntil(Promise.reject(Error('Local already rejected work'))),unavailable);
  assert.equal(count(env,'maintenance_leases'),1);gate.resolve();await finished;assert.equal(count(env,'maintenance_leases'),0);
});

test('a delayed OTP provider cannot verify the account after its request lease becomes stale',async t=>{
  const env=setup(t);Object.assign(env,{AUTHENTICA_API_KEY:'offline-maintenance-key',AUTHENTICA_TEMPLATE_ID:'91'});
  const created=await freeAuth(env,'rider',{action:'register',name:'Local maintenance fixture',phone:'0500000000',email:'maintenance@example.test',password:'local-test-password',clientIp:'local'});
  const {sessionToken}=await created.json(),gate=deferred(),entered=deferred(),original=globalThis.fetch;
  globalThis.fetch=async url=>{if(String(url).endsWith('/verify-otp')){entered.resolve();await gate.promise;return Response.json({status:true})}return Response.json({success:true})};t.after(()=>{globalThis.fetch=original});
  const scope=await acquireMaintenanceScope(env);assert.equal((await freeAuth(scope.env,'rider',{action:'phone-otp-start',sessionToken,clientIp:'local'})).status,200);
  const checked=freeAuth(scope.env,'rider',{action:'phone-otp-check',sessionToken,code:'123456',clientIp:'local'});await entered.promise;
  env.db.prepare('UPDATE maintenance_leases SET epoch=epoch+1 WHERE id=?').run(scope.id);gate.resolve();assert.notEqual((await checked).status,200);
  assert.equal(env.db.prepare('SELECT phone_verified_at FROM public_accounts').get().phone_verified_at,null);assert.equal(count(env,'rider_phone_accounts'),0);assert.equal(scope.blocked,true);
  env.db.prepare('UPDATE maintenance_leases SET epoch=? WHERE id=?').run(scope.epoch,scope.id);await scope.finish();
});

test('a delayed payment verification cannot partly credit the ledger after its request lease becomes stale',async t=>{
  const env=setup(t);Object.assign(env,{MOYASAR_ENABLED:'true',MOYASAR_SECRET_KEY:'sk_live_local_fixture',MOYASAR_PUBLIC_KEY:'pk_live_local_fixture'});
  env.db.prepare("INSERT INTO payment_intents(id,rider_id,purpose,method,amount_halalas,status,created_at) VALUES('local-maintenance-intent','local-rider','wallet_topup','card',1000,'pending',?)").run(new Date().toISOString());
  const scope=await acquireMaintenanceScope(env),gate=deferred(),entered=deferred(),original=globalThis.fetch;
  globalThis.fetch=async()=>{entered.resolve();await gate.promise;return Response.json({id:'offline-payment-123',status:'paid',amount:1000,currency:'SAR',metadata:{intent_id:'local-maintenance-intent'},source:{type:'creditcard'}})};t.after(()=>{globalThis.fetch=original});
  const result=confirmWebhookPayment(scope.env,'local-maintenance-intent','offline-payment-123');await entered.promise;
  env.db.prepare('UPDATE maintenance_leases SET epoch=epoch+1 WHERE id=?').run(scope.id);gate.resolve();await assert.rejects(result,unavailable);
  assert.equal(count(env,'wallet_entries'),0);assert.equal(env.db.prepare("SELECT status FROM payment_intents WHERE id='local-maintenance-intent'").get().status,'pending');assert.equal(scope.blocked,true);
  env.db.prepare('UPDATE maintenance_leases SET epoch=? WHERE id=?').run(scope.epoch,scope.id);await scope.finish();
});
