# ملحق ملفات تدقيق main

المصدر الوحيد main. هذا ملحق [التقرير الكامل](../MISHWAR_MAIN_FULL_AUDIT_AR.md).

يسرد 426 ملفًا متتبعًا في نقطة فحص المصدر، إضافة إلى التقرير وهذا الملحق المنشأين للتسليم. البصمات الكاملة والإيصالات في الأدلة الخاصة؛ لا مفاتيح أو بيانات حسابات ضمن الملحق.

«جرد» يعني قراءة المسار والبايتات والفحص الآلي المنطبق؛ لا يعني مراجعة بشرية لكل سطر. إشارة مراجعة الراكب/التهيئة/Backend تعني دخول الملف في المجموعة المراجعة، مع قراءة يدوية موجهة للأجزاء الحساسة واختبارات السلوك المذكورة في التقرير. الأصول الثنائية وAndroid والتوثيق التاريخي لها حدود منفصلة واضحة.

## الملفات المتغيرة من أساس التدقيق

- [apps/admin/public/phone-verifications.js](../apps/admin/public/phone-verifications.js)
- [apps/admin/scripts/build.mjs](../apps/admin/scripts/build.mjs)
- [apps/admin/tests/packaging.test.mjs](../apps/admin/tests/packaging.test.mjs)
- [apps/admin/tests/phone-verifications-race.test.mjs](../apps/admin/tests/phone-verifications-race.test.mjs)
- [apps/admin/vercel.json](../apps/admin/vercel.json)
- [apps/hub/public/driver-services.js](../apps/hub/public/driver-services.js)
- [apps/hub/public/sw.js](../apps/hub/public/sw.js)
- [apps/hub/public/version.json](../apps/hub/public/version.json)
- [apps/hub/scripts/restore-isolated.mjs](../apps/hub/scripts/restore-isolated.mjs)
- [apps/hub/tests/launch-features.test.mjs](../apps/hub/tests/launch-features.test.mjs)
- [apps/hub/tests/main-backend-regression.test.mjs](../apps/hub/tests/main-backend-regression.test.mjs)
- [apps/hub/tests/main-captain-gps.test.mjs](../apps/hub/tests/main-captain-gps.test.mjs)
- [apps/hub/tests/main-commercial-itinerary.test.mjs](../apps/hub/tests/main-commercial-itinerary.test.mjs)
- [apps/hub/tests/main-restore-scope.test.mjs](../apps/hub/tests/main-restore-scope.test.mjs)
- [apps/hub/tests/pricing-snapshot.test.mjs](../apps/hub/tests/pricing-snapshot.test.mjs)
- [apps/hub/tests/road-data.test.mjs](../apps/hub/tests/road-data.test.mjs)
- [apps/hub/worker/commerce.js](../apps/hub/worker/commerce.js)
- [apps/hub/worker/commercial-maps.js](../apps/hub/worker/commercial-maps.js)
- [apps/hub/worker/expansion.js](../apps/hub/worker/expansion.js)
- [apps/hub/worker/launch-features.js](../apps/hub/worker/launch-features.js)
- [apps/hub/worker/launch-operations.js](../apps/hub/worker/launch-operations.js)
- [apps/hub/worker/road-data.js](../apps/hub/worker/road-data.js)
- [apps/rider/public/captain-tracking.js](../apps/rider/public/captain-tracking.js)
- [apps/rider/public/launch-ui.js](../apps/rider/public/launch-ui.js)
- [apps/rider/public/live-booking.js](../apps/rider/public/live-booking.js)
- [apps/rider/public/maps.js](../apps/rider/public/maps.js)
- [apps/rider/public/ride-ui.js](../apps/rider/public/ride-ui.js)
- [apps/rider/public/search-ui.js](../apps/rider/public/search-ui.js)
- [apps/rider/public/sw.js](../apps/rider/public/sw.js)
- [apps/rider/public/version.json](../apps/rider/public/version.json)
- [apps/rider/tests/account-isolation.test.mjs](../apps/rider/tests/account-isolation.test.mjs)
- [apps/rider/tests/launch-owner-response.test.mjs](../apps/rider/tests/launch-owner-response.test.mjs)
- [apps/rider/tests/map-provider-transition.test.mjs](../apps/rider/tests/map-provider-transition.test.mjs)
- [apps/rider/tests/notification-display.test.mjs](../apps/rider/tests/notification-display.test.mjs)
- [apps/rider/tests/search-accessibility.test.mjs](../apps/rider/tests/search-accessibility.test.mjs)
- [apps/rider/tests/tracking-recovery.test.mjs](../apps/rider/tests/tracking-recovery.test.mjs)
- [scripts/main-captain-smoke-browser.mjs](../scripts/main-captain-smoke-browser.mjs)
- [scripts/rider-browser-smoke.mjs](../scripts/rider-browser-smoke.mjs)
- [scripts/rider-navigation-browser.mjs](../scripts/rider-navigation-browser.mjs)
- [scripts/staff-security-browser.mjs](../scripts/staff-security-browser.mjs)
- [التقرير](../MISHWAR_MAIN_FULL_AUDIT_AR.md)
- هذا الملحق.

## جرد كل الملفات

