// Every production entrypoint is admitted through a durable lease. All D1
// statement methods are fenced, so SQL classification/RETURNING cannot bypass
// the same-transaction epoch check. Control operations are not HTTP routes.
const now=()=>new Date().toISOString();
const stopped=()=>Object.assign(new Error('الخدمة متوقفة مؤقتًا للصيانة. أعد المحاولة لاحقًا.'),{code:'MAINTENANCE_UNAVAILABLE',status:503});
const controls=/\bmaintenance_(?:state|leases|effects|write_fences|transitions)\b/i;
const statementState=new WeakMap();
export const maintenanceReply=()=>new Response(JSON.stringify({error:'الخدمة متوقفة مؤقتًا للصيانة. أعد المحاولة لاحقًا.',code:'MAINTENANCE_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'60'}});

/** A read-only, non-identifying status query; no metrics/audit is added. */
export async function maintenanceSnapshot(db){
  if(!db)throw stopped();
  try{
    const row=await db.prepare(`SELECT mode,epoch,
      (SELECT COUNT(*) FROM maintenance_leases) AS active,
      (SELECT COUNT(*) FROM maintenance_effects WHERE state IN ('pending','unknown')) AS uncertain
      FROM maintenance_state WHERE id=1`).first();
    if(!row||!['open','draining','frozen','validating'].includes(row.mode)||!Number.isSafeInteger(row.epoch)||row.epoch<1)throw stopped();
    return row;
  }catch{throw stopped()}
}

/** Local/operator integration only. Never mount this function in an API. */
export async function transitionMaintenance(db,{expectedMode,expectedEpoch,targetMode}){
  if(!['open','draining','frozen','validating'].includes(targetMode)||!Number.isSafeInteger(expectedEpoch))throw stopped();
  const increment=targetMode==='frozen'&&expectedMode==='draining'||targetMode==='open'&&['frozen','validating'].includes(expectedMode);
  // D1 meta.changes can include the AFTER UPDATE audit trigger. The returned
  // row proves the conditional state update itself, without relying on totals.
  const nextEpoch=expectedEpoch+(increment?1:0);
  const result=await db.prepare('UPDATE maintenance_state SET mode=?,epoch=?,updated_at=? WHERE id=1 AND mode=? AND epoch=? RETURNING mode,epoch')
    .bind(targetMode,nextEpoch,now(),expectedMode,expectedEpoch).first();
  if(!result||result.mode!==targetMode||result.epoch!==nextEpoch)throw stopped();
  return maintenanceSnapshot(db);
}

export async function acquireMaintenanceScope(env,ctx,kind='request'){
  const raw=env.DB;if(!raw||!['request','scheduled'].includes(kind))throw stopped();
  const id=crypto.randomUUID();
  let admitted;
  try{
    admitted=await raw.prepare(`INSERT INTO maintenance_leases(id,epoch,kind,started_at)
      SELECT ?,epoch,?,? FROM maintenance_state WHERE id=1 AND mode='open'`).bind(id,kind,now()).run();
  }catch{throw stopped()}
  if(admitted.meta?.changes!==1)throw stopped();
  let lease;
  try{lease=await raw.prepare('SELECT epoch FROM maintenance_leases WHERE id=?').bind(id).first();if(!lease)throw stopped()}
  catch{throw stopped()} // Retain an uncertain admitted lease: never silently reap it.
  const epoch=lease.epoch,pending=new Set();let released=false,sealed=false,finishTask,blocked=false;
  const alive=()=>{if(released||sealed){blocked=true;throw stopped()}};
  const track=promise=>{
    try{alive()}catch(error){Promise.resolve(promise).catch(()=>{});throw error}
    const task=Promise.resolve(promise);pending.add(task);
    task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
  };
  async function batch(items){
    alive();
    const originals=items.map(item=>{const info=statementState.get(item);if(!info||info.owner!==id)throw stopped();return info.raw});
    if(!originals.length)return [];
    const marker=crypto.randomUUID();
    try{
      const results=await raw.batch([
        raw.prepare('INSERT INTO maintenance_write_fences(id,lease_id,epoch) VALUES(?,?,?)').bind(marker,id,epoch),
        ...originals,raw.prepare('DELETE FROM maintenance_write_fences WHERE id=?').bind(marker)
      ]);
      return results.slice(1,-1);
    }catch(error){
      if(/MAINTENANCE_|no such table: maintenance_/i.test(String(error?.message))){blocked=true;throw stopped()}
      throw error;
    }
  }
  function wrapStatement(sql,rawStatement){
    if(typeof sql!=='string'||controls.test(sql))throw stopped();
    const statement={
      bind(...args){return wrapStatement(sql,rawStatement.bind(...args))},
      run(){alive();return track(batch([statement]).then(results=>results[0]))},
      all(){alive();return track(batch([statement]).then(results=>results[0]))},
      first(column){alive();return track(batch([statement]).then(results=>{const row=results[0]?.results?.[0]??null;return column===undefined?row:row?.[column]??null}))},
      raw(options){alive();return track(batch([statement]).then(results=>{const rows=results[0]?.results||[],keys=Object.keys(rows[0]||{});const data=rows.map(row=>keys.map(key=>row[key]));return options?.columnNames?[keys,...data]:data}))}
    };
    statementState.set(statement,{raw:rawStatement,owner:id});return statement;
  }
  const guardedDB={
    prepare(sql){alive();return wrapStatement(sql,raw.prepare(sql))},
    batch(items){alive();return track(batch(items))},
    exec(){throw stopped()},dump(){throw stopped()},withSession(){throw stopped()}
  };
  async function assertCurrent(){
    alive();
    try{
      const row=await raw.prepare(`SELECT 1 AS allowed FROM maintenance_state s JOIN maintenance_leases l ON l.epoch=s.epoch
        WHERE s.id=1 AND s.mode IN ('open','draining') AND l.id=? AND l.epoch=?`).bind(id,epoch).first();
      if(!row)throw stopped();
    }catch{blocked=true;throw stopped()}
  }
  async function effect(effectKind,operation,{uncertainOnFailure=true}={}){
    alive();
    if(!/^(?:r2\.(?:put|delete)|provider\.(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS))$/.test(effectKind))throw stopped();
    const effectId=crypto.randomUUID();
    await assertCurrent();
    const marker=crypto.randomUUID();
    try{
      await raw.batch([
        raw.prepare('INSERT INTO maintenance_write_fences(id,lease_id,epoch) VALUES(?,?,?)').bind(marker,id,epoch),
        raw.prepare('INSERT INTO maintenance_effects(id,lease_id,epoch,kind,state,started_at) VALUES(?,?,?,?,?,?)').bind(effectId,id,epoch,effectKind,'pending',now()),
        raw.prepare('DELETE FROM maintenance_write_fences WHERE id=?').bind(marker)
      ]);
    }catch{blocked=true;throw stopped()}
    try{
      const result=await operation();
      await raw.prepare("UPDATE maintenance_effects SET state='settled',completed_at=? WHERE id=? AND state='pending'").bind(now(),effectId).run();
      return result;
    }catch(error){
      // Unknown external outcomes survive lease release and prevent freezing.
      // No URL, object key, identity, token, request body or provider body is stored.
      try{await raw.prepare("UPDATE maintenance_effects SET state=?,completed_at=? WHERE id=? AND state='pending'").bind(uncertainOnFailure?'unknown':'settled',now(),effectId).run()}catch{}
      throw error;
    }
  }
  const wrappedCtx={
    waitUntil(promise){const task=track(promise);ctx?.waitUntil?.(task)},
    passThroughOnException(){ctx?.passThroughOnException?.()}
  };
  const bucket=env.BUCKET?new Proxy(env.BUCKET,{get(target,key){
    if(['put','delete','createMultipartUpload','resumeMultipartUpload'].includes(key)){
      if(!['put','delete'].includes(key))return ()=>{throw stopped()};
      return (...args)=>{alive();return track(effect('r2.'+key,()=>Reflect.apply(target[key],target,args)))};
    }
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }}):undefined;
  const scope={
    id,epoch,track,assertCurrent,
    effect(kind,operation,options){alive();return track(effect(kind,operation,options))},
    get blocked(){return blocked},
    finish(){
      if(finishTask)return finishTask;
      finishTask=(async()=>{
        while(pending.size)await Promise.allSettled([...pending]);
        // Seal synchronously before awaiting deletion: late registrations may
        // not start an external effect during the lease release round-trip.
        sealed=true;
        // A failed release deliberately leaves a durable blocker for inspection.
        await raw.prepare('DELETE FROM maintenance_leases WHERE id=? AND epoch=?').bind(id,epoch).run();released=true;
      })();
      return finishTask;
    }
  };
  scope.env={...env,DB:guardedDB,...(bucket?{BUCKET:bucket}:{}),__maintenance:scope,__ctx:wrappedCtx};
  scope.ctx=wrappedCtx;return scope;
}

/** Provider I/O is buffered before acknowledging completion; a timeout leaves
 * a durable unknown outcome for mutating requests. Direct unit handlers may
 * omit a scope, but production entrypoints always supply it. */
async function strictProviderFetch(input,options){
  // Cloudflare rejects redirect:'error'. Preserve its deny-redirect semantics
  // using manual mode, and never follow a provider Location header.
  const denyRedirect=options.redirect==='error';
  const response=await fetch(input,denyRedirect?{...options,redirect:'manual'}:options);
  if(denyRedirect&&(response.redirected||response.type==='opaqueredirect'||(response.status>=300&&response.status<400))){
    try{await response.body?.cancel?.()}catch{}
    throw Object.assign(new Error('External provider redirect rejected'),{code:'EXTERNAL_PROVIDER_REDIRECT'});
  }
  return response;
}

export async function maintenanceFetch(env,input,options={}){
  const scope=env.__maintenance;if(!scope)return strictProviderFetch(input,options);
  const method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  return scope.effect('provider.'+method,async()=>{
    const response=await strictProviderFetch(input,options),reader=response.body?.getReader(),chunks=[];let size=0;
    if(reader)for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>4*1024*1024){await reader.cancel();throw stopped()}chunks.push(item.value)}
    const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength}
    if(!['GET','HEAD','OPTIONS'].includes(method)&&(response.status>=500||response.status===408))throw Object.assign(new Error('تعذر تأكيد نتيجة الطلب لدى المزود. راجع الحالة قبل إعادة المحاولة.'),{code:'EXTERNAL_OUTCOME_UNKNOWN'});
    return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,statusText:response.statusText,headers:response.headers});
  },{uncertainOnFailure:!['GET','HEAD','OPTIONS'].includes(method)});
}
