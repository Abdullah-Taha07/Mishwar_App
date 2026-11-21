import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {startTrackingServer} from './fixtures/rider-tracking-server.mjs';

// RIDER-UX-MOTION: browser acceptance against actual application gateways, auth,
// captain handlers and migrated SQLite. Only SMS, road, map tiles and GPS are
// declared local fixtures. The browser enters addresses and books through UI.
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;

const publicRoot=resolve(option('--public','apps/rider/dist/public'));
const output=resolve(option('--output','.local-verification/rider-ux-motion-'+Date.now()));
mkdirSync(join(output,'screens'),{recursive:true});
assert.ok(existsSync(join(publicRoot,'index.html')),'Build rider first');
const nativeFetch=globalThis.fetch,lab=await startTrackingServer({publicRoot});
const observations={phase:'RIDER-UX-MOTION',results:[],externalBlocked:[],exceptions:[],consoleErrors:[],limitations:[
  'Headless Edge mobile viewport; no physical device or Safari test.',
  lab.disclosure,
  'Local requestAnimationFrame intervals and long tasks are headless observations, not proof of physical-device 60 FPS.',
  'No real TomTom request, payment, production or Staging resource is used.',
]};
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(edge,'Edge or Chromium required');
const profile=mkdtempSync(join(tmpdir(),'mishwar-rdev003-'));
const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let ws,command,evaluate,current=null;
const timeout=setTimeout(()=>{console.error('RDEV003_BROWSER_TIMEOUT');browser.kill();process.exit(2)},300000);timeout.unref();
try{
  let port;
  for(let n=0;n<100;n++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break}catch{}await wait(100)}
  assert.match(port||'',/^\d+$/,'CDP launch failed');
  const targets=await nativeFetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
  const page=targets.find(t=>t.type==='page'&&t.url==='about:blank');assert.ok(page,'Use only our new blank target');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done,fail)=>{ws.onopen=done;ws.onerror=fail;setTimeout(()=>fail(Error('CDP websocket deadline')),8000).unref()});
  let sequence=0;const pending=new Map();
  command=(method,params={})=>new Promise((done,fail)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP deadline: '+method))},12000);pending.set(id,{done:value=>{clearTimeout(timer);done(value)},fail:error=>{clearTimeout(timer);fail(error)}});ws.send(JSON.stringify({id,method,params}))});
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.fail(Error(JSON.stringify(message.error))):p?.done(message.result);return}
    if(message.method==='Runtime.exceptionThrown')observations.exceptions.push({scenario:current?.name,text:message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text});
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')observations.consoleErrors.push({scenario:current?.name,text:message.params.args.map(x=>x.value||x.description).join(' ')});
    if(message.method==='Fetch.requestPaused'){
      const request=message.params,url=new URL(request.request.url);
      const fulfill=(mime,text)=>command('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:mime}],body:Buffer.from(text).toString('base64')});
      if(url.origin===lab.origin)void command('Fetch.continueRequest',{requestId:request.requestId}).catch(()=>{});
      else if(url.hostname==='fonts.googleapis.com'&&url.pathname==='/css2')void fulfill('text/css','/* Local system fonts. */').catch(()=>{});
      else if(url.hostname==='tile.openstreetmap.org'&&url.pathname.endsWith('.png'))void fulfill('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0ec"/><path d="M0 128H256M128 0V256" stroke="white" stroke-width="12"/></svg>').catch(()=>{});
      else{observations.externalBlocked.push({scenario:current?.name,origin:url.origin,path:url.pathname});void command('Fetch.failRequest',{requestId:request.requestId,errorReason:'BlockedByClient'}).catch(()=>{})}
    }
  };
  evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const until=async(expression,label,ms=18000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(expression))return;await wait(100)}throw Error(label)};
  const untilLocal=async(test,label,ms=18000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await wait(100)}throw Error(label)};
  const settle=()=>evaluate("Promise.all(document.getAnimations().filter(a=>{const t=a.effect?.getComputedTiming();return t&&Number.isFinite(t.endTime)&&t.endTime<2000&&a.playState==='running'}).map(a=>a.finished.catch(()=>{})))");
  const visible=selector=>`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({visibilityProperty:true})&&e.getClientRects().length)`;
  const click=async selector=>{await settle();await evaluate(`(${visible(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);await wait(60);const p=await evaluate(`(()=>{const e=${visible(selector)};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,clickable:!e.disabled&&!!h&&(e===h||e.contains(h)),hit:h?.outerHTML.slice(0,160)}})()`);assert.ok(p?.clickable,'Blocked UI '+selector+': '+JSON.stringify(p));for(const[type,extra]of[['mouseMoved',{}],['mousePressed',{button:'left',clickCount:1}],['mouseReleased',{button:'left',clickCount:1}]])await command('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,...extra});await wait(80);await settle()};
  const fill=async(selector,value)=>{await click(selector);await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await command('Input.insertText',{text:String(value)})};
  const shot=async name=>{const r=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'screens',name+'.png'),Buffer.from(r.data,'base64'))};
  const check=async(name,run)=>{current={name,passed:false,startedAt:Date.now()};observations.results.push(current);try{await run();current.passed=true;console.log('PASS '+name)}catch(error){current.error=error.message;current.dom=await evaluate('document.body.innerText.slice(0,14000)').catch(()=>'');await shot('FAIL-'+name).catch(()=>{});throw error}finally{current.durationMs=Date.now()-current.startedAt}};
  const closeModal=async()=>{if(await evaluate("document.querySelector('#modal')?.open"))await click('#modal [data-action="close"]')};
  const openSection=async name=>{
    if(await evaluate(`!!(${visible('.mobile-nav [data-open-menu]')})`)){await click('.mobile-nav [data-open-menu]');await until("document.querySelector('#drawer')?.open",'Drawer opens');await click('#drawer [data-section="'+name+'"]')}
    else await click('.rail [data-section="'+name+'"]');
    await until("document.querySelector('#modal')?.open",'Section dialog opens');
  };
  const auditLayout=async label=>{
    await settle();
    const layout=await evaluate(`(()=>{
      const dialog=document.querySelector('dialog[open]'),r=dialog?.getBoundingClientRect(),container=dialog?.querySelector('.dialog-body,#drawer-content,#modal-content');
      const rgb=s=>(s.match(/[\\d.]+/g)||[]).map(Number),luminance=s=>rgb(s).slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
      const contrast=e=>{let p=e,bg='rgb(255,255,255)';while(p){const c=getComputedStyle(p).backgroundColor,v=rgb(c);if(v.length===3||v.length===4&&v[3]>=.999){bg=c;break}p=p.parentElement}const foreground=getComputedStyle(e).color,a=luminance(foreground),b=luminance(bg);return{selector:e.className||e.tagName,foreground,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}};
      return{label:${JSON.stringify(label)},direction:document.documentElement.dir,theme:document.documentElement.dataset.theme,viewport:innerWidth,pageWidth:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth),dialog:r?{left:r.left,right:r.right,width:r.width,client:dialog.clientWidth,scroll:dialog.scrollWidth,bodyClient:container?.clientWidth,bodyScroll:container?.scrollWidth}:null,contrasts:${JSON.stringify(label)}==='profile'?[...document.querySelectorAll('#modal .profile-heading h3,#modal .secondary,#modal .dialog-language,#modal .verified-note')].filter(e=>e.checkVisibility({visibilityProperty:true})&&e.getClientRects().length).map(contrast):[]};
    })()`);
    assert.ok(layout.pageWidth<=layout.viewport+1,label+' no horizontal page overflow: '+JSON.stringify(layout));
    if(layout.dialog){assert.ok(layout.dialog.left>=-1&&layout.dialog.right<=layout.viewport+1,label+' dialog inside viewport');assert.ok(layout.dialog.scroll<=layout.dialog.client+1,label+' no horizontal dialog overflow');assert.ok(layout.dialog.bodyScroll<=layout.dialog.bodyClient+1,label+' no hidden horizontal content')}
    if(label==='profile'){assert.ok(layout.contrasts.length>=3,'Profile heading, language and verified note measured');assert.ok(layout.contrasts.every(c=>c.ratio>=4.5),'Profile text contrast >=4.5:1 '+JSON.stringify(layout.contrasts))}
    (current.layouts??=[]).push(layout);return layout;
  };
  const observer=`(()=>{
    window.__uxMotion={animations:[],longTasks:[]};const original=Element.prototype.animate;
    Element.prototype.animate=function(...args){const animation=original.apply(this,args);window.__uxMotion.animations.push({at:performance.now(),element:this.id||this.className?.baseVal||String(this.className).slice(0,80),duration:animation.effect?.getComputedTiming().duration,animation});return animation};
    try{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__uxMotion.longTasks.push({at:e.startTime,duration:e.duration})}).observe({type:'longtask',buffered:true})}catch{}
  })();`;
  await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:observer});
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const f=await lab.resetFixture({returning:true,scenarioId:'rider-ux-motion'});
  await command('Page.navigate',{url:lab.origin+'/?local-ux-motion=1'});
  await until("window.MishwarAccountContext?.snapshot().status==='ready'&&!!document.querySelector('#mishwar-language')",'Actual rider app ready');
  await check('actual-local-authentication',async()=>{
    await openSection('profile');await until("!!document.querySelector('#rider-password-form')",'Password login');
    await fill('#rider-password-form [name="phone"]',f.credentials.phone);await fill('#rider-password-form [name="password"]',f.credentials.password);await click('#rider-password-form [type="submit"]');
    await until("!!document.querySelector('.profile-state.verified')",'Actual verified fixture login');await closeModal();assert.equal((await lab.snapshot()).tripCount,0);
  });
  for(const mode of [{width:320,lang:'ar',theme:'light'},{width:320,lang:'en',theme:'dark'},{width:390,lang:'ar',theme:'dark'},{width:390,lang:'en',theme:'light'},{width:768,lang:'ar',theme:'light'},{width:768,lang:'en',theme:'dark'}])await check('ui-'+mode.width+'-'+mode.lang+'-'+mode.theme,async()=>{
    await command('Emulation.setDeviceMetricsOverride',{width:mode.width,height:844,deviceScaleFactor:1,mobile:true});
    if(await evaluate('window.MishwarLang.get()')!==mode.lang)await click('#mishwar-language');
    await openSection('settings');await until("!!document.querySelector('#theme-toggle')",'Settings');
    if(await evaluate("document.querySelector('#theme-toggle').checked")!==(mode.theme==='dark'))await click('#theme-toggle');await closeModal();
    const home=await auditLayout('home');assert.equal(home.direction,mode.lang==='ar'?'rtl':'ltr');assert.equal(home.theme,mode.theme);
    if(await evaluate(`!!(${visible('.mobile-nav [data-open-menu]')})`)){
      await click('.mobile-nav [data-open-menu]');await auditLayout('drawer');await shot(current.name+'-drawer');await click('#drawer [data-section="profile"]');
    }else{current.desktopNavigation=true;await click('.rail [data-section="profile"]')}
    await until("!!document.querySelector('.rider-account-card')",'Authenticated profile');await auditLayout('profile');await shot(current.name+'-profile');await closeModal();
    await click('#notifications-button');await until("document.querySelector('#modal')?.open&&!!document.querySelector('[data-notifications-view] .notifications-empty,[data-notifications-view] .notifications-list')",'Actual notification response renders');await auditLayout('notifications');await shot(current.name+'-notifications');await closeModal();
  });
  await check('motion-preference-and-local-frame-observation',async()=>{
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await evaluate("window.__uxFrameResult=null;(()=>{const values=[],start=performance.now();let previous=start;function frame(now){values.push(now-previous);previous=now;if(now-start<1500)requestAnimationFrame(frame);else window.__uxFrameResult={intervals:values,elapsed:now-start}}requestAnimationFrame(frame)})()");
    const before=await evaluate('window.__uxMotion.animations.length');await openSection('profile');await closeModal();await click('#notifications-button');await closeModal();
    await until('!!window.__uxFrameResult','Local frame sample');
    const performance=await evaluate("(()=>{const r=window.__uxFrameResult,v=r.intervals.slice(1).sort((a,b)=>a-b);return{frames:v.length,elapsedMs:r.elapsed,medianIntervalMs:v[Math.floor(v.length/2)],p95IntervalMs:v[Math.min(v.length-1,Math.floor(v.length*.95))],maxIntervalMs:v.at(-1),longTasks:window.__uxMotion.longTasks,animationCalls:window.__uxMotion.animations.length}})()");
    assert.ok(performance.frames>0);assert.ok(performance.animationCalls>before,'Normal local interactions produce optional motion');current.localPerformance=performance;
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await until("matchMedia('(prefers-reduced-motion: reduce)').matches",'Reduced motion matches');
    const reducedBefore=await evaluate('window.__uxMotion.animations.length');await openSection('profile');await closeModal();await click('#notifications-button');await closeModal();
    assert.equal(await evaluate('window.__uxMotion.animations.length'),reducedBefore,'Reduced motion suppresses optional WAAPI feedback');
    assert.equal(await evaluate("window.__uxMotion.animations.filter(x=>x.animation.playState==='running').length"),0,'No optional animation continues after reduction');
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await openSection('settings');await click('#motion-toggle');assert.equal(await evaluate("document.body.classList.contains('no-animation')"),true);await closeModal();
    const appBefore=await evaluate('window.__uxMotion.animations.length');await click('#notifications-button');await closeModal();assert.equal(await evaluate('window.__uxMotion.animations.length'),appBefore,'App motion preference suppresses optional feedback');
    await auditLayout('reduced-motion-home');await shot('reduced-motion-home');assert.equal((await lab.snapshot()).tripCount,0,'UI batch creates no trip');
  });
  observations.audit=lab.audit;assert.equal(observations.externalBlocked.length,0);assert.equal(observations.exceptions.length,0);assert.equal(observations.consoleErrors.length,0);assert.equal(lab.audit.errors.length,0);
}catch(error){observations.fatalError=error.message;observations.audit=lab.audit;console.error('RIDER_UX_MOTION_FATAL: '+error.message)}finally{
  clearTimeout(timeout);ws?.close();browser.kill();await lab.close();observations.completedAt=new Date().toISOString();
  const passed=observations.results.filter(r=>r.passed).length,failed=observations.results.length-passed,status=!failed&&!observations.fatalError&&passed===8?'PASS':'FAIL';
  const summary={phase:'rider-ux-motion',status,total:observations.results.length,passed,failed,fatalError:observations.fatalError||null,output,limitations:observations.limitations};writeFileSync(join(output,'observations.json'),JSON.stringify(observations,null,2)+'\n');writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));if(status!=='PASS')process.exitCode=1;
}
