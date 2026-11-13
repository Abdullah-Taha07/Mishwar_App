import {passwordDigest,publicSession} from './free-auth.js';
import {tokenHash} from './rider-auth.js';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const hex=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
const validEmail=e=>typeof e==='string'&&e.length<=150&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword=p=>typeof p==='string'&&p.length>=8&&p.length<=128;
const appUrl=role=>role==='rider'?'https://mishwar-rider.vercel.app':'https://mishwar-captain.vercel.app';
async function send(env,to,subject,html){if(!env.RESEND_API_KEY||!env.MISHWAR_EMAIL_FROM)throw Error('إرسال البريد غير مهيأ على الخادم');const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.MISHWAR_EMAIL_FROM,to:[to],subject,html}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('تعذر إرسال البريد الآن')}
async function throttle(env,role,action,key){const bucket='email:'+role+':'+action+':'+await tokenHash(key)+':'+Math.floor(Date.now()/900000);const row=await env.DB.prepare('INSERT INTO access_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind(bucket).first();if(row.n>5)throw Error('طلبات كثيرة. حاول بعد ١٥ دقيقة')}
export async function emailAuth(env,role,b){try{
 const action=b.action, now=new Date().toISOString();
 if(action==='email-request-verification'||action==='email-request-reset'){
  const session=action==='email-request-verification'?await publicSession(env,b.sessionToken,role):null;
  const email=String(action==='email-request-verification'?session?.email||'':b.email||'').trim().toLowerCase();
  if(!validEmail(email))return reply({error:'أدخل بريدًا إلكترونيًا صحيحًا مرتبطًا بالحساب'},400);
  await throttle(env,role,action,email+':'+String(b.clientIp||''));
  const account=await env.DB.prepare('SELECT actor,email FROM public_accounts WHERE role=? AND lower(trim(email))=?').bind(role,email).first();
  if(action==='email-request-verification'&&(!session||session.actor!==account?.actor))return reply({error:'سجّل الدخول أولًا'},401);
  const message={ok:true,message:'إذا كان البريد مرتبطًا بحساب، ستصلك رسالة خلال دقائق.'};
  if(!account)return reply(message);
  if(!env.RESEND_API_KEY||!env.MISHWAR_EMAIL_FROM)return reply({error:'خدمة البريد لم تُفعّل بعد. تواصل مع الإدارة.'},503);
  const token=hex(),purpose=action==='email-request-reset'?'reset':'verify',id=crypto.randomUUID(),expires=new Date(Date.now()+15*60000).toISOString();
  const url=new URL(appUrl(role));url.hash='email-'+purpose+'='+token;
  await env.DB.prepare('INSERT INTO email_auth_tokens(id,role,actor,purpose,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,role,account.actor,purpose,await tokenHash(token),expires,now).run();
  try{await send(env,email,purpose==='reset'?'استعادة كلمة مرور مشوار':'تأكيد بريدك في مشوار',`<div dir="rtl"><h2>مشوار</h2><p>${purpose==='reset'?'طلب استعادة كلمة المرور':'تأكيد البريد الإلكتروني'}</p><p><a href="${url.toString()}">اضغط هنا لإكمال الطلب</a></p><p>الرابط صالح لمدة 15 دقيقة ولمرة واحدة. تجاهل الرسالة إذا لم تطلبها.</p></div>`)}catch(e){await env.DB.prepare('DELETE FROM email_auth_tokens WHERE id=?').bind(id).run();throw e}
  return reply(message);
 }
 if(action==='email-confirm'||action==='email-reset-password'){
  const token=String(b.token||'');if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'رابط غير صالح'},400);
  const purpose=action==='email-confirm'?'verify':'reset';
  await throttle(env,role,action,String(b.clientIp||'')+':'+token.slice(0,8));
  const row=await env.DB.prepare('SELECT * FROM email_auth_tokens WHERE role=? AND purpose=? AND token_hash=? AND consumed_at IS NULL AND expires_at>?').bind(role,purpose,await tokenHash(token),now).first();if(!row)return reply({error:'الرابط مستخدم أو منتهي الصلاحية'},400);
  const account=await env.DB.prepare('SELECT actor,email FROM public_accounts WHERE actor=? AND role=?').bind(row.actor,role).first();if(!account)return reply({error:'الحساب غير موجود'},400);
  if(purpose==='reset'&&!validPassword(b.password))return reply({error:'كلمة المرور يجب أن تكون من ٨ إلى ١٢٨ حرفًا'},400);
  const consumed=env.DB.prepare('UPDATE email_auth_tokens SET consumed_at=? WHERE id=? AND consumed_at IS NULL').bind(now,row.id);
  const statements=[consumed];
  if(purpose==='verify')statements.push(env.DB.prepare('INSERT INTO verified_emails(role,actor,email,verified_at) VALUES(?,?,?,?) ON CONFLICT(role,actor) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at').bind(role,row.actor,account.email,now));
  else{const salt=hex();statements.push(env.DB.prepare('UPDATE public_accounts SET salt=?,password_hash=? WHERE actor=? AND role=?').bind(salt,await passwordDigest(b.password,salt),row.actor,role),env.DB.prepare('DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM public_sessions WHERE actor=? AND role=?)').bind(row.actor,role),env.DB.prepare('DELETE FROM public_sessions WHERE actor=? AND role=?').bind(row.actor,role),env.DB.prepare('DELETE FROM rider_sessions WHERE actor=?').bind(row.actor));}
  await env.DB.batch(statements);return reply({ok:true,message:purpose==='reset'?'تم تغيير كلمة المرور. سجل الدخول من جديد.':'تم توثيق البريد الإلكتروني.'});
 }
 return reply({error:'عملية غير معروفة'},400)
}catch(e){return reply({error:e.message||'تعذر إكمال الطلب'},/طلبات كثيرة/.test(e.message)?429:400)}}
