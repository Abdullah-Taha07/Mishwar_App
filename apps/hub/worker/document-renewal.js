import{fileError,validDate,DOCUMENTS}from'../public/validation.js';import{logEvent}from'./operations.js';
const drFields={identity:'identityExpiry',license:'licenseExpiry',registration:'registrationExpiry',insurance:'insuranceExpiry'},drJson=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function renewDocument(request,env){const actor=request.headers.get('oai-authenticated-user-id');if(!actor)return drJson({error:'سجل الدخول'},401);const app=await env.DB.prepare("SELECT id FROM captain_applications WHERE user_id=? AND status='active'").bind(actor).first();if(!app)return drJson({error:'الحساب غير مفعّل'},403);if(request.method==='GET')return drJson({items:(await env.DB.prepare('SELECT id,kind,expires_at,status,reason,created_at,reviewed_at,reviewed_by FROM document_renewals WHERE captain_id=? ORDER BY created_at DESC LIMIT 50').bind(app.id).all()).results});if(request.method!=='POST'||!([new URL(request.url).origin,'https://mishwar-captain.vercel.app'].includes(request.headers.get('origin'))))return drJson({error:'غير مسموح'},403);try{if(Number(request.headers.get('content-length')||0)>6*1024*1024)throw Error('الملف أكبر من الحد المسموح');const reader=request.body.getReader();let size=0;const pieces=[];for(;;){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>6*1024*1024){await reader.cancel();throw Error('الملف كبير')}pieces.push(value)}const form=await new Response(new Blob(pieces),{headers:{'Content-Type':request.headers.get('content-type')}}).formData(),kind=form.get('kind'),expiry=String(form.get('expiresAt')),file=form.get('file');if(!drFields[kind]||!validDate(expiry)||expiry<new Date().toISOString().slice(0,10))throw Error('حدد نوع المستند وتاريخ انتهاء صحيحًا');const err=fileError(file);if(err)throw Error(err);const bytes=new Uint8Array(await file.arrayBuffer()),head=new TextDecoder().decode(bytes.slice(0,12)),sig=file.type==='application/pdf'?head.startsWith('%PDF-'):file.type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:head.startsWith('RIFF')&&head.slice(8)==='WEBP';if(!sig)throw Error('نوع الملف لا يطابق محتواه');const id=crypto.randomUUID(),key='renewals/'+app.id+'/'+id;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});try{await env.DB.prepare('INSERT INTO document_renewals(id,captain_id,kind,expires_at,object_key,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,app.id,kind,expiry,key,file.type,file.size,new Date().toISOString()).run()}catch{await env.BUCKET.delete(key);throw Error('يوجد طلب تحديث معلق لهذا المستند')}await logEvent(env,'captain','document_renewal_requested',actor,id,{kind});return drJson({ok:true,id},201)}catch(e){return drJson({error:e.message},400)}}

export function captainDocuments(row, renewals=[], today=new Date().toISOString().slice(0,10)) {
 const vehicle=JSON.parse(row.vehicle_json), files=JSON.parse(row.documents_json);
 const limit=new Date(Date.parse(today)+30*86400000).toISOString().slice(0,10);
 const documents=DOCUMENTS.map(([kind,title])=>{
  const field=drFields[kind];
  const date=vehicle[field]||null,present=!!files[kind]?.key;
  const state=!present||field&&!validDate(date||'')?'missing':!field?'present':date<today?'expired':date<=limit?'expiring':'valid';
  return {kind,title,date,present,state,pending:renewals.some(r=>r.kind===kind&&r.status==='pending')};
 });
 const states=[...new Set(documents.flatMap(d=>d.pending?[d.state,'pending']:[d.state]).filter(s=>s!=='present'))];
 const priority=['pending','expired','missing','expiring','valid'].findIndex(s=>states.includes(s));
 return {id:row.id,name:row.name,phone:row.phone,status:row.status,reference:'KM-'+row.id.slice(0,8).toUpperCase(),documents,states,priority,renewals};
}

export async function documentManagement(request,env) {
 if(request.method!=='GET')return drJson({error:'غير مسموح'},405);
 const url=new URL(request.url),q=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,100),state=url.searchParams.get('state')||'all';
 if(!['all','pending','expired','missing','expiring','valid'].includes(state))return drJson({error:'حالة غير صحيحة'},400);
 // Read all pages so healthy captains and older renewal requests are never silently omitted.
 async function allPages(sql){const rows=[];for(let offset=0;;offset+=500){const page=(await env.DB.prepare(sql+' LIMIT 500 OFFSET ?').bind(offset).all()).results;rows.push(...page);if(page.length<500)return rows}}
 const rows=await allPages("SELECT id,phone,status,vehicle_json,documents_json,json_extract(personal_json,'$.name') AS name FROM captain_applications ORDER BY id");
 const renewals=await allPages('SELECT id,captain_id,kind,expires_at,status,reason,created_at,reviewed_at,reviewed_by FROM document_renewals ORDER BY created_at DESC,id');
 const history=await allPages('SELECT renewal_id,captain_id,kind,decision,reason,reviewer_id,reviewed_at,previous_expiry,replacement_expiry FROM document_review_history ORDER BY reviewed_at DESC,id');
 const grouped=new Map();for(const r of renewals){if(!grouped.has(r.captain_id))grouped.set(r.captain_id,[]);grouped.get(r.captain_id).push(r)}
 const histories=new Map();for(const h of history){if(!histories.has(h.captain_id))histories.set(h.captain_id,[]);histories.get(h.captain_id).push(h)}
 const items=rows.map(r=>({...captainDocuments(r,grouped.get(r.id)||[]),history:histories.get(r.id)||[]}));
 const counters={total:items.length};for(const s of ['pending','expired','missing','expiring','valid'])counters[s]=items.filter(x=>x.states.includes(s)).length;
 const filtered=items.filter(x=>(state==='all'||x.states.includes(state))&&(!q||[x.name,x.phone,x.id,x.reference].some(v=>String(v||'').toLowerCase().includes(q))));
 filtered.sort((a,b)=>a.priority-b.priority||String(a.name||'').localeCompare(String(b.name||''))||a.id.localeCompare(b.id));
 return drJson({items:filtered,counters,total:filtered.length,asOf:new Date().toISOString(),counterUnit:'captains'});
}

export async function renewalAdmin(request,env){
 if(request.method==='GET'){
  const id=new URL(request.url).searchParams.get('file');
  if(!id){
   const url=new URL(request.url),captain=url.searchParams.get('captain'),kind=url.searchParams.get('kind');
   if(!captain&&!kind)return documentManagement(request,env);
   if(!DOCUMENTS.some(([key])=>key===kind))return drJson({error:'??? ?????'},404);
   const app=await env.DB.prepare('SELECT documents_json FROM captain_applications WHERE id=?').bind(captain).first();
   const doc=app&&JSON.parse(app.documents_json)[kind];if(!doc?.key)return drJson({error:'??? ?????'},404);
   const ext=({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[doc.type];
   if(!ext)return drJson({error:'??? ??? ?????'},400);
   const file=await env.BUCKET.get(doc.key);if(!file)return drJson({error:'????? ??? ?????'},404);
   return new Response(file.body,{headers:{'Content-Type':doc.type,'Content-Disposition':'inline; filename="'+kind+'.'+ext+'"','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  }
  const r=await env.DB.prepare('SELECT * FROM document_renewals WHERE id=?').bind(id).first();
  if(!r)return drJson({error:'غير موجود'},404);
  const f=await env.BUCKET.get(r.object_key);if(!f)return drJson({error:'الملف غير موجود'},404);
  const ext=({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[r.mime_type];
  if(!ext)return drJson({error:'نوع غير مدعوم'},400);
  return new Response(f.body,{headers:{'Content-Type':r.mime_type,'Content-Disposition':'inline; filename="renewal.'+ext+'"','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 }
 if(request.method!=='POST')return drJson({error:'غير مسموح'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin)return drJson({error:'غير مسموح'},403);
 const actor=request.headers.get('oai-authenticated-user-id');if(!actor)return drJson({error:'سجل الدخول'},401);
 try{
  const raw=await request.text();if(raw.length>4000)return drJson({error:'طلب كبير'},413);
  const b=JSON.parse(raw),reason=String(b.reason||'').trim().slice(0,500);
  if(!['approved','rejected'].includes(b.decision)||b.decision==='approved'&&b.confirmReviewed!==true||b.decision==='rejected'&&reason.length<3)return drJson({error:'راجع الملف قبل الاعتماد واكتب سبب الرفض'},400);
  const r=await env.DB.prepare("SELECT * FROM document_renewals WHERE id=? AND status='pending'").bind(String(b.id)).first();
  if(!r)return drJson({error:'تمت مراجعة الطلب أو لم يعد موجودًا'},409);
  if(!drFields[r.kind])return drJson({error:'نوع غير صحيح'},400);
  if(b.decision==='approved'&&(!validDate(r.expires_at)||r.expires_at<new Date().toISOString().slice(0,10)))return drJson({error:'المستند الجديد منتهي الصلاحية'},400);
  const at=new Date().toISOString(),claim=crypto.randomUUID(),field='$.'+drFields[r.kind],doc='$.'+r.kind,replacement=JSON.stringify({key:r.object_key,type:r.mime_type,size:r.size_bytes});
  // The unique renewal history row is the transactional claim. A losing review rolls back.
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO document_review_history SELECT ?,r.id,r.captain_id,r.kind,?,?,?, ?,json_extract(a.documents_json,?),json_extract(a.vehicle_json,?),?,r.expires_at FROM document_renewals r JOIN captain_applications a ON a.id=r.captain_id WHERE r.id=? AND r.status='pending'`).bind(claim,b.decision,reason,actor,at,doc,field,replacement,r.id),
   env.DB.prepare("UPDATE document_renewals SET status=?,reason=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM document_review_history WHERE id=?)").bind(b.decision,reason,actor,at,r.id,claim),
   env.DB.prepare("INSERT INTO operation_events(id,source,action,actor_id,entity_id,details_json,created_at) SELECT ?,'admin',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_review_history WHERE id=?)").bind(crypto.randomUUID(),'document_renewal_'+b.decision,actor,r.id,JSON.stringify({captainId:r.captain_id,kind:r.kind,reason}),at,claim),
   ...(b.decision==='approved'?[env.DB.prepare('UPDATE captain_applications SET vehicle_json=json_set(vehicle_json,?,?),documents_json=json_set(documents_json,?,json(?)) WHERE id=? AND EXISTS(SELECT 1 FROM document_review_history WHERE id=?)').bind(field,r.expires_at,doc,replacement,r.captain_id,claim)]:[])
  ]);
  const saved=await env.DB.prepare('SELECT id FROM document_review_history WHERE id=?').bind(claim).first();
  if(!saved)return drJson({error:'تمت مراجعة الطلب بواسطة موظف آخر'},409);
  return drJson({ok:true});
 }catch(e){if(String(e.message).includes('UNIQUE'))return drJson({error:'تمت مراجعة الطلب بواسطة موظف آخر'},409);return drJson({error:'تعذر حفظ قرار المراجعة'},400)}
}
