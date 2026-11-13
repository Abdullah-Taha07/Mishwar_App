import{settingsAdmin}from'./account-settings.js';import{rechargeAdmin}from'./recharge.js';
import{recoveryAdmin}from'./recovery.js';
import{manualPhoneAdmin}from'./free-auth.js';
import{handleCommerceAdmin,livePayments,expireMatchingTrips}from'./commerce.js';
import{handleOperations,logEvent}from'./operations.js';
import {DOCUMENTS} from '../public/validation.js';
const adminJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function isAdmin(request,env){const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');return !!(id&&email&&env.CAPTAIN_ADMIN_EMAIL&&email.trim().toLowerCase()===env.CAPTAIN_ADMIN_EMAIL.trim().toLowerCase())}
export async function handleAdmin(request,env){
 if(!isAdmin(request,env))return adminJson({error:'هذه الصفحة مخصصة لإدارة كابتن مشوار.'},403);
 const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean);
 if(url.pathname==='/api/admin/notifications'&&request.method==='GET'){
 const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM captain_applications WHERE status='pending'").first();
 const phones=(await env.DB.prepare("SELECT role,COUNT(*) AS n FROM public_accounts WHERE phone_verified_at IS NULL GROUP BY role").all()).results;
 const requests=await env.DB.prepare("SELECT COUNT(*) AS n FROM trips WHERE status='matching' AND is_demo=0 AND julianday(created_at)>julianday('now','-3 minutes')").first();
 const recovery=await env.DB.prepare("SELECT COUNT(*) AS n FROM account_recovery WHERE status='pending' AND actor IS NOT NULL AND expires_at>?").bind(new Date().toISOString()).first();const changes=await env.DB.prepare("SELECT COUNT(*) AS n FROM account_changes WHERE mode='manual' AND stage IN ('old','new') AND consumed_at IS NULL AND expires_at>?").bind(new Date().toISOString()).first();const items=[{page:'account-changes',label:'طلبات تعديل بيانات الدخول',count:changes.n},{page:'account-recovery',label:'طلبات استعادة الحسابات',count:recovery.n},{page:'applications',label:'طلبات انضمام الكباتن',count:pending.n},{page:'phone-verifications',label:'أرقام الركاب بانتظار التوثيق',count:phones.find(x=>x.role==='rider')?.n||0},{page:'phone-verifications',label:'أرقام الكباتن بانتظار التوثيق',count:phones.find(x=>x.role==='captain')?.n||0},{page:'live',label:'طلبات رحلات بانتظار كابتن',count:requests.n}];return adminJson({items,total:items.reduce((n,x)=>n+x.count,0),updatedAt:new Date().toISOString()});
 }
 if(url.pathname==='/api/admin/session')return adminJson({admin:true});
 if(!env.DB||!env.BUCKET)return adminJson({error:'خدمة المراجعة غير متاحة حاليًا.'},503);
 if(url.pathname==='/api/admin/trip-extras'&&request.method==='GET'){const id=url.searchParams.get('id')||'';const pricing=await env.DB.prepare('SELECT n.minimum_halalas,q.fare_halalas AS rider_offer FROM trip_negotiations n JOIN trip_commerce c ON c.trip_id=n.trip_id JOIN ride_quotes q ON q.id=c.quote_id WHERE n.trip_id=?').bind(id).first();const offers=(await env.DB.prepare('SELECT captain_id,amount_halalas,status,created_at,expires_at FROM fare_counters WHERE trip_id=? ORDER BY created_at').bind(id).all()).results;const ratings=(await env.DB.prepare('SELECT role,score,comment,created_at FROM trip_ratings WHERE trip_id=?').bind(id).all()).results;const context=await env.DB.prepare('SELECT * FROM trip_context WHERE trip_id=?').bind(id).first();return adminJson({pricing,offers,ratings,context})}
 if(url.pathname==='/api/admin/connections'&&request.method==='GET'){
 const cutoff=new Date(Date.now()-120000).toISOString();
 const captains=await env.DB.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(a.status='active'),0) AS active,COALESCE(SUM(a.status='active' AND p.available=1 AND p.location_at>? AND p.accuracy<=150 AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND COALESCE(w.balance_halalas,0)>=0 AND COALESCE(c.suspended,0)=0 AND NOT EXISTS(SELECT 1 FROM trips t WHERE t.driver_id=a.id AND t.status IN ('arriving','arrived','riding'))),0) AS available FROM captain_applications a LEFT JOIN captain_presence p ON p.application_id=a.id LEFT JOIN wallet_accounts w ON w.account_id='captain:'||a.id LEFT JOIN account_controls c ON c.role='captain' AND c.account_id=a.id").bind(cutoff).first();
 const trips=await env.DB.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(status IN ('matching','arriving','arrived','riding')),0) AS live FROM trips WHERE is_demo=0").first();
 const riders=await env.DB.prepare('SELECT COUNT(*) AS total FROM riders').first();
 return adminJson({connected:true,updatedAt:new Date().toISOString(),captains,trips,riders,services:{database:true,documents:!!env.BUCKET,dispatch:true,history:true,wallet:true,manualPhoneVerification:true,card:!!livePayments(env),applepay:!!(livePayments(env)&&env.APPLE_PAY_ENABLED==='true'),sms:!!(env.AUTHENTICA_API_KEY&&env.AUTHENTICA_TEMPLATE_ID),push:!!(env.VAPID_PRIVATE_JWK&&env.VAPID_PUBLIC_KEY)}});
 }
 if(url.pathname==='/api/admin/account-changes')return await settingsAdmin(request,env);if(url.pathname==='/api/admin/recharge-cards')return await rechargeAdmin(request,env);
 if(url.pathname==='/api/admin/account-recovery')return await recoveryAdmin(request,env);
 if(url.pathname==='/api/admin/phone-verifications')return await manualPhoneAdmin(request,env);
 if(url.pathname.startsWith('/api/admin/commerce/'))return await handleCommerceAdmin(request,env);
 if(url.pathname.startsWith('/api/admin/operations/')){if(request.method==='GET')await expireMatchingTrips(env);return await handleOperations(request,env)}
 if(request.method==='GET'&&url.pathname==='/api/admin/applications'){
 const status=url.searchParams.get('status')||'pending',q=(url.searchParams.get('q')||'').trim().slice(0,100);if(!['all','pending','active','rejected'].includes(status))return adminJson({error:'حالة غير صحيحة.'},400);
 const offset=Math.max(0,Math.min(1000000,Number.parseInt(url.searchParams.get('offset')||'0',10)||0));
 let where='WHERE 1=1';const values=[];if(status!=='all'){where+=' AND status = ?';values.push(status)}if(q){where+=" AND (json_extract(personal_json,'$.name') LIKE ? OR phone LIKE ? OR id LIKE ?)";const search='%'+q.replace(/^KM-/i,'')+'%';values.push(search,search,search)}
 const list=await env.DB.prepare("SELECT id, phone, status, submitted_at, reviewed_at, json_extract(personal_json,'$.name') AS name, json_extract(vehicle_json,'$.make') AS make, json_extract(vehicle_json,'$.model') AS model FROM captain_applications "+where+' ORDER BY submitted_at DESC, id DESC LIMIT 50 OFFSET ?').bind(...values,offset).all();
 const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM captain_applications '+where).bind(...values).first();
 const stats=await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status='pending'),0) AS pending, COALESCE(SUM(status='active'),0) AS active, COALESCE(SUM(status='rejected'),0) AS rejected FROM captain_applications").bind().first();
 return adminJson({items:list.results.map(r=>({...r,reference:'KM-'+r.id.slice(0,8).toUpperCase()})),total:count.total,offset,stats});
 }
 if(parts[2]!=='applications'||!parts[3]||!/^[-\w]{1,80}$/.test(parts[3]))return adminJson({error:'الطلب غير موجود.'},404);
 const id=parts[3];const row=await env.DB.prepare('SELECT a.*, r.reason AS review_reason, r.reviewed_documents_json FROM captain_applications a LEFT JOIN captain_reviews r ON r.application_id=a.id WHERE a.id=?').bind(id).first();if(!row)return adminJson({error:'الطلب غير موجود.'},404);
 const docs=JSON.parse(row.documents_json);
 if(request.method==='GET'&&parts.length===4)return adminJson({id:row.id,reference:'KM-'+row.id.slice(0,8).toUpperCase(),status:row.status,submittedAt:row.submitted_at,reviewedAt:row.reviewed_at,reason:row.review_reason||'',phone:row.phone,email:row.email,personal:JSON.parse(row.personal_json),vehicle:JSON.parse(row.vehicle_json),documents:DOCUMENTS.map(([key,title])=>({key,title,present:!!docs[key],type:docs[key]?.type,size:docs[key]?.size})),reviewedDocuments:JSON.parse(row.reviewed_documents_json||'[]')});
 if(request.method==='GET'&&parts[4]==='documents'&&parts.length===6){const key=parts[5];if(!DOCUMENTS.some(d=>d[0]===key)||!docs[key])return adminJson({error:'المستند غير موجود.'},404);const file=await env.BUCKET.get(docs[key].key);if(!file)return adminJson({error:'تعذر العثور على الملف المرفوع.'},404);const type=docs[key].type;const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'})[type];if(!ext)return adminJson({error:'نوع المستند غير مدعوم.'},400);return new Response(file.body,{headers:{'Content-Type':type,'Content-Disposition':(url.searchParams.get('download')==='1'?'attachment':'inline')+'; filename="'+key+'.'+ext+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"sandbox; default-src 'none'"}})}
 if(request.method==='POST'&&parts[4]==='review'&&parts.length===5){
 if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return adminJson({error:'طلب غير مسموح.'},403);
 if(row.status!=='pending')return adminJson({error:'تمت مراجعة هذا الطلب مسبقًا. حدّث الصفحة.'},409);
 if(Number(request.headers.get('content-length')||0)>8192)return adminJson({error:'الطلب كبير جدًا.'},413);
 let data;try{const text=await request.text();if(text.length>8192)throw Error();data=JSON.parse(text)}catch{return adminJson({error:'بيانات المراجعة غير صالحة.'},400)}
 if(!['active','rejected'].includes(data.decision))return adminJson({error:'اختر قرارًا صحيحًا.'},400);
 const reason=typeof data.reason==='string'?data.reason.trim():'';if(reason.length>500||data.decision==='rejected'&&reason.length<3)return adminJson({error:'اكتب سبب الرفض بوضوح، حتى ٥٠٠ حرف.'},400);
 const reviewed=Array.isArray(data.reviewedDocuments)?[...new Set(data.reviewedDocuments)]:[];
 if(data.decision==='active'&&DOCUMENTS.some(([key])=>!docs[key]||!reviewed.includes(key)))return adminJson({error:'يجب مراجعة جميع المستندات والتأشير عليها قبل التفعيل.'},400);
 const at=new Date().toISOString();
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO captain_reviews (application_id,reviewer_id,decision,reason,reviewed_documents_json,reviewed_at) VALUES (?,?,?,?,?,?)').bind(id,request.headers.get('oai-authenticated-user-id'),data.decision,reason,JSON.stringify(reviewed.filter(key=>DOCUMENTS.some(d=>d[0]===key))),at),
 env.DB.prepare("UPDATE captain_applications SET status=?, reviewed_at=? WHERE id=? AND status='pending'").bind(data.decision,at,id)
 ]);}catch{return adminJson({error:'لم يُحفظ القرار أو تمت مراجعة الطلب بالفعل. حدّث الصفحة وأعد المحاولة.'},409)}
 await logEvent(env,'admin',data.decision==='active'?'captain_approved':'captain_rejected',request.headers.get('oai-authenticated-user-id'),id).catch(()=>{});return adminJson({id,status:data.decision,reviewedAt:at});
 }
 return adminJson({error:'المسار غير موجود.'},404)
}
