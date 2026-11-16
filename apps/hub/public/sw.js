const __MISHWAR_ASSETS__ = typeof self.__MISHWAR_ASSETS__ !== 'undefined' ? self.__MISHWAR_ASSETS__ : [];
const BUILD='v-8a2a5188412d';const CACHE='mishwar-shell-'+BUILD;const SHELL=["/account-settings.js","/app-background.js","/app-update.js","/cancellation-ui.js","/captain-auth.js","/captain-responsive.css","/compact.css","/driver-install.css","/driver-install.js","/driver-offers.js","/driver-responsive.css","/driver-services.js","/driver.css","/driver.js","/i18n.css","/i18n.js","/icon-192.png","/icon-512.png","/icon-maskable-512.png","/icon.svg","/launch-ui.css","/launch-ui.js","/live-driver-map.js","/manifest.webmanifest","/navigation-ui.js","/onboarding.css","/onboarding.js","/realtime-client.js","/recovery-ui.css","/recovery-ui.js","/trip-feedback.js","/validation.js","/vendor/leaflet.css","/vendor/leaflet.js","/wallet-funding.js"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(async path=>{const response=await fetch(path,{credentials:'include',cache:'reload'});if(!response.ok||response.redirected)return;const type=response.headers.get('content-type')||'';if(path.endsWith('.js')&&!type.includes('javascript')||path.endsWith('.css')&&!type.includes('text/css'))return;await cache.put(path,response)})))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>/^(mishwar-shell-|captain-mishwar-|mishwar-captain-|rider-demo-)/.test(k)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Auth-sensitive navigation must not replay a previous signed-in page.
 if(event.request.mode==='navigate'||event.request.destination==='document')return;
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname==='/version.json'||!SHELL.includes(url.pathname))return;
 event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   if(/\.(?:js|css|webmanifest)$/.test(url.pathname)){
     try{const fresh=await fetch(event.request,{cache:'no-store'});
       if(fresh.ok&&!fresh.redirected){const type=fresh.headers.get('content-type')||'';if(!url.pathname.endsWith('.js')||type.includes('javascript'))await cache.put(url.pathname,fresh.clone())}
       return fresh;
     }catch{return (await cache.match(url.pathname))||Response.error()}
   }
   return (await cache.match(url.pathname))||fetch(event.request);
 })());
});
// New versions activate promptly and migrate away from old cached pages.
self.addEventListener('install',()=>{self.skipWaiting()});

self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting()});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const client of windows)client.postMessage({type:'REFRESH_DRIVER'});
 // Refreshing an open page does not mean that its user has seen the inbox.
 if(windows.some(client=>client.visibilityState==='visible'))return;
 let rows=[];
 try{const response=await fetch('/api/background',{credentials:'include',cache:'no-store'});if(response.ok&&response.headers.get('content-type')?.includes('application/json')){const data=await response.json();if(Array.isArray(data.notifications))rows=data.notifications}}catch{}
 if(!rows.length){await self.registration.showNotification('مشوار',{body:'لديك تحديث. افتح التطبيق للاطلاع عليه.',icon:'/icon-192.png',silent:false,vibrate:[250,100,250,100,250],tag:'mishwar-update',data:{url:'/'}});return}
 const displayed=[];
 for(const item of rows.slice(0,3)){
  try{
   await self.registration.showNotification(item.title,{body:item.body,icon:'/icon-192.png',silent:false,vibrate:[250,100,250,100,250],tag:'mishwar-'+item.id,data:{url:item.url},requireInteraction:true});
   if(typeof item.id==='string'&&item.id)displayed.push(item.id);
  }catch{}
 }
 // Failed displays and rows beyond the display limit must remain unread.
 if(displayed.length)await fetch('/api/background',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({action:'ack',ids:displayed})}).catch(()=>{});
})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of list)if(new URL(client.url).origin===url.origin){await client.navigate(url.href);return client.focus()}return self.clients.openWindow(url.href)})())});
