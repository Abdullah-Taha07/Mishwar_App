import{captainAuth,publicSession}from'./free-auth.js';
import{routeEstimate}from'./routing.js';
import{handleRiderAuth}from'./rider-auth.js';
import{handleCaptainBackground,handleRiderBackground}from'./background.js';
import{handleLiveRider,handleDriver}from'./commerce.js';
import{handleRiderBridge,handleOperations,handleCaptainPresence,secretMatches,logEvent}from'./operations.js';
import{handleAdmin,isAdmin}from'./admin.js';
import{DOCUMENTS,phoneNumber,digits,validatePersonal,validateVehicle,fileError}from'../public/validation.js';

const MAX_BODY=26*1024*1024;

// ✅ التعديل الأول: تعريف الدومين المسموح له بالاتصال (تطبيق الكابتن على Vercel)
const ALLOWED_ORIGIN = 'https://mishwar-captain.vercel.app'; 

// ✅ التعديل الثاني: إضافة رؤوس الـ CORS لدالة الـ json عشان المتصفح يقبل الاستجابة
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true'
}});

const summary=row=>({id:row.id,reference:'KM-'+row.id.slice(0,8).toUpperCase(),status:row.status,submittedAt:row.submitted_at,reviewedAt:row.reviewed_at||null,reason:row.review_reason||''});

async function record(env,user){
    return env.DB.prepare('SELECT a.id, a.user_id, a.phone, a.status, a.submitted_at, a.reviewed_at, r.reason AS review_reason FROM captain_applications a LEFT JOIN captain_reviews r ON r.application_id=a.id WHERE a.user_id = ?').bind(user).first()
}

async function limitedBody(request){
    const reader=request.body?.getReader();
    if(!reader)throw Error('EMPTY');
    let size=0;
    const chunks=[];
    while(true){
        const{done,value}=await reader.read();
        if(done)break;
        size+=value.byteLength;
        if(size>MAX_BODY){await reader.cancel();throw Error('SIZE')}
        chunks.push(value)
    }
    return new Blob(chunks)
}

function signature(bytes,type){
    const a=new Uint8Array(bytes);
    if(type==='image/jpeg')return a[0]===255&&a[1]===216&&a[2]===255;
    if(type==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>a[i]===v);
    const head=new TextDecoder().decode(a.slice(0,12));
    if(type==='application/pdf')return head.startsWith('%PDF-');
    return type==='image/webp'&&head.startsWith('RIFF')&&head.slice(8)==='WEBP'
}

