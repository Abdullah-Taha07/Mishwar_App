// Fast, offline static cross-application contract check (not a penetration test).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const checks=[
 ['Hub bundles real ES module imports',()=>/await build\(/.test(read('apps/hub/scripts/build.mjs'))&&/bundle:true/.test(read('apps/hub/scripts/build.mjs'))],
 ['Rider Vercel allows SMS start and check',()=>['phone-otp-start','phone-otp-check'].every(x=>read('apps/rider/worker/index.js').includes(`'/api/auth/${x}'`))],
 ['Hub routes rider and admin to shared backend',()=>read('apps/hub/worker/index.js').includes('/internal/rider-auth')&&read('apps/hub/worker/index.js').includes('/internal/administration')],
 ['Rider and captain use SMS self-verification',()=>read('apps/rider/public/rider-auth.js').includes("'phone-otp-check'")&&read('apps/hub/public/captain-auth.js').includes("'phone-otp-check'")],
 ['SMS accepts 4 digits while captain passwords remain >= 6',()=>/\^\\d\{4,6\}\$/.test(read('apps/hub/worker/public-phone-otp.js'))&&/minlength="6"/.test(read('apps/hub/public/captain-auth.js'))&&/pattern="\[0-9\]\{4\}"/.test(read('apps/hub/public/captain-auth.js'))],
 ['Admin tracks Authentica status without WhatsApp approval form',()=>read('apps/admin/public/phone-verifications.js').includes('مراقبة توثيق SMS')&&!/verify-phone-form|data-verify-phone|https:\/\/wa.me/.test(read('apps/admin/public/phone-verifications.js'))],
 ['Manual verification is disabled by default',()=>read('apps/hub/worker/free-auth.js').includes("ENABLE_LEGACY_PHONE_VERIFICATION!=='true'")],
 ['SMS verification history belongs to D1',()=>read('apps/hub/worker/public-phone-otp.js').includes('public_phone_otp')&&read('apps/hub/worker/free-auth.js').includes('AS otp_active')],
 ['Dispatch has matching and captain eligibility',()=>read('apps/hub/worker/dispatch.js').includes('eligibleCaptains')&&read('apps/hub/worker/commerce.js').includes("b.action==='live_book'")],
 ['Admin backend authorization exists',()=>read('apps/hub/worker/admin.js').includes('isAdmin')&&read('apps/admin/worker/index.js').includes('portalAdmin')],
 ['Build and secrets have no checked-in .dev.vars',()=>!read('apps/hub/worker/authentica.js').includes('const AUTHENTICA_API_KEY =')],
 ['Availability persists before dispatch and confirms its state',()=>read('apps/hub/worker/commerce.js').includes("return cj({ok:true,available:b.available})")],
 ['Captain GPS errors are explicit and location precision is still required',()=>read('apps/hub/public/driver-services.js').includes('lastAccuracy')&&read('apps/hub/worker/commerce.js').includes('validDriverLocation(b)')],
 ['Captain cannot trust public user ID header',()=>read('apps/hub/worker/index.js').includes("headers.delete('oai-authenticated-user-id')")],
 ['Captain has a draggable responsive map sheet and profile accordion',()=>read('apps/hub/public/driver-responsive.css').includes('.driver-grab')&&read('apps/hub/public/driver.js').includes('captain-account-accordion')],
 ['Rider profile has expandable details and CSS breakpoints',()=>read('apps/rider/public/rider-auth.js').includes('rider-account-disclosure')&&read('apps/rider/public/responsive-ui.css').includes('@media')],
 ['Captain SMS and application states poll without refresh button',()=>read('apps/hub/public/captain-auth.js').includes('pollCaptainVerification')&&read('apps/hub/public/onboarding.js').includes('startStatusPolling')],
 ['Admin SMS and live operations poll while visible',()=>read('apps/admin/public/phone-verifications.js').includes('setInterval')&&read('apps/admin/public/portal.js').includes('setInterval')],
 ['Root build includes the pinned esbuild dependency and lock',()=>JSON.parse(read('package-lock.json')).packages['node_modules/esbuild'].version==='0.28.2'&&JSON.parse(read('package.json')).devDependencies?.esbuild],

];
let fail=0;
for(const [name,fn] of checks){let pass=false;try{pass=!!fn()}catch{}console.log(`${pass?'PASS':'FAIL'} — ${name}`);if(!pass)fail++}
console.log(`${checks.length-fail}/${checks.length} static contracts passed`);
if(fail)process.exit(1);
