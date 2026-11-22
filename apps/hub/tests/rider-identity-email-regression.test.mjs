import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {freeAuth,publicSession,passwordDigest} from '../worker/free-auth.js';
import {handleRiderAuth,riderSession,tokenHash} from '../worker/rider-auth.js';
import {handleLiveRider} from '../worker/commerce.js';
import {emailAuth} from '../worker/email-auth.js';
import {accountSettings,settingsAdmin} from '../worker/account-settings.js';

const nativeFetch=globalThis.fetch;
test.beforeEach(()=>{globalThis.fetch=async()=>{throw Error('Network forbidden in regression tests')}});
test.afterEach(()=>{globalThis.fetch=nativeFetch});
const request=body=>new Request('https://offline.test/internal/live-rider',{method:'POST',headers:{'x-mishwar-key':'test-rider-key','Content-Type':'application/json'},body:JSON.stringify(body)});
const authRequest=body=>new Request('https://offline.test/internal/rider-auth',{method:'POST',headers:{'x-mishwar-key':'test-rider-key','Content-Type':'application/json'},body:JSON.stringify(body)});
function environment(t){const e=makeEnv();t.after(()=>e.db.close());return e}
async function account(e,role='rider',email='old@example.test',phone='0500000007'){
 const registered=await freeAuth(e,role,{action:'register',name:'Offline account',phone,email,password:'offline-old-password',clientIp:'offline'});
 assert.equal(registered.status,201);
 const data=await registered.json();
 return {...data,actor:(await publicSession(e,data.sessionToken,role)).actor,role};
}
async function issue(e,a,purpose='verify'){
 e.RESEND_API_KEY='offline-only';e.MISHWAR_EMAIL_FROM='offline@example.test';let mail;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');mail=JSON.parse(options.body);return Response.json({id:'offline-message'})};
 const response=await emailAuth(e,a.role,{action:purpose==='verify'?'email-request-verification':'email-request-reset',sessionToken:a.sessionToken,email:'old@example.test',clientIp:'offline'});
 assert.equal(response.status,200);assert.ok(mail);
 const token=mail.html.match(/email-(?:verify|reset)=([a-f0-9]{64})/)[1];
 globalThis.fetch=async()=>{throw Error('Network forbidden after mocked mail')};
 return token;
}
async function changeProfile(e,a,email){
 e.db.prepare('UPDATE public_accounts SET phone_verified_at=? WHERE actor=? AND role=?').run(new Date().toISOString(),a.actor,a.role);
 const r=await handleRiderAuth(authRequest({action:'profile',sessionToken:a.sessionToken,name:'Offline account',email}),e);
 assert.equal(r.status,200,await r.text());
}
async function changeSettings(e,a,email){
 e.db.prepare('UPDATE public_accounts SET phone_verified_at=? WHERE actor=? AND role=?').run(new Date().toISOString(),a.actor,a.role);
 const start=await accountSettings(e,a.role,{action:'change-start',kind:'email',value:email,oldPassword:'offline-old-password',sessionToken:a.sessionToken});assert.equal(start.status,201);
 const pending=await start.json();
 const approval=await settingsAdmin(new Request('https://offline.test/api/admin/account-changes',{method:'POST',headers:{origin:'https://offline.test'},body:JSON.stringify({id:pending.id,stage:pending.stage,code:pending.code,confirmContact:true})}),e);assert.equal(approval.status,200);
 const finish=await accountSettings(e,a.role,{action:'change-finish',sessionToken:a.sessionToken});assert.equal(finish.status,200,await finish.text());
}

test('rider private session rejects caller identity without credentials before any rider upsert',async t=>{
 const e=environment(t);const at=new Date().toISOString();
 e.db.prepare('INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').run('rider:other-account','Private name','+966500000001','private@example.test',at,at);
 const before=e.db.prepare('SELECT * FROM riders').all();
 for(const sessionToken of [undefined,'a'.repeat(64)]){
  const r=await handleLiveRider(request({action:'live_session',actor:'other-account',platformActor:'other-account',email:'changed@example.test',profile:{name:'Forged name'},sessionToken}),e);
  assert.equal(r.status,401);assert.doesNotMatch(await r.text(),/Private name|private@example.test/);
 }
 assert.deepEqual(e.db.prepare('SELECT * FROM riders').all(),before);
});

test('legacy OTP proof cannot attach an untrusted platform identity, including an older stored challenge',async t=>{
 const e=environment(t);Object.assign(e,{AUTHENTICA_API_KEY:'offline-api-key',AUTHENTICA_TEMPLATE_ID:'31'});
 globalThis.fetch=async(url,options)=>{assert.ok(String(url).startsWith('https://api.authentica.sa/'));const b=JSON.parse(options.body);return Response.json(String(url).endsWith('verify-otp')?{status:b.otp==='123456'}:{success:true})};
 const start=await handleRiderAuth(authRequest({action:'start',phone:'0500000003',name:'Offline OTP',platformActor:'victim-platform-account',clientIp:'offline'}),e);assert.equal(start.status,200);
 const challenge=await start.json();assert.equal(e.db.prepare('SELECT platform_actor FROM phone_challenges WHERE id=?').get(challenge.challengeId).platform_actor,'');
 // A pre-deployment challenge must not revive the old platform-actor fallback.
 e.db.prepare('UPDATE phone_challenges SET platform_actor=? WHERE id=?').run('victim-platform-account',challenge.challengeId);
 const checked=await handleRiderAuth(authRequest({action:'check',challengeId:challenge.challengeId,code:'123456'}),e);assert.equal(checked.status,200);
 const session=await riderSession(e,(await checked.json()).sessionToken);assert.notEqual(session.actor,'victim-platform-account');assert.match(session.actor,/^phone:/);
});

