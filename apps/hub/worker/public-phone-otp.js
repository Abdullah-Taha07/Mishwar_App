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
    // Cooldown is checked before the hourly counter: a premature retry must not consume a send quota.
    const old=await env.DB.prepare('SELECT created_at FROM public_phone_otp WHERE role=? AND actor=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1').bind(role,actor).first();
    if(old && Date.now()-Date.parse(old.created_at)<60000)return reply({error:'انتظر دقيقة قبل طلب رمز جديد',retryAfter:Math.ceil((60000-(Date.now()-Date.parse(old.created_at)))/1000)},429);
    // Reserve a per-phone, per-role send lease atomically before calling the SMS provider.
    // Without it, two concurrent requests both see no challenge and send two SMS codes.
    // Keep the lease for 60 seconds even if the provider outcome is uncertain.
    const leaseKey=`otp:send-lease:${role}:${await tokenHash(phone)}`;
    const leaseStart=Date.now(),leaseExpiry=leaseStart+60000;
    const reserved=await env.DB.prepare('INSERT INTO access_rate_limits(bucket,n) VALUES(?,?) ON CONFLICT(bucket) DO UPDATE SET n=excluded.n WHERE n<=? RETURNING n').bind(leaseKey,leaseExpiry,leaseStart).first();
    if(!reserved)return reply({error:'هناك رمز تحقق قيد الإرسال. انتظر دقيقة ثم أعد المحاولة.',retryAfter:60},429);
    const bucket=`otp:${await tokenHash(phone)}:${Math.floor(Date.now()/3600000)}`;
    const limit=await env.DB.prepare('INSERT INTO access_rate_limits(bucket,n) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind(bucket).first();
    if(limit.n>3)return reply({error:'تجاوزت الحد المسموح لإرسال الرموز. حاول بعد ساعة'},429);
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
    // Provider I/O can outlive the challenge or the login session. Recheck all
    // ownership conditions inside the atomic batch, and consume last so every
    // effect uses the same still-unused proof. A second consumer has no effects.
    const eligible=`EXISTS (SELECT 1 FROM public_phone_otp p JOIN public_accounts a ON a.actor=p.actor AND a.role=p.role AND a.phone=p.phone JOIN public_sessions s ON s.token_hash=p.session_hash AND s.actor=p.actor AND s.role=p.role WHERE p.id=? AND p.role=? AND p.actor=? AND p.phone=? AND p.session_hash=? AND p.consumed_at IS NULL AND p.expires_at>? AND s.expires_at>?)${role==='rider'?' AND NOT EXISTS (SELECT 1 FROM rider_phone_accounts WHERE phone=? AND actor<>?)':''}`;
    const proof=[challenge.id,role,actor,phone,sessionHash,at,at,...(role==='rider'?[phone,actor]:[])];
    const ops=[
      env.DB.prepare(`UPDATE public_accounts SET phone_verified_at=?,verification_method=? WHERE role=? AND actor=? AND phone=? AND phone_verified_at IS NULL AND ${eligible}`).bind(at,'authentica_sms',role,actor,phone,...proof)
    ];
    if(role==='rider'){
      const prior=await env.DB.prepare('SELECT actor FROM rider_phone_accounts WHERE phone=?').bind(phone).first();
      if(prior && prior.actor!==actor)return reply({error:'الرقم مرتبط بحساب راكب آخر. تواصل مع الإدارة'},409);
      ops.push(env.DB.prepare(`INSERT INTO rider_phone_accounts(phone,actor,verified_at) SELECT ?,?,? WHERE ${eligible} ON CONFLICT(phone) DO NOTHING`).bind(phone,actor,at,...proof));
    }
    ops.push(env.DB.prepare(`UPDATE public_phone_otp SET consumed_at=? WHERE id=? AND ${eligible}`).bind(at,challenge.id,...proof));
    const results=await env.DB.batch(ops);
    if(!results.at(-1)?.meta?.changes)return reply({error:'الرمز مستخدم أو منتهي الصلاحية. سجّل الدخول واطلب رمزًا جديدًا'},400);
    return reply({ok:true,phoneVerified:true});
  }
  return reply({error:'عملية غير معروفة'},400);
}
