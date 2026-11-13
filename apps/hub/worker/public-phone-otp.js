import { authenticaReady, sendAuthenticaOtp, verifyAuthenticaOtp } from './authentica.js';
import { tokenHash } from './rider-auth.js';
const reply = (data, status=200) => new Response(JSON.stringify(data), { status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'} });
const now = () => new Date().toISOString();
export async function publicPhoneOtp(env, role, body, session) {
  if (!session) return reply({error:'سجّل الدخول أولًا'},401);
  if (!authenticaReady(env)) return reply({error:'خدمة SMS غير مهيأة حاليًا',code:'SMS_NOT_CONFIGURED'},503);
  const actor=session.actor, phone=session.phone, sessionHash=session.token_hash;
  if (body.action === 'phone-otp-start') {
    if (session.phone_verified_at) return reply({ok:true,alreadyVerified:true});
    const bucket=`otp:${await tokenHash(phone)}:${Math.floor(Date.now()/3600000)}`;
    const limit=await env.DB.prepare('INSERT INTO access_rate_limits(bucket,n) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind(bucket).first();
    if(limit.n>3)return reply({error:'تجاوزت الحد المسموح لإرسال الرموز. حاول بعد ساعة'},429);
    const old=await env.DB.prepare('SELECT created_at FROM public_phone_otp WHERE role=? AND actor=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1').bind(role,actor).first();
    if(old && Date.now()-Date.parse(old.created_at)<60000)return reply({error:'انتظر دقيقة قبل طلب رمز جديد'},429);
    await sendAuthenticaOtp(env,phone);
    const id=crypto.randomUUID(),at=now();
    await env.DB.batch([
      env.DB.prepare('UPDATE public_phone_otp SET consumed_at=? WHERE role=? AND actor=? AND consumed_at IS NULL').bind(at,role,actor),
      env.DB.prepare('INSERT INTO public_phone_otp(id,role,actor,phone,session_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(id,role,actor,phone,sessionHash,at,new Date(Date.now()+10*60000).toISOString())
    ]);
    return reply({ok:true,retryAfter:60,expiresIn:600});
  }
  if(body.action==='phone-otp-check'){
    const code=String(body.code||'').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
    if(!/^\d{4,6}$/.test(code))return reply({error:'اكتب رمزًا من ٤ إلى ٦ أرقام'},400);
    const challenge=await env.DB.prepare('SELECT * FROM public_phone_otp WHERE role=? AND actor=? AND phone=? AND session_hash=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1').bind(role,actor,phone,sessionHash,now()).first();
    if(!challenge)return reply({error:'لا يوجد رمز صالح. اطلب رمزًا جديدًا'},400);
    const inc=await env.DB.prepare('UPDATE public_phone_otp SET attempts=attempts+1 WHERE id=? AND attempts<3 AND consumed_at IS NULL').bind(challenge.id).run();
    if(!inc.meta?.changes)return reply({error:'انتهت المحاولات. اطلب رمزًا جديدًا'},429);
    if(!await verifyAuthenticaOtp(env,phone,code))return reply({error:'الرمز غير صحيح أو انتهت صلاحيته'},400);
    const at=now();
    const ops=[
      env.DB.prepare('UPDATE public_phone_otp SET consumed_at=? WHERE id=? AND consumed_at IS NULL').bind(at,challenge.id),
      env.DB.prepare('UPDATE public_accounts SET phone_verified_at=?,verification_method=? WHERE role=? AND actor=? AND phone=? AND phone_verified_at IS NULL').bind(at,'authentica_sms',role,actor,phone)
    ];
    if(role==='rider'){
      const prior=await env.DB.prepare('SELECT actor FROM rider_phone_accounts WHERE phone=?').bind(phone).first();
      if(prior && prior.actor!==actor)return reply({error:'الرقم مرتبط بحساب راكب آخر. تواصل مع الإدارة'},409);
      ops.push(env.DB.prepare('INSERT INTO rider_phone_accounts(phone,actor,verified_at) VALUES(?,?,?) ON CONFLICT(phone) DO NOTHING').bind(phone,actor,at));
    }
    await env.DB.batch(ops);
    return reply({ok:true,phoneVerified:true});
  }
  return reply({error:'عملية غير معروفة'},400);
}
