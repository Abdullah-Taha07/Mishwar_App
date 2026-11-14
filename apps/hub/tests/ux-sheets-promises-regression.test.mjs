import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('income marketing is qualified and not represented as guaranteed',()=>{
 const html=source('../public/index.html');
 assert.match(html,/10,000 ريال شهريًا/);
 assert.match(html,/ليست مضمونة/);
 assert.match(source('../public/captain-auth.js'),/الأرباح المحتملة غير مضمونة/);
});
test('captain sheet uses one pointer drag controller and discrete snap heights',()=>{
 const js=source('../public/driver-offers.js');
 assert.match(js,/MISHWAR_UX_SINGLE_POINTER_DRAG_20261114/);
 assert.match(js,/nearestSnap=percent=>\[38,62,86\]/);
 assert.doesNotMatch(js,/sheet\.addEventListener\('touchmove'/);
 assert.match(source('../public/driver-responsive.css'),/MISHWAR_UX_DRIVER_SHEET_20261114/);
});
test('notification permission is optional and not requested by automatic availability',()=>{
 const js=source('../public/driver-offers.js');
 assert.doesNotMatch(js,/enableMishwarPush\(false\)/);
 assert.match(source('../public/app-background.js'),/if\(!showMessage\)return/);
});
test('rider Safari permission tutorial provides non-blocking path and admin remains readable',()=>{
 assert.match(source('../../rider/public/rider-experience.js'),/iosSafariNotice/);
 assert.match(source('../../admin/public/responsive-ui.css'),/MISHWAR_UX_ADMIN_ACCESSIBILITY_20261114/);
});
