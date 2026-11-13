// Authentica is called exclusively from the Worker; never expose the API key to browsers.
const BASE = 'https://api.authentica.sa/api/v2';
export const authenticaReady = env => Boolean(env.AUTHENTICA_API_KEY && env.AUTHENTICA_TEMPLATE_ID);
async function call(env, endpoint, payload) {
  if (!authenticaReady(env)) throw Error('خدمة رسائل الجوال غير مهيأة: راجع AUTHENTICA_TEMPLATE_ID');
  let response, data;
  try {
    response = await fetch(`${BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'X-Authorization': env.AUTHENTICA_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
    });
    data = await response.json();
  } catch { throw Error('تعذر الاتصال بخدمة الرسائل، حاول لاحقًا'); }
  if (!response.ok) throw Error('مزود الرسائل رفض الطلب، تحقق من القالب والرصيد وإعدادات الحساب');
  return data;
}
export async function sendAuthenticaOtp(env, phone) {
  const data = await call(env, 'send-otp', { method: 'sms', phone, template_id: Number(env.AUTHENTICA_TEMPLATE_ID) });
  if (data.success !== true) throw Error('لم يؤكد مزود الرسائل إرسال رمز التحقق');
  return data;
}
export async function verifyAuthenticaOtp(env, phone, otp) {
  const data = await call(env, 'verify-otp', { phone, otp });
  return data.status === true;
}
