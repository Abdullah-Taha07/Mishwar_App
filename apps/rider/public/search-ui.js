/* A single, keyboard-aware address screen for both trip endpoints. */
const searchSheet=document.createElement('section');searchSheet.id='search-sheet';searchSheet.hidden=true;searchSheet.setAttribute('role','dialog');searchSheet.setAttribute('aria-modal','true');searchSheet.setAttribute('aria-label','البحث عن الانطلاق والوجهة');document.body.append(searchSheet);
const searchSourceCredit=()=>window.mishwarMapSearchCredit?.()||'البحث: Photon · بيانات OpenStreetMap';
window.addEventListener('mishwar-map-provider-changed',()=>{const source=searchSheet.querySelector('.search-source');if(source)source.textContent=searchSourceCredit()});
let searchReturn=null,searchNote='',selectedSearchTarget='destination',searchOwnerTicket=null;
const searchBackground=new Map();
function containSearchFocus(active){
 if(active){
  for(const node of document.body.children||[]){
   if(node===searchSheet||node.id==='toast'||['SCRIPT','STYLE','LINK'].includes(node.tagName))continue;
   if(!searchBackground.has(node))searchBackground.set(node,node.inert===true);
   node.inert=true;
  }
 }else{for(const [node,inert]of searchBackground)node.inert=inert;searchBackground.clear()}
}
function restoreSearchFocus(){
 const target=searchReturn?.matches('[data-address]')?$('#panel>.primary')||searchReturn:searchReturn;
 if(target?.isConnected)target.focus({preventScroll:true});
}
function searchFocusable(){return [...searchSheet.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]')].filter(node=>!node.hidden&&node.getAttribute?.('aria-hidden')!=='true')}
const arabicKey=s=>String(s||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLowerCase().trim();
const sameFavoritePlace=(a,b)=>a.name===b.name&&Math.abs(a.lat-b.lat)<.001&&Math.abs(a.lng-b.lng)<.001;
function addressStorage(name){const context=window.MishwarAccountContext,state=context?.snapshot();return state?.status==='ready'&&state.authenticated?context.storageKey(name+'-v3'):null}
function addressList(name){const key=addressStorage(name),points=key?read(key,[]):[];return Array.isArray(points)?points.filter(validPoint):[]}
function savedAddresses(){return addressList('mishwar-favorites')}
function recentAddresses(){return addressList('mishwar-recent-addresses')}
function saveAddressList(name,points,ticket){const context=window.MishwarAccountContext,key=addressStorage(name);if(!key||!context.isCurrent(ticket))return false;try{localStorage.setItem(key,JSON.stringify(points));return true}catch{toast('تعذر حفظ المكان على هذا الجهاز. لم يُحفظ التعديل.');return false}}
function rememberAddress(point,ticket=window.MishwarAccountContext?.capture()){return saveAddressList('mishwar-recent-addresses',[point,...recentAddresses().filter(p=>p.name!==point.name||Math.abs(p.lat-point.lat)>.001)].slice(0,12),ticket)}
function openSearchSheet(target){
 searchOwnerTicket=window.MishwarAccountContext?.capture()||null;
 if(!searchSheet.hidden){selectSearchField(target);return}
 searchReturn=document.activeElement;closeAddressEditor();selectedSearchTarget=target;searchSheet.hidden=false;document.body.classList.add('search-open');containSearchFocus(true);
 searchSheet.innerHTML=`<header class="search-header"><button class="icon-btn" data-search-close aria-label="إغلاق البحث">${icon('close')}</button><strong>إلى أين وجهتك؟</strong><span>مشوار</span></header><div class="search-route">${['pickup','destination'].map((id,i)=>`<div class="search-route-row"><span class="search-route-dot ${i?'end':''}"></span><label for="search-${id}">${i?'الوجهة':'نقطة الانطلاق'}<input id="search-${id}" data-search-address="${id}" role="combobox" aria-autocomplete="list" aria-controls="search-results-list" aria-expanded="true" autocomplete="off" enterkeyhint="search" placeholder="${i?'ابحث عن وجهتك':'ابحث عن نقطة الانطلاق'}" value="${esc((i?state.destination:pickupPoint)?.name||'')}"></label><button class="icon-btn" data-search-clear="${id}" aria-label="مسح ${i?'الوجهة':'الانطلاق'}">${icon('close')}</button></div>`).join('')}</div><div class="search-actions"><button data-search-map>${icon('pin')} اختر على الخريطة</button><button data-search-location>${icon('target-locate')} موقعي الحالي</button><button data-search-note>${icon('chat')} ملاحظة للوصول</button></div><div class="search-list-heading"><strong id="search-result-heading">أماكنك الأخيرة والمفضلة</strong><span id="search-result-hint"></span></div><div id="search-results-list" role="listbox" aria-label="اقتراحات الأماكن والشوارع والأحياء"></div><footer class="search-source">${searchSourceCredit()}</footer>`;
 selectSearchField(target);
}
function selectSearchField(target){
 selectedSearchTarget=target;editor.target=target;editor.results=[];editor.error='';editor.loading=false;
 searchSheet.querySelectorAll('.search-route-row').forEach(row=>row.classList.toggle('focused',row.querySelector('input').dataset.searchAddress===target));
 const input=$('#search-'+target);editor.query=input.value;input.focus({preventScroll:true});input.select();
 if(input.value.trim().length>=2)scheduleAddressSearch(input.value);else drawSuggestions();
}
startAddressEditor=function(input){openSearchSheet(input.dataset.address)};
focusAddress=function(target){if($('#modal').open)$('#modal').close();if(!['home','select'].includes(state.stage))setStage('home');openSearchSheet(target)};
showSearch=function(){openSearchSheet('destination')};
closeAddressEditor=function({restoreFocus=false}={}){
 stopAddressSearch();editor.target=null;editor.results=[];editor.visibleResults=[];suggestionBox.hidden=true;searchSheet.hidden=true;document.body.classList.remove('address-editing','search-open');
 document.querySelectorAll('[data-address]').forEach(x=>x.setAttribute('aria-expanded','false'));
 if(document.activeElement?.matches('[data-search-address]'))document.activeElement.blur();
 containSearchFocus(false);if(restoreFocus)restoreSearchFocus();
};
positionSuggestions=function(){};
drawSuggestions=function(){
 if(!editor.target||searchSheet.hidden)return;
 const list=$('#search-results-list'),query=arabicKey(editor.query),words=query.split(/\s+/).filter(w=>w.length>1&&!['حي','شارع','طريق','الرياض'].includes(w));
 let results=editor.query.trim().length>=2?editor.results:[...savedAddresses(),...recentAddresses()];
 const seen=new Set();results=results.filter(p=>{const key=arabicKey(p.name)+p.lat.toFixed(3)+p.lng.toFixed(3);if(seen.has(key))return false;seen.add(key);return true});
 results=window.MishwarGeoPolicy.rank(results,searchFocus());
 // The result pane scrolls; do not silently discard valid matches below its fold.
 editor.visibleResults=results;
 $('#search-result-heading').textContent=editor.loading?'جارٍ البحث…':query.length>=2?'الأقرب إليك في الرياض':'أماكنك الأخيرة والمفضلة';
 $('#search-result-heading').setAttribute('role','status');list.setAttribute('aria-busy',String(editor.loading));
 $('#search-result-hint').textContent=results.length>6?'أضف تفاصيل لتضييق النتائج':'';
 list.innerHTML=editor.visibleResults.length?editor.visibleResults.map((p,i)=>`<div class="search-result-row"><button role="option" aria-selected="false" data-search-select="${i}">${icon('pin')}<span><strong data-no-translate>${esc(p.name)}</strong><small><span data-no-translate>${esc(p.area||'')}</span> · ${p.distanceKm.toFixed(1)} كم</small></span></button><button class="favorite-address ${savedAddresses().some(f=>sameFavoritePlace(f,p))?'saved':''}" data-search-favorite="${i}" aria-label="حفظ ${esc(p.name)} في المفضلة">♡</button></div>`).join(''):editor.loading?`<div class="search-loading-skeleton" aria-hidden="true">${[1,2,3].map(()=>'<div class="search-result-row"><span class="mw-skeleton" style="height:12px;width:75%"></span></div>').join('')}</div>`:`<div class="search-empty">${icon('search')}<strong>${editor.error?'تعذر تحميل النتائج':query.length>=2?'جرّب اسمًا أو عنوانًا أوضح':'اكتب اسم مكان أو شارع أو حي'}</strong><p>${esc(editor.error||(query.length>=2?'بعض الأنشطة غير متوفرة في مصدر الخرائط الحالي. يمكنك تحديد مكانها بنفسك على الخريطة.':'ستظهر الاقتراحات هنا أثناء الكتابة.'))}</p></div>`;
};
searchSheet.addEventListener('focusin',e=>{const input=e.target.closest('[data-search-address]');if(input&&editor.target!==input.dataset.searchAddress){stopAddressSearch();selectedSearchTarget=input.dataset.searchAddress;editor.target=selectedSearchTarget;editor.results=[];editor.query=input.value;editor.error='';editor.loading=false;searchSheet.querySelectorAll('.search-route-row').forEach(row=>row.classList.toggle('focused',row.contains(input)));input.value.length>=2?scheduleAddressSearch(input.value):drawSuggestions()}});
searchSheet.addEventListener('input',e=>{if(e.target.matches('[data-search-address]'))scheduleAddressSearch(e.target.value)});
searchSheet.addEventListener('keydown',e=>{
 if(e.key==='Escape'){e.preventDefault();closeAddressEditor({restoreFocus:true});return}
 if(e.key==='Tab'){
  const controls=searchFocusable(),first=controls[0],last=controls[controls.length-1];
  if(first&&((e.shiftKey&&(document.activeElement===first||!searchSheet.contains(document.activeElement)))||(!e.shiftKey&&(document.activeElement===last||!searchSheet.contains(document.activeElement))))){e.preventDefault();(e.shiftKey?last:first).focus({preventScroll:true})}
  return;
 }
 const options=[...searchSheet.querySelectorAll('[data-search-select]')],current=options.indexOf(document.activeElement);
 if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&(e.target.matches('[data-search-address]')||current>=0)){
  // Home/End retain their normal text-editing behavior inside the address field.
  if(e.target.matches('[data-search-address]')&&['Home','End'].includes(e.key))return;
  if(!options.length)return;e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?options.length-1:e.key==='ArrowDown'?Math.min(options.length-1,current+1):current<0?options.length-1:Math.max(0,current-1);
  options.forEach((option,n)=>option.setAttribute('aria-selected',String(n===index)));options[index].focus({preventScroll:true});options[index].scrollIntoView?.({block:'nearest'});return;
 }
 if(e.key==='Enter'&&e.target.matches('[data-search-address]')){e.preventDefault();clearTimeout(editor.timer);runAddressSearch(e.target.value,editor.sequence)}
});
searchSheet.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;e.preventDefault();e.stopPropagation();
 const context=window.MishwarAccountContext;if(context&&searchOwnerTicket&&!context.isCurrent(searchOwnerTicket)){closeAddressEditor();return}
 if(b.hasAttribute('data-search-close')){closeAddressEditor({restoreFocus:true});return}
 if(b.dataset.searchClear){const input=$('#search-'+b.dataset.searchClear);input.value='';if(b.dataset.searchClear==='pickup'){window.beginMishwarManualPickup?.();pickupPoint=null;syncMapPoints()}else state.destination=null;selectSearchField(b.dataset.searchClear);return}
 if(b.hasAttribute('data-search-map')){const target=editor.target;startMapPick(target);return}
 if(b.hasAttribute('data-search-location')){locatePickup();return}
 if(b.hasAttribute('data-search-note')){closeAddressEditor();modal('ملاحظة للوصول',`<p class="feature-intro">مثال: أمام البوابة الرئيسية أو بجوار المدخل الشمالي.</p><form id="arrival-note"><label for="arrival-text">الملاحظة</label><textarea id="arrival-text" maxlength="200" rows="3">${esc(searchNote)}</textarea><button class="primary" type="submit">حفظ الملاحظة</button></form>`);$('#arrival-note').onsubmit=ev=>{ev.preventDefault();searchNote=$('#arrival-text').value.trim();$('#modal').close();toast('ستصل الملاحظة للكابتن عند تأكيد الطلب')};return}
 if(b.dataset.searchFavorite!==undefined){const p=editor.visibleResults[Number(b.dataset.searchFavorite)];if(!p)return;if(!addressStorage('mishwar-favorites')){toast('سجّل الدخول لحفظ المفضلة لهذا الحساب.');return}const list=savedAddresses(),exists=list.some(f=>sameFavoritePlace(f,p));saveAddressList('mishwar-favorites',exists?list.filter(f=>!sameFavoritePlace(f,p)):[p,...list].slice(0,30),searchOwnerTicket);drawSuggestions();return}
 if(b.dataset.searchSelect!==undefined){const p=editor.visibleResults[Number(b.dataset.searchSelect)],target=editor.target;if(!p)return;rememberAddress(p);closeAddressEditor();if(target==='pickup'){setPickup(p);if(!state.destination)openSearchSheet('destination')}else{choose(p);fitLocations()}}
});
const chooseNamed=choose;
choose=function(point){if(validPoint(point)){chooseNamed(point);return}openSearchSheet('destination');$('#search-destination').value=point.name;scheduleAddressSearch(point.name)};
new ResizeObserver(()=>{if(!searchSheet.hidden)drawSuggestions()}).observe(searchSheet);
window.addEventListener('mishwar-account-reset',()=>{searchOwnerTicket=null;closeAddressEditor();editor.query='';editor.error='';searchSheet.innerHTML=''});
