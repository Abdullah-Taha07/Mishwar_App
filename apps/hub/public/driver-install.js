(()=>{
const button=document.getElementById('driver-install');
const dialog=document.getElementById('driver-install-help');
const instructions=document.getElementById('install-instructions');
const media=matchMedia('(display-mode: standalone)');
let pending=null;
function installed(){return media.matches||navigator.standalone===true}
function refresh(){button.hidden=installed()}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event;refresh()});
window.addEventListener('appinstalled',()=>{pending=null;button.hidden=true;dialog.close()});
media.addEventListener('change',refresh);
button.addEventListener('click',async()=>{
 if(pending){const event=pending;pending=null;try{await event.prompt();const result=await event.userChoice;if(result.outcome==='accepted'){button.hidden=true;return}}catch{} }
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
 instructions.textContent=ios?'افتح رابط السائق في Safari، واضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية» وأكّد الإضافة.':'افتح رابط السائق في Google Chrome خارج تطبيق ChatGPT. سجّل الدخول إذا طُلب منك، ثم من قائمة ⋮ اختر «إضافة إلى الشاشة الرئيسية» ثم «تثبيت». إذا لم يظهر «تثبيت»، أعد تحميل الصفحة بعد تسجيل الدخول ثم جرّب قائمة Chrome.';
 if(!dialog.open)dialog.showModal();
});
document.getElementById('install-close').onclick=()=>dialog.close();
refresh();
})();
