/* Mishwar universal installation — no unsafe automated iOS install claims. */
(()=>{'use strict';
  const qs=s=>document.querySelector(s);
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
  const android=/Android/i.test(navigator.userAgent);
  const platform=ios?'ios':android?'android':'other';
  document.documentElement.dataset.platform=platform;
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const status=qs('#install-feedback');
  const say=message=>{status.textContent=message};
  const title=document.body.dataset.appTitle||'مشوار';
  const url=location.href.split('#')[0];
  const preferred=ios?qs('#ios-card'):android?qs('#android-card'):null;
  if(preferred){preferred.classList.add('recommended');preferred.querySelector('.badge').textContent='المناسب لجهازك';}
  if(standalone){say('التطبيق مفتوح بالفعل في وضع التطبيق المثبت.');}
  let installPrompt=null;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
  window.addEventListener('appinstalled',()=>{installPrompt=null;say('تم تثبيت التطبيق. ابحث عن أيقونته في الشاشة الرئيسية.');});
  qs('#install-android').addEventListener('click',async()=>{
    if(standalone){say('التطبيق مثبت بالفعل.');return;}
    if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();const outcome=await prompt.userChoice;if(outcome.outcome==='accepted'){say('تم قبول التثبيت. ابحث عن أيقونة مشوار.');return;}}catch{}}
    const guide=qs('#android-guide');guide.hidden=false;guide.focus();
    say('افتح الرابط في Chrome، ثم من القائمة ⋮ اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».');
  });
  qs('#install-ios').addEventListener('click',()=>{
    const guide=qs('#ios-guide');guide.hidden=false;guide.focus();
    say(ios?'من Safari اضغط مشاركة ثم «إضافة إلى الشاشة الرئيسية».':'لتثبيت مشوار على iPhone افتح هذا الرابط في Safari.');
  });
  const apkUrl=document.body.dataset.apkUrl||'';
  const apkLink=qs('#signed-apk-link');
  // Show APK only when a vetted, stable HTTPS release URL is explicitly configured.
  try{if(apkUrl){const u=new URL(apkUrl,location.origin);if(u.protocol==='https:'&&u.pathname.toLowerCase().endsWith('.apk')){apkLink.href=u.href;apkLink.hidden=false;}}}catch{}
  qs('#share-install').addEventListener('click',async()=>{
    if(typeof navigator.share==='function'){
      try{await navigator.share({title,text:'ثبت '+title+' على أندرويد أو آيفون من نفس الرابط',url});say('تم فتح خيارات المشاركة.');return;}
      catch(error){if(error&&error.name==='AbortError')return;}
    }
    say('المشاركة المباشرة غير مدعومة في هذا المتصفح. استخدم «نسخ الرابط» لإرساله.');
  });
  qs('#copy-install').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(url);say('تم نسخ رابط التثبيت، ويمكنك إرساله لأي شخص.');}
    catch{say('انسخ هذا الرابط وشاركه: '+url);}
  });
})();