test('pending rider sessions expose only their own limited state and cannot book',async t=>{
 const e=environment(t),a=await account(e);
 const before=e.db.prepare('SELECT * FROM riders').all();
 for(const action of ['live_session','live_watch']){
  const r=await handleLiveRider(request({action,sessionToken:a.sessionToken,actor:'other-account',profile:{name:'Forged name'}}),e);assert.equal(r.status,200);
  const value=await r.json();assert.equal(value.verified,false);assert.equal(value.accountKey,await tokenHash('rider:'+a.actor));assert.equal(value.trip,null);assert.equal(value.recentTrip,null);assert.equal(value.wallet.balance,0);
 }
 assert.equal((await handleLiveRider(request({action:'live_book',sessionToken:a.sessionToken,actor:'other-account'}),e)).status,403);
 assert.deepEqual(e.db.prepare('SELECT * FROM riders').all(),before);
});

test('verified rider identity and account keys come from the session and remain stable across session/watch/auth',async t=>{
 const e=environment(t),a=await account(e);e.db.prepare('UPDATE public_accounts SET phone_verified_at=?').run(new Date().toISOString());
 const expected=await tokenHash('rider:'+a.actor);
 for(const action of ['live_session','live_watch']){
  const r=await handleLiveRider(request({action,sessionToken:a.sessionToken,actor:'other-account',profile:{name:'Forged name'}}),e);assert.equal(r.status,200);
  const value=await r.json();assert.equal(value.verified,true);assert.equal(value.accountKey,expected);
 }
 const auth=await(await handleRiderAuth(authRequest({action:'session',sessionToken:a.sessionToken}),e)).json();assert.equal(auth.accountKey,expected);
 const guest=await(await handleRiderAuth(authRequest({action:'session'}),e)).json();assert.equal(guest.authenticated,false);assert.equal(guest.accountKey,null);
 const legacyToken=e.verifiedToken('legacy-account');const legacy=await(await handleLiveRider(request({action:'live_session',sessionToken:legacyToken,actor:'other-account'}),e)).json();assert.equal(legacy.accountKey,await tokenHash('rider:legacy-account'));
});

test('email links bind a stored target address and an unchanged address can verify once',async t=>{
 const e=environment(t),a=await account(e),token=await issue(e,a);
 assert.equal(e.db.prepare('SELECT target_email FROM email_auth_tokens').get().target_email,'old@example.test');
 assert.equal((await emailAuth(e,'rider',{action:'email-confirm',token,clientIp:'offline'})).status,200);
 assert.equal(e.db.prepare('SELECT email FROM verified_emails').get().email,'old@example.test');
 assert.equal((await emailAuth(e,'rider',{action:'email-confirm',token,clientIp:'offline'})).status,400);
});

