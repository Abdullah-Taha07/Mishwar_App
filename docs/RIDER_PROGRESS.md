# سجل تقدم تطبيق راكب مشوار

**نقطة الاستئناف الحالية — 19 نوفمبر 2026:** أُنجز إصلاح RIDER-007 واختباره محليًا من الأساس `d3c3b9a` على `work/rider-007-location-20261119`. التفاصيل ومعايير القبول وحدود التحقق في [تقرير GPS](RIDER_007_LOCATION_AR.md). نجاح الرفع إلى `dev/mishwar-shared` يُثبت بمطابقة SHA البعيد بعد الرفع؛ لا انتقال إلى RIDER-008 قبله. لا تُفسَّر النتائج المحلية على أنها جاهزية تجارية أو اختبار أجهزة ميداني. السجل السابق أدناه محفوظ.

آخر تحديث: **2026-11-19 15:57:39 (وقت جهاز التطوير)**.

المستودع: https://github.com/Abdullah-Taha07/Mishwar_App

الفرع السحابي المعتمد: **dev/mishwar-shared**. الفرع المحلي: **review/mishwar-clean-cloud-20261119**.

المجلد: `D:\Mishwar_App\cloud-review-workspace`. النسخ القديمة محفوظة ولا تُستبدل بها هذه النسخة.

آخر Commit مؤكد على GitHub عند إعداد هذا التحديث: `011903476248004dcb1965de327289a0e4a3032a`. مرحلة هذا التحديث: **RIDER-001**؛ تفاصيل الاختبارات أدناه. تأكيد Push اللاحق يُراجع من تاريخ Git ومن تطابق HEAD مع الفرع السحابي، ويُعرض SHA الجديد في تقرير المرحلة.

- ✅ RIDER-001: التنقل الأساسي محليًا على الكمبيوتر والجوال مع تأخير الجلسة والتحديثات الدورية؛ حفظ الوجهة دون إعادة معاملات.
- ⏳ RIDER-002/003: تشغيل اختبار المتصفح للحساب مع Worker/SQLite الحقيقيين محليًا، ثم RIDER-004 لإصلاح الخروج وإرسال OTP.
- ⬜ استكمال معايير قبول RIDER-001 إلى RIDER-012 بالترتيب، وإصلاح العيوب المثبتة فقط.
- ⬜ تفعيل واختبار الخدمات الخارجية في بيئة معتمدة، ثم الأجهزة الفعلية والتجربة المغلقة قبل الاعتماد التجاري.

نجاح البناء والاختبارات المحلية منفصل عن نجاح النشر والتشغيل الميداني. لا تنفذ هذه الجلسة نشرًا أو ترحيلًا إنتاجيًا أو عملية مالية حقيقية. نتائج R01–R29 السابقة تاريخية ومحلية؛ التفاصيل في [التقرير الموحد](MISHWAR_UNIFIED_STATUS_AR.md). لا تعني الجاهزية التجارية أو وصول SMS والبريد فعليًا.

مخاطر وخدمات تحتاج تحققًا: SMS والبريد الحقيقيان، بيئة خرائط ومفاتيح وحصص معتمدة، بوابة الدفع Sandbox، اللحظية والإشعارات الأصلية، إعدادات Cloudflare/D1/R2 والترحيلات غير المنشورة، اختبارات الضغط الشبكية والأجهزة الفعلية والمتطلبات التشغيلية والنظامية. Vercel Git deployments معطلة في ملفات التطبيقات؛ لم تُغير إعدادات الخدمة.

قواعد الحفظ: ملفات الخطوة فقط؛ اختبارات ناجحة؛ فحص أسرار؛ Commit؛ فحص أن الفرع السحابي لم يتغير؛ Push عادي إلى dev/mishwar-shared؛ تحقق SHA. عند فشل الاختبارات احتفظ بالعمل محليًا وسجّل الفشل، ولا تصفه بإصلاح ناجح.

<!-- RIDER_HISTORY -->

### RIDER-001 — إصلاح التنقل أثناء بدء الجلسة وإثبات الضغط الفعلي

