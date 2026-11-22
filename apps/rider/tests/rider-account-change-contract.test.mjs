import test from 'node:test';
import assert from 'node:assert/strict';

const hub=new URL('../../hub/',import.meta.url);
const {makeEnv}=await import(new URL('tests/fixtures.mjs',hub));
const {freeAuth}=await import(new URL('worker/free-auth.js',hub));
const {accountSettings,settingsAdmin}=await import(new URL('worker/account-settings.js',hub));
async function setup(t){
  const env=makeEnv();t.after(()=>env.db.close());
  const registered=await freeAuth(env,'rider',{action:'register',name:'Local rider',phone:'0501234567',password:'old-local-pass',email:'rider@local.test',clientIp:'192.0.2.40'});
  assert.equal(registered.status,201);const token=(await registered.json()).sessionToken;
  // Phone ownership is a local test fixture, not evidence of SMS delivery.
  env.db.prepare('UPDATE public_accounts SET phone_verified_at=?').run(new Date().toISOString());
  return{env,token,call:body=>accountSettings(env,'rider',{sessionToken:token,...body}),session:async()=>await(await freeAuth(env,'rider',{action:'session',sessionToken:token})).json()};
}
const approve=(env,value)=>settingsAdmin(new Request('https://admin.local.test/api/admin/account-changes',{method:'POST',headers:{origin:'https://admin.local.test','content-type':'application/json'},body:JSON.stringify({id:value.id,stage:value.stage,code:value.code,confirmContact:true})}),env);

test('rider phone change preserves its immutable owner key only after old and new ownership approvals',async t=>{
  const h=await setup(t),before=await h.session();
  assert.equal((await h.call({action:'change-start',kind:'phone',value:'0509876543',oldPassword:'wrong'})).status,400);
  const started=await h.call({action:'change-start',kind:'phone',value:'0509876543',oldPassword:'old-local-pass'});assert.equal(started.status,201);const old=await started.json();
  assert.equal(old.stage,'old');assert.equal(old.mode,'manual');assert.equal((await h.call({action:'change-finish'})).status,400);
  assert.equal((await h.call({action:'change-check',code:old.code})).status,400,'browser cannot self-approve manual contact proof');
  assert.equal((await approve(h.env,old)).status,200);
  const next=await(await h.call({action:'change-status'})).json();assert.equal(next.stage,'new');assert.notEqual(next.code,old.code);
  assert.equal((await approve(h.env,old)).status,400);assert.equal((await h.call({action:'change-finish'})).status,400);
  assert.equal((await approve(h.env,next)).status,200);assert.equal((await h.call({action:'change-finish'})).status,200);
  const after=await h.session();assert.equal(after.profile.phone,'+966509876543');assert.equal(after.accountKey,before.accountKey);assert.equal(after.authenticated,true);
  assert.equal((await h.call({action:'change-finish'})).status,400,'approved change is consumed once');
});

test('rider password change uses the existing proof flow and stores no plaintext password',async t=>{
  const h=await setup(t),before=await h.session();
  const started=await h.call({action:'change-start',kind:'password',oldPassword:'old-local-pass',value:'new-local-pass'});assert.equal(started.status,201);const request=await started.json();
  assert.equal(request.stage,'old');assert.equal(h.env.db.prepare('SELECT new_value FROM account_changes').get().new_value,'');
  assert.equal((await h.call({action:'change-finish'})).status,400);await approve(h.env,request);assert.equal((await h.call({action:'change-finish'})).status,200);
  const row=h.env.db.prepare('SELECT password_hash FROM public_accounts').get();assert.notEqual(row.password_hash,'new-local-pass');
  assert.equal((await h.session()).accountKey,before.accountKey);
  assert.equal((await freeAuth(h.env,'rider',{action:'password-login',phone:'0501234567',password:'old-local-pass',clientIp:'192.0.2.41'})).status,400);
  assert.equal((await freeAuth(h.env,'rider',{action:'password-login',phone:'0501234567',password:'new-local-pass',clientIp:'192.0.2.42'})).status,200);
});

test('rider account-change state is role-bound, session-bound, and cancellation prevents later approval',async t=>{
  const h=await setup(t);assert.equal((await accountSettings(h.env,'captain',{sessionToken:h.token,action:'change-start',kind:'phone',value:'0509876543',oldPassword:'old-local-pass'})).status,401);
  const request=await(await h.call({action:'change-start',kind:'phone',value:'0509876543',oldPassword:'old-local-pass'})).json();
  assert.equal((await accountSettings(h.env,'rider',{sessionToken:'f'.repeat(64),action:'change-status'})).status,401);
  assert.equal((await h.call({action:'change-cancel'})).status,200);assert.equal((await approve(h.env,request)).status,400);assert.equal((await h.call({action:'change-finish'})).status,400);
});