test('email issuance does not send or store a stale link if the address changes before insertion',async t=>{
 const e=environment(t),a=await account(e);Object.assign(e,{RESEND_API_KEY:'offline-only',MISHWAR_EMAIL_FROM:'offline@example.test'});
 let sends=0;globalThis.fetch=async()=>{sends++;return Response.json({id:'offline-message'})};
 const prepare=e.DB.prepare.bind(e.DB);
 e.DB.prepare=sql=>{const original=prepare(sql);if(!sql.startsWith('INSERT INTO email_auth_tokens'))return original;
  return {bind(...args){const bound=original.bind(...args);return {...bound,async run(){e.db.prepare('UPDATE public_accounts SET email=? WHERE actor=?').run('raced@example.test',a.actor);return bound.run()}}}};
 };
 const response=await emailAuth(e,'rider',{action:'email-request-verification',sessionToken:a.sessionToken,clientIp:'offline'});assert.equal(response.status,200);assert.equal(sends,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM email_auth_tokens').get().n,0);
});

test('valid reset and verification preserve role boundaries for rider and captain',async t=>{
 for(const role of ['rider','captain']){
  const e=environment(t),a=await account(e,role),verify=await issue(e,a);
  assert.equal((await emailAuth(e,role,{action:'email-confirm',token:verify,clientIp:'offline'})).status,200);
  const reset=await issue(e,a,'reset');assert.equal((await emailAuth(e,role,{action:'email-reset-password',token:reset,password:'offline-new-password',clientIp:'offline'})).status,200);
  assert.equal(await publicSession(e,a.sessionToken,role),null);
  const logged=await freeAuth(e,role,{action:'password-login',phone:'0500000007',password:'offline-new-password',clientIp:'offline'});assert.equal(logged.status,200);
  assert.equal(e.db.prepare('SELECT role,email FROM verified_emails').get().role,role);
 }
});

test('profile email change invalidates previous verification and reset links without verifying the new address',async t=>{
 const e=environment(t),a=await account(e),verify=await issue(e,a),reset=await issue(e,a,'reset');
 const oldHash=e.db.prepare('SELECT password_hash FROM public_accounts').get().password_hash;
 await changeProfile(e,a,'new@example.test');
 assert.equal((await emailAuth(e,'rider',{action:'email-confirm',token:verify,clientIp:'offline'})).status,400);
 assert.equal((await emailAuth(e,'rider',{action:'email-reset-password',token:reset,password:'different-password',clientIp:'offline'})).status,400);
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM verified_emails').get().n,0);
 assert.equal(e.db.prepare('SELECT password_hash FROM public_accounts').get().password_hash,oldHash);
 assert.ok(await publicSession(e,a.sessionToken,'rider'));
});

test('changing email back does not revive an old link, including captain shared account settings',async t=>{
 for(const role of ['rider','captain']){
  const e=environment(t),a=await account(e,role),token=await issue(e,a);
  await changeSettings(e,a,'new@example.test');await changeSettings(e,a,'old@example.test');
  assert.equal((await emailAuth(e,role,{action:'email-confirm',token,clientIp:'offline'})).status,400);
 }
});

test('legacy email tokens without an address snapshot fail without backfilling or deleting the row',async t=>{
 const e=environment(t),a=await account(e),token='e'.repeat(64),at=new Date().toISOString();
 e.db.prepare('INSERT INTO email_auth_tokens(id,role,actor,purpose,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run('legacy-email','rider',a.actor,'verify',await tokenHash(token),new Date(Date.now()+60000).toISOString(),at);
 assert.equal((await emailAuth(e,'rider',{action:'email-confirm',token,clientIp:'offline'})).status,400);
 const row=e.db.prepare('SELECT * FROM email_auth_tokens WHERE id=?').get('legacy-email');assert.equal(row.target_email,null);assert.equal(row.consumed_at,null);
});

test('email purpose and account role cannot be interchanged',async t=>{
 const e=environment(t),a=await account(e),token=await issue(e,a);
 assert.equal((await emailAuth(e,'captain',{action:'email-confirm',token,clientIp:'offline'})).status,400);
 assert.equal((await emailAuth(e,'rider',{action:'email-reset-password',token,password:'different-password',clientIp:'offline'})).status,400);
 assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM verified_emails').get().n,0);
 assert.equal(e.db.prepare('SELECT consumed_at FROM email_auth_tokens').get().consumed_at,null);
});

test('an email changed between token lookup and its batch causes no confirmation or reset side effects',async t=>{
 for(const purpose of ['verify','reset']){
  const e=environment(t),a=await account(e),token=await issue(e,a,purpose),oldHash=e.db.prepare('SELECT password_hash FROM public_accounts').get().password_hash;
  const batch=e.DB.batch.bind(e.DB);e.DB.batch=async items=>{e.db.prepare('UPDATE public_accounts SET email=? WHERE actor=?').run('raced@example.test',a.actor);return batch(items)};
  const r=await emailAuth(e,'rider',{action:purpose==='verify'?'email-confirm':'email-reset-password',token,password:'different-password',clientIp:'offline'});assert.equal(r.status,400);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM verified_emails').get().n,0);assert.equal(e.db.prepare('SELECT consumed_at FROM email_auth_tokens').get().consumed_at,null);
  assert.equal(e.db.prepare('SELECT password_hash FROM public_accounts').get().password_hash,oldHash);assert.ok(await publicSession(e,a.sessionToken,'rider'));
 }
});

test('two consumers that both read an unused token commit only one password reset',async t=>{
 const e=environment(t),a=await account(e),token=await issue(e,a,'reset'),prepare=e.DB.prepare.bind(e.DB),batch=e.DB.batch.bind(e.DB);
 let readers=0,release;const barrier=new Promise(r=>release=r);let queue=Promise.resolve();
 e.DB.prepare=sql=>{const original=prepare(sql);if(!sql.startsWith('SELECT * FROM email_auth_tokens'))return original;
  return {bind(...args){const bound=original.bind(...args);return {...bound,async first(){const row=await bound.first();if(++readers===2)release();await barrier;return row}}}};
 };
 e.DB.batch=items=>{const next=queue.then(()=>batch(items));queue=next.catch(()=>{});return next};
 const passwords=['first-new-password','second-new-password'];
 const responses=await Promise.all(passwords.map(password=>emailAuth(e,'rider',{action:'email-reset-password',token,password,clientIp:'offline'})));
 assert.deepEqual(responses.map(x=>x.status).sort(),[200,400]);
 const winner=responses.findIndex(x=>x.status===200),row=e.db.prepare('SELECT salt,password_hash FROM public_accounts').get();assert.equal(row.password_hash,await passwordDigest(passwords[winner],row.salt));
});
