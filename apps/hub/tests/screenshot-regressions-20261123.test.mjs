import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('payment dialog stays centered and contained on small RTL/LTR viewports',()=>{
 const css=source('../public/driver.css');
 assert.match(css,/MISHWAR_SCREEN_FIX_20261123/);
 assert.match(css,/#driver-services-dialog\.driver-service-modal\s*\{/);
 assert.match(css,/width:\s*min\(500px,\s*calc\(100vw - 24px\)\)/);
 assert.match(css,/#driver-services-dialog #close-driver-service\s*\{/);
 assert.match(css,/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
 assert.match(css,/max-height:\s*calc\(100dvh - 24px\)/);
});
test('English welcome translates the new Arabic earnings disclaimer and badge',()=>{
 const i18n=source('../public/i18n.js');
 assert.match(i18n,/الأرباح المحتملة غير مضمونة، والدخل تقديري/);
 assert.match(i18n,/Potential earnings are not guaranteed/);
 assert.match(i18n,/كل طريق، فرصة جديدة/);
 assert.match(i18n,/Every road, a new opportunity/);
});
test('history does not leak database errors into the app UI and offers retry',()=>{
 const services=source('../public/driver-services.js');
 assert.doesNotMatch(services,/target\.textContent=e\.message/);
 assert.match(services,/data-history-refresh>إعادة المحاولة/);
 const api=source('../worker/commerce.js');
 assert.match(api,/SERVICE_SCHEMA_UNAVAILABLE/);
 assert.match(api,/trip_destination_changes/);
});
test('Android installation does not offer the untrusted legacy APK',()=>{
 const html=source('../public/install.html');
 assert.match(html,/أندرويد — تثبيت تطبيق الويب/);
 assert.match(html,/Chrome/);
 assert.match(html,/نسخة APK الأصلية غير متاحة حاليًا/);
 assert.doesNotMatch(html,/نسخة APK الجديدة قيد البناء/);
});
test('destination schema exists in migration and cannot be substituted with a new table',()=>{
 const migration=source('../drizzle/0025_destination_requests.sql');
 assert.match(migration,/CREATE TABLE trip_destination_changes/);
 assert.match(migration,/CREATE TRIGGER destination_change_apply/);
});
