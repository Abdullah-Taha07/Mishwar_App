const __MISHWAR_ASSETS__ = typeof self.__MISHWAR_ASSETS__ !== 'undefined' ? self.__MISHWAR_ASSETS__ : [];
const BUILD='__MISHWAR_VERSION__';const CACHE='mishwar-shell-'+BUILD;const SHELL=__MISHWAR_ASSETS__;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(SHELL.map(async path=>{const response=await fetch(path,{credentials:'include',cache:'reload'});if(!response.ok||response.redirected)return;const type=response.headers.get('content-type')||'';if(path.endsWith('.js')&&!type.includes('javascript')||path.endsWith('.css')&&!type.includes('text/css'))return;await cache.put(path,response)})))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>/^(mishwar-shell-|captain-mishwar-|mishwar-captain-|rider-demo-)/.test(k)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname==='/version.json'||!SHELL.includes(url.pathname))return;
 event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   if(event.request.mode==='navigate'||/\.(?:html|js|css)$/.test(url.pathname)){
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
self.addEventListener('push',event=>event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows)client.postMessage({type:'REFRESH_DRIVER'});let rows=[];try{const r=await fetch('/api/background',{credentials:'include',cache:'no-store'});if(r.ok&&r.headers.get('content-type')?.includes('application/json'))rows=(await r.json()).notifications||[]}catch{}if(!rows.length)await self.registration.showNotification('مشوار',{body:'لديك تحديث. افتح التطبيق للاطلاع عليه.',icon:'/icon-192.png',silent:false,vibrate:[250,100,250,100,250],tag:'mishwar-update',data:{url:'/'}});else{for(const item of rows.slice(0,3))await self.registration.showNotification(item.title,{body:item.body,icon:'/icon-192.png',silent:false,vibrate:[250,100,250,100,250],tag:'mishwar-'+item.id,data:{url:item.url},requireInteraction:true});await fetch('/api/background',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({action:'ack',ids:rows.map(x=>x.id)})}).catch(()=>{})}})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of list)if(new URL(client.url).origin===url.origin){await client.navigate(url.href);return client.focus()}return self.clients.openWindow(url.href)})())});
