import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function harness(){
 const pending=[],nodes=new Map();
 const target={isConnected:true,innerHTML:'',textContent:'',scrollTop:0,querySelector(key){if(!nodes.has(key))nodes.set(key,{innerHTML:'',value:''});return nodes.get(key)}};
 const c={Map,WeakMap,JSON,Promise,fetch(){const request=deferred();pending.push(request);return request.promise},setInterval(){},document:{hidden:false,querySelector:()=>null}};
 c.window=c;vm.createContext(c);vm.runInContext(readFileSync(new URL('../public/phone-verifications.js',import.meta.url),'utf8'),c);
 const reply=(n,configured)=>pending[n].resolve({ok:true,json:async()=>({smsConfigured:configured,items:[]})});
 return {target,pending,reply,load:()=>c.renderPhoneVerifications(target)};
}
test('MAIN-ADMIN older phone-verification polls cannot overwrite a newer configuration response',async()=>{
 const h=harness(),old=h.load(),latest=h.load();h.reply(1,true);await latest;const html=h.target.innerHTML;
 h.reply(0,false);await old;assert.equal(h.target.innerHTML,html);assert.match(html,/يُرسل الرمز/);
});
test('MAIN-ADMIN a stale poll failure cannot replace a successful phone-verification view',async()=>{
 const h=harness(),old=h.load(),latest=h.load();h.reply(1,true);await latest;
 h.pending[0].reject(Error('stale request failed'));await old;assert.equal(h.target.textContent,'');assert.match(h.target.innerHTML,/يُرسل الرمز/);
});
test('MAIN-ADMIN a rejected poll cannot repaint a detached phone-verification page',async()=>{
 const h=harness(),load=h.load();h.target.isConnected=false;h.pending[0].reject(Error('offline'));await load;assert.equal(h.target.textContent,'');
});
