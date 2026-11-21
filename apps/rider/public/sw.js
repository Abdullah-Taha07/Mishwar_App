const BUILD='v-85826366b946';const CACHE='mishwar-shell-'+BUILD;const SHELL=["/account-context.js","/app-background.js","/app-share.js","/app-update.js","/app.js","/cancellation-ui.js","/captain-tracking.js","/compact.css","/features.js","/geo-policy.js","/i18n-catalog.js","/i18n.css","/i18n.js","/icon-192.png","/icon-512.png","/icon-maskable-512.png","/icon.svg","/index.html","/install.html","/language-boot.js","/launch-ui.css","/launch-ui.js","/live-booking.css","/live-booking.js","/manifest.webmanifest","/maps.js","/mobile.css","/navigation-ui.js","/operations-sync.js","/realtime-client.js","/recovery-ui.css","/recovery-ui.js","/responsive-ui.css","/ride-ui.css","/ride-ui.js","/rider-account-settings.js","/rider-auth.js","/rider-design-system.css","/rider-experience.js","/rider-history.css","/rider-history.js","/rider-location.js","/rider-motion.js","/rider-speed.js","/rider-support.js","/screens.css","/screens.js","/search-ui.js","/shared-tracking.js","/sheet.css","/sheet.js","/style.css","/track.html","/tracking-eta.css","/tracking-eta.js","/trip-feedback.js","/trip-receipt.js","/universal-install.js","/ux.css","/vendor/images/layers-2x.png","/vendor/images/layers.png","/vendor/images/marker-icon-2x.png","/vendor/images/marker-icon.png","/vendor/images/marker-shadow.png","/vendor/leaflet.css","/vendor/leaflet.js","/wallet-funding.js","/"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(async path=>{const response=await fetch(path,{credentials:'include',cache:'reload'});if(!response.ok||response.redirected)return;const type=response.headers.get('content-type')||'';if(path.endsWith('.js')&&!type.includes('javascript')||path.endsWith('.css')&&!type.includes('text/css'))return;await cache.put(path,response)})))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>/^(mishwar-shell-|captain-mishwar-|mishwar-captain-|rider-demo-)/.test(k)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname==='/version.json'||!SHELL.includes(url.pathname))return;event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(url.pathname);if(cached)return cached;return fetch(event.request)}))});

self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting()});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const client of windows)client.postMessage({type:'REFRESH_TRIP'});
 // Refreshing an open page does not mean that its user has seen the inbox.
 if(windows.some(client=>client.visibilityState==='visible'))return;
 let rows=[];
 try{const response=await fetch('/api/background',{credentials:'include',cache:'no-store'});if(response.ok&&response.headers.get('content-type')?.includes('application/json')){const data=await response.json();if(Array.isArray(data.notifications))rows=data.notifications}}catch{}
 if(!rows.length){await self.registration.showNotification('مشوار',{body:'لديك تحديث. افتح التطبيق للاطلاع عليه.',icon:'/icon-192.png',silent:false,vibrate:[200,100,200],lang:'ar',dir:'rtl',tag:'mishwar-update',data:{url:'/'}});return}
 const displayed=[];
 for(const item of rows.slice(0,3)){
  try{
   await self.registration.showNotification(item.title,{body:item.body,icon:'/icon-192.png',silent:false,vibrate:[200,100,200],lang:'ar',dir:'rtl',tag:'mishwar-'+item.id,data:{url:item.url},requireInteraction:true});
   if(typeof item.id==='string'&&item.id)displayed.push(item.id);
  }catch{}
 }
 // Failed displays and rows beyond the display limit must remain unread.
 if(displayed.length)await fetch('/api/background',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({action:'ack',ids:displayed})}).catch(()=>{});
})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of list)if(new URL(client.url).origin===url.origin){await client.navigate(url.href);return client.focus()}return self.clients.openWindow(url.href)})())});
