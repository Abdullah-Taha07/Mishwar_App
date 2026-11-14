(()=>{let ctx=null,alertId='',alertTimer=null,collapsed=false,drag=null,suppressClick=false;const sheet=document.querySelector('#driver-panel');
function beep(){try{if(ctx?.state!=='running')return;for(const [index,f]of[880,1100,880].entries()){const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=f;g.gain.setValueAtTime(.0001,ctx.currentTime+index*.22);g.gain.exponentialRampToValueAtTime(.18,ctx.currentTime+index*.22+.02);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+index*.22+.19);o.start(ctx.currentTime+index*.22);o.stop(ctx.currentTime+index*.22+.2)}navigator.vibrate?.([180,90,180])}catch{}}
document.addEventListener('pointerdown',()=>{try{ctx||=new(window.AudioContext||window.webkitAudioContext)();ctx.resume()}catch{}},{once:true});
window.prepareDriverAlerts=async()=>{try{ctx||=new(window.AudioContext||window.webkitAudioContext)();await ctx.resume();beep()}catch{toast('الصوت غير متاح. تحقق من إعدادات المتصفح')}/* Push permission is opt-in from notification settings; never prompt when toggling availability. */};
window.syncDriverOffers=offers=>{const r=offers?.[0],id=r?.id||'';if(id===alertId)return;clearInterval(alertTimer);alertId=id;if(!id)return;tab='requests';height(86);beep();alertTimer=setInterval(()=>{if(!data?.requests?.some(x=>x.id===id)||Date.parse(r.offerExpiresAt)<=Date.now()){clearInterval(alertTimer);return}beep()},4500)};
function tick(){document.querySelectorAll('[data-offer-clock]').forEach(el=>{const seconds=Math.max(0,Math.ceil((Date.parse(el.dataset.offerClock)-Date.now())/1000));el.textContent=String(seconds);el.closest('.offer-countdown')?.classList.toggle('ending',seconds<=10);if(!seconds){el.closest('article')?.querySelectorAll('button').forEach(b=>b.disabled=true);refresh()}})}setInterval(tick,1000);
let sheetPercent=56;
function height(percent){sheetPercent=Math.max(38,Math.min(86,percent));document.documentElement.style.setProperty('--driver-offer-height',sheetPercent+'%');document.documentElement.style.setProperty('--driver-sheet-height',sheetPercent+'%');const grip=sheet.querySelector('.driver-grab');if(grip){grip.setAttribute('aria-valuenow',String(Math.round(sheetPercent)));grip.setAttribute('aria-valuetext',sheetPercent<=42?'لوحة صغيرة':sheetPercent>=80?'لوحة موسعة':'لوحة متوسطة')}}
function setSnap(percent){height(percent);collapsed=percent<=40;}

document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-enable-driver-alerts')){await window.prepareDriverAlerts();b.textContent='تم تفعيل صوت الطلبات';b.disabled=true}if(b.hasAttribute('data-driver-sheet')||b.classList.contains('driver-grab')){if(suppressClick)return;setSnap(sheetPercent>=80?38:sheetPercent>=55?86:62)}if(b.dataset.declineOffer)await change({action:'decline',tripId:b.dataset.declineOffer});if(b.dataset.counterTrip){document.querySelector('#driver-counter-dialog')?.remove();const d=document.createElement('dialog');d.id='driver-counter-dialog';d.className='recovery-dialog';d.innerHTML=`<h2>اقتراح سعر أعلى</h2><p>لا يُعتمد السعر إلا بعد موافقة الراكب، خلال وقت الطلب المتبقي.</p><form><label>السعر بالريال<input name="amount" type="number" min="${(Number(b.dataset.counterMin)+1)/100}" max="100000" step="0.01" inputmode="decimal" required></label><p role="alert"></p><button class="recovery-primary">إرسال العرض للراكب</button></form><button class="recovery-link" data-close>إغلاق</button>`;document.body.append(d);d.showModal();d.querySelector('[data-close]').onclick=()=>d.remove();d.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const submit=ev.target.querySelector('button');submit.disabled=true;try{await api({action:'counter_offer',tripId:b.dataset.counterTrip,amount:Math.round(Number(ev.target.amount.value)*100)});d.remove();toast('تم إرسال عرضك إلى الراكب');await refresh()}catch(err){d.querySelector('[role=alert]').textContent=err.message;submit.disabled=false}}}});
/* MISHWAR_UX_SINGLE_POINTER_DRAG_20261114: one drag controller for both sheets. */
const nearestSnap=percent=>[38,62,86].reduce((best,n)=>Math.abs(n-percent)<Math.abs(best-percent)?n:best);
let activeDrag=null;
sheet.addEventListener('pointerdown',event=>{
 if(!matchMedia('(max-width:799px)').matches || !['requests','trip'].includes(document.body.dataset.driverTab))return;
 const grip=event.target.closest('.driver-grab,[data-driver-sheet]');
 if(!grip || event.isPrimary===false || (event.pointerType==='mouse'&&event.button!==0))return;
 const shell=document.querySelector('.driver-shell');if(!shell)return;
 activeDrag={id:event.pointerId,y:event.clientY,height:sheet.getBoundingClientRect().height,container:shell.getBoundingClientRect().height,moved:false};
 try{grip.setPointerCapture(event.pointerId)}catch{}
});
sheet.addEventListener('pointermove',event=>{
 if(!activeDrag||activeDrag.id!==event.pointerId)return;
 const dy=event.clientY-activeDrag.y;if(!activeDrag.moved&&Math.abs(dy)<7)return;
 activeDrag.moved=true;event.preventDefault();
 document.body.classList.add('driver-sheet-dragging');
 height((activeDrag.height-dy)/activeDrag.container*100);
});
function finishDrag(event){if(!activeDrag||event.pointerId!==activeDrag.id)return;const moved=activeDrag.moved;activeDrag=null;document.body.classList.remove('driver-sheet-dragging');if(moved){suppressClick=true;setTimeout(()=>{suppressClick=false},350);setSnap(nearestSnap(sheetPercent));}}
sheet.addEventListener('pointerup',finishDrag);
sheet.addEventListener('pointercancel',finishDrag);
sheet.addEventListener('lostpointercapture',event=>{if(activeDrag?.id===event.pointerId)finishDrag(event)});
sheet.addEventListener('keydown',event=>{
 if(!event.target.closest('.driver-grab,[data-driver-sheet]'))return;
 if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
 event.preventDefault();
 if(event.key==='Home')setSnap(86);
 else if(event.key==='End')setSnap(38);
 else if(event.key==='ArrowUp')setSnap(sheetPercent<50?62:86);
 else setSnap(sheetPercent>75?62:38);
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();if(alertId)beep()}});
navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='REFRESH_DRIVER')refresh()});
})();
