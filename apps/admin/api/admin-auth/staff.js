// Same-origin browser bridge; only this server can call the Worker service gateway.
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
 const send=(s,d)=>{res.status(s).end(JSON.stringify(d));};
 if(req.method!=='POST'||req.headers.origin!==`https://${req.headers.host}`)return send(403,{error:'طلب غير مسموح'});
 const hub=(process.env.HUB_URL||'').replace(/\/+$/,'');
 if(!hub||!process.env.ADMIN_SERVICE_KEY)return send(503,{error:'خدمة الموظفين غير مهيأة'});
 const cookies=String(req.headers.cookie||'');const get=n=>cookies.match(new RegExp('(?:^|;\\s*)'+n+'=([a-f0-9]{64})(?:;|$)'))?.[1];
 const action=String(req.body?.action||'');if(!['login','complete','session','activity','logout'].includes(action))return send(400,{error:'طلب غير صحيح'});
 const body={...req.body,sessionToken:get('__Host-mishwar_staff'),deviceToken:get('__Host-mishwar_device')};delete body.action;
 if(JSON.stringify(body).length>8192)return send(413,{error:'طلب كبير جدًا'});
 try{
  const upstream=await fetch(`${hub}/internal/administration/staff-auth/${action}`,{method:'POST',headers:{'Content-Type':'application/json','x-mishwar-key':process.env.ADMIN_SERVICE_KEY,'x-staff-source':String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0],'user-agent':String(req.headers['user-agent']||'')},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  const data=await upstream.json(),set=[];
  const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
  if(data.sessionToken){set.push(cookie('__Host-mishwar_admin','',0));set.push(cookie('__Host-mishwar_staff',data.sessionToken,28800));delete data.sessionToken;}
  if(data.deviceToken){set.push(cookie('__Host-mishwar_device',data.deviceToken,2592000));delete data.deviceToken;}
  if(action==='logout'||upstream.status===401)set.push(cookie('__Host-mishwar_staff','',0));
  if(set.length)res.setHeader('Set-Cookie',set);send(upstream.status,data);
 }catch{send(502,{error:'تعذر الاتصال بخادم المصادقة'});}
}
