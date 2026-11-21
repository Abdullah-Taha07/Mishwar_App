import {DatabaseSync} from 'node:sqlite';
import {securityAdmin} from '../apps/hub/worker/staff-security.js';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve('apps/admin/public'),art=resolve('artifacts/staff-security-browser');mkdirSync(art,{recursive:true});
const errors=[];
const db=new DatabaseSync(':memory:');db.exec(readFileSync(resolve('apps/hub/drizzle/0021_staff_security.sql'),'utf8'));
const env={CAPTAIN_ADMIN_EMAIL:'owner@local.test',DB:{prepare(sql){return {bind(...args){const q=db.prepare(sql);return {async first(){return q.get(...args)||null},async all(){return {results:q.all(...args)}},async run(){return {meta:{changes:Number(q.run(...args).changes)}}}}}};},async batch(items){db.exec('BEGIN');try{const v=await Promise.all(items.map(i=>i.run()));db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}}};

const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path.startsWith('/api/admin/security/')){
  let body='';for await(const chunk of req)body+=chunk;
  const response=await securityAdmin(new Request('https://local.test'+req.url,{method:req.method,...(body?{body}:{})}),env,true,null);
  res.statusCode=response.status;res.setHeader('Content-Type','application/json');return res.end(await response.text());
 }
 if(path.startsWith('/api/admin/operations/support')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:[],total:0}));}
 if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(path.includes('session')?{authenticated:false}:{error:'Local offline fixture'}));}
 try{const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'\\'))throw Error();let bytes=readFileSync(file);if(file.endsWith('.html'))bytes=Buffer.from(bytes.toString('utf8').replace(/<link[^>]*https:\/\/fonts[^>]*>/g,''));res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const address=`http://127.0.0.1:${server.address().port}`;
