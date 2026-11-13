// Authentica is called exclusively from the Worker; never expose the API key to browsers.
const BASE = 'https://api.authentica.sa/api/v2';
export const authenticaReady = env => Boolean(env.AUTHENTICA_API_KEY && env.AUTHENTICA_TEMPLATE_ID);
async function call(env, endpoint, payload) {
  if (!authenticaReady(env)) throw Error('خدمة رسائل الجوال غير مهيأة: راجع AUTHENTICA_TEMPLATE_ID');
  let response;
  try {
    response = await fetch(`${BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'X-Authorization': env.AUTHENTICA_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
    });
  } catch { throw Error('تعذر الاتصال بمزوّد الرسائل، حاول لاحقًا'); }
  // Never log provider response bodies: they can contain OTPs or phone numbers.
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    console.error('AUTHENTICA_REQUEST_FAILED', {operation:endpoint, httpStatus:response.status});
    if(response.status===429)throw Error('الحد المسموح لطلبات التحقق لدى مزوّد الرسائل انتهى مؤقتًا. حاول لاحقًا.');
    if(response.status===401||response.status===403)throw Error('مزوّد الرسائل رفض بيانات الربط؛ راجع مفتاح Authentica في Cloudflare.');
    if(endpoint==='verify-otp')throw Error('مزوّد الرسائل لم يقبل رمز التحقق (HTTP '+response.status+'). تأكد من أحدث رمز وصلك، أو راجع سجل Cloudflare.');
    throw Error('مزوّد الرسائل رفض إرسال الرمز (HTTP '+response.status+'). راجع القالب والرصيد وإعدادات الحساب.');
  }
  if(!data || typeof data!=='object')throw Error('استجابة غير صالحة من مزوّد الرسائل.');
  return data;
}
export async function sendAuthenticaOtp(env, phone) {
  const data = await call(env, 'send-otp', { method: 'sms', phone, template_id: Number(env.AUTHENTICA_TEMPLATE_ID) });
  if (data.success !== true) throw Error('لم يؤكد مزود الرسائل إرسال رمز التحقق');
  return data;
}
export async function verifyAuthenticaOtp(env, phone, otp) {
  const data = await call(env, 'verify-otp', { phone, otp });
  return data.verified === true || data.status === true || data.status === 'verified';
}
