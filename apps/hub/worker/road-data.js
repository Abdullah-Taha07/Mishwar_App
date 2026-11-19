import {maintenanceFetch} from './maintenance.js';
export function checkedRouteSnapshot(route,{distinct=true}={}){
 if(!route||!Number.isFinite(route.distanceMeters)||!Number.isFinite(route.durationSeconds)||route.distanceMeters<0||route.durationSeconds<0||route.distanceMeters>10000000||route.durationSeconds>604800)throw Error('بيانات الطريق غير موثوقة. أعد حساب المسار.');
 if(distinct&&(!route.distanceMeters||!route.durationSeconds))throw Error('لا يوجد مسار قيادة موثوق بين الموقعين.');
 if(route.trafficDelaySeconds!==undefined&&(!Number.isFinite(route.trafficDelaySeconds)||route.trafficDelaySeconds<0||route.trafficDelaySeconds>604800))throw Error('بيانات زمن الازدحام غير صحيحة. أعد حساب المسار.');
 const geometry=route.geometry;
 if(geometry!==undefined&&geometry!==null&&(geometry.type!=='LineString'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||geometry.coordinates.length>20000||geometry.coordinates.some(point=>!Array.isArray(point)||point.length<2||!Number.isFinite(point[0])||!Number.isFinite(point[1])||Math.abs(point[0])>180||Math.abs(point[1])>90)))throw Error('إحداثيات الطريق غير صحيحة. أعد حساب المسار.');
 return route;
}
export function assertPriceableRoute(env,route){
 checkedRouteSnapshot(route);
 if(route.stale)throw Error('المسار المحفوظ قديم. أعد المحاولة للحصول على سعر موثوق.');
 if(!['OSRM','TomTom'].includes(route.provider))throw Error('مصدر المسار غير موثوق. أعد حساب السعر.');
 if(env.REQUIRE_COMMERCIAL_ROUTES==='true'&&route.provider!=='TomTom')throw Error('الحجز ينتظر مسارًا تجاريًا موثوقًا. أعد حساب السعر.');
 if((route.demoProvider||route.provider==='OSRM'&&!env.OSRM_BASE_URL)&&env.ALLOW_PUBLIC_ROUTE_QUOTES!=='true')throw Error('الحجز ينتظر إعداد مزود توجيه معتمد. لا يوجد سعر قابل للتأكيد حاليًا.');
 return route;
}
export async function boundedRoadJson(url,options={},timeoutMs=8000,env={}){
 const controller=new AbortController();let timer;
 const safeError=Symbol('localRoadError');
 const localError=(message,name='Error')=>Object.assign(Error(message),{name,[safeError]:true});
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(localError('انتهت مهلة خدمة الطريق. أعد المحاولة.','TimeoutError'));controller.abort()},timeoutMs)});
 const work=(async()=>{
  const response=await maintenanceFetch(env,url,{...options,redirect:'manual',signal:controller.signal});
  if(!response.ok)throw localError('تعذر جلب مسار قيادة موثوق. أعد المحاولة.');
  return response.json();
 })();
 try{return await Promise.race([work,deadline])}catch(error){if(error?.[safeError])throw error;if(error?.name==='TimeoutError')throw localError('انتهت مهلة خدمة الطريق. أعد المحاولة.','TimeoutError');throw Error('تعذر الاتصال بخدمة الطريق. أعد المحاولة.')}finally{clearTimeout(timer)}
}
