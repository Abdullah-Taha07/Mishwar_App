(()=>{
  const context=window.MishwarAccountContext;
  let view=null;
  const isOwnerReady=()=>{const state=context.snapshot();return state.status==='ready'&&state.authenticated&&state.verified};
  const nowLocale=()=>window.MishwarLang?.get?.()==='en'?'en-GB':'ar-SA';
  function show(){
    if(!isOwnerReady()){toast('سجّل الدخول وفعّل رقمك قبل تعديل بيانات الدخول.');window.showRiderLogin?.();return}
    sectionModal('إعدادات الحساب','<section class="account-form" data-rider-security-view></section>');
    const root=document.querySelector('[data-rider-security-view]'),modal=document.querySelector('#modal');
    const currentView={root,modal,ticket:context.capture(),busy:false};view=currentView;
    const current=()=>view===currentView&&modal.open&&root.isConnected&&context.isCurrent(currentView.ticket)&&isOwnerReady();
    const clearSecrets=()=>{for(const input of root.querySelectorAll('input[type=password]'))input.value=''};
    modal.addEventListener('close',()=>{clearSecrets();if(view===currentView)view=null},{once:true});
    const message=error=>{if(current())root.querySelector('[data-security-error]').textContent=error.message||'تعذر تعديل الحساب.'};
    async function call(action,body={}){
      if(!current())throw context.stale();
      const read=action==='change-status'?context.readController():null;
      let timer=null;
      try{
        const work=(async()=>{
          const response=await fetch('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body),...(read?{signal:read.controller.signal}:{})});
          if(!current()||read?.controller.signal.aborted)throw context.stale();
          let data;try{data=await response.json()}catch{throw Error('تعذر قراءة رد الخادم. أعد المحاولة.')}
          if(!current()||read?.controller.signal.aborted)throw context.stale();
          if(!response.ok)throw Error(data.error||'تعذر تعديل الحساب.');
          return data;
        })();
        const deadline=read?new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('انتهت مهلة تحديث حالة الطلب. أعد المحاولة.');error.name='TimeoutError';reject(error);read.controller.abort()},10000)}):null;
        return await (deadline?Promise.race([work,deadline]):work);
      }finally{if(timer!==null)clearTimeout(timer);read?.release()}
    }
    async function perform(button,action,body,next){
      if(!current()||currentView.busy)return;
      currentView.busy=true;button.disabled=true;
      try{const result=await call(action,body);if(current())await next(result)}catch(error){if(!context.ignored(error))message(error)}
      finally{currentView.busy=false;if(current()&&button.isConnected)button.disabled=false}
    }
    function form(){
      if(!current())return;
      root.innerHTML='<p class="feature-intro">أكد كلمة المرور الحالية، ثم ملكية جوالك. تغيير الجوال يتطلب توثيق الرقم الجديد أيضًا.</p><form id="rider-account-change"><label>التعديل<select name="kind"><option value="password">كلمة المرور</option><option value="phone">رقم الجوال</option></select></label><label>كلمة المرور الحالية<input name="oldPassword" type="password" required maxlength="128" autocomplete="current-password"></label><label><span data-new-value-label>كلمة المرور الجديدة</span><input name="value" type="password" required minlength="6" maxlength="128" autocomplete="new-password"></label><label data-confirm-label>تأكيد كلمة المرور<input name="confirm" type="password" required minlength="6" maxlength="128" autocomplete="new-password"></label><p data-security-error role="alert"></p><button class="primary" type="submit">بدء التحقق</button><button class="secondary" type="button" data-resume-account-change>متابعة طلب تعديل سابق</button></form>';
      const fields=root.querySelector('form');
      fields.elements.kind.onchange=()=>{
        const phone=fields.elements.kind.value==='phone',input=fields.elements.value,confirm=fields.elements.confirm;
        input.type=phone?'tel':'password';input.minLength=phone?1:6;input.maxLength=phone?20:128;input.autocomplete=phone?'tel':'new-password';input.value='';
        confirm.value='';confirm.required=!phone;confirm.disabled=phone;root.querySelector('[data-confirm-label]').hidden=phone;
        root.querySelector('[data-new-value-label]').textContent=phone?'رقم الجوال الجديد':'كلمة المرور الجديدة';
      };
      fields.onsubmit=event=>{
        event.preventDefault();if(currentView.busy||!current())return;
        const kind=fields.elements.kind.value;
        if(!['phone','password'].includes(kind)){message(Error('اختر التعديل المطلوب.'));return}
        if(kind==='password'&&fields.elements.value.value!==fields.elements.confirm.value){message(Error('كلمتا المرور غير متطابقتين'));return}
        const payload={kind,oldPassword:fields.elements.oldPassword.value,value:fields.elements.value.value};
        clearSecrets();void perform(fields.querySelector('[type=submit]'),'change-start',payload,stage);
      };
      root.querySelector('[data-resume-account-change]').onclick=event=>{void perform(event.currentTarget,'change-status',{},stage)};
    }
    function stage(value){
      if(!current())return;
      if(!['phone','password'].includes(value.kind)||!['old','new','approved'].includes(value.stage)||!Number.isFinite(Date.parse(value.expiresAt)))throw Error('حالة طلب التعديل غير صالحة. ابدأ طلبًا جديدًا.');
      const approved=value.stage==='approved',old=value.stage==='old';
      root.innerHTML=`<div class="settings-steps"><span>١ الجوال الحالي</span>${value.kind==='phone'?'<span>٢ الجوال الجديد</span>':''}<span>✓ حفظ التعديل</span></div>${approved?'<p class="feature-intro">اكتمل التحقق. احفظ التعديل لإغلاق جلسات الأجهزة الأخرى.</p><button class="primary" type="button" data-finish-account-change>حفظ التعديل</button>':`<p class="feature-intro">${old?'تحقق من جوالك الحالي أولًا.':'تحقق الآن من رقم الجوال الجديد.'}<br><span dir="ltr" data-no-translate>${esc(value.phone||'')}</span></p>${value.mode==='sms'?'<form id="rider-account-code"><label>الرمز المرسل إلى الجوال<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9٠-٩]{4,6}" maxlength="6" dir="ltr"></label><button class="primary" type="submit">تأكيد الرمز</button></form>':value.mode==='manual'?`<p class="feature-intro">التحقق بمراجعة فريق الدعم حاليًا. أرسل رقم الطلب ورمز المرحلة من رقم الجوال المطلوب عبر قناة الدعم المعتمدة. عرض الرمز هنا لا يثبت ملكية الجوال.</p><p data-no-translate>الطلب: ${esc(value.id||'')}</p><p class="verification-code" dir="ltr" data-no-translate>${esc(value.code||'')}</p><button class="primary" type="button" data-refresh-account-change>تحديث حالة التحقق</button>`:'<p class="feature-intro">طريقة التحقق غير متاحة. ألغ الطلب وحاول لاحقًا.</p>'}`}<p class="field-hint">صلاحية الطلب حتى <time data-no-translate>${esc(new Date(value.expiresAt).toLocaleTimeString(nowLocale(),{hour:'2-digit',minute:'2-digit'}))}</time>. لن تتغير البيانات قبل اكتمال التحقق والحفظ.</p><p data-security-error role="alert"></p><button class="secondary" type="button" data-cancel-account-change>إلغاء التعديل</button>`;
      const bind=(selector,action,next)=>{const button=root.querySelector(selector);if(button)button.onclick=()=>{void perform(button,action,{},next)}};
      bind('[data-refresh-account-change]','change-status',stage);
      bind('[data-cancel-account-change]','change-cancel',form);
      bind('[data-finish-account-change]','change-finish',async()=>{
        const refreshed=await window.refreshMishwarRiderAccount?.();
        if(!current())return;
        modal.close();toast(refreshed?'تم تعديل الحساب وإغلاق الجلسات الأخرى.':'تم حفظ التعديل. حدّث حالة حسابك للتحقق من البيانات.');
        if(refreshed)showAccount();
      });
      const code=root.querySelector('#rider-account-code');
      if(code)code.onsubmit=event=>{event.preventDefault();const payload={code:code.elements.code.value};code.elements.code.value='';void perform(code.querySelector('button'),'change-check',payload,stage)};
    }
    form();
  }
  window.showRiderAccountSettings=show;
  window.addEventListener('mishwar-account-reset',()=>{
    const old=view;view=null;if(!old)return;
    for(const input of old.root.querySelectorAll('input[type=password]'))input.value='';
    if(old.modal.open&&old.root.isConnected)old.modal.close();
  });
  function button(root){
    if(!root||root.querySelector('[data-rider-account-settings]'))return;
    const control=document.createElement('button');control.type='button';control.className='account-refresh';control.dataset.riderAccountSettings='';control.textContent='تغيير الجوال وكلمة المرور';control.onclick=show;root.append(control);
  }
  const accountBeforeSettings=showAccount;
  showAccount=function(...args){const result=accountBeforeSettings(...args);if(isOwnerReady())button(document.querySelector('.rider-account-card'));return result};
  const settingsBeforeSecurity=showSettings;
  showSettings=function(...args){const result=settingsBeforeSecurity(...args);button(document.querySelector('#modal .dialog-body')||document.querySelector('#modal-content'));return result};
})();
