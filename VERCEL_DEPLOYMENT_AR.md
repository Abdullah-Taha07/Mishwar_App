# دليل نشر مشوار على Vercel وربطه بالخادم المركزي

هذه النسخة تضيف طبقة API Serverless لتطبيق الراكب، وتضيف دخولًا مستقلًا ومحميًا للوحة الإدارة. تظل قاعدة البيانات D1 ومخزن R2 والخادم المركزي الحالي على Cloudflare كما هي؛ لا تنشئ قاعدة بيانات جديدة ولا تنقل بيانات الرحلات.

## 1) مشاريع Vercel الثلاثة

اربط المستودع نفسه `Abdullah-Taha07/Mishwar_App` بثلاثة مشاريع منفصلة:

| التطبيق | Root Directory | Framework | Build Command | Output Directory |
|---|---|---|---|---|
| الراكب | `apps/rider` | Other | `npm run build` | `public` |
| الكابتن | `apps/hub` | Other | `npm run build` | `public` |
| الإدارة | `apps/admin` | Other | `npm run build` | `public` |

فعّل **Include files outside the root directory** للمشاريع التي تحتاج ملفات مشتركة من المستودع. ملفات `vercel.json` في كل مجلد تضبط أمر البناء ومجلد النشر. مشروع الكابتن يحتفظ بإعادة توجيه `/api/*` إلى Worker الحالي.

## 2) متغيرات مشروع الراكب على Vercel

من Project Settings → Environment Variables أضف:

- `HUB_URL` = `https://mishwar-api.abduuallah3.workers.dev`
- `HUB_SERVICE_KEY` = نفس قيمة سر Cloudflare `RIDER_SERVICE_KEY`

لا تضع المفتاح في ملفات الواجهة أو GitHub. لا تحتاج نسخة Vercel الجديدة من بوابة الراكب إلى `HUB_ACCESS_TOKEN` الخاص باستضافة ChatGPT Sites.

## 3) متغيرات مشروع الإدارة على Vercel

أضف:

- `HUB_URL` = `https://mishwar-api.abduuallah3.workers.dev`
- `ADMIN_SERVICE_KEY` = نفس قيمة سر Cloudflare `ADMIN_SERVICE_KEY`
- `ADMIN_LOGIN_PASSWORD` = كلمة مرور إدارة قوية وفريدة لا تقل عن 16 حرفًا.
- `ADMIN_SESSION_SECRET` = سر عشوائي مستقل لا يقل عن 32 حرفًا.

أنشئ كلمة المرور والسر داخل مدير كلمات المرور لديك أو مولّد موثوق. لا ترسلهما في المحادثة ولا تضعهما في GitHub. بعد حفظ المتغيرات أعد نشر مشروع الإدارة. جلسة الإدارة تحفظ في Cookie من نوع HttpOnly وSecure وتنتهي بعد 8 ساعات. توجد أداة تسجيل خروج في رأس لوحة الإدارة.

## 4) أسرار Cloudflare — لا تغيّر قاعدة البيانات

في Worker `mishwar-api` تأكد من وجود الأسرار التالية، وأن كل مفتاح يطابق نظيره في Vercel:

- `RIDER_SERVICE_KEY` ↔ `HUB_SERVICE_KEY` في مشروع الراكب.
- `ADMIN_SERVICE_KEY` ↔ `ADMIN_SERVICE_KEY` في مشروع الإدارة.

اترك D1 `mishwar-db` وR2 `mishwar-storage` وربطهما الحاليين كما هما. لا تنشئ D1 جديدة. لا تشارك قيم الأسرار مع أي شخص.

## 5) ترتيب النشر والاختبار

1. ارفع التعديلات إلى GitHub.
2. انشر مشروع الراكب بعد إضافة متغيراته.
3. اختبر `https://<rider-domain>/api/auth/session`؛ المتوقع JSON فيه `authenticated:false` عند عدم وجود جلسة، وليس صفحة Vercel 404.
4. انشر مشروع الكابتن من Root Directory `apps/hub`، مع بقاء Worker الحالي متصلًا بـ D1/R2.
5. أنشئ مشروع الإدارة من Root Directory `apps/admin`، أضف متغيرات الإدارة، ثم انشره.
6. افتح الإدارة وسجّل الدخول بكلمة المرور التي ضبطتها.
7. اختبر دورة فعلية: طلب راكب → ظهور عرض للكابتن → قبول الكابتن → ظهور الرحلة في الإدارة → إنهاء الرحلة. لا تعتبر المنظومة متزامنة بالكامل قبل نجاح هذه الدورة.

## ملاحظات مهمة

- ملفات المصدر لا تحتوي أسرار التشغيل؛ لا تضع أي مفاتيح حقيقية داخل `.env.example`.
- إعداد Twilio/SMS وبوابة الدفع ما زال مستقلًا عن نشر الواجهات. نجاح نشر التطبيقات لا يعني تفعيل SMS أو الدفع الإلكتروني.
- إذا كانت أسماء مشاريع Vercel أو النطاقات مختلفة، لا يلزم تغيير منطق قاعدة البيانات؛ استخدم نطاق الإنتاج الفعلي عند إعداد CORS إذا أصبح هناك اتصال مباشر من المتصفح إلى Worker.
- المشروع الحالي يجعل الكابتن هو واجهة `apps/hub/public` وخادمه `apps/hub/worker`؛ لا يوجد مجلد مستقل باسم `apps/captain` في هذه النسخة.
