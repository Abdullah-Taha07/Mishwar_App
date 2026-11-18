/* Rider APK share: native Android chooser when in Mishwar WebView, system Web Share elsewhere. */
(()=>{
  const native=/\bMishwarAndroid\/\d+/.test(navigator.userAgent);
  const installUrl=()=>new URL('/install.html',location.origin).href;
  const nativeAction=kind=>{window.location.href='mishwar-app://'+kind};
  document.addEventListener('click',event=>{
    if(!event.target.closest('[data-share-application]'))return;
    sectionModal('مشاركة تطبيق مشوار',`<div class="app-share-card"><img src="/icon-192.png" alt="شعار مشوار"><h3>خلّ مشوار يوصل لمعارفك</h3><p>${native?'تقدر تبعت ملف APK المثبت لأي جهاز أندرويد يقبل مشاركة الملفات، أو تشارك رابط التثبيت.':'يمكنك مشاركة رابط تثبيت مشوار. تنزيل APK المباشر سيصبح متاحًا بعد نشر الإصدار الموقع على الموقع الرسمي.'}</p>${native?'<button class="primary" type="button" id="share-app-apk">إرسال ملف APK عبر التطبيقات</button>':''}<button class="secondary" type="button" id="share-app-link">مشاركة رابط التثبيت</button><button class="secondary" type="button" id="copy-app-link">نسخ الرابط</button><p class="field-hint">${native?'قد تمنع بعض تطبيقات المراسلة إرسال ملفات APK. استخدم Quick Share أو Bluetooth أو المشاركة عبر ملفاتي.':'إذا لم تظهر نافذة المشاركة فسيتم نسخ الرابط لتتمكن من إرساله بنفسك.'}</p><a class="account-refresh" href="/install.html">تعليمات التثبيت</a><p id="app-share-result" role="status" aria-live="polite"></p></div>`);
    const result=document.querySelector('#app-share-result');
    const say=t=>{if(result?.isConnected)result.textContent=t};
    const apk=document.querySelector('#share-app-apk');
    if(apk)apk.onclick=()=>nativeAction('share');
    document.querySelector('#share-app-link').onclick=async()=>{
      if(native){nativeAction('share-link');return}
      try{
        if(typeof navigator.share==='function')await navigator.share({title:'مشوار',text:'ثبّت مشوار على هاتفك',url:installUrl()});
        else {await navigator.clipboard.writeText(installUrl());say('تم نسخ رابط التثبيت لمشاركته')}
      }catch(error){if(error?.name==='AbortError')return;try{await navigator.clipboard.writeText(installUrl());say('تعذرت نافذة المشاركة، وتم نسخ الرابط')}catch{say(installUrl())}}
    };
    document.querySelector('#copy-app-link').onclick=async()=>{try{await navigator.clipboard.writeText(installUrl());say('تم نسخ رابط التثبيت')}catch{say(installUrl())}};
  });
})();
