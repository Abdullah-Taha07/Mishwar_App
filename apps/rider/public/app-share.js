/* Share the verified install URL only. Native APK sharing is disabled until a signed release is audited. */
(()=>{'use strict';
  const installUrl=()=>new URL('/install.html',location.origin).href;
  document.addEventListener('click',event=>{
    if(!event.target.closest('[data-share-application]'))return;
    event.preventDefault();
    const drawer=document.querySelector('#drawer');
    if(drawer?.open)drawer.close();
    sectionModal('مشاركة تطبيق مشوار',`<div class="app-share-card"><img src="/icon-192.png" alt="أيقونة مشوار"><h3>شارك مشوار مع معارفك</h3><p>شارك رابط التثبيت الرسمي للآيفون وأندرويد. توزيع ملفات APK متوقف لحين اعتماد إصدار موقّع وآمن.</p><button class="primary" type="button" id="share-app-link">مشاركة رابط التثبيت</button><button class="secondary" type="button" id="copy-app-link">نسخ الرابط</button><a class="account-refresh" href="/install.html">تعليمات التثبيت</a><p id="app-share-result" role="status" aria-live="polite"></p></div>`);
    const result=document.querySelector('#app-share-result');
    const say=message=>{if(result?.isConnected)result.textContent=message};
    const copy=async()=>{
      try{await navigator.clipboard.writeText(installUrl());say('تم نسخ رابط التثبيت');return true}
      catch{say('انسخ الرابط لإرساله: '+installUrl());return false}
    };
    document.querySelector('#share-app-link').onclick=async()=>{
      if(typeof navigator.share==='function'){
        try{await navigator.share({title:'مشوار الراكب',text:'ثبّت مشوار على هاتفك',url:installUrl()});say('تمت مشاركة رابط التثبيت');return}
        catch(error){if(error?.name==='AbortError'){say('أُلغيت المشاركة. يمكنك نسخ الرابط بدلًا منها.');return}}
      }
      await copy();
    };
    document.querySelector('#copy-app-link').onclick=copy;
  });
})();