| الملف | البايتات | الفحوص الآلية | مستوى المراجعة وحدوده |
|---|---:|---|---|
| [.github/workflows/checks.yml](../.github/workflows/checks.yml) | 380 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [.gitignore](../.gitignore) | 467 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [ADMIN_REPAIR_REPORT_AR.md](../ADMIN_REPAIR_REPORT_AR.md) | 7724 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [AUTHENTICA_SETUP_AR.md](../AUTHENTICA_SETUP_AR.md) | 3916 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [CHANGES_AR.md](../CHANGES_AR.md) | 2368 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [DOCUMENT_MANAGEMENT_CHANGES.md](../DOCUMENT_MANAGEMENT_CHANGES.md) | 4143 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [MISHWAR_RELEASE_AUDIT_AR.md](../MISHWAR_RELEASE_AUDIT_AR.md) | 3595 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [MISHWAR_UPDATE_REPORT_AR.md](../MISHWAR_UPDATE_REPORT_AR.md) | 3346 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [MISHWAR_UX_SYNC_RELEASE_AR.md](../MISHWAR_UX_SYNC_RELEASE_AR.md) | 6152 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [README_AR.md](../README_AR.md) | 33781 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [RELEASE_REVIEW_2026-11-13_AR.md](../RELEASE_REVIEW_2026-11-13_AR.md) | 7168 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [SOURCE_VERSIONS.json](../SOURCE_VERSIONS.json) | 171 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [STAFF_SECURITY_IMPLEMENTATION_AR.md](../STAFF_SECURITY_IMPLEMENTATION_AR.md) | 24333 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [VERCEL_DEPLOYMENT_AR.md](../VERCEL_DEPLOYMENT_AR.md) | 5074 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [android/.gitignore](../android/.gitignore) | 58 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/README_AR.md](../android/README_AR.md) | 2866 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/build.gradle](../android/app/build.gradle) | 962 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/admin/res/values/strings.xml](../android/app/src/admin/res/values/strings.xml) | 237 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/captain/res/values/strings.xml](../android/app/src/captain/res/values/strings.xml) | 233 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/main/AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml) | 1548 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/main/java/com/abdallataha/mishwar/ApkShareProvider.java](../android/app/src/main/java/com/abdallataha/mishwar/ApkShareProvider.java) | 1880 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/main/java/com/abdallataha/mishwar/LaunchPolicy.java](../android/app/src/main/java/com/abdallataha/mishwar/LaunchPolicy.java) | 706 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/main/java/com/abdallataha/mishwar/MainActivity.java](../android/app/src/main/java/com/abdallataha/mishwar/MainActivity.java) | 3007 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/main/res/drawable/ic_launcher.png](../android/app/src/main/res/drawable/ic_launcher.png) | 12675 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ بلا بناء APK أو جهاز Android |
| [android/app/src/main/res/values/colors.xml](../android/app/src/main/res/values/colors.xml) | 58 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/app/src/rider/res/values/strings.xml](../android/app/src/rider/res/values/strings.xml) | 231 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/build.gradle](../android/build.gradle) | 71 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/gradle.properties](../android/gradle.properties) | 78 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/gradle/wrapper/gradle-wrapper.jar](../android/gradle/wrapper/gradle-wrapper.jar) | 43705 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ بلا بناء APK أو جهاز Android |
| [android/gradle/wrapper/gradle-wrapper.properties](../android/gradle/wrapper/gradle-wrapper.properties) | 296 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/gradlew](../android/gradlew) | 9003 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/gradlew.bat](../android/gradlew.bat) | 2966 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/scripts/build-sdk.py](../android/scripts/build-sdk.py) | 3928 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/settings.gradle](../android/settings.gradle) | 277 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [android/tests/LaunchPolicyTest.java](../android/tests/LaunchPolicyTest.java) | 1064 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ بلا بناء APK أو جهاز Android |
| [apps/admin/.env.example](../apps/admin/.env.example) | 497 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/.gitignore](../apps/admin/.gitignore) | 44 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/.openai/hosting.json](../apps/admin/.openai/hosting.json) | 94 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/api/admin-auth/[action].js](../apps/admin/api/admin-auth/[action].js) | 4295 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/api/admin-auth/staff.js](../apps/admin/api/admin-auth/staff.js) | 2247 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/api/admin/[...path].js](../apps/admin/api/admin/[...path].js) | 4317 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/package.json](../apps/admin/package.json) | 223 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/account-recovery.js](../apps/admin/public/account-recovery.js) | 2183 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/admin-auth.js](../apps/admin/public/admin-auth.js) | 8080 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/admin-commerce.js](../apps/admin/public/admin-commerce.js) | 13158 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/admin.css](../apps/admin/public/admin.css) | 8898 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/applications.html](../apps/admin/public/applications.html) | 1604 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/applications.js](../apps/admin/public/applications.js) | 10770 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/dialogs.html](../apps/admin/public/dialogs.html) | 459 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/document-console.js](../apps/admin/public/document-console.js) | 9439 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/downloads/mishwar-admin.apk](../apps/admin/public/downloads/mishwar-admin.apk) | 33245 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/admin/public/expansion-console.js](../apps/admin/public/expansion-console.js) | 8550 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/icon-192.png](../apps/admin/public/icon-192.png) | 2759 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/admin/public/icon-512.png](../apps/admin/public/icon-512.png) | 2509 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/admin/public/icon-maskable-512.png](../apps/admin/public/icon-maskable-512.png) | 2509 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/admin/public/icon.svg](../apps/admin/public/icon.svg) | 331 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/index.html](../apps/admin/public/index.html) | 2726 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/install.html](../apps/admin/public/install.html) | 2987 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/install.js](../apps/admin/public/install.js) | 966 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/launch-console.js](../apps/admin/public/launch-console.js) | 17467 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/manifest.webmanifest](../apps/admin/public/manifest.webmanifest) | 716 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/phone-verifications.js](../apps/admin/public/phone-verifications.js) | 4349 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/portal.css](../apps/admin/public/portal.css) | 11592 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/portal.js](../apps/admin/public/portal.js) | 38720 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/realtime-client.js](../apps/admin/public/realtime-client.js) | 2590 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/responsive-ui.css](../apps/admin/public/responsive-ui.css) | 7297 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/secure-accounts.js](../apps/admin/public/secure-accounts.js) | 4378 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/staff-security.css](../apps/admin/public/staff-security.css) | 2791 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/staff-security.js](../apps/admin/public/staff-security.js) | 21483 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/public/sw.js](../apps/admin/public/sw.js) | 504 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/scripts/build.mjs](../apps/admin/scripts/build.mjs) | 2435 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/scripts/dev.mjs](../apps/admin/scripts/dev.mjs) | 2262 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/scripts/validate-artifact.mjs](../apps/admin/scripts/validate-artifact.mjs) | 978 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/tests/admin-ui.test.mjs](../apps/admin/tests/admin-ui.test.mjs) | 5262 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/admin/tests/packaging.test.mjs](../apps/admin/tests/packaging.test.mjs) | 4498 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/admin/tests/phone-verifications-race.test.mjs](../apps/admin/tests/phone-verifications-race.test.mjs) | 1913 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/admin/tests/proxy.test.mjs](../apps/admin/tests/proxy.test.mjs) | 2372 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/admin/tests/staff-proxy.test.mjs](../apps/admin/tests/staff-proxy.test.mjs) | 5201 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/admin/tests/support-drafts.test.mjs](../apps/admin/tests/support-drafts.test.mjs) | 8613 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/admin/tests/vercel-auth.test.mjs](../apps/admin/tests/vercel-auth.test.mjs) | 1796 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/admin/vercel.json](../apps/admin/vercel.json) | 250 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/admin/worker/index.js](../apps/admin/worker/index.js) | 2932 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/.env.example](../apps/hub/.env.example) | 482 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/.gitignore](../apps/hub/.gitignore) | 60 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/.openai/hosting.json](../apps/hub/.openai/hosting.json) | 98 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/README_PILOT.md](../apps/hub/README_PILOT.md) | 4971 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/dist-check/README.md](../apps/hub/dist-check/README.md) | 112 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/dist-check/index.js](../apps/hub/dist-check/index.js) | 791700 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/dist-check/index.js.map](../apps/hub/dist-check/index.js.map) | 912757 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/drizzle/0000_captain_applications.sql](../apps/hub/drizzle/0000_captain_applications.sql) | 392 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0001_captain_reviews.sql](../apps/hub/drizzle/0001_captain_reviews.sql) | 317 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0002_operations.sql](../apps/hub/drizzle/0002_operations.sql) | 1819 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0003_dispatch_wallet.sql](../apps/hub/drizzle/0003_dispatch_wallet.sql) | 4644 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0004_auth_background.sql](../apps/hub/drizzle/0004_auth_background.sql) | 2110 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0005_road_routing.sql](../apps/hub/drizzle/0005_road_routing.sql) | 310 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0006_dispatch_accounts.sql](../apps/hub/drizzle/0006_dispatch_accounts.sql) | 2088 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0007_withdrawal_threshold.sql](../apps/hub/drizzle/0007_withdrawal_threshold.sql) | 255 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0008_matching_identity.sql](../apps/hub/drizzle/0008_matching_identity.sql) | 1833 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0009_recovery_negotiation_safety.sql](../apps/hub/drizzle/0009_recovery_negotiation_safety.sql) | 2909 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0010_trip_context.sql](../apps/hub/drizzle/0010_trip_context.sql) | 217 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0011_secure_settings_recharge.sql](../apps/hub/drizzle/0011_secure_settings_recharge.sql) | 1673 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0012_email_auth.sql](../apps/hub/drizzle/0012_email_auth.sql) | 535 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0013_authentica_phone_otp.sql](../apps/hub/drizzle/0013_authentica_phone_otp.sql) | 373 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0014_document_renewals.sql](../apps/hub/drizzle/0014_document_renewals.sql) | 478 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0015_document_assignment_guard.sql](../apps/hub/drizzle/0015_document_assignment_guard.sql) | 609 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0016_expansion_controls.sql](../apps/hub/drizzle/0016_expansion_controls.sql) | 1718 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0017_referrals.sql](../apps/hub/drizzle/0017_referrals.sql) | 497 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0018_launch_features.sql](../apps/hub/drizzle/0018_launch_features.sql) | 4256 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0019_refunds_native_push.sql](../apps/hub/drizzle/0019_refunds_native_push.sql) | 491 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0020_document_review_history.sql](../apps/hub/drizzle/0020_document_review_history.sql) | 711 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0021_staff_security.sql](../apps/hub/drizzle/0021_staff_security.sql) | 2170 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0022_email_token_identity.sql](../apps/hub/drizzle/0022_email_token_identity.sql) | 226 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0023_account_support_requests.sql](../apps/hub/drizzle/0023_account_support_requests.sql) | 2279 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/0024_maintenance_write_fence.sql](../apps/hub/drizzle/0024_maintenance_write_fence.sql) | 4535 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ تطبيق SQLite مع فحص السلامة والعلاقات |
| [apps/hub/drizzle/meta/_journal.json](../apps/hub/drizzle/meta/_journal.json) | 1735 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/package-lock.json](../apps/hub/package-lock.json) | 14250 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/package.json](../apps/hub/package.json) | 274 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/account-settings.js](../apps/hub/public/account-settings.js) | 5564 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/admin-ui.js](../apps/hub/public/admin-ui.js) | 10370 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/admin.css](../apps/hub/public/admin.css) | 8898 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/admin.html](../apps/hub/public/admin.html) | 2846 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/app-background.js](../apps/hub/public/app-background.js) | 10189 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/app-update.js](../apps/hub/public/app-update.js) | 2862 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/cancellation-ui.js](../apps/hub/public/cancellation-ui.js) | 2569 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/captain-auth.js](../apps/hub/public/captain-auth.js) | 14323 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/captain-auth.js.backup](../apps/hub/public/captain-auth.js.backup) | 7896 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/captain-responsive.css](../apps/hub/public/captain-responsive.css) | 951 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/compact.css](../apps/hub/public/compact.css) | 5091 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/dashboard.html](../apps/hub/public/dashboard.html) | 3462 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/downloads/mishwar-captain.apk](../apps/hub/public/downloads/mishwar-captain.apk) | 33245 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/hub/public/driver-install.css](../apps/hub/public/driver-install.css) | 736 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/driver-install.js](../apps/hub/public/driver-install.js) | 1601 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/driver-offers.js](../apps/hub/public/driver-offers.js) | 7120 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/driver-responsive.css](../apps/hub/public/driver-responsive.css) | 9310 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/driver-services.js](../apps/hub/public/driver-services.js) | 9822 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/driver.css](../apps/hub/public/driver.css) | 15589 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/driver.js](../apps/hub/public/driver.js) | 23388 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/i18n.css](../apps/hub/public/i18n.css) | 1715 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/i18n.js](../apps/hub/public/i18n.js) | 47515 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/icon-192.png](../apps/hub/public/icon-192.png) | 8273 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/hub/public/icon-512.png](../apps/hub/public/icon-512.png) | 4163 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/hub/public/icon-maskable-512.png](../apps/hub/public/icon-maskable-512.png) | 4163 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [apps/hub/public/icon.svg](../apps/hub/public/icon.svg) | 456 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/index.html](../apps/hub/public/index.html) | 4257 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/install.html](../apps/hub/public/install.html) | 2987 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/launch-ui.css](../apps/hub/public/launch-ui.css) | 5746 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/launch-ui.js](../apps/hub/public/launch-ui.js) | 33306 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/live-driver-map.js](../apps/hub/public/live-driver-map.js) | 3502 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/manifest.webmanifest](../apps/hub/public/manifest.webmanifest) | 1180 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/navigation-ui.js](../apps/hub/public/navigation-ui.js) | 563 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/onboarding.css](../apps/hub/public/onboarding.css) | 9155 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/onboarding.js](../apps/hub/public/onboarding.js) | 17461 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/realtime-client.js](../apps/hub/public/realtime-client.js) | 2590 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/recovery-ui.css](../apps/hub/public/recovery-ui.css) | 3024 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/recovery-ui.js](../apps/hub/public/recovery-ui.js) | 5873 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/sw.js](../apps/hub/public/sw.js) | 4800 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/trip-feedback.js](../apps/hub/public/trip-feedback.js) | 3077 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/validation.js](../apps/hub/public/validation.js) | 4421 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/vendor/LEAFLET-LICENSE.txt](../apps/hub/public/vendor/LEAFLET-LICENSE.txt) | 1395 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/vendor/leaflet.css](../apps/hub/public/vendor/leaflet.css) | 14806 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/vendor/leaflet.js](../apps/hub/public/vendor/leaflet.js) | 147557 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/version.json](../apps/hub/public/version.json) | 28 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/public/wallet-funding.js](../apps/hub/public/wallet-funding.js) | 3137 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/build.mjs](../apps/hub/scripts/build.mjs) | 4693 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/build.mjs.backup](../apps/hub/scripts/build.mjs.backup) | 4030 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/build.mjs.backup-esbuild](../apps/hub/scripts/build.mjs.backup-esbuild) | 4564 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/build.mjs.before-esbuild](../apps/hub/scripts/build.mjs.before-esbuild) | 4564 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/dev.mjs](../apps/hub/scripts/dev.mjs) | 6860 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/maintenance-local.mjs](../apps/hub/scripts/maintenance-local.mjs) | 3502 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/restore-isolated.mjs](../apps/hub/scripts/restore-isolated.mjs) | 3619 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/sw.template.js](../apps/hub/scripts/sw.template.js) | 4156 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/scripts/validate-artifact.mjs](../apps/hub/scripts/validate-artifact.mjs) | 978 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/tests/admin.test.mjs](../apps/hub/tests/admin.test.mjs) | 5685 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/auth-background.test.mjs](../apps/hub/tests/auth-background.test.mjs) | 5887 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/authentica-phone.test.mjs](../apps/hub/tests/authentica-phone.test.mjs) | 2418 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/captain-boot-regression.test.mjs](../apps/hub/tests/captain-boot-regression.test.mjs) | 1482 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/captain-dashboard-cookie-auth.test.mjs](../apps/hub/tests/captain-dashboard-cookie-auth.test.mjs) | 1838 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/captain-otp-async-regression.test.mjs](../apps/hub/tests/captain-otp-async-regression.test.mjs) | 2933 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/captain-packaging.test.mjs](../apps/hub/tests/captain-packaging.test.mjs) | 8142 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/captain-pwa-navigation.test.mjs](../apps/hub/tests/captain-pwa-navigation.test.mjs) | 2054 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/captain-session-401.test.mjs](../apps/hub/tests/captain-session-401.test.mjs) | 2674 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/captain-ux-regression.test.mjs](../apps/hub/tests/captain-ux-regression.test.mjs) | 4162 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/cloudflare-redirect.test.mjs](../apps/hub/tests/cloudflare-redirect.test.mjs) | 3185 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/commerce.test.mjs](../apps/hub/tests/commerce.test.mjs) | 23523 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/commercial-maps.test.mjs](../apps/hub/tests/commercial-maps.test.mjs) | 11650 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/connection-policy.test.mjs](../apps/hub/tests/connection-policy.test.mjs) | 4234 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/cors-origin-routing.test.mjs](../apps/hub/tests/cors-origin-routing.test.mjs) | 3275 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/document-management.test.mjs](../apps/hub/tests/document-management.test.mjs) | 7037 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/email-auth-contract.test.mjs](../apps/hub/tests/email-auth-contract.test.mjs) | 1241 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/expansion.test.mjs](../apps/hub/tests/expansion.test.mjs) | 4752 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/experience-policy.test.mjs](../apps/hub/tests/experience-policy.test.mjs) | 3774 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/fixtures.mjs](../apps/hub/tests/fixtures.mjs) | 3099 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/tests/free-auth-dispatch.test.mjs](../apps/hub/tests/free-auth-dispatch.test.mjs) | 9984 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/launch-features.test.mjs](../apps/hub/tests/launch-features.test.mjs) | 12083 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/main-backend-regression.test.mjs](../apps/hub/tests/main-backend-regression.test.mjs) | 10407 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/main-captain-gps.test.mjs](../apps/hub/tests/main-captain-gps.test.mjs) | 2891 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/main-commercial-itinerary.test.mjs](../apps/hub/tests/main-commercial-itinerary.test.mjs) | 2677 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/main-restore-scope.test.mjs](../apps/hub/tests/main-restore-scope.test.mjs) | 2070 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/maintenance-cli.test.mjs](../apps/hub/tests/maintenance-cli.test.mjs) | 3030 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/maintenance-provider-redirect.test.mjs](../apps/hub/tests/maintenance-provider-redirect.test.mjs) | 4514 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/maintenance.test.mjs](../apps/hub/tests/maintenance.test.mjs) | 26590 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/operations.test.mjs](../apps/hub/tests/operations.test.mjs) | 4519 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/pricing-snapshot.test.mjs](../apps/hub/tests/pricing-snapshot.test.mjs) | 10602 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/private-support-contact-ui.test.mjs](../apps/hub/tests/private-support-contact-ui.test.mjs) | 15108 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/r09-otp-email.test.mjs](../apps/hub/tests/r09-otp-email.test.mjs) | 12740 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/recovery.test.mjs](../apps/hub/tests/recovery.test.mjs) | 3288 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/registration.test.mjs](../apps/hub/tests/registration.test.mjs) | 5447 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/rider-identity-email-regression.test.mjs](../apps/hub/tests/rider-identity-email-regression.test.mjs) | 15100 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/rider-otp-concurrency.test.mjs](../apps/hub/tests/rider-otp-concurrency.test.mjs) | 3407 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/rider-payment-recovery.test.mjs](../apps/hub/tests/rider-payment-recovery.test.mjs) | 8237 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/road-data.test.mjs](../apps/hub/tests/road-data.test.mjs) | 2483 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/route-trust.test.mjs](../apps/hub/tests/route-trust.test.mjs) | 3455 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/routing.test.mjs](../apps/hub/tests/routing.test.mjs) | 3130 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/settings-recharge.test.mjs](../apps/hub/tests/settings-recharge.test.mjs) | 6793 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/sms-admin-modernization.test.mjs](../apps/hub/tests/sms-admin-modernization.test.mjs) | 2217 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/staff-security.test.mjs](../apps/hub/tests/staff-security.test.mjs) | 21167 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/support-requests.test.mjs](../apps/hub/tests/support-requests.test.mjs) | 10378 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/ux-sheet-refresh-regression.test.mjs](../apps/hub/tests/ux-sheet-refresh-regression.test.mjs) | 522 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/ux-sheet-stops-v3-regression.test.mjs](../apps/hub/tests/ux-sheet-stops-v3-regression.test.mjs) | 566 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/ux-sheets-promises-regression.test.mjs](../apps/hub/tests/ux-sheets-promises-regression.test.mjs) | 1528 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/tests/verification-routing-update.test.mjs](../apps/hub/tests/verification-routing-update.test.mjs) | 3033 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [apps/hub/vercel.json](../apps/hub/vercel.json) | 990 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/worker/account-settings.js](../apps/hub/worker/account-settings.js) | 10530 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/admin.js](../apps/hub/worker/admin.js) | 12190 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/authentica.js](../apps/hub/worker/authentica.js) | 2583 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/background.js](../apps/hub/worker/background.js) | 10431 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/commerce.js](../apps/hub/worker/commerce.js) | 51497 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/commercial-maps.js](../apps/hub/worker/commercial-maps.js) | 7617 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/dispatch.js](../apps/hub/worker/dispatch.js) | 5344 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/document-renewal.js](../apps/hub/worker/document-renewal.js) | 11580 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/email-auth.js](../apps/hub/worker/email-auth.js) | 8870 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/expansion.js](../apps/hub/worker/expansion.js) | 10965 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/free-auth.js](../apps/hub/worker/free-auth.js) | 14066 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/index.js](../apps/hub/worker/index.js) | 23797 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/launch-features.js](../apps/hub/worker/launch-features.js) | 18910 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/launch-operations.js](../apps/hub/worker/launch-operations.js) | 17539 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/maintenance.js](../apps/hub/worker/maintenance.js) | 10960 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/message-requests.js](../apps/hub/worker/message-requests.js) | 2368 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/native-push.js](../apps/hub/worker/native-push.js) | 4383 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/negotiation.js](../apps/hub/worker/negotiation.js) | 4900 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/operations.js](../apps/hub/worker/operations.js) | 15772 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/payment-webhook.js](../apps/hub/worker/payment-webhook.js) | 1783 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/public-phone-otp.js](../apps/hub/worker/public-phone-otp.js) | 6193 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/public-phone-otp.js.backup](../apps/hub/worker/public-phone-otp.js.backup) | 4144 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/hub/worker/realtime.js](../apps/hub/worker/realtime.js) | 2285 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/recharge.js](../apps/hub/worker/recharge.js) | 3250 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/recovery.js](../apps/hub/worker/recovery.js) | 5988 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/referrals.js](../apps/hub/worker/referrals.js) | 3677 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/refunds.js](../apps/hub/worker/refunds.js) | 6237 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/request-policy.js](../apps/hub/worker/request-policy.js) | 1850 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/rider-auth.js](../apps/hub/worker/rider-auth.js) | 10203 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/road-data.js](../apps/hub/worker/road-data.js) | 3241 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/routing.js](../apps/hub/worker/routing.js) | 9331 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/staff-security.js](../apps/hub/worker/staff-security.js) | 20490 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/worker/trip-extras.js](../apps/hub/worker/trip-extras.js) | 2386 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ مراجعة Backend وصياغة/imports |
| [apps/hub/wrangler.toml](../apps/hub/wrangler.toml) | 684 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [apps/rider/.gitignore](../apps/rider/.gitignore) | 31 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/.openai/hosting.json](../apps/rider/.openai/hosting.json) | 94 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/api/[...path].js](../apps/rider/api/[...path].js) | 2239 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/api/auth/[action].js](../apps/rider/api/auth/[action].js) | 44 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/package.json](../apps/rider/package.json) | 169 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/account-context.js](../apps/rider/public/account-context.js) | 4129 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/app-background.js](../apps/rider/public/app-background.js) | 10245 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/app-share.js](../apps/rider/public/app-share.js) | 2084 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/app-update.js](../apps/rider/public/app-update.js) | 2862 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/app.js](../apps/rider/public/app.js) | 17701 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/cancellation-ui.js](../apps/rider/public/cancellation-ui.js) | 2569 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/captain-tracking.js](../apps/rider/public/captain-tracking.js) | 7693 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/compact.css](../apps/rider/public/compact.css) | 3552 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/driver.html](../apps/rider/public/driver.html) | 420 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/features.js](../apps/rider/public/features.js) | 26111 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/geo-policy.js](../apps/rider/public/geo-policy.js) | 838 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/i18n-catalog.js](../apps/rider/public/i18n-catalog.js) | 53088 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/i18n.css](../apps/rider/public/i18n.css) | 1715 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/i18n.js](../apps/rider/public/i18n.js) | 48595 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/icon-192.png](../apps/rider/public/icon-192.png) | 12675 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/icon-512.png](../apps/rider/public/icon-512.png) | 32815 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/icon-maskable-512.png](../apps/rider/public/icon-maskable-512.png) | 22874 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/icon.svg](../apps/rider/public/icon.svg) | 422 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/index.html](../apps/rider/public/index.html) | 12966 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/install.html](../apps/rider/public/install.html) | 7827 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/language-boot.js](../apps/rider/public/language-boot.js) | 332 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/launch-ui.css](../apps/rider/public/launch-ui.css) | 5746 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/launch-ui.js](../apps/rider/public/launch-ui.js) | 35363 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/live-booking.css](../apps/rider/public/live-booking.css) | 2875 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/live-booking.js](../apps/rider/public/live-booking.js) | 48799 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/manifest.webmanifest](../apps/rider/public/manifest.webmanifest) | 870 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/maps.js](../apps/rider/public/maps.js) | 24892 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/mobile.css](../apps/rider/public/mobile.css) | 10552 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/navigation-ui.js](../apps/rider/public/navigation-ui.js) | 7135 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/operations-sync.js](../apps/rider/public/operations-sync.js) | 1816 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/realtime-client.js](../apps/rider/public/realtime-client.js) | 3812 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/recovery-ui.css](../apps/rider/public/recovery-ui.css) | 2747 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/recovery-ui.js](../apps/rider/public/recovery-ui.js) | 5932 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/responsive-ui.css](../apps/rider/public/responsive-ui.css) | 2188 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/ride-ui.css](../apps/rider/public/ride-ui.css) | 24719 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/ride-ui.js](../apps/rider/public/ride-ui.js) | 10675 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-account-settings.js](../apps/rider/public/rider-account-settings.js) | 10214 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-auth.js](../apps/rider/public/rider-auth.js) | 15174 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-design-system.css](../apps/rider/public/rider-design-system.css) | 21443 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-experience.js](../apps/rider/public/rider-experience.js) | 13116 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-history.css](../apps/rider/public/rider-history.css) | 6055 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-history.js](../apps/rider/public/rider-history.js) | 8950 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-location.js](../apps/rider/public/rider-location.js) | 8504 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-motion.js](../apps/rider/public/rider-motion.js) | 5627 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-speed.js](../apps/rider/public/rider-speed.js) | 6255 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/rider-support.js](../apps/rider/public/rider-support.js) | 11056 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/screens.css](../apps/rider/public/screens.css) | 8203 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/screens.js](../apps/rider/public/screens.js) | 9453 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/search-ui.js](../apps/rider/public/search-ui.js) | 13648 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/shared-tracking.js](../apps/rider/public/shared-tracking.js) | 7789 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/sheet.css](../apps/rider/public/sheet.css) | 6168 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/sheet.js](../apps/rider/public/sheet.js) | 5662 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/style.css](../apps/rider/public/style.css) | 29092 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/sw.js](../apps/rider/public/sw.js) | 4559 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/track.html](../apps/rider/public/track.html) | 1844 | local HTML asset references | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/trip-feedback.js](../apps/rider/public/trip-feedback.js) | 3170 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/universal-install.js](../apps/rider/public/universal-install.js) | 3473 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/ux.css](../apps/rider/public/ux.css) | 9495 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/LEAFLET-LICENSE.txt](../apps/rider/public/vendor/LEAFLET-LICENSE.txt) | 1395 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/images/layers-2x.png](../apps/rider/public/vendor/images/layers-2x.png) | 1259 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/images/layers.png](../apps/rider/public/vendor/images/layers.png) | 696 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/images/marker-icon-2x.png](../apps/rider/public/vendor/images/marker-icon-2x.png) | 2464 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/images/marker-icon.png](../apps/rider/public/vendor/images/marker-icon.png) | 1466 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/images/marker-shadow.png](../apps/rider/public/vendor/images/marker-shadow.png) | 618 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/leaflet.css](../apps/rider/public/vendor/leaflet.css) | 14806 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/vendor/leaflet.js](../apps/rider/public/vendor/leaflet.js) | 147557 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/version.json](../apps/rider/public/version.json) | 28 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/public/wallet-funding.js](../apps/rider/public/wallet-funding.js) | 3137 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/scripts/build.mjs](../apps/rider/scripts/build.mjs) | 4805 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/scripts/dev.mjs](../apps/rider/scripts/dev.mjs) | 7663 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/scripts/sw.template.js](../apps/rider/scripts/sw.template.js) | 3351 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/scripts/validate-artifact.mjs](../apps/rider/scripts/validate-artifact.mjs) | 978 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/tests/account-isolation.test.mjs](../apps/rider/tests/account-isolation.test.mjs) | 65091 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/background-activation.test.mjs](../apps/rider/tests/background-activation.test.mjs) | 12980 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/captain-referral-sharing.test.mjs](../apps/rider/tests/captain-referral-sharing.test.mjs) | 4123 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/cash-journey.test.mjs](../apps/rider/tests/cash-journey.test.mjs) | 14660 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/geo-policy.test.mjs](../apps/rider/tests/geo-policy.test.mjs) | 1348 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/i18n-catalog.test.mjs](../apps/rider/tests/i18n-catalog.test.mjs) | 3168 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/i18n-dom.test.mjs](../apps/rider/tests/i18n-dom.test.mjs) | 8156 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/identity-boundary.test.mjs](../apps/rider/tests/identity-boundary.test.mjs) | 2963 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/launch-owner-response.test.mjs](../apps/rider/tests/launch-owner-response.test.mjs) | 2890 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/map-marker-motion.test.mjs](../apps/rider/tests/map-marker-motion.test.mjs) | 12255 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/map-provider-transition.test.mjs](../apps/rider/tests/map-provider-transition.test.mjs) | 14777 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/message-drafts.test.mjs](../apps/rider/tests/message-drafts.test.mjs) | 10950 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/no-fake-booking.test.mjs](../apps/rider/tests/no-fake-booking.test.mjs) | 536 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/notification-display.test.mjs](../apps/rider/tests/notification-display.test.mjs) | 14025 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/pwa-build.test.mjs](../apps/rider/tests/pwa-build.test.mjs) | 6983 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/referral-sharing.test.mjs](../apps/rider/tests/referral-sharing.test.mjs) | 4116 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/rider-account-change-contract.test.mjs](../apps/rider/tests/rider-account-change-contract.test.mjs) | 4747 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/rider-account-settings.test.mjs](../apps/rider/tests/rider-account-settings.test.mjs) | 10093 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/rider-auth-bridge-integration.test.mjs](../apps/rider/tests/rider-auth-bridge-integration.test.mjs) | 8428 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/rider-location.test.mjs](../apps/rider/tests/rider-location.test.mjs) | 14949 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/rider-motion.test.mjs](../apps/rider/tests/rider-motion.test.mjs) | 6222 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/rider-places.test.mjs](../apps/rider/tests/rider-places.test.mjs) | 8113 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/search-accessibility.test.mjs](../apps/rider/tests/search-accessibility.test.mjs) | 10475 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/search-places-isolation.test.mjs](../apps/rider/tests/search-places-isolation.test.mjs) | 4970 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/shared-tracking-security.test.mjs](../apps/rider/tests/shared-tracking-security.test.mjs) | 2265 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/support-ui.test.mjs](../apps/rider/tests/support-ui.test.mjs) | 9056 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/sync.test.mjs](../apps/rider/tests/sync.test.mjs) | 5892 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/tracking-recovery.test.mjs](../apps/rider/tests/tracking-recovery.test.mjs) | 17385 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/tracking.test.mjs](../apps/rider/tests/tracking.test.mjs) | 706 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/tests/transport-security.test.mjs](../apps/rider/tests/transport-security.test.mjs) | 6020 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب؛ شُغلت حالات الملف في مجموعتها |
| [apps/rider/vercel.json](../apps/rider/vercel.json) | 689 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/worker/index.js](../apps/rider/worker/index.js) | 8004 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/worker/index.js.backup](../apps/rider/worker/index.js.backup) | 5003 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [apps/rider/worker/index.js.before-otp-fix](../apps/rider/worker/index.js.before-otp-fix) | 4947 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ ضمن مراجعة الراكب |
| [artifacts/SHA256SUMS.txt](../artifacts/SHA256SUMS.txt) | 263 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [artifacts/app-admin-debug.apk](../artifacts/app-admin-debug.apk) | 33245 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [artifacts/app-captain-debug.apk](../artifacts/app-captain-debug.apk) | 33245 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [artifacts/app-rider-debug.apk](../artifacts/app-rider-debug.apk) | 33245 | جرد وبصمة | جرد أصل ثنائي وتغليف؛ بلا قبول جهاز فعلي |
| [docs/ACCOUNT_CONTAINMENT_PLAN_AR.md](../docs/ACCOUNT_CONTAINMENT_PLAN_AR.md) | 13585 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/BACKUP_FORENSICS_20261116_AR.md](../docs/BACKUP_FORENSICS_20261116_AR.md) | 9063 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/BACKUP_OPERATIONS_AR.md](../docs/BACKUP_OPERATIONS_AR.md) | 10390 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/D1_FINAL_REVIEW_20261117.json](../docs/D1_FINAL_REVIEW_20261117.json) | 6297 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/D1_FINAL_REVIEW_20261117_AR.md](../docs/D1_FINAL_REVIEW_20261117_AR.md) | 18608 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/D1_WORKER_RELEASE_PLAN_AR.md](../docs/D1_WORKER_RELEASE_PLAN_AR.md) | 19423 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/MAPS_PROVIDER_DECISION_AR.md](../docs/MAPS_PROVIDER_DECISION_AR.md) | 3735 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/MISHWAR_PRODUCTION_ROADMAP_AR.md](../docs/MISHWAR_PRODUCTION_ROADMAP_AR.md) | 19387 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/MISHWAR_ROADMAP_STATUS.json](../docs/MISHWAR_ROADMAP_STATUS.json) | 5643 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/MISHWAR_UNIFIED_STATUS_AR.md](../docs/MISHWAR_UNIFIED_STATUS_AR.md) | 24418 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/OLD_LAPTOP_REVIEW_20261117_AR.md](../docs/OLD_LAPTOP_REVIEW_20261117_AR.md) | 6074 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/PRIVACY_SUPPORT_FIX_AR.md](../docs/PRIVACY_SUPPORT_FIX_AR.md) | 4515 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/PUBLIC_HISTORY_SECURITY_REVIEW_AR.md](../docs/PUBLIC_HISTORY_SECURITY_REVIEW_AR.md) | 15571 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/R09_VERIFICATION_AR.md](../docs/R09_VERIFICATION_AR.md) | 7404 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/REVIEW_2026-11-16_AR.md](../docs/REVIEW_2026-11-16_AR.md) | 15406 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/REVIEW_2026-11-16_STAGE2_AR.md](../docs/REVIEW_2026-11-16_STAGE2_AR.md) | 6662 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/RIDER012_FINAL_READINESS_AR.md](../docs/RIDER012_FINAL_READINESS_AR.md) | 17373 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/RIDER012_GAP_ANALYSIS_AR.md](../docs/RIDER012_GAP_ANALYSIS_AR.md) | 39876 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/RIDER_007_LOCATION_AR.md](../docs/RIDER_007_LOCATION_AR.md) | 6819 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/RIDER_008_MAPS_AR.md](../docs/RIDER_008_MAPS_AR.md) | 2501 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/RIDER_DESIGN_SYSTEM_AR.md](../docs/RIDER_DESIGN_SYSTEM_AR.md) | 3825 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/RIDER_PROGRESS.md](../docs/RIDER_PROGRESS.md) | 13462 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/RIDER_RESUME.md](../docs/RIDER_RESUME.md) | 8666 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/SECURITY_ARTIFACT_AUDIT_AR.md](../docs/SECURITY_ARTIFACT_AUDIT_AR.md) | 8427 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/SECURITY_EXECUTION_DECISIONS_AR.md](../docs/SECURITY_EXECUTION_DECISIONS_AR.md) | 4966 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/SECURITY_RESUME_HANDOFF_AR.md](../docs/SECURITY_RESUME_HANDOFF_AR.md) | 7157 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/VERIFICATION_20261116_BACKUP.json](../docs/VERIFICATION_20261116_BACKUP.json) | 3978 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/WRANGLER_ISOLATED_RESULT_AR.md](../docs/WRANGLER_ISOLATED_RESULT_AR.md) | 4795 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/WRITE_PAUSE_RELEASE_REVIEW_AR.md](../docs/WRITE_PAUSE_RELEASE_REVIEW_AR.md) | 20254 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [docs/leaflet-1.9.4-assets.json](../docs/leaflet-1.9.4-assets.json) | 1544 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة؛ مرجع تاريخي وليس دليل تشغيل جديد |
| [mishwar-account-schema-review.txt](../mishwar-account-schema-review.txt) | 26875 | جرد وبصمة | جرد نصي وبصمة وفحوص آلية منطبقة |
| [package-lock.json](../package-lock.json) | 14303 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [package.json](../package.json) | 538 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [qa/OLD_LAPTOP_VERIFICATION_20261117.json](../qa/OLD_LAPTOP_VERIFICATION_20261117.json) | 1719 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [qa/QA_SUMMARY.json](../qa/QA_SUMMARY.json) | 602 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [qa/UX_SYNC_RELEASE_RESULTS.json](../qa/UX_SYNC_RELEASE_RESULTS.json) | 514 | JSON parsed | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/d1-backup.mjs](../scripts/d1-backup.mjs) | 12996 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/d1-migration-rehearsal.mjs](../scripts/d1-migration-rehearsal.mjs) | 13593 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/link-audit.mjs](../scripts/link-audit.mjs) | 836 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/main-captain-smoke-browser.mjs](../scripts/main-captain-smoke-browser.mjs) | 19503 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/offline-fetch-guard.mjs](../scripts/offline-fetch-guard.mjs) | 216 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/release-audit.mjs](../scripts/release-audit.mjs) | 4281 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/rider-auth-browser.mjs](../scripts/rider-auth-browser.mjs) | 18916 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/rider-browser-smoke.mjs](../scripts/rider-browser-smoke.mjs) | 29340 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/rider-location-browser.mjs](../scripts/rider-location-browser.mjs) | 31396 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/rider-maps-browser.mjs](../scripts/rider-maps-browser.mjs) | 20835 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/rider-navigation-browser.mjs](../scripts/rider-navigation-browser.mjs) | 23053 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/rider-readiness-browser.mjs](../scripts/rider-readiness-browser.mjs) | 41062 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/run.mjs](../scripts/run.mjs) | 1154 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/security/account-containment.mjs](../scripts/security/account-containment.mjs) | 12574 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/security/account-containment.test.mjs](../scripts/security/account-containment.test.mjs) | 10085 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [scripts/staff-security-browser.mjs](../scripts/staff-security-browser.mjs) | 10943 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |
| [scripts/tests/d1-backup.test.mjs](../scripts/tests/d1-backup.test.mjs) | 5231 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [scripts/tests/d1-migration-rehearsal.test.mjs](../scripts/tests/d1-migration-rehearsal.test.mjs) | 10633 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة؛ شُغلت حالات الملف في مجموعتها |
| [scripts/verify-rider-repairs.mjs](../scripts/verify-rider-repairs.mjs) | 3293 | syntax PASS | جرد نصي وبصمة وفحوص آلية منطبقة |

لم تُختبر الخدمات والأجهزة الحقيقية أو بيانات إنتاج؛ نتائج المتصفح المحلية وقواعد SQLite الصناعية لا تعوّض ذلك. لم تُرفع الأدلة الخام أو الصور أو قواعد الاختبار أو النسخ الاحتياطية.
