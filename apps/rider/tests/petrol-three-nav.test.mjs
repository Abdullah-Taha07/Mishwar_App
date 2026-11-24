import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const text=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const html=text('../public/index.html'),script=text('../public/mishwar-three-nav.js'),css=text('../public/mishwar-petrol-nav.css'),live=text('../public/live-booking.js'),features=text('../public/features.js');
test('rider has three tabs, direct account access and its own scoped styles',()=>{
 const nav=html.match(/<nav class="mobile-nav"[^>]*>(.*?)<\/nav>/s)?.[1];
 assert.ok(nav);assert.equal((nav.match(/<button\b/g)||[]).length,3);
 assert.match(html,/mishwar-petrol-nav\.css/);assert.match(html,/mishwar-three-nav\.js/);
 assert.match(script,/mishwar-rider-account-shortcut/);assert.match(features,/window.MishwarOpenRiderMore=openDrawer/);assert.match(features,/window.MishwarOpenRiderSection=openSection/);
 assert.match(css,/\.mobile-nav\{display:flex!important;position:fixed!important/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/#drawer .drawer-links \[data-section="profile"\]/);
});
test('rider balance is read from verified live session, not local or hardcoded zero',()=>{
 assert.match(live,/window\.mishwarRiderFinancialSnapshot=\(\)=>/);
 assert.match(live,/if\(!session\?\.verified\)return null/);
 assert.match(live,/Number\.isSafeInteger\(balance\)/);
 assert.match(script,/window\.mishwarRiderFinancialSnapshot\?\.\(\)/);
 assert.match(script,/data-mw-wallet/);assert.match(script,/MishwarOpenRiderSection/);
 assert.doesNotMatch(script,/0\.00|٠٫٠٠|localStorage.*balance/);
});
test('rider Trips page formats a real live balance and opens dedicated wallet',()=>{
 const callbacks=new Map();
 const cls=()=>({toggle(){},add(){},remove(){}});
 const node=(name)=>({tagName:name,hidden:false,innerHTML:'',classList:cls(),dataset:{},setAttribute(){},removeAttribute(){},addEventListener(event,fn){callbacks.set(name+':'+event,fn)},append(){},querySelectorAll(){return []}});
 const nav=node('nav'),main=node('main'),bar=node('bar'),rail=null,trips=node('section'),account=node('button');
 main.querySelector=()=>bar;main.append=(el)=>{if(el===trips)trips.isAttached=true};
 const doc={documentElement:{lang:'ar'},querySelector(s){return s==='.mobile-nav'?nav:s==='.workspace'?main:s==='.rail nav'?rail:null},querySelectorAll(){return []},createElement(s){return s==='button'?account:trips}};
 const win={MishwarAccountContext:{snapshot:()=>({verified:true})},MishwarOpenRiderSection:(s)=>{win.openedSection=s},MishwarOpenRiderMore:()=>{win.moreOpened=true},mishwarRiderFinancialSnapshot:()=>({balance:12345}),mishwarRiderCurrentTrip:()=>null,addEventListener(){},};
 vm.runInNewContext(script,{document:doc,window:win});
 assert.ok(trips.isAttached);
 win.MishwarThreeNav.showTrips();
 assert.equal(trips.hidden,false);
 assert.match(trips.innerHTML,/123\.45 ر\.س/);
 assert.match(trips.innerHTML,/data-mw-wallet/);
 callbacks.get('section:click')({target:{closest:()=>({hasAttribute:a=>a==='data-mw-wallet'})}});
 assert.equal(win.openedSection,'wallet');
 callbacks.get('button:click')();assert.equal(win.openedSection,'profile');
 callbacks.get('nav:click')({target:{closest:()=>({dataset:{},hasAttribute:k=>k==='data-open-menu'})},preventDefault(){},stopPropagation(){}});assert.equal(win.moreOpened,true);
});

test('rider modal and drawer hide floating navigation',()=>{
 assert.match(css,/body:has\(#modal\[open\]\) \.mobile-nav/);
 assert.match(css,/body:has\(#drawer\[open\]\) \.mobile-nav/);
});
