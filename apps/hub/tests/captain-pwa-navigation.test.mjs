import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../',import.meta.url);
const get=(path)=>readFileSync(new URL(path,root),'utf8');
test('PWA launch uses its own URL and the same worker homepage',()=>{
 const manifest=JSON.parse(get('public/manifest.webmanifest'));
 assert.equal(manifest.id,'/');
 assert.equal(manifest.start_url,'/launch');
 assert.ok(get('worker/index.js').includes("if(path==='/launch')path='/index.html'"));
});
test('service worker avoids cached HTML navigation',()=>{
 const sw=get('scripts/sw.template.js');
 const build=get('scripts/build.mjs');
 assert.ok(sw.includes("event.request.mode==='navigate'"));
 assert.ok(sw.includes("event.request.destination==='document'"));
 assert.ok(!build.includes("shell.push('/')"));
 assert.ok(!build.includes("shell.push('/dashboard')"));
 assert.ok(build.includes('(css|js|png|svg|webmanifest)'));
});
test('returning captains can register another account and continue without page reload',()=>{
 const auth=get('public/captain-auth.js');
 assert.ok(auth.includes('id="switch-account"'));
 assert.ok(!auth.includes('if (!known || register)'));
 assert.ok(auth.includes('function () { form(false); };'));
 assert.ok(auth.includes("location.replace('/launch')"));
});
test('forced login and a verified live endpoint prevent endless active-session redirects',()=>{
 const auth=get('public/captain-auth.js');
 assert.ok(auth.includes("params.get('login') === '1'"));
 assert.ok(auth.includes('mishwar-captain-last-dashboard-hop'));
 assert.ok(auth.includes("await fetch('/api/driver',options)"));
 assert.ok(auth.includes('if(!check.ok)'));
});
test('logout on the dashboard returns to the main sign-in screen',()=>{
 const driver=get('public/driver.js');
 assert.ok(driver.includes('data-captain-logout>تسجيل الخروج'));
 assert.ok(driver.includes("fetch('/api/auth/logout'"));
 assert.ok(driver.includes("location.replace('/launch?login=1#login')"));
});
