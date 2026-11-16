const defaultCaptainOrigin='https://mishwar-captain.vercel.app';
export function allowedApiOrigin(request,env){
 const origin=request.headers.get('origin');if(!origin)return null;
 const allowed=new Set([new URL(request.url).origin,defaultCaptainOrigin]);
 for(const value of String(env.PUBLIC_API_ORIGINS||'').split(',')){
  try{const url=new URL(value.trim());if(url.protocol==='https:'&&url.origin===value.trim())allowed.add(url.origin)}catch{}
 }
 return allowed.has(origin)?origin:null;
}
export function apiPreflight(request,env){
 const origin=allowedApiOrigin(request,env),method=request.headers.get('access-control-request-method')||'GET';
 const headers=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
 if(!origin||!['GET','HEAD','POST'].includes(method)||headers.some(h=>!['content-type','authorization'].includes(h)))return new Response(null,{status:403,headers:{Vary:'Origin'}});
 return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600',Vary:'Origin'}});
}
export function withApiCors(response,request,env){
 const headers=new Headers(response.headers);
 for(const name of ['Access-Control-Allow-Origin','Access-Control-Allow-Credentials','Access-Control-Allow-Headers','Access-Control-Allow-Methods'])headers.delete(name);
 const origin=allowedApiOrigin(request,env);
 if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Credentials','true')}
 headers.append('Vary','Origin');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