const profile=resolve(art,'edge-profile-'+Date.now());mkdirSync(profile);
const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws;const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let port;for(let i=0;i<100;i++){if(existsSync(profile+'/DevToolsActivePort')){port=readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0];break;}await wait(100);}if(!port)throw Error('Edge debug port unavailable');
 const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Fetch.requestPaused'){const p=m.params;cmd('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}};
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 async function waitFor(expression,label){for(let n=0;n<100;n++){if(await evaluate(expression))return;await wait(100)}throw Error('UI readiness deadline: '+label)}
 await cmd('Runtime.enable');await cmd('Page.enable');
 // Block every non-loopback request before it can reach the network.
 await cmd('Network.enable');await cmd('Network.setBlockedURLs',{urls:['https://*','http://fonts.*']});
 const results=[];
 for(const [name,width,height,reduced,cores] of [['desktop',1440,1000,false,8],['mobile',390,844,false,8],['reduced-motion',1440,1000,true,8],['low-power-desktop',1440,1000,false,4]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  // The product deliberately draws fewer cars on low-power devices. Declare
  // the fixture hardware instead of depending on the machine running CI.
  await cmd('Emulation.setHardwareConcurrencyOverride',{hardwareConcurrency:cores});
  await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
  await cmd('Page.navigate',{url:address});await waitFor("!!document.querySelector('#mishwar-admin-auth .login-card [name=email]') && !!document.querySelector('link[href=\"/staff-security.css\"]')?.sheet",name+' styled login');
  const data=await evaluate(`(()=>{const gate=document.querySelector('#mishwar-admin-auth'),card=document.querySelector('.login-card'),r=card.getBoundingClientRect();return {rtl:gate.dir,lang:gate.lang,title:card.querySelector('h1').textContent,emailType:card.querySelector('[name=email]').type,paths:gate.querySelectorAll('defs > path').length,cars:[...gate.querySelectorAll('.car')].filter(x=>getComputedStyle(x).display!=='none').length,paused:gate.querySelector('svg').animationsPaused(),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,bg:getComputedStyle(gate).backgroundColor}})()`);
  assert.equal(data.rtl,'rtl');assert.equal(data.lang,'ar');assert.ok(data.title.includes('\u0645\u0634\u0648\u0627\u0631'));assert.equal(data.emailType,'email');assert.equal(data.paths,5);assert.equal(data.fits,true);assert.equal(data.paused,reduced);assert.equal(data.cars,reduced?0:width<600||cores<=4?4:10);
  const before=await evaluate(`document.querySelector('.car').getCTM().e`);await wait(150);const after=await evaluate(`document.querySelector('.car').getCTM().e`);assert.equal(before===after,reduced);
  await evaluate(`document.querySelector('[name=mode]').value='staff';document.querySelector('[name=mode]').dispatchEvent(new Event('change'));document.querySelector('.show-password').click()`);
  const fields=await evaluate(`({emailRequired:document.querySelector('[name=email]').required,emailShown:!document.querySelector('.staff-email').hidden,passwordShown:document.querySelector('[name=password]').type==='text',aria:document.querySelector('.show-password').getAttribute('aria-pressed')})`);assert.deepEqual(fields,{emailRequired:true,emailShown:true,passwordShown:true,aria:'true'});
  const image=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(art,name+'.png'),Buffer.from(image.data,'base64'));results.push({name,...data,...fields,animationChanged:before!==after});
 }

 await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate(`document.querySelector('#mishwar-admin-auth')?.remove();[...document.body.children].forEach(e=>e.inert=false);window.renderStaffSecurity(document.querySelector('#content'))`);
 await wait(200);
 await evaluate(`(()=>{const f=document.querySelector('#new-staff');f.elements.name.value='موظف الاختبار';f.elements.email.value='browser@local.test';f.elements.role.value='دعم';f.elements.password.value='browser-private-test-password';f.requestSubmit();})()`);
 await wait(100);await evaluate(`(()=>{const d=document.querySelector('dialog[open]');d.querySelector('input').value='local-owner-password-123456';d.querySelector('form').requestSubmit(d.querySelector('[value=confirm]'));})()`);await wait(350);
 assert.equal(db.prepare('SELECT status FROM staff_accounts').get().status,'pending');
 const matrix=await evaluate(`(()=>{const d=document.querySelector('#staff-list details');d.open=true;return {checkboxes:d.querySelectorAll('[name=permissions]').length,checked:d.querySelectorAll('[name=permissions]:checked').length,text:d.textContent.includes('حفظ واعتماد التغييرات')}})()`);
 assert.deepEqual(matrix,{checkboxes:91,checked:0,text:true});
 await evaluate(`(()=>{const f=document.querySelector('#staff-list form');f.elements.status.value='active';f.elements.policy.value='account';f.querySelector('[value="support:view"]').checked=true;f.querySelector('[value="support:create"]').checked=true;f.requestSubmit();})()`);
 await wait(100);await evaluate(`(()=>{const d=document.querySelector('dialog[open]');d.querySelector('input').value='local-owner-password-123456';d.querySelector('form').requestSubmit(d.querySelector('[value=confirm]'));})()`);await wait(200);const account=db.prepare('SELECT status,permissions FROM staff_accounts').get();assert.equal(account.status,'active');assert.deepEqual(JSON.parse(account.permissions),['support:view','support:create']);
 await evaluate(`document.querySelector('#staff-list details').open=true`);
 const ownerImage=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(art,'owner-permissions.png'),Buffer.from(ownerImage.data,'base64'));
 await evaluate(`window.mishwarStaffSession={staff:true,permissions:['support:view','support:create']};window.renderStaffWorkspace()`);await wait(200);
 const staff=await evaluate(`({sections:[...document.querySelectorAll('[data-section]')].map(x=>x.dataset.section),form:!!document.querySelector('#staff-operation'),ownerControls:!!document.querySelector('#new-staff')})`);
 assert.deepEqual(staff,{sections:['support'],form:true,ownerControls:false});results.push({name:'owner-management',...matrix,createdPending:true,savedPermissions:true},{name:'staff-workspace',...staff});
 assert.equal(errors.length,0);writeFileSync(resolve(art,'results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({checks:6,results,errors},null,2));
}finally{ws?.close();const stopped=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await Promise.race([stopped,wait(1000)]);server.close();db.close();if(profile.startsWith(art+'\\')&&/edge-profile-\d+$/.test(profile)){try{rmSync(profile,{recursive:true,force:true});}catch{}}}
