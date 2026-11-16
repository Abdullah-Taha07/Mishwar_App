export function checkedRouteSnapshot(route,{distinct=true}={}){
 if(!route||!Number.isFinite(route.distanceMeters)||!Number.isFinite(route.durationSeconds)||route.distanceMeters<0||route.durationSeconds<0||route.distanceMeters>10000000||route.durationSeconds>604800)throw Error('بيانات الطريق غير موثوقة. أعد حساب المسار.');
 if(distinct&&(!route.distanceMeters||!route.durationSeconds))throw Error('لا يوجد مسار قيادة موثوق بين الموقعين.');
 const geometry=route.geometry;
 if(geometry!==undefined&&geometry!==null&&(geometry.type!=='LineString'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||geometry.coordinates.length>20000||geometry.coordinates.some(point=>!Array.isArray(point)||point.length<2||!Number.isFinite(point[0])||!Number.isFinite(point[1])||Math.abs(point[0])>180||Math.abs(point[1])>90)))throw Error('إحداثيات الطريق غير صحيحة. أعد حساب المسار.');
 return route;
}
export function assertPriceableRoute(env,route){
 checkedRouteSnapshot(route);
 if(route.stale)throw Error('المسار المحفوظ قديم. أعد المحاولة للحصول على سعر موثوق.');
 if(!['OSRM','TomTom'].includes(route.provider))throw Error('مصدر المسار غير موثوق. أعد حساب السعر.');
 if((route.demoProvider||route.provider==='OSRM'&&!env.OSRM_BASE_URL)&&env.ALLOW_PUBLIC_ROUTE_QUOTES!=='true')throw Error('الحجز ينتظر إعداد مزود توجيه معتمد. لا يوجد سعر قابل للتأكيد حاليًا.');
 return route;
}
export async function boundedRoadJson(url,options={},timeoutMs=8000){
 const controller=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('انتهت مهلة خدمة الطريق. أعد المحاولة.');error.name='TimeoutError';reject(error);controller.abort()},timeoutMs)});
 const work=(async()=>{
  const response=await fetch(url,{...options,redirect:'error',signal:controller.signal});
  if(!response.ok)throw Error('تعذر جلب مسار قيادة موثوق. أعد المحاولة.');
  return response.json();
 })();
 try{return await Promise.race([work,deadline])}catch(error){if(error.name==='TimeoutError'||/[\u0600-\u06ff]/.test(error.message))throw error;throw Error('تعذر الاتصال بخدمة الطريق. أعد المحاولة.')}finally{clearTimeout(timer)}
}