export async function handleApi(request,env){
    const url=new URL(request.url),user=request.headers.get('oai-authenticated-user-id');
    if(!user)return json({error:'سجّل الدخول بحسابك أولًا.'},401);
    if(!env.DB||!env.BUCKET)return json({error:'خدمة التسجيل غير جاهزة حاليًا، حاول لاحقًا.'},503);
    
    if(request.method==='GET'&&url.pathname==='/api/application'){
        const row=await record(env,user);
        return row?json(summary(row)):json({error:'لا يوجد طلب مسجل لهذا الحساب.'},404)
    }
    
    if(request.method==='POST'){
        // ✅ التعديل الثالث: السماح بالطلبات القادمة من Vercel أو من نفس الدومين
        const origin = request.headers.get('origin');
        if(origin && origin !== url.origin && origin !== ALLOWED_ORIGIN) {
            return json({error:'طلب غير مسموح.'}, 403);
        }
        
        if(url.pathname==='/api/login'){
            let data;
            try{data=await request.json()}catch{return json({error:'طلب غير صالح.'},400)}
            const phone=phoneNumber(data.phone),row=await record(env,user);
            if(!phone||!row||row.phone!==phone)return json({error:'لا يوجد حساب مطابق تحت حساب الدخول الحالي. تأكد من الرقم أو سجّل ككابتن جديد.'},403);
            return json(summary(row))
        }
        
        if(url.pathname==='/api/application'){
            const existing=await record(env,user);
            if(existing)return json(summary(existing));
            if(Number(request.headers.get('content-length')||0)>MAX_BODY)return json({error:'إجمالي الملفات كبير. الحد الإجمالي ٢٥ ميجابايت.'},413);
            if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))return json({error:'ارفع البيانات والمستندات مع الطلب.'},400);
            let form,p,v;
            try{
                const body=await limitedBody(request);
                form=await new Response(body,{headers:{'Content-Type':request.headers.get('content-type')}}).formData();
                p=JSON.parse(form.get('personal'));
                v=JSON.parse(form.get('vehicle'));
                if(!p||typeof p!=='object'||!v||typeof v!=='object')throw Error()
            }catch(error){
                return json({error:error.message==='SIZE'?'إجمالي الملفات يتجاوز الحد المسموح.':'تعذر قراءة بيانات الطلب.'},400)
            }
            
            if(Object.entries(p).some(([k,x])=>k!=='consent'&&typeof x!=='string')||Object.values(v).some(x=>typeof x!=='string'))return json({error:'نوع البيانات غير صحيح.'},400);
            
            const account=await env.DB.prepare("SELECT phone FROM public_accounts WHERE role='captain' AND actor=?").bind(user).first();
            if(account&&phoneNumber(p.phone)!==account.phone)return json({error:'رقم الطلب يجب أن يطابق رقم حسابك الموثق'},403);
            
            const fields={...validatePersonal(p),...validateVehicle(v)};
            if(Object.keys(fields).length)return json({error:'أكمل البيانات المطلوبة بصورة صحيحة.',fields},400);
            if(form.get('consent')!=='true')return json({error:'يجب تأكيد صحة البيانات والموافقة على المراجعة.'},400);
            
            const accountEmail=String(p.email).trim().toLowerCase();
            if(await env.DB.prepare("SELECT actor FROM public_accounts WHERE role='captain' AND actor<>? AND lower(trim(email))=?").bind(user,accountEmail).first()||await env.DB.prepare('SELECT id FROM captain_applications WHERE lower(trim(email))=?').bind(accountEmail).first())return json({error:'البريد الإلكتروني مسجل لكابتن آخر. استخدم تسجيل الدخول إلى حسابك المسجل.'},409);
            
            const validated=[];
            let total=0;
            for(const[key,,]of DOCUMENTS){
                const file=form.get(key),imageOnly=DOCUMENTS.findIndex(d=>d[0]===key)>=4;
                const message=fileError(file,imageOnly);
                if(message)return json({error:message,field:key},400);
                total+=file.size;
                if(total>25*1024*1024)return json({error:'الحد الإجمالي للملفات ٢٥ ميجابايت.'},413);
                if(!signature(await file.slice(0,12).arrayBuffer(),file.type))return json({error:'أحد الملفات غير مطابق لنوعه. اختر صورة أو ملف PDF صالحًا.',field:key},400);
                validated.push([key,file])
            }
            
            const id=crypto.randomUUID(),created=new Date().toISOString(),docs={},uploaded=[];
            try{
                for(const[key,file]of validated){
                    const storageKey='applications/'+id+'/'+key;
                    await env.BUCKET.put(storageKey,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
                    uploaded.push(storageKey);
                    docs[key]={key:storageKey,type:file.type,size:file.size}
                }
                
                const cleanPersonal=Object.fromEntries(['name','birthDate','nationality','identityType','identityNumber','city','district','street','building','postalCode'].map(k=>[k,String(p[k]).trim()]));
                cleanPersonal.identityNumber=digits(cleanPersonal.identityNumber);
                cleanPersonal.postalCode=digits(cleanPersonal.postalCode);
                
                const cleanVehicle=Object.fromEntries(['make','model','year','color','plate','seats','ownership','identityExpiry','licenseExpiry','registrationExpiry','insuranceExpiry'].map(k=>[k,String(v[k]).trim()]));
                
                await env.DB.prepare('INSERT INTO captain_applications (id,user_id,phone,email,personal_json,vehicle_json,documents_json,status,submitted_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,user,phoneNumber(p.phone),String(p.email).trim().toLowerCase(),JSON.stringify(cleanPersonal),JSON.stringify(cleanVehicle),JSON.stringify(docs),'pending',created).run();
                await logEvent(env,'captain','captain_registered',user,id).catch(()=>{});
                
                return json({id,reference:'KM-'+id.slice(0,8).toUpperCase(),status:'pending',submittedAt:created},201)
            }catch(error){
                await Promise.allSettled(uploaded.map(key=>env.BUCKET.delete(key)));
                const row=await record(env,user);
                if(row)return json(summary(row));
                return json({error:'لم يتم حفظ الطلب. أعد المحاولة وتأكد من عدم استخدام رقم الجوال في حساب آخر.'},409)
            }
        }
    }
    return json({error:'المسار غير موجود.'},404)
}

