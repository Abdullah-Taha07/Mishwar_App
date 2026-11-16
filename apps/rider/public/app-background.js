(()=>{
  const role='rider',timeoutMs=15000,context=window.MishwarAccountContext;
  const header=document.querySelector('.header-actions')||document.querySelector('header.topbar')||document.querySelector('.driver-shell header');
  if(!header)return;
  const button=document.createElement('button');
  button.id='background-notifications-button';button.type='button';button.className='background-notifications-button';
  button.textContent='تفعيل الإشعارات';button.title='تفعيل إشعارات الخلفية';button.setAttribute('aria-label','تفعيل إشعارات الخلفية');button.setAttribute('aria-pressed','false');
  button.style.cssText='font:inherit;font-size:11px;border:1px solid #cce5ec;border-radius:12px;background:#f0fafc;color:#26788b;padding:8px 10px;cursor:pointer;max-width:112px;min-height:38px;flex-shrink:0;line-height:1.3';
  if(role==='rider')button.style.marginInlineEnd='44px';
  // Captain account already exposes its notification settings entry on small screens.
  if(role==='rider')header.insertBefore(button,header.querySelector('#notifications-button'));
  else if(!document.querySelector('.driver-shell'))header.append(button);
  let configured=false,epoch=0,active=null;
  function label(){
    button.textContent=configured?'الإشعارات مفعّلة':'تفعيل الإشعارات';
    button.title=configured?'إعدادات إشعارات الخلفية':'تفعيل إشعارات الخلفية';
    button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(configured));
  }
  function explain(message){
    const dialog=document.createElement('dialog');dialog.className='background-notifications-dialog';
    dialog.style.cssText='font:inherit;max-width:420px;width:calc(100% - 36px);border:0;border-radius:18px;padding:24px;color:#083344;line-height:1.9';
    const title=document.createElement('h2');title.textContent='إشعارات الخلفية';title.style.fontSize='22px';
    const text=document.createElement('p');text.textContent=message;text.style.fontSize='13px';text.setAttribute('role','status');
    const close=document.createElement('button');close.textContent='تمام';close.style.cssText='border:0;border-radius:10px;padding:11px 20px;background:#06b6d4;font:inherit';
    close.onclick=()=>{dialog.close();dialog.remove()};dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.append(title,text,close);document.body.append(dialog);dialog.showModal();
  }
  const supported=()=>('serviceWorker'in navigator)&&('PushManager'in window)&&('Notification'in window);
  function activationError(message,name='ActivationError'){const error=Error(message);error.name=name;error.userMessage=message;return error}
  const cancelled=()=>{const error=Error('Notification activation cancelled');error.name='AbortError';return error};
  function current(op){return active===op&&!op.cancelled&&op.epoch===epoch&&(!op.ticket||context.isCurrent(op.ticket))}
  function guard(op){if(!current(op))throw cancelled()}
  function step(op,work){
    guard(op);
    return Promise.race([Promise.resolve().then(()=>{guard(op);return work()}),op.deadline]).then(value=>{guard(op);return value});
  }
  function reset(){
    epoch++;configured=false;active?.cancel();active=null;button.disabled=false;button.removeAttribute('aria-busy');label();
  }
  function operation(showMessage,create){
    let rejectDeadline;
    const op={epoch,ticket:role==='rider'&&context?context.capture():null,controller:new AbortController(),cancelled:false,showMessage,create};
    op.deadline=new Promise((_,reject)=>{
      rejectDeadline=reject;
      op.timer=setTimeout(()=>{if(op.cancelled)return;op.cancelled=true;const error=activationError('انتهت مهلة تفعيل الإشعارات. تحقق من الاتصال وحدّث الصفحة ثم أعد المحاولة.','TimeoutError');reject(error);op.controller.abort()},timeoutMs);
    });
    op.cancel=()=>{if(op.cancelled)return;op.cancelled=true;rejectDeadline(cancelled());op.controller.abort()};
    return op;
  }
  async function request(op,path,options={}){
    const response=await step(op,()=>fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:op.controller.signal}));
    if(!response.ok)throw activationError(response.status===401||response.status===403?'سجّل الدخول وفعّل حسابك أولًا لتفعيل الإشعارات.':'تعذر ربط الجهاز بخدمة الإشعارات. أعد المحاولة.');
    return step(op,()=>response.json());
  }
  function decode(value){
    const text=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(text,char=>char.charCodeAt(0));
  }
  function availableRider(){
    return role!=='rider'||!context||(context.snapshot().status==='ready'&&context.snapshot().verified);
  }
  function run(showMessage,create){
    if(!supported()){
      if(showMessage)explain('المتصفح لا يدعم إشعارات الويب هنا. جرّب التطبيق المثبّت على الشاشة الرئيسية. على iPhone يلزم تثبيت التطبيق والسماح بالإشعارات. استمرار الموقع والاتصال في الخلفية غير مضمون.');
      return Promise.resolve(false);
    }
    if(!availableRider()){
      if(showMessage)explain('سجّل الدخول وفعّل حسابك أولًا لتفعيل الإشعارات.');
      return Promise.resolve(false);
    }
    if(configured&&Notification.permission!=='granted'){configured=false;label()}
    if(configured){
      if(showMessage)explain('الجهاز مسجل لاستقبال إشعارات الرحلة والطلبات. التسليم يعتمد على اتصال الجهاز وأذونات النظام وتوفير الطاقة؛ لا يعني ذلك تتبع الموقع باستمرار.');
      return Promise.resolve(true);
    }
    if(active){
      if(create&&!active.create){active.cancel();active=null}
      else{active.showMessage=active.showMessage||showMessage;return active.promise}
    }
    const op=operation(showMessage,create);active=op;
    if(create){button.disabled=true;button.setAttribute('aria-busy','true')}
    op.promise=(async()=>{
      try{
        if(role==='captain'){
          const session=await request(op,'/api/auth/session');
          if(!session.authenticated||!session.phoneVerified||session.application?.status!=='active')throw activationError('سجّل الدخول إلى حساب كابتن مفعّل أولًا لتفعيل الإشعارات.');
        }
        if(!create&&Notification.permission!=='granted')return false;
        const data=await request(op,'/api/background?action=config');
        if(!data.configured||!data.publicKey)throw activationError('خدمة الإشعارات غير جاهزة حاليًا.');
        let permission=Notification.permission;
        if(permission!=='granted'&&create&&op.showMessage)permission=await step(op,()=>Notification.requestPermission());
        if(permission!=='granted')throw activationError('لم يُسمح بالإشعارات. يمكنك تفعيلها من إعدادات الموقع في المتصفح.');
        const reg=create?await step(op,()=>navigator.serviceWorker.ready):await step(op,()=>navigator.serviceWorker.getRegistration());
        if(!reg){if(create)throw activationError('تعذر تجهيز خدمة الإشعارات. حدّث الصفحة ثم أعد المحاولة.');return false}
        let subscription=await step(op,()=>reg.pushManager.getSubscription());
        if(!subscription&&create)subscription=await step(op,()=>reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(data.publicKey)}));
        if(!subscription)return false;
        guard(op);
        await request(op,'/api/background',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'register',subscription:subscription.toJSON()})});
        guard(op);configured=true;label();
        if(op.showMessage)explain('تم تسجيل هذا الجهاز لإشعارات الرحلة والطلبات. حالة الرحلة محفوظة على الخادم وتُستعاد عند العودة للتطبيق.');
        return true;
      }catch(error){
        if(error.name!=='AbortError'&&op.epoch===epoch&&(!op.ticket||context.isCurrent(op.ticket))&&op.showMessage)explain(error.userMessage||'تعذر تفعيل الإشعارات. تحقق من الاتصال وإعدادات المتصفح ثم أعد المحاولة.');
        return false;
      }finally{
        clearTimeout(op.timer);
        if(active===op){active=null;button.disabled=false;button.removeAttribute('aria-busy')}
      }
    })();
    return op.promise;
  }
  function syncExisting(){if(!supported()||Notification.permission!=='granted')return Promise.resolve(false);return run(false,false)}
  function enable(showMessage=true){if(!showMessage)return syncExisting();return run(true,true)}
  button.onclick=()=>enable();
  if(role==='rider')window.enableMishwarBackground=enable;else window.enableMishwarPush=enable;
  document.addEventListener('click',event=>{
    if(event.target.closest?.('[data-notification-settings],[data-enable-background]'))void enable();
    if(event.target.closest?.('[data-captain-logout],#logout-account'))reset();
  });
  window.addEventListener('mishwar-account-reset',reset);
  window.addEventListener('mishwar-captain-auth-required',reset);
  window.addEventListener('mishwar-auth-changed',()=>{reset();void syncExisting()});
  window.addEventListener('mishwar-notifications-permitted',()=>{if(supported()&&Notification.permission==='granted')void run(false,true)});
  window.addEventListener('pagehide',reset);
  for(const event of ['pageshow','online'])window.addEventListener(event,()=>{window.refreshMishwarTrip?.();window.refresh?.();void syncExisting()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){window.refreshMishwarTrip?.();window.refresh?.()}});
  void syncExisting();
})();