- التاريخ: 2026-11-19 15:21:02 (الرياض).
- النتيجة المحلية: PASS.
- Commit المؤكد السابق: `011903476248004dcb1965de327289a0e4a3032a`.
- معرّف حفظ هذه المرحلة: Commit الذي أضاف هذا الإدخال؛ يُستخرج من `git log -- docs/RIDER_PROGRESS.md`، ويُعد محفوظًا سحابيًا عند تطابقه مع الفرع المشترك أو وجوده ضمن تاريخه المؤكد. لا يمكن كتابة SHA هذا الـCommit داخل نفسه.

- ✅ ثبت أن رد الجلسة الأول يغلق النوافذ عبر account-reset ويعيد عرض الرئيسية، دون تحميل مستند. حُفظت نية التنقل بأسماء شاشات محددة وأُعيد رسمها من الحالة الحالية بعد التحقق.
- ✅ أضيف إشعار قبل تنظيف الحساب لحفظ شاشة البحث قبل إغلاق مشتركي reset لها. يُلتقط فتح البحث عند التركيز على حقل العنوان، كما تُراعى نقطة فحص microtasks بين معالجات الضغط الفعلية.
- ✅ تُحفظ مسودات الدخول والاستعادة وإغلاق المستخدم للشاشة، ويُلغي تبديل المالك الوجهة المعلقة. تنتظر الشاشات الخاصة مزامنة بيانات صاحبها مع إعادة قراءة محدودة؛ لا يعاد إرسال حجز أو دفع أو استرداد.
- ✅ أضيف اختبار Edge بنقر حقيقي عبر CDP يغطي 11 وجهة وزائرًا ومستخدمًا وثلاثة أحجام، وتحديثات live الدورية وعزل الحسابات. المحاولة الأولية فشلت في المتصفح 63/140 رغم نجاح اختبارات الكود؛ لم تُحفظ كإصلاح ناجح، وأضيفت اختبارات ترتيب الأحداث والتركيز قبل التحقق النهائي.
- ✅ أُنشئ سجل التقدم وتعليمات الاستئناف. بُنيت التطبيقات الثلاثة، واستُبعدت تغييرات sw.js/version.json المولدة من ملفات هذه الخطوة.

| الاختبار | الناجح | الفاشل | المهمل |
|---|---:|---:|---:|
| اختبارات التطبيقات الشاملة: hub254 + rider178 + admin21 | 453/453 | 0 | 0 |
| اختبارات التشغيل المستقلة | 19/19 | 0 | 0 |
| اختبارات الأمان المستقلة | 7/7 | 0 | 0 |
| عقود الربط الثابتة (منفصلة عن اختبارات التطبيقات) | 19/19 | 0 | 0 |
| Edge التنقل الفعلي: 1440×1000 و390×844 و390×640 | 140/140 | 0 | 0 |
| Edge/PWA الصارم: مجموعات القبول | 22/22 | 0 | 0 |

الملفات الخاصة بالخطوة:

- `apps/rider/public/account-context.js`
- `apps/rider/public/navigation-ui.js`
- `apps/rider/public/live-booking.js`
- `apps/rider/public/i18n-catalog.js`
- `apps/rider/tests/account-isolation.test.mjs`
- `scripts/rider-navigation-browser.mjs`
- `docs/RIDER_PROGRESS.md`
- `docs/RIDER_RESUME.md`

الأدلة: إعادة التنفيذ: npm.cmd test؛ npm.cmd run test:ops؛ npm.cmd run test:security؛ npm.cmd run audit:source؛ node scripts/rider-navigation-browser.mjs apps/rider/dist/public؛ node scripts/rider-browser-smoke.mjs apps/rider/dist/public --pwa. الأدلة المحلية: .local-verification/rider-001-*.log وartifacts/rider-repairs-2026-11-15/navigation-final-20261119/observations.json وصور المتصفح. اختبارات account-isolation البالغ عددها40 جزء من453 وليست إضافة عليها.

