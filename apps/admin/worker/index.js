const portalJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function portalAdmin(_request,env,ctx){
 // Only Cloudflare Access's authenticated runtime context may establish identity.
 // User-supplied oai-authenticated-user-* headers are never credentials.
 if(typeof env?.ADMIN_EMAIL!=='string'||!env.ADMIN_EMAIL.trim()||typeof ctx?.access?.getIdentity!=='function')return null;
 try{
  const identity=await ctx.access.getIdentity();
  const email=typeof identity?.email==='string'?identity.email.trim().toLowerCase():'';
  if(!email||email!==env.ADMIN_EMAIL.trim().toLowerCase())return null;
  const id=typeof identity.id==='string'&&identity.id.length>0&&identity.id.length<=256?identity.id:email;
  return {id,email};
 }catch{return null}
}
export default{async fetch(request,env,ctx){const url=new URL(request.url);const principal=await portalAdmin(request,env,ctx);if(!principal)return new Response('هذه الصفحة مخصصة لإدارة مشوار.',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
 if(url.pathname==='/api/health')return portalJson({ready:!!(env.HUB_URL&&env.HUB_ACCESS_TOKEN&&env.HUB_SERVICE_KEY)});
 if(url.pathname.startsWith('/api/admin/')){if(!['GET','POST'].includes(request.method))return portalJson({error:'غير مسموح'},405);if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return portalJson({error:'طلب غير مسموح'},403);if(!env.HUB_URL||!env.HUB_ACCESS_TOKEN||!env.HUB_SERVICE_KEY)return portalJson({error:'اتصال خادم العمليات غير مهيأ'},503);const path=url.pathname.replace('/api/admin/','/internal/administration/');
 try{const response=await fetch(env.HUB_URL+path+url.search,{method:request.method,headers:{'OAI-Sites-Authorization':'Bearer '+env.HUB_ACCESS_TOKEN,'x-mishwar-key':env.HUB_SERVICE_KEY,'x-mishwar-admin-id':principal.id,'x-mishwar-admin-email':principal.email,'Content-Type':request.headers.get('content-type')||'application/json'},...(request.method==='POST'?{body:request.body,duplex:'half'}:{}),signal:AbortSignal.timeout(20000)});const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.delete('set-cookie');if(!headers.get('content-type')?.match(/application\/json|image\/(png|jpeg|webp)|application\/pdf/))return portalJson({error:'تعذر الوصول لخادم العمليات. أعد المحاولة.'},502);return new Response(response.body,{status:response.status,headers})}catch{return portalJson({error:'تعذر الاتصال بخادم العمليات'},502)}}
 let path=url.pathname;if(path==='/install')path='/install.html';if(path==='/'||path==='/admin')path='/index.html';const asset=ASSETS[path];if(!asset)return new Response('Not found',{status:404});const headers={'Content-Type':asset.type,'Cache-Control':path.endsWith('.html')||path==='/sw.js'?'no-store':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};if(path.endsWith('.apk'))headers['Content-Disposition']='attachment; filename="'+path.split('/').pop()+'"';if(path==='/sw.js')headers['Service-Worker-Allowed']='/';return new Response(Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)),{headers});}};
