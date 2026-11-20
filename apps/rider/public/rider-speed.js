(()=>{
  const context=window.MishwarAccountContext;
  let mapStep='pickup',saveTarget=null;
  const owner=()=>{const value=context.snapshot();return value.status==='ready'&&value.verified?value.accountKey:null};
  const key=()=>owner()?context.storageKey('mishwar-places-v3'):null;
  function favorites(){
    const storage=key();if(!storage)return {};
    const value=read(storage,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }
  const pointValue=point=>({name:String(point.name||'موقع محفوظ').slice(0,200),area:String(point.area||'').slice(0,200),lat:point.lat,lng:point.lng});
  function labels(){const all=favorites();for(const name of ['home','work']){if(validPoint(all[name]))profile[name]=all[name].name;else delete profile[name]}}
  function persist(all,ticket){
    if(!owner()||!context.isCurrent(ticket))return false;
    const storage=key();
    try{localStorage.setItem(storage,JSON.stringify(all));return true}catch{toast('تعذر حفظ المكان على هذا الجهاز. لم يُحفظ التعديل.');return false}
  }
  const beforeChoose=choose;
  choose=function(point){
    const pending=saveTarget;
    if(pending){
      if(!context.isCurrent(pending.ticket)||!owner()){saveTarget=null;return}
      if(validPoint(point)){
        saveTarget=null;
        const all=favorites();all[pending.name]=pointValue(point);
        if(persist(all,pending.ticket)){labels();toast('تم حفظ المكان')}
      }
    }
    beforeChoose(point);
  };
  function favorite(name){
    if(!owner()){toast('سجّل الدخول وفعّل حسابك لحفظ أماكنك.');window.showRiderLogin?.();return}
    const ticket=context.capture(),saved=favorites()[name],hasSaved=validPoint(saved),title=name==='home'?'موقع المنزل':'موقع العمل';
    sectionModal(title,`${hasSaved?`<p class="feature-intro" data-no-translate>${esc(saved.name)}</p><button class="primary" data-favorite-use="${name}">استخدام هذا المكان</button>`:'<p class="feature-intro">احفظ عنوانك لهذا الحساب على هذا الجهاز.</p>'}<button class="${hasSaved?'secondary':'primary'}" data-favorite-search="${name}">${hasSaved?'تعديل بالبحث عن العنوان':'البحث عن العنوان'}</button><button class="secondary" data-favorite-map="${name}">${hasSaved?'تعديل بالاختيار من الخريطة':'اختيار من الخريطة'}</button>${validPoint(pickupPoint)?`<button class="secondary" data-favorite-current="${name}">حفظ نقطة الانطلاق الحالية</button>`:''}${hasSaved?`<button class="secondary" data-favorite-delete="${name}">حذف هذا المكان</button>`:''}`);
    for(const button of document.querySelectorAll('#modal [data-favorite-use],#modal [data-favorite-search],#modal [data-favorite-map],#modal [data-favorite-current],#modal [data-favorite-delete]'))button.onclick=event=>{
      event.preventDefault();event.stopPropagation();
      if(!context.isCurrent(ticket)||!owner())return;
      if(button.dataset.favoriteUse){$('#modal').close();beforeChoose(saved);return}
      if(button.dataset.favoriteDelete){const all=favorites();delete all[name];if(persist(all,ticket)){labels();$('#modal').close();render();toast('تم حذف المكان')}return}
      if(button.dataset.favoriteCurrent){if(!validPoint(pickupPoint)){toast('حدد نقطة انطلاق صالحة أولًا.');return}const all=favorites();all[name]=pointValue(pickupPoint);if(persist(all,ticket)){labels();$('#modal').close();render();toast('تم حفظ المكان')}return}
      saveTarget={name,ticket};$('#modal').close();
      if(button.dataset.favoriteSearch)openSearchSheet('destination');else startMapPick('destination');
    };
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.geo==='cancel-pick'||button.hasAttribute('data-search-close'))saveTarget=null;
    if(['saved-home','saved-work'].includes(button.dataset.action)){
      event.preventDefault();event.stopImmediatePropagation();favorite(button.dataset.action==='saved-home'?'home':'work');
    }
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')saveTarget=null},true);
  window.addEventListener('mishwar-account-reset',()=>{saveTarget=null;mapStep='pickup';labels()});
  window.addEventListener('mishwar-auth-changed',()=>{labels();render()});
  const renderBeforePlaces=render;
  render=function(){labels();return renderBeforePlaces()};
  window.onMishwarMapTap=point=>{
    if(window.mishwarTripActive||!['home','select'].includes(state.stage))return;
    const ticket=context.capture(),target=state.stage==='home'?'pickup':mapStep;
    const selected={lat:point.lat,lng:point.lng,name:target==='pickup'?'نقطة الانطلاق على الخريطة':'الوجهة على الخريطة'};
    if(target==='pickup'){state.destination=null;setPickup(selected);mapStep='destination';setStage('select');window.dispatchEvent(new CustomEvent('mishwar-sheet-height',{detail:44}))}
    else{choose(selected);mapStep='pickup';window.dispatchEvent(new CustomEvent('mishwar-sheet-height',{detail:92}))}
    const selectedPoint=target==='pickup'?pickupPoint:state.destination;
    reverseAddress(selected).then(named=>{
      if(!context.isCurrent(ticket))return;
      const labels={name:named.name,area:named.area,resolved:named.resolved};
      if(target==='pickup'&&pickupPoint===selectedPoint){pickupPoint={...pickupPoint,...labels};render()}
      else if(target==='destination'&&state.destination===selectedPoint){state.destination={...state.destination,...labels};render()}
    }).catch(()=>{});
  };
  const oldShowTrips=showTrips;
  showTrips=async function(...args){await oldShowTrips(...args);const modal=document.querySelector('#modal');if(modal.open){modal.classList.add('rider-history-page');modal.addEventListener('close',()=>modal.classList.remove('rider-history-page'),{once:true})}};
  document.querySelector('.header-brand')?.addEventListener('click',event=>{event.preventDefault();location.reload()});
  labels();render();
})();
