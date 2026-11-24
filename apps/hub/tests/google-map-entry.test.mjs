import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const root=new URL('../',import.meta.url); // imported when copied into apps/.../tests/
const publicRoot=new URL('../public/',import.meta.url);
const src=filename=>readFileSync(new URL(filename,publicRoot),'utf8');
const html=readFileSync(new URL('../public/'+(import.meta.dirname.includes('rider')?'index.html':'dashboard.html'),import.meta.url),'utf8');
const google=src('mishwar-google-map.js'),gps=src('mishwar-gps-entry.js');
test('Google Maps is optional, gated by restricted browser key and gracefully falls back',()=>{
 assert.match(google,/validKey\(value\?\.googleMapsBrowserKey\)/);
 assert.match(google,/fetch\('\/api\/map-config'/);
 assert.match(google,/google\.maps\.Map|maps\.Map\(/);
 assert.match(google,/disable\(\)/);
 assert.match(google,/googleMapsBrowserKey/);
 assert.doesNotMatch(google,/AIza[a-zA-Z0-9_-]{30,}/);
});
test('No GPS without permission; foreground resume and validation',()=>{
 assert.match(gps,/permission\?\.state !== 'granted'/);
 assert.match(gps,/navigator\.geolocation\.getCurrentPosition/);
 assert.match(gps,/visibilitychange/);
 assert.match(gps,/accuracy > 150/);
 assert.doesNotMatch(gps,/localStorage\.setItem|sessionStorage\.setItem|fetch\('/);
});
test('Google provider assets load only on rider/captain app screen',()=>{
 assert.match(html,/mishwar-google-map\.css/);
 assert.match(html,/mishwar-google-map\.js/);
 assert.match(html,/mishwar-gps-entry\.js/);
});

function runGpsWithPermission(permission) {
 const handlers = {}, emitted = [], status = {textContent:'', setAttribute(){}};
 const marker = {append(){}};
 const document = {
   hidden:false,
   querySelector(selector){return selector==='.mobile-nav' ? marker : marker;},
   getElementById(){return marker;},
   createElement(){return status;},
   addEventListener(type,fn){handlers[type]=fn;}
 };
 let calls = 0;
 const window={isSecureContext:true,addEventListener(){},dispatchEvent(event){emitted.push(event.detail)}};
 const navigator={permissions:{query:async()=>({state:permission})},geolocation:{getCurrentPosition(ok){calls++;ok({coords:{latitude:24.71,longitude:46.67,accuracy:12},timestamp:Date.now()});}}};
 runInNewContext(gps,{document,window,navigator,Date,Number,CustomEvent:class{constructor(_type,opts){this.detail=opts.detail}},console});
 return {handlers,emitted,get calls(){return calls}};
}
test('GPS consent prevents silent permission prompts',async()=>{
 const h=runGpsWithPermission('prompt');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls,0);
 assert.equal(h.emitted.length,0);
});
test('GPS entry acquires a fresh permission-granted foreground sample',async()=>{
 const h=runGpsWithPermission('granted');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls,1);
 assert.equal(h.emitted.length,1);
 assert.equal(h.emitted[0].lat,24.71);
});
