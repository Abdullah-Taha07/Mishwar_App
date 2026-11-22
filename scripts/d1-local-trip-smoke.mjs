import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';

// Optional runtime install (no changes to root dependencies):
// npm install --prefix .local-verification/stage3-d1-runtime --no-audit --no-fund miniflare@5.20261110.0-beta
// node scripts/d1-local-trip-smoke.mjs --runtime-module .local-verification/stage3-d1-runtime/node_modules/miniflare/dist/src/index.js
// This never reads wrangler.toml, .env, provider secrets, or a customer SQL dump.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
if(!value('--runtime-module'))throw Error('Use --runtime-module <installed Miniflare dist/src/index.js>; optional --output <new .local-verification folder>');
const runtimeModule=resolve(root,value('--runtime-module'));
const here=resolve(root,value('--output')||'.local-verification/stage3-d1-'+Date.now());
for(const path of [runtimeModule,here]){const rel=relative(root,path);if(isAbsolute(rel)||rel.startsWith('..')||!rel.startsWith('.local-verification'+String.fromCharCode(92))&&!rel.startsWith('.local-verification/'))throw Error('Runtime and output must stay in this workspace .local-verification directory')}
if(existsSync(join(here,'summary.json')))throw Error('Keep prior evidence: choose a new --output folder');
mkdirSync(here,{recursive:true});
const runtimeRoot=resolve(dirname(runtimeModule),'../..');
const runtimeVersion=JSON.parse(readFileSync(join(runtimeRoot,'package.json'))).version;
assert.equal(runtimeVersion,'5.20261110.0-beta','This parity probe pins its reviewed SDK and SQL splitter version');
const workerdVersion=JSON.parse(readFileSync(join(runtimeRoot,'../workerd/package.json'))).version;
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(runtimeModule));
const hash=value=>createHash('sha256').update(value).digest('hex');
const summary={date:'2026-11-22',status:'RUNNING',scope:'Local workerd D1 binding parity; never remote D1',command:'node scripts/d1-local-trip-smoke.mjs --runtime-module '+relative(root,runtimeModule)+' --output '+relative(root,here),miniflare:runtimeVersion,workerd:workerdVersion,migrations:[],checks:[],outbound:{routeFixtures:0,refundPostFixtures:0,refundGetFixtures:0,unexpected:0},productionVerified:false};
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);summary.checks.push(name)};
let mf;
try{
 const probeSource="import {captainStopAction} from "+JSON.stringify(join(root,'apps/hub/worker/stop-progress.js'))+";\nimport {operationsTrip} from "+JSON.stringify(join(root,'apps/hub/worker/operations-trip.js'))+";\nimport {handleDriver} from "+JSON.stringify(join(root,'apps/hub/worker/commerce.js'))+";\nimport {refundAction,refundAdmin} from "+JSON.stringify(join(root,'apps/hub/worker/refunds.js'))+";\nconst captain='11111111-1111-4111-8111-111111111111';\nexport default {async fetch(request,env){\n const b=await request.json();\n try{\n  if(b.action==='stop')return Response.json(await captainStopAction(env,b.captain||captain,b));\n  if(b.action==='admin')return Response.json(await operationsTrip(env,b.tripId));\n  if(b.action==='refund-request')return Response.json(await refundAction(env,'rider:d1-local',{action:'live_refund_request',intentId:'d1-local-intent',reason:'Synthetic D1 refund parity'}));\n  if(b.action==='refund-admin')return Response.json(await refundAdmin(env,b.input,'d1-local-admin'));\n  if(b.action==='complete'||b.action==='complete-race'){\n   let target=env;\n   if(b.action==='complete-race'){\n    let changed=false;const db=env.DB;\n    target={...env,DB:{prepare:db.prepare.bind(db),batch:async items=>{\n     if(!changed){changed=true;await db.prepare('DELETE FROM operation_events WHERE id=?').bind('trip-stop:'+b.tripId+':1:departed').run()}\n     return db.batch(items);\n    }}};\n   }\n   return handleDriver(new Request('https://d1-local.test/api/driver',{method:'POST',headers:{Origin:'https://d1-local.test','Content-Type':'application/json','oai-authenticated-user-id':'d1-local-captain'},body:JSON.stringify({action:'trip_status',tripId:b.tripId,status:'completed',cashReceived:true})}),target);\n  }\n  return Response.json({error:'Unknown local parity action'},{status:400});\n }catch(error){return Response.json({error:error.message,code:error.code},{status:error.status||400})}\n}};\n";
 writeFileSync(join(here,'probe-worker.mjs'),probeSource);
 await build({entryPoints:[join(here,'probe-worker.mjs')],outfile:join(here,'probe-worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
 // Use the installed Cloudflare SDK's own SQL splitter so trigger bodies and
 // migration transactions retain their complete statements. No triggers removed.
 const sdk=readFileSync(runtimeModule,'utf8');
 const parserStart=sdk.indexOf('function trimSqlQuery(sql)'),parserEnd=sdk.indexOf('__name(classifyIdentifier, "classifyIdentifier");',parserStart)+'__name(classifyIdentifier, "classifyIdentifier");'.length;
 assert.ok(parserStart>=0&&parserEnd>parserStart);
 const parser=sdk.slice(parserStart,parserEnd),split=vm.runInNewContext(parser+'\nsplitSqlQuery',{__name:value=>value,UserError:Error});summary.sqlSplitterSha256=hash(parser);
 let releaseRefund;const refundGate=new Promise(done=>{releaseRefund=done});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:join(here,'probe-worker.js'),compatibilityDate:'2026-11-10',d1Databases:{DB:'stage3-local-only'},bindings:{TOMTOM_ENABLED:'true',TOMTOM_API_KEY:'offline-d1-route-fixture',REQUIRE_COMMERCIAL_ROUTES:'true',MOYASAR_ENABLED:'true',MOYASAR_SECRET_KEY:'sk_live_OFFLINE_D1_FIXTURE_ONLY'},outboundService:async request=>{
  const url=new URL(request.url);
  if(url.origin==='https://api.tomtom.com'&&url.pathname.startsWith('/routing/1/calculateRoute/')){
   summary.outbound.routeFixtures++;
   const points=url.pathname.slice('/routing/1/calculateRoute/'.length).replace(/\/json$/,'').split(':').map(value=>{const [latitude,longitude]=value.split(',').map(Number);return {latitude,longitude}});
   return Response.json({routes:[{summary:{lengthInMeters:2200,travelTimeInSeconds:420,trafficDelayInSeconds:20},legs:points.slice(1).map((p,index)=>({points:[points[index],p]}))}]});
  }
  if(url.origin==='https://api.moyasar.com'&&url.pathname.startsWith('/v1/payments/d1-local-provider')){
   if(request.method==='POST'){summary.outbound.refundPostFixtures++;return Response.json({error:'Synthetic acknowledgement lost'},{status:503})}
   summary.outbound.refundGetFixtures++;if(summary.outbound.refundGetFixtures===2)releaseRefund();
   await Promise.race([refundGate,new Promise((_,reject)=>setTimeout(()=>reject(Error('Refund requests did not overlap')),5000))]);
   return Response.json({id:'d1-local-provider',amount:2500,currency:'SAR',refunded:2500,status:'refunded'});
  }
  summary.outbound.unexpected++;return Response.json({error:'External network blocked'},{status:503});
 }}));
 const db=await mf.getD1Database('DB');
 for(const name of readdirSync(join(root,'apps/hub/drizzle')).filter(file=>file.endsWith('.sql')).sort()){
  const bytes=readFileSync(join(root,'apps/hub/drizzle',name)),statements=split(bytes.toString('utf8'));
  await db.batch(statements.map(sql=>db.prepare(sql)));
  summary.migrations.push({name,sha256:hash(bytes),statements:statements.length});
 }
 check('All application migrations applied unchanged',summary.migrations.length,readdirSync(join(root,'apps/hub/drizzle')).filter(name=>name.endsWith('.sql')).length);
 const triggers=await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").first();assert.ok(triggers.n>10);summary.triggerCount=triggers.n;summary.checks.push('Application triggers remain enabled');
 const at=new Date().toISOString(),captain='11111111-1111-4111-8111-111111111111',id='d1-local-trip';
 const pickup={name:'Synthetic pickup',lat:24.7,lng:46.6},destination={name:'Synthetic destination',lat:24.73,lng:46.63},stops=[{name:'Synthetic A',lat:24.71,lng:46.61},{name:'Synthetic B',lat:24.72,lng:46.62}];
 const vehicle={make:'Fixture',model:'Local',plate:'TEST',identityExpiry:'2030-01-01',licenseExpiry:'2030-01-01',registrationExpiry:'2030-01-01',insuranceExpiry:'2030-01-01'};
 await db.batch([
  db.prepare('INSERT INTO captain_applications VALUES(?,?,?,?,?,?,?,?,?,?)').bind(captain,'d1-local-captain','+966500000099','d1-local@example.test',JSON.stringify({name:'Synthetic captain'}),JSON.stringify(vehicle),'{}','active',at,at),
  db.prepare('INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').bind('rider:d1-local','Synthetic rider','+966500000098','rider-d1@example.test',at,at),
  db.prepare('INSERT INTO trips(id,rider_id,driver_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'rider:d1-local',captain,'riding',JSON.stringify(pickup),JSON.stringify(destination),3500,1000,'cash_due',0,at,at),
  db.prepare('INSERT INTO trip_commerce(trip_id,quote_id,method,cash_due_halalas) VALUES(?,?,?,?)').bind(id,'d1-local-quote','cash',3500),
  db.prepare('INSERT INTO trip_options(trip_id,stops_json,guest_name,business_note) VALUES(?,?,?,?)').bind(id,JSON.stringify(stops),'',''),
  db.prepare('INSERT INTO captain_presence VALUES(?,?,?,?,?,?,?)').bind(captain,1,at,24.72,46.62,5,at),
 ]);
 const call=async body=>{const response=await mf.dispatchFetch('https://d1-local.test/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}};
 const pending=await call({action:'complete',tripId:id});check('Pending stops refuse completion',pending.status,409);
 check('Pending completion moves no money',(await db.prepare('SELECT COUNT(*) n FROM wallet_entries').first()).n,0);
 check('Foreign captain cannot update stops',(await call({action:'stop',tripId:id,captain:'foreign',stopIndex:0,phase:'arrived'})).status,403);
 check('Stops cannot be skipped',(await call({action:'stop',tripId:id,stopIndex:1,phase:'arrived'})).status,409);
 for(const stopIndex of [0,1])for(const phase of ['arrived','departed']){
  check('Actual stop handler '+stopIndex+' '+phase,(await call({action:'stop',tripId:id,stopIndex,phase})).status,200);
  check('Actual stop retry is idempotent '+stopIndex+' '+phase,(await call({action:'stop',tripId:id,stopIndex,phase})).body.idempotent,true);
  const view=await call({action:'admin',tripId:id});check('Actual admin stop snapshot '+stopIndex+' '+phase,view.body.stopProgress.stops[stopIndex].status,phase);
 }
 const ready=await call({action:'admin',tripId:id});check('Final-leg ETA uses D1 JSON fingerprint and provider facts',ready.body.eta.durationSeconds,420);
 const raced=await call({action:'complete-race',tripId:id});check('D1 atomic settlement rechecks stop departures',raced.status,409);check('D1 NOT NULL error becomes a domain conflict',raced.body.code,'STOP_SEQUENCE_CONFLICT');
 check('D1 failed batch rolls back completion snapshot',(await db.prepare("SELECT COUNT(*) n FROM operation_events WHERE id=?").bind('completion-snapshot:'+id).first()).n,0);
 check('D1 failed batch rolls back settlement',(await db.prepare('SELECT COUNT(*) n FROM trip_settlements').first()).n,0);
 check('D1 failed batch leaves ledger untouched',(await db.prepare('SELECT COUNT(*) n FROM wallet_entries').first()).n,0);
 check('Restore departure through actual stop handler',(await call({action:'stop',tripId:id,stopIndex:1,phase:'departed'})).status,200);
 check('Actual completion succeeds once',(await call({action:'complete',tripId:id})).status,200);check('Completion retry cannot settle again',(await call({action:'complete',tripId:id})).status,409);
 check('One D1 settlement',(await db.prepare('SELECT COUNT(*) n FROM trip_settlements').first()).n,1);
 const finished=await call({action:'admin',tripId:id});check('Admin terminal status',finished.body.status,'completed');check('Terminal GPS closes',finished.body.driverLocation,null);check('Terminal ETA closes',finished.body.eta,null);
 await db.batch([
  db.prepare("INSERT INTO payment_intents(id,rider_id,purpose,method,amount_halalas,status,provider_id,created_at) VALUES('d1-local-intent','rider:d1-local','topup','card',2500,'paid','d1-local-provider',?)").bind(at),
  db.prepare('INSERT INTO wallet_entries VALUES(?,?,?,?,?,?,?,?)').bind('d1-local-credit','d1-local-credit','rider:d1-local',2500,0,'offline_fixture','d1-local',at),
  db.prepare('INSERT INTO wallet_entries VALUES(?,?,?,?,?,?,?,?)').bind('d1-local-debit','d1-local-credit','offline_external',-2500,0,'offline_fixture','d1-local',at),
 ]);
 const requested=await call({action:'refund-request'});check('Actual refund hold succeeds',requested.status,200);const refund=requested.body.id;
 check('Uncertain provider submission succeeds once',(await call({action:'refund-admin',input:{action:'submit',id:refund,confirm:true}})).status,200);
 check('Provider submission retry is blocked',(await call({action:'refund-admin',input:{action:'submit',id:refund,confirm:true}})).status,400);
 const reconciled=await Promise.all([call({action:'refund-admin',input:{action:'reconcile',id:refund}}),call({action:'refund-admin',input:{action:'reconcile',id:refund}})]);
 check('Concurrent actual D1 reconciliations both acknowledge',reconciled.map(row=>row.body.status),['refunded','refunded']);
 check('D1 refund claim is unique',(await db.prepare('SELECT COUNT(*) n FROM operation_events WHERE id=?').bind('refund-finalization:'+refund).first()).n,1);
 check('Only two balanced refund ledger lines',(await db.prepare("SELECT COUNT(*) n FROM wallet_entries WHERE kind='card_refund'").first()).n,2);
 check('Whole D1 ledger remains balanced',(await db.prepare('SELECT SUM(amount_halalas) n FROM wallet_entries').first()).n,0);
 check('Provider POST sent once to synthetic handler',summary.outbound.refundPostFixtures,1);check('No unexpected external request',summary.outbound.unexpected,0);
 check('Foreign key check remains clean',(await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 summary.status='PASS_LOCAL_WORKERD_D1';summary.assertions=summary.checks.length;
}catch(error){summary.status='FAIL';summary.error=String(error.message);process.exitCode=1}
finally{if(mf)await mf.dispose();writeFileSync(join(here,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({status:summary.status,assertions:summary.checks.length,migrations:summary.migrations.length,miniflare:summary.miniflare,workerd:summary.workerd,error:summary.error}));}
