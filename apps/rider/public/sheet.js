/* Two mobile snap states: favorites and request below, address search above. */
const sheetMedia=matchMedia('(max-width:700px)');
function openTripSearch(){openSearchSheet(pickupPoint?'destination':'pickup')}
function attachSheetGesture(element,handle,mode){
 let drag=null,suppressClick=false;
 element.addEventListener('pointerdown',e=>{
  if(!sheetMedia.matches||e.button!==0||mode==='compact'&&state.stage!=='home')return;
  if(e.target.closest('input,textarea,a,select,button')!==null&&!handle.contains(e.target))return;
  drag={id:e.pointerId,startY:e.clientY,lastY:e.clientY,startTime:performance.now()};(handle.contains(e.target)?handle:element).setPointerCapture(e.pointerId);element.classList.add('sheet-dragging');
 });
 element.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;drag.lastY=e.clientY;
  const delta=e.clientY-drag.startY,offset=mode==='compact'?Math.max(-180,Math.min(45,delta)):Math.max(0,Math.min(innerHeight*.65,delta));
  element.style.setProperty('--sheet-drag',offset+'px');
 });
 const end=e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const delta=drag.lastY-drag.startY,velocity=delta/Math.max(1,performance.now()-drag.startTime);
  const cancelled=e.type==='pointercancel';suppressClick=Math.abs(delta)>8;
  element.classList.remove('sheet-dragging');element.style.removeProperty('--sheet-drag');drag=null;
  if(cancelled)return;
  if(mode==='compact'&&(delta<-45||(delta<-18&&velocity<-.45)))openTripSearch();
  if(mode==='expanded'&&(delta>65||(delta>24&&velocity>.45))){closeAddressEditor();$('#panel>.primary')?.focus({preventScroll:true})}
 };
 element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);
 handle.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();return}if(mode==='compact')openTripSearch();else{closeAddressEditor();$('#panel>.primary')?.focus({preventScroll:true})}});
 handle.addEventListener('keydown',e=>{if(e.key==='ArrowUp'&&mode==='compact'){e.preventDefault();openTripSearch()}if(e.key==='ArrowDown'&&mode==='expanded'){e.preventDefault();closeAddressEditor();$('#panel>.primary')?.focus({preventScroll:true})}});
}
function prepareCompactSheet(){
 const booking=$('.booking');let handle=booking.querySelector('.booking-sheet-handle');
 if(!handle){handle=document.createElement('button');handle.type='button';handle.className='booking-sheet-handle mobile-sheet-handle';handle.setAttribute('aria-label','رفع لوحة البحث عن الانطلاق والوجهة');handle.setAttribute('aria-expanded','false');handle.innerHTML='<span></span><small>اسحب للأعلى للبحث</small>';booking.prepend(handle);attachSheetGesture(booking,handle,'compact')}
 const saved=$('#panel .saved');
 if(saved&&!saved.querySelector('[data-sheet-other]')){const other=document.createElement('button');other.type='button';other.dataset.sheetOther='';other.innerHTML=icon('pin')+'<div><strong>أخرى</strong><small>أماكني المفضلة</small></div>';saved.append(other)}
 document.body.classList.toggle('rider-home-sheet',sheetMedia.matches&&state.stage==='home');
}
function prepareExpandedSheet(){
 if(searchSheet.querySelector('.search-sheet-handle'))return;
 const handle=document.createElement('button');handle.type='button';handle.className='search-sheet-handle mobile-sheet-handle';handle.setAttribute('aria-label','تنزيل لوحة البحث وعرض أماكني وزر اطلب مشوار');handle.setAttribute('aria-expanded','true');handle.innerHTML='<span></span>';searchSheet.prepend(handle);attachSheetGesture(searchSheet,handle,'expanded');
}
const openSearchBeforeSheet=openSearchSheet;
openSearchSheet=function(target){openSearchBeforeSheet(target);prepareExpandedSheet()};
const renderBeforeSheet=render;
render=function(){renderBeforeSheet();prepareCompactSheet()};
const mapPickBeforeSheet=startMapPick,finishPickBeforeSheet=finishMapPick;
startMapPick=function(target){document.body.classList.remove('rider-home-sheet');mapPickBeforeSheet(target)};
finishMapPick=function(){finishPickBeforeSheet();prepareCompactSheet()};
document.addEventListener('click',e=>{
 if(!e.target.closest('[data-sheet-other]'))return;
 const favorites=savedAddresses();
 modal('أماكني المفضلة',`<p class="feature-intro">أماكنك المحفوظة للوصول السريع.</p>${favorites.length?`<div class="sheet-favorite-list">${favorites.slice(0,5).map((p,i)=>`<button type="button" data-sheet-favorite="${i}">${icon('pin')}<span><strong>${esc(p.name)}</strong><small>${esc(p.area||'مكان محفوظ')}</small></span></button>`).join('')}</div>`:'<div class="empty-state"><strong>احفظ مكانك المفضل</strong><p>ابحث عن المكان واضغط القلب بجواره لإضافته هنا.</p></div>'}<button type="button" class="primary" data-sheet-add>البحث عن مكان</button>`);
 $('#modal').querySelectorAll('[data-sheet-favorite]').forEach(button=>button.onclick=()=>{const point=favorites[Number(button.dataset.sheetFavorite)];$('#modal').close();choose(point);fitLocations()});
 $('[data-sheet-add]').onclick=()=>{$('#modal').close();openSearchSheet('destination')};
});
sheetMedia.addEventListener('change',()=>{prepareCompactSheet();$('.booking').style.removeProperty('--sheet-drag');searchSheet.style.removeProperty('--sheet-drag')});
prepareCompactSheet();