المتبقي: لم يُنشر الإصلاح إلى الإنتاج. يلزم إثبات وظائف الحساب بمعالجات Worker وSQLite الحقيقية محليًا، ثم إصلاح العيوب المثبتة في إعلان نجاح الخروج عند فشل إبطال الجلسة، وتزامن إرسال OTP وحصته عبر Cron، وحارس GPS. R09 الخارجي والخدمات والاختبارات الميدانية باقية.

الخطوة التالية مباشرة: RIDER-002/003: تشغيل اختبار المتصفح للحساب مع Worker/SQLite الحقيقيين محليًا، ثم RIDER-004 لإصلاح الخروج وإرسال OTP.


### RIDER-002/003 — اختبارات حقيقية لبوابة المصادقة والخادم وSQLite؛ RIDER-004 إصلاح الخروج

- الوقت: 2026-11-19 15:57:39 (وقت الجهاز).
- النتيجة: PASS محليًا بناءً على exit code للاختبارات والعمليات والأمان وتدقيق المصدر.
- التسجيل والدخول وتدوير الجلسة والخروج والاستعادة قيد الانتظار وSMS بمحاكاة Authentica: جميعها عبر بوابة الراكب وWorker الحقيقي وقاعدة SQLite بالذاكرة، دون إنتاج أو إرسال SMS حقيقية.
- إصلاح استجابة الجلسة لتُرجع phoneVerified:true بعد نجاح OTP؛ وإصلاح عدم إعلان نجاح الخروج إذا فشل إبطال جلسة الخادم الدائم؛ عند الفشل لا تُحذف Cookie بوابة الراكب.
- الملفات: apps/hub/worker/rider-auth.js؛ apps/rider/tests/rider-auth-bridge-integration.test.mjs؛ وثيقتا التقدم والاستئناف.
- سجل الفحص الكامل: محفوظ محليًا في مجلد النسخة الاحتياطية المذكور في PowerShell وليس على GitHub.
- التالي: اختبارات تفاعل شاشات الحساب الحقيقية في Edge مع Worker/SQLite المحليين، ثم فحص تزامن وتحديد حصص OTP وGPS. لا تزعم جاهزية الإنتاج أو وصول SMS الحقيقية.
- بعد الحفظ تحقق من Commit GitHub عبر تاريخ الفرع؛ لم يتم نشر أي نسخة إنتاجية.


### RIDER-005 - REAL BROWSER AUTH

- Checkpoint: 2026-11-19 16:22:19 (local development workstation).
- PASS: Edge/Chromium real pointer clicks and form submissions against rider gateway plus shared Worker auth and migration-backed in-memory SQLite.
- Covered: guest login, registration, synthetic Authentica OTP, logout, re-login, pending recovery and accurate CDP main-frame navigation/document marker checks. PWA precache GET / is NOT a user-facing reload.
- Production connections blocked. Test uses fake phone/email/password and fake SMS provider; production behavior NOT verified.
- Evidence: C:\Users\abdul\AppData\Local\Temp\Mishwar_RIDER_005_PWA_Fix_20261119_162133 (local only).
- Next: complete more varied owner/account browser scenarios, verify OTP quota concurrency and GPS policy, then route/pricing/booking checks.
- All source modifications saved to dev/mishwar-shared only; no main or deployment.


### RIDER-006 - ATOMIC OTP SEND LEASE

- Checkpoint: 2026-11-19 16:42:26 (local development device time).
- PASS: atomic per-role/per-phone send lease prevents duplicate simultaneous Authentica requests and preserves the normal hourly SMS quota.
- Fixed R09 legacy assertion: hourly quota query explicitly excludes otp:send-lease rows (which carry expiration timestamps).
- All targeted SMS tests, full project tests, real Edge auth browser, operations, security and source audit passed locally.
- Files: apps/hub/worker/public-phone-otp.js; apps/hub/tests/rider-otp-concurrency.test.mjs; apps/hub/tests/r09-otp-email.test.mjs.
- Logs and backups (local only): C:\Users\abdul\AppData\Local\Temp\Mishwar_RIDER_006_Resume_20261119_164139.
- Next: GPS permission accuracy/freshness checks; TomTom route/pricing; booking flow. Real SMS and production behavior not yet verified.
- GitHub milestone is confirmed only by verifying pushed SHA in the script. No main or production deployment.
