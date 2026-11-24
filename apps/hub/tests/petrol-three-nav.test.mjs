import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const html=text('../public/dashboard.html'),script=text('../public/driver.js'),css=text('../public/mishwar-petrol-nav.css');
test('authenticated captain has exactly three primary navigation buttons',()=>{
 const nav=html.match(/<nav class="driver-nav"[^>]*>(.*?)<\/nav>/s)?.[1];
 assert.ok(nav);
 assert.deepEqual([...nav.matchAll(/<button[^>]+data-tab="([^"]+)"/g)].map(x=>x[1]),['requests','trips','more']);
 assert.match(html,/data-captain-profile/);assert.doesNotMatch(nav,/profile|wallet|history/);
});
test('captain trips owns the balance card; wallet remains a separately navigable view',()=>{
 const beforeWallet=script.slice(script.indexOf("if(tab==='trips')"),script.indexOf("if(tab==='wallet')"));
 assert.match(beforeWallet,/class="mw-wallet-card" data-tab="wallet"/);
 assert.match(beforeWallet,/money\(data\.wallet\.balance\)/);
 assert.match(beforeWallet,/data-tab="history"/);
 assert.match(script,/if\(tab==='wallet'\)body=/);
 assert.match(script,/if\(b\.hasAttribute\('data-captain-profile'\)\)/);
});
test('captain fixed navigation styles support safe-area and touch targets',()=>{
 assert.match(css,/safe-area-inset-bottom/);assert.match(css,/position:absolute!important/);
 assert.match(css,/min-height:48px/);assert.match(css,/#083344/);
});