export default{
    async fetch(request,env,ctx){
        // ✅ التعديل الرابع: معالجة طلبات الفحص المسبق (Preflight) التي يرسلها المتصفح
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Access-Control-Allow-Credentials': 'true',
                }
            });
        }

        const url=new URL(request.url);
        try{
            if(url.pathname.startsWith('/api/auth/'))return await captainAuth(request,env);
            
            const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-mishwar_captain=([a-f0-9]{64})(?:;|$)/)?.[1];
            // Never trust user-identity headers supplied to the public workers.dev endpoint.
            // Captain operations are authenticated exclusively with our signed-in HTTP-only session.
            if(['/api/driver','/api/application','/api/login','/api/captain-presence','/api/background'].includes(url.pathname)){
                const authenticated=token?await publicSession(env,token,'captain'):null;
                const headers=new Headers(request.headers);
                headers.delete('oai-authenticated-user-id');
                headers.delete('oai-authenticated-user-email');
                if(authenticated?.phoneVerified)headers.set('oai-authenticated-user-id',authenticated.actor);
                request=new Request(request,{headers});
            }
            
            if(url.pathname==='/internal/route-estimate')return await routeEstimate(request,env);
            if(url.pathname==='/internal/rider-auth')return await handleRiderAuth(request,env);
            if(url.pathname==='/internal/rider-background')return await handleRiderBackground(request,env);
            if(url.pathname==='/api/background')return await handleCaptainBackground(request,env);
            if(url.pathname==='/internal/live-rider')return await handleLiveRider(request,env,ctx);
            if(url.pathname==='/api/driver')return await handleDriver(request,env,ctx);
            if(url.pathname==='/internal/rider')return await handleRiderBridge(request,env);
            
            if(url.pathname.startsWith('/internal/administration/')){
                if(!await secretMatches(request.headers.get('x-mishwar-key'),env.ADMIN_SERVICE_KEY))return json({error:'غير مسموح'},403);
                const target=new URL(request.url);
                target.pathname=target.pathname.replace('/internal/administration/','/api/admin/');
                const headers=new Headers(request.headers);
                headers.set('origin',target.origin);
                headers.set('oai-authenticated-user-id','administration-service');
                headers.set('oai-authenticated-user-email',env.CAPTAIN_ADMIN_EMAIL||'');
                const trusted=new Request(target,{method:request.method,headers,...(request.method==='GET'?{}:{body:request.body,duplex:'half'})});
                return await handleAdmin(trusted,env)
            }
            
            if(url.pathname==='/api/captain-presence')return await handleCaptainPresence(request,env);
            
            if(url.pathname==='/api/health'){
                if(!env.DB||!env.BUCKET)return json({ready:false},503);
                await env.DB.prepare('SELECT id FROM captain_applications LIMIT 1').bind().first();
                await env.DB.prepare('SELECT application_id FROM captain_reviews LIMIT 1').bind().first();
                await env.DB.prepare('SELECT id FROM trips LIMIT 1').bind().first();
                return json({ready:true,adminConfigured:!!env.CAPTAIN_ADMIN_EMAIL,operationsReady:true,dispatchReady:true})
            }
            
            if(url.pathname.startsWith('/api/admin/'))return await handleAdmin(request,env);
            if(url.pathname.startsWith('/api/'))return await handleApi(request,env);
            
            let path=url.pathname;
            if(path==='/install')path='/install.html';
            if(path==='/launch')path='/index.html';
            
            if(['/admin','/admin/','/admin.html'].includes(path)){
                return Response.redirect('https://mishwar-admin-gamma.vercel.app',302);
            }
            
            if(['/dashboard','/dashboard.html'].includes(path)){
                // A verified HttpOnly captain cookie, NOT a request header, authorizes navigation.
                const signedIn=token?await publicSession(env,token,'captain'):null;
                if(!signedIn?.phoneVerified||!env.DB)return Response.redirect(url.origin+'/launch?login=1#login',302);
                const row=await record(env,signedIn.actor);
                if(row?.status!=='active')return Response.redirect(url.origin+'/launch?login=1#login',302);
                path='/dashboard.html';
            }
            
            if(path==='/'){
                // Same session model for both the homepage and the dashboard.
                const signedIn=token?await publicSession(env,token,'captain'):null;
                if(signedIn?.phoneVerified){
                    const saved=await record(env,signedIn.actor);
                    if(saved?.status==='active')return Response.redirect(url.origin+'/dashboard',302)
                }
                path='/index.html'
            }
            
            const item=ASSETS[path];
            if(!item)return new Response('Not found',{status:404});
            
            const headers={
                'Content-Type':item.type,
                'X-Content-Type-Options':'nosniff',
                'Referrer-Policy':'same-origin',
                'Cache-Control':path.endsWith('.html')||path==='/sw.js'?'no-store':'no-cache'
            };
            
            if(path.endsWith('.apk'))headers['Content-Disposition']='attachment; filename="'+path.split('/').pop()+'"';
            if(path==='/sw.js')headers['Service-Worker-Allowed']='/';
            
            const bytes=Uint8Array.from(atob(item.data),c=>c.charCodeAt(0));
            return new Response(bytes,{headers});
        }catch{
            return json({error:'تعذر إكمال العملية الآن. أعد المحاولة لاحقًا.'},500)
        }
    }
};