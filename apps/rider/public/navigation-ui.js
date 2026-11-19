(()=>{const apply=()=>{for(const b of document.querySelectorAll('[data-action="close"],[data-search-close],.recovery-close,#close-driver-service,#install-close')){if(b.dataset.backReady)continue;b.dataset.backReady='yes';b.setAttribute('aria-label','رجوع');if(b.matches('[data-search-close],[data-action="close"],.recovery-close'))b.textContent='→';else b.textContent='رجوع'}};new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});apply();})();
/* Restore a navigation choice after the first account bootstrap; never replay a mutation. */
(()=>{
 const context=window.MishwarAccountContext;
 if(!context||context.snapshot().status!=='unknown')return;
 const sections={profile:'showAccount',wallet:'showWallet',payment:'showPayment',trips:'showTrips',promo:'showPromo',help:'showHelp',settings:'showSettings',driver:'showDriver'};
 const liveSections=new Set(['wallet','payment','trips']);
 const launchScreens=new Set(['reservations','cases','readiness','referral','contacts']);
 let listening=true,choice=null,pending=null,sequence=0;
 const node=selector=>document.querySelector(selector);
 const marker=view=>view?.querySelector('.modal-head')||view?.firstElementChild||view;
 const shown=record=>!!record?.view?.isConnected&&(record.kind==='search'&&!record.waiting?record.view.hidden===false:record.view.open===true)&&record.marker===marker(record.view);
 const needsLive=intent=>liveSections.has(intent.section)||(intent.kind==='search'&&context.snapshot().authenticated);
 function recordChoice(intent){
  const selector=intent.kind==='launch'?'#launch-dialog':intent.kind==='search'?'#search-sheet':intent.section==='menu'?'#drawer':'#modal',view=node(selector);
  const target=intent.kind==='search'?(document.activeElement?.dataset?.searchAddress||intent.target):intent.target;
  return {...intent,target,view,marker:marker(view),pendingView:false};
 }
 function discard(){if(pending?.timer)clearTimeout(pending.timer);pending=null;choice=null;sequence++}
 function navigate(intent){
  if(intent.kind==='launch')node('[data-launch="'+intent.launch+'"]')?.click();
  else if(intent.kind==='notifications')node('#notifications-button')?.click();
  else if(intent.kind==='search'){
   if(window.mishwarTripActive){if(intent.waiting)node('#modal')?.close();toast('لديك مشوار نشط؛ تابعه أولًا');return}
   focusAddress(intent.target);
  }
  else if(intent.section==='menu')openDrawer();
  else ({showAccount,showWallet,showPayment,showTrips,showPromo,showHelp,showSettings,showDriver})[sections[intent.section]]?.();
 }
 function current(){return !!pending&&context.isCurrent(pending.ticket)}
 function complete(){
  if(!current()){discard();return}
  const intent=pending;
  if(intent.waiting&&!shown(intent)){discard();return}
  discard();navigate(intent);
 }
 function waiting(){
  if(!current()){discard();return}
  sectionModal('جارٍ التحميل…','<p class="feature-intro" data-rider-navigation-status role="status">جارٍ التحميل…</p><button type="button" class="secondary" data-rider-navigation-retry hidden>إعادة المحاولة</button>');
  pending.view=node('#modal');pending.marker=marker(pending.view);pending.waiting=true;
  const retry=node('[data-rider-navigation-retry]');
  if(retry)retry.onclick=()=>{if(!current())return;retry.hidden=true;node('[data-rider-navigation-status]').textContent='جارٍ التحميل…';armFailure();void window.refreshMishwarTrip?.(true)};
  armFailure();
 }
 function showFailure(){
  if(!current()||!shown(pending)){discard();return}
  const status=node('[data-rider-navigation-status]'),retry=node('[data-rider-navigation-retry]');
  if(status)status.textContent='تعذر الاتصال بالخادم. أعد المحاولة.';
  if(retry)retry.hidden=false;
 }
 function armFailure(){if(pending.timer)clearTimeout(pending.timer);pending.timer=setTimeout(showFailure,11000)}
 function captureNavigation(event){
  // Address fields open their screen on focus, before a click can reach them.
  if(event.type==='focusin'&&!event.target.matches('[data-address]'))return;
  if(!listening||context.snapshot().status!=='unknown')return;
  const button=event.target.closest('button,[data-address]');if(!button)return;
  if(button.dataset.page==='home'){choice=null;sequence++;return}
  const section=button.dataset.section||(button.dataset.page==='account'?'profile':button.dataset.page==='trips'?'trips':button.hasAttribute('data-open-menu')?'menu':null);
  let intent=null;
  if(section&&(section==='menu'||Object.prototype.hasOwnProperty.call(sections,section)))intent={kind:'section',section};
  else if(launchScreens.has(button.dataset.launch))intent={kind:'launch',launch:button.dataset.launch};
  else if(button.id==='notifications-button')intent={kind:'notifications'};
  else if(button.matches?.('.booking-sheet-handle')||['pickup','search','next'].includes(button.dataset.action)||['pickup','destination'].includes(button.dataset.address))intent={kind:'search',target:button.dataset.address||(button.dataset.action==='pickup'?'pickup':'destination')};
  if(!intent)return;
  const operation=++sequence;
  // A capture callback has its own microtask checkpoint before delegated click
  // handlers. Keep the named intent now and inspect its view after dispatch.
  choice={...intent,pendingView:true};
  setTimeout(()=>{
   if(!listening||operation!==sequence||context.snapshot().status!=='unknown')return;
   const record=recordChoice(intent);
   choice=shown(record)?record:null;
  },0);
 }
 window.addEventListener('click',captureNavigation,true);
 window.addEventListener('focusin',captureNavigation,true);
 window.MishwarNavigation={
  beforeAccountReset(event){
   if(!event?.detail?.bootstrap){listening=false;discard();return}
   // A fast auth response may precede the zero-delay snapshot task.
   if(choice?.pendingView)choice=recordChoice(choice);
   const protectedForm=choice?.view?.querySelector('#rider-password-form,#email-reset-request,#email-new-password');
   const keepDraft=protectedForm&&(protectedForm.id!=='rider-password-form'||!context.snapshot().authenticated||[...protectedForm.querySelectorAll('input')].some(input=>String(input.value||'').length>0));
   const restore=shown(choice)&&!keepDraft?{kind:choice.kind,section:choice.section,launch:choice.launch,target:choice.target}:null;
   discard();listening=false;
   if(restore)pending={...restore,ticket:context.capture(),waiting:false,timer:null};
  }
 };
 // Capture the visible choice before any account-reset subscriber clears it.
 window.addEventListener('mishwar-account-will-reset',window.MishwarNavigation.beforeAccountReset);
 window.addEventListener('mishwar-auth-changed',()=>{
  listening=false;choice=null;
  if(!pending)return;
  if(!current()){discard();return}
  if(pending.waiting){if(!shown(pending))discard();return}
  if(needsLive(pending))waiting();else complete();
 });
 window.addEventListener('mishwar-live-ready',()=>{
  if(current()&&needsLive(pending))complete();
 });
})();
