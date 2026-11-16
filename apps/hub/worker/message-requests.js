// Idempotency keys identify an attempt, never an account or a permission.
export function clientRequestId(body){
 const value=body?.clientRequestId;
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||! /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value))throw Error('معرّف محاولة الإرسال غير صالح');
 return value.toLowerCase();
}
export function requestConflict(){const error=Error('تغيّرت بيانات محاولة الإرسال. أعد فتح النموذج وأرسل المحاولة الجديدة.');error.status=409;return error}
const tables={case:['case_messages','case_id'],trip:['trip_messages','trip_id']};
export async function writeMessageOnce(env,kind,{contextId,role,senderId,text,at,requestId}){
 const [table,column]=tables[kind]||[];if(!table)throw Error('نوع رسالة غير صالح');
 const existing=async()=>requestId?env.DB.prepare(`SELECT body FROM ${table} WHERE ${column}=? AND role=? AND sender_id=? AND client_request_id=?`).bind(contextId,role,senderId,requestId).first():null;
 const previous=await existing();
 if(previous){if(previous.body!==text)throw requestConflict();return false}
 let guard,args;
 if(kind==='case'){
  guard=role==='admin'?'SELECT 1 FROM service_cases WHERE id=?':"SELECT 1 FROM service_cases WHERE id=? AND role=? AND owner_id=? AND status<>'closed'";
  args=role==='admin'?[contextId]:[contextId,role,senderId];
 }else{
  guard="SELECT 1 FROM trips WHERE id=? AND status IN ('arriving','arrived','riding') AND driver_id IS NOT NULL AND CASE WHEN ?='rider' THEN rider_id ELSE driver_id END=?";
  args=[contextId,role,senderId];
 }
 const result=await env.DB.prepare(`INSERT INTO ${table}(${column},role,sender_id,body,created_at,client_request_id) SELECT ?,?,?,?,?,? WHERE EXISTS(${guard}) ON CONFLICT(${column},role,sender_id,client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING`).bind(contextId,role,senderId,text,at,requestId,...args).run();
 if(result.meta?.changes)return true;
 const replay=await existing();
 if(replay){if(replay.body!==text)throw requestConflict();return false}
 throw Error(kind==='case'?'أغلق هذا الطلب. افتح طلبًا جديدًا عند الحاجة':'المحادثة غير متاحة بعد انتهاء الرحلة');
}
