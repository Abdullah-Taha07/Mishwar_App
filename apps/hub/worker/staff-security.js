// Staff identity is resolved here, never from browser supplied role/email headers.
const encoder = new TextEncoder();
const now = () => Math.floor(Date.now()/1000);
export const SECTIONS = ['applications','documents','captains','riders','trips','wallets','transfers','support','reports','notifications','settings','staff','audit'];
export const ACTIONS = ['view','create','edit','approve','reject','delete','export'];
export const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
export const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const stmt = (env,sql,...args) => env.DB.prepare(sql).bind(...args);
export async function audit(env,actor,action,section,result,reference=null,approver=null) {
 await stmt(env,'INSERT INTO staff_audit VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),actor,action,section,result,reference,approver,now()).run();
}
export async function hashPassword(password,salt=token()) {
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 return salt+':'+Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function verifyPassword(password,stored) {
 const expected=await hashPassword(password,stored.split(':')[0]);let diff=expected.length^stored.length;
 for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^(stored.charCodeAt(i)||0);return diff===0;
}
export function validPermissions(p) {return Array.isArray(p)&&p.length<=91&&p.every(x=>typeof x==='string'&&SECTIONS.some(s=>ACTIONS.some(a=>x===s+':'+a)));}
export function sessionValid(s,t=now()) {return !!s&&s.status==='active'&&!s.revoked_at&&s.version===s.account_version&&t<s.expires_at&&t<s.last_activity+s.idle_seconds;}
export async function authenticateStaff(env,raw) {
 if(!/^[a-f0-9]{64}$/.test(raw||''))return null;
 const s=await stmt(env,'SELECT s.*,a.name,a.email,a.role,a.status,a.permissions,a.idle_seconds,a.version AS account_version FROM staff_sessions s JOIN staff_accounts a ON a.id=s.staff_id WHERE token_hash=?',await digest(raw)).first();
 if(s?.device_hash&&!await stmt(env,'SELECT token_hash FROM staff_devices WHERE token_hash=? AND staff_id=? AND revoked_at IS NULL AND expires_at>?',s.device_hash,s.staff_id,now()).first())return null;
 return sessionValid(s)?s:null;
}
async function issueSession(env,a,device,agent,startedAt=now()) {
 const raw=token(),t=startedAt;await stmt(env,'INSERT INTO staff_sessions VALUES(?,?,?,?,?,?,?,?,?)',await digest(raw),a.id,device,a.version,t,t+a.max_seconds,t,null,(/Android|iPhone|iPad|Windows|Macintosh|Linux/i.exec(agent)?.[0]||'جهاز غير محدد')).run();
 await audit(env,a.id,'session_started','staff','success');return {authenticated:true,sessionToken:raw,expiresAt:t+a.max_seconds};
}
export async function staffAuth(request,env) {
 const action=new URL(request.url).pathname.split('/').pop();
 if(request.method!=='POST')return reply({error:'طلب غير مسموح'},405);
 let b;try {const text=await request.text();if(text.length>8192)throw Error();b=JSON.parse(text);}catch{return reply({error:'بيانات غير صحيحة'},400);}
 if(action==='owner-attempt') {
  const key=await digest('owner-source:'+String(b.source||'unknown'));
  await stmt(env,'INSERT INTO staff_login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END',key,now()+900,now(),now()).run();
  const limit=await stmt(env,'SELECT attempts FROM staff_login_limits WHERE key=?',key).first();
  if(limit.attempts>15){await audit(env,'owner','login_rate_limited','staff','denied');return reply({error:'محاولات كثيرة؛ حاول لاحقًا'},429);}
  await audit(env,'owner',b.success?'login_success':'login_failed','staff',b.success?'success':'denied');return reply({ok:true});
 }
 if(action==='session'||action==='activity'||action==='logout') {
  const s=await authenticateStaff(env,b.sessionToken);if(!s)return reply({authenticated:false,error:'انتهت الجلسة أو تم إلغاء الوصول'},401);
  if(action==='logout'){await stmt(env,'UPDATE staff_sessions SET revoked_at=? WHERE token_hash=?',now(),s.token_hash).run();await audit(env,s.staff_id,'session_ended','staff','success');return reply({authenticated:false});}
  if(action==='activity')await stmt(env,'UPDATE staff_sessions SET last_activity=? WHERE token_hash=? AND revoked_at IS NULL',now(),s.token_hash).run();
  return reply({authenticated:true,staff:true,id:s.staff_id,name:s.name,permissions:JSON.parse(s.permissions),expiresAt:s.expires_at,idleExpiresAt:(action==='activity'?now():s.last_activity)+s.idle_seconds});
 }
 if(action==='complete') {
  const challenge=await digest(String(b.challenge||''));
  const p=await stmt(env,"SELECT * FROM staff_approvals WHERE challenge_hash=? AND kind='login'",challenge).first();
  if(!p||p.expires_at<=now()||p.status==='rejected'||p.status==='consumed')return reply({error:'انتهى طلب الدخول أو رُفض'},401);
  if(p.status!=='approved')return reply({pending:true},202);
  const a=await stmt(env,"SELECT * FROM staff_accounts WHERE id=? AND status='active'",p.staff_id).first();if(!a)return reply({error:'الدخول غير متاح'},401);
  const used=await stmt(env,"UPDATE staff_approvals SET status='consumed' WHERE id=? AND status='approved' AND expires_at>?",p.id,now()).run();
  if(!used.meta.changes)return reply({error:'طلب الدخول مستخدم بالفعل'},409);
  let deviceToken;
  if(a.policy==='device'){deviceToken=token();await stmt(env,'INSERT INTO staff_devices VALUES(?,?,?,?,NULL)',await digest(deviceToken),a.id,now(),now()+2592000).run();}
  const result=await issueSession(env,a,deviceToken?await digest(deviceToken):null,request.headers.get('user-agent')||'',p.approved_at);
  await audit(env,a.id,'login_success','staff','success',p.id,p.approved_by);
  return reply({...result,...(deviceToken?{deviceToken}:{})});
 }
 if(action!=='login')return reply({error:'المسار غير موجود'},404);
 const email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
 if(email.length>254||password.length>256)return reply({error:'بيانات الدخول غير صحيحة'},401);
 // Durable account and source limits, including unknown accounts. Source set only by trusted proxy.
 const keys=await Promise.all(['source:'+(request.headers.get('x-staff-source')||'unknown'),'email:'+email].map(digest));
 for(const key of keys){await stmt(env,'INSERT INTO staff_login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END',key,now()+900,now(),now()).run();const limit=await stmt(env,'SELECT attempts FROM staff_login_limits WHERE key=?',key).first();if(limit.attempts>15)return reply({error:'محاولات كثيرة؛ حاول مجددًا لاحقًا'},429);}
 const a=await stmt(env,'SELECT * FROM staff_accounts WHERE email=?',email).first();
 const ok=await verifyPassword(password,a?.password_hash||('0'.repeat(64)+':'+ '0'.repeat(64)));
 if(!a||!ok||a.status!=='active'){await audit(env,a?.id||'unknown','login_failed','staff','denied');return reply({error:'بيانات الدخول غير صحيحة أو الحساب غير معتمد'},401);}
 const device=await digest(String(b.deviceToken||''));
 const approved=a.policy==='device'?await stmt(env,'SELECT token_hash FROM staff_devices WHERE token_hash=? AND staff_id=? AND revoked_at IS NULL AND expires_at>?',device,a.id,now()).first():null;
 if(a.policy==='always'||a.policy==='device'&&!approved){
  const challenge=token(),approvalId=crypto.randomUUID();await stmt(env,"INSERT INTO staff_approvals (id,staff_id,kind,challenge_hash,device_hash,summary,created_at,expires_at) VALUES(?,?,'login',?,?,?,?,?)",approvalId,a.id,await digest(challenge),device,'طلب دخول / جهاز جديد — رمز المطابقة: '+approvalId.slice(0,8)+' — '+(/Android|iPhone|iPad|Windows|Macintosh|Linux/i.exec(request.headers.get('user-agent')||'')?.[0]||'جهاز غير محدد'),now(),now()+300).run();
  await audit(env,a.id,'login_pending','staff','pending');return reply({pending:true,challenge,approvalReference:approvalId.slice(0,8),expiresAt:now()+300},202);
 }
 await audit(env,a.id,'login_success','staff','success');return reply(await issueSession(env,a,approved?device:null,request.headers.get('user-agent')||''));
}
// Exact route registry. Unmapped routes fail closed for staff, including future APIs.
const READ = {
 'operations/captains':'captains','operations/riders':'riders','operations/trips':'trips','operations/live':'trips','trip-extras':'trips',
 'operations/finance':'reports','operations/reports':'reports','operations/support':'support','operations/events':'audit',
 'operations/settings':'settings','commerce/wallets':'wallets','commerce/withdrawals':'transfers','commerce/destinations':'transfers','commerce/driver-payments':'transfers','commerce/captain-settlements':'transfers','commerce/captain-categories':'captains','commerce/controls':'captains',
 'launch/documents':'documents','launch/renewals':'documents','launch/cases':'support','launch/incidents':'support','launch/chat-audit':'support','launch/reconciliation':'reports','launch/refunds':'transfers',
 'launch/metrics':'reports','launch/reservations':'trips','expansion/fleet':'trips','notifications':'notifications'
};
export function routePermission(path,method,b={}) {
 const suffix=path.replace(/^\/api\/admin\//,'');let section=READ[suffix];
 if(/^applications(?:\/[-\w]+)?$/.test(suffix))section='applications';
 if(/^applications\/[-\w]+\/documents\/[-\w]+$/.test(suffix))section='documents';
 if(method==='GET')return section?[section,'view']:null;
 if(method!=='POST')return null;
 if(/^applications\/[-\w]+\/review$/.test(suffix))return ['applications',b.decision==='active'?'approve':b.decision==='rejected'?'reject':'invalid'];
 if(suffix==='launch/renewals')return ['documents',b.decision==='approved'?'approve':b.decision==='rejected'?'reject':'invalid'];
 if(suffix==='commerce/withdrawals')return ['transfers',b.decision==='paid'?'approve':b.decision==='rejected'?'reject':'invalid'];
 if(suffix==='commerce/captain-settlements')return ['transfers','create'];
 if(suffix==='commerce/destinations')return ['transfers','approve'];
 if(suffix==='commerce/captain-categories')return ['captains','edit'];
 if(suffix==='commerce/controls'&&['captain','rider'].includes(b.role))return [b.role==='captain'?'captains':'riders','edit'];
 if(suffix==='operations/settings')return ['settings','edit'];
 if(suffix==='operations/support')return ['support',b.id?'edit':'create'];
 // Other mutations require explicit review of their payload contract before delegation.
 return null;
}
export async function guardStaff(request,env,s) {
 const url=new URL(request.url);if(url.pathname==='/api/admin/session')return null;
 let b={};if(request.method==='POST'){try{const text=await request.clone().text();if(text.length>16384)throw Error();b=JSON.parse(text)}catch{return reply({error:'بيانات غير صحيحة'},400);}}
 const p=routePermission(url.pathname,request.method,b);
 if(p&&url.searchParams.get('export')==='1')p[1]='export';
 if(!p||!JSON.parse(s.permissions).includes(p.join(':'))){await audit(env,s.staff_id,'access_denied',p?.[0]||'unknown','denied',url.pathname);return reply({error:'لا تملك الصلاحية المطلوبة'},403);}
 const sensitive=request.method==='POST'&&['transfers','settings'].includes(p[0])||p[1]==='export';
 if(sensitive){
  const fingerprint=await digest(JSON.stringify([s.staff_id,request.method,url.pathname,url.search,await request.clone().text()]));
  const approvalId=request.headers.get('x-staff-approval');
  if(approvalId){
   const approved=await stmt(env,"SELECT approved_by FROM staff_approvals WHERE id=? AND staff_id=? AND fingerprint=? AND kind='operation' AND status='approved' AND expires_at>?",approvalId,s.staff_id,fingerprint,now()).first();
   if(approved){const used=await stmt(env,"UPDATE staff_approvals SET status='consumed' WHERE id=? AND status='approved' AND expires_at>?",approvalId,now()).run();if(used.meta.changes){await audit(env,s.staff_id,'sensitive_authorized',p[0],'success',approvalId,approved.approved_by);return null;}}
   return reply({error:'الموافقة غير صالحة لهذه العملية أو استُخدمت'},403);
  }
  const existing=await stmt(env,"SELECT id FROM staff_approvals WHERE staff_id=? AND fingerprint=? AND status='pending' AND expires_at>?",s.staff_id,fingerprint,now()).first();
  const id=existing?.id||crypto.randomUUID();
  if(!existing)await stmt(env,"INSERT INTO staff_approvals (id,staff_id,kind,fingerprint,summary,created_at,expires_at) VALUES(?,?,'operation',?,?,?,?)",id,s.staff_id,fingerprint,JSON.stringify({method:request.method,path:url.pathname,query:url.search,body:Object.fromEntries(Object.entries(b).filter(([key])=>['id','captainId','decision','amount','reference','requestId','confirmReceived','confirmOwnership','reason','transferReference','transferred','commission_bps'].includes(key)))}),now(),now()+300).run();
  await audit(env,s.staff_id,'sensitive_pending',p[0],'pending',id);return reply({error:'بانتظار موافقة المالك؛ أعد المحاولة بعد الاعتماد خلال خمس دقائق',approvalId:id},202);
 }
 return null;
}
export async function securityAdmin(request,env,owner,staff) {
 const url=new URL(request.url),action=url.pathname.split('/').pop();
 const readPermission=action==='audit'?'audit:view':action==='accounts'?'staff:view':null;
 if(!owner&&!(request.method==='GET'&&staff&&readPermission&&JSON.parse(staff.permissions).includes(readPermission))){if(staff)await audit(env,staff.staff_id,'access_denied','staff','denied',url.pathname);return reply({error:'هذه العملية للمالك فقط'},403);}
 if(request.method==='GET') {
  if(action==='accounts')return reply({items:(await stmt(env,'SELECT id,name,email,role,status,permissions,policy,max_seconds,idle_seconds,created_at FROM staff_accounts ORDER BY created_at DESC LIMIT 200').all()).results,sections:SECTIONS,actions:ACTIONS});
  if(action==='approvals')return reply({items:(await stmt(env,"SELECT p.id,p.staff_id,a.name,p.kind,p.summary,p.status,p.created_at,p.expires_at,p.approved_by FROM staff_approvals p JOIN staff_accounts a ON a.id=p.staff_id WHERE p.status='pending' AND p.expires_at>? ORDER BY p.created_at DESC LIMIT 200",now()).all()).results});
  if(action==='sessions')return reply({items:(await stmt(env,'SELECT s.token_hash AS id,s.staff_id,a.name,s.started_at,s.expires_at,s.last_activity,s.revoked_at,s.agent,a.idle_seconds FROM staff_sessions s JOIN staff_accounts a ON a.id=s.staff_id ORDER BY s.started_at DESC LIMIT 200').all()).results,devices:(await stmt(env,'SELECT token_hash AS id,staff_id,approved_at,expires_at,revoked_at FROM staff_devices ORDER BY approved_at DESC LIMIT 200').all()).results});
  if(action==='audit'){const q=url.searchParams;return reply({items:(await stmt(env,'SELECT * FROM staff_audit WHERE actor LIKE ? AND section LIKE ? AND action LIKE ? AND created_at>=? AND created_at<=? ORDER BY created_at DESC LIMIT 200','%'+(q.get('actor')||'')+'%','%'+(q.get('section')||'')+'%','%'+(q.get('action')||'')+'%',Number(q.get('from')||0),Number(q.get('to')||now())).all()).results});}
 }
 if(request.method!=='POST')return reply({error:'طلب غير مسموح'},405);
 let b;try{const text=await request.text();if(text.length>16384)throw Error();b=JSON.parse(text)}catch{return reply({error:'بيانات غير صحيحة'},400);}
 const actor='owner';
 if(action==='accounts') {
  if(b.id){
   const a=await stmt(env,'SELECT * FROM staff_accounts WHERE id=?',String(b.id)).first();if(!a)return reply({error:'بيانات غير صحيحة'},404);
   if(!['pending','active','rejected','suspended'].includes(b.status)||!validPermissions(b.permissions)||!['device','always','account'].includes(b.policy)||![3600,14400,28800].includes(b.max_seconds)||![600,900,1800].includes(b.idle_seconds))return reply({error:'راجع الحالة والصلاحيات وسياسة الجلسة'},400);
   if(b.password!==undefined&&(typeof b.password!=='string'||b.password.length<16||b.password.length>256))return reply({error:'كلمة المرور الجديدة يجب أن تكون من ١٦ إلى ٢٥٦ حرفًا'},400);
   const replacementHash=b.password?await hashPassword(b.password):a.password_hash;
   await env.DB.batch([stmt(env,'UPDATE staff_accounts SET password_hash=?,status=?,permissions=?,policy=?,max_seconds=?,idle_seconds=?,version=version+1 WHERE id=?',replacementHash,b.status,JSON.stringify([...new Set(b.permissions)]),b.policy,b.max_seconds,b.idle_seconds,a.id),stmt(env,'UPDATE staff_sessions SET revoked_at=? WHERE staff_id=? AND revoked_at IS NULL',now(),a.id),stmt(env,"UPDATE staff_approvals SET status='rejected' WHERE staff_id=? AND status IN ('pending','approved')",a.id)]);
   if(a.status!==b.status)await audit(env,actor,'account_'+b.status,'staff','success',a.id);
   if(b.password)await audit(env,actor,'password_changed','staff','success',a.id);
   await audit(env,actor,'account_permissions_updated','staff','success',a.id);return reply({ok:true});
  }
  const email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim(),role=String(b.role||'').trim(),password=String(b.password||'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||email===env.CAPTAIN_ADMIN_EMAIL?.trim().toLowerCase()||name.length<2||name.length>100||role.length<2||role.length>60||/owner|\u0645\u0627\u0644\u0643/i.test(role)||password.length<16||password.length>256)return reply({error:'راجع البيانات؛ كلمة المرور ١٦ حرفًا على الأقل، ولا يمكن إنشاء مالك'},400);
  const id=crypto.randomUUID();try{await stmt(env,'INSERT INTO staff_accounts (id,name,email,role,password_hash,created_at) VALUES(?,?,?,?,?,?)',id,name,email,role,await hashPassword(password),now()).run();}catch{return reply({error:'تعذر إنشاء الحساب؛ تحقق من البريد'},409);}
  await audit(env,actor,'account_created','staff','pending',id);return reply({ok:true,id},201);
 }
 if(action==='approvals') {
  if(!['approved','rejected'].includes(b.status))return reply({error:'قرار غير صحيح'},400);
  const changed=await stmt(env,"UPDATE staff_approvals SET status=?,approved_by=?,approved_at=? WHERE id=? AND status='pending' AND expires_at>?",b.status,actor,now(),String(b.id),now()).run();
  if(!changed.meta.changes)return reply({error:'الطلب منتهي أو تمت مراجعته'},409);await audit(env,actor,'approval_'+b.status,'staff','success',String(b.id),actor);return reply({ok:true});
 }
 if(action==='revoke') {
  if(b.device){const d=await stmt(env,'SELECT staff_id FROM staff_devices WHERE token_hash=?',String(b.device)).first();if(!d)return reply({error:'بيانات غير صحيحة'},404);await env.DB.batch([stmt(env,'UPDATE staff_devices SET revoked_at=? WHERE token_hash=?',now(),String(b.device)),stmt(env,'UPDATE staff_sessions SET revoked_at=? WHERE device_hash=?',now(),String(b.device))]);}
  else if(b.session)await stmt(env,'UPDATE staff_sessions SET revoked_at=? WHERE token_hash=?',now(),String(b.session)).run();
  else if(b.staffId)await stmt(env,'UPDATE staff_sessions SET revoked_at=? WHERE staff_id=?',now(),String(b.staffId)).run();else return reply({error:'حدد جلسة أو موظفًا أو جهازًا'},400);
  await audit(env,actor,'access_revoked','staff','success',String(b.staffId||b.session||b.device));return reply({ok:true});
 }
 return reply({error:'المسار غير موجود'},404);
}
