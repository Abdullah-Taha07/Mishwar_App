// Mishwar three-tab UX: presentation only. Server-owned trip and wallet flows remain unchanged.
(()=>{
 const nav=document.querySelector('.mobile-nav');
 const main=document.querySelector('.workspace');
 if(!nav||!main)return;
 const ar={home:'الرئيسية',trips:'الرحلات',more:'المزيد',wallet:'رصيد المحفظة',details:'اضغط لفتح تفاصيل المحفظة',history:'سجل الرحلات السابقة',active:'الرحلة الحالية',none:'لا توجد رحلة نشطة حاليًا',loading:'جارٍ تحميل الرصيد',guest:'سجّل الدخول لعرض رصيدك',resume:'متابعة الرحلة'};
 const en={home:'Home',trips:'Trips',more:'More',wallet:'Wallet balance',details:'Open wallet details',history:'Trip history and receipts',active:'Current trip',none:'No active trip',loading:'Loading balance',guest:'Sign in to view balance',resume:'Resume trip'};
 const tr=k=>(document.documentElement.lang==='en'?en:ar)[k];
 const account=document.createElement('button');account.id='mishwar-rider-account-shortcut';account.type='button';account.setAttribute('aria-label','حسابي');account.setAttribute('title','حسابي');account.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></svg>';
 main.querySelector('.topbar')?.append(account);
 const trips=document.createElement('section');trips.id='mishwar-rider-trips-page';trips.hidden=true;trips.setAttribute('aria-label','الرحلات');main.append(trips);
 // Unify desktop and mobile navigation. These buttons never call a money-changing API.
 const rail=document.querySelector('.rail nav');
 const icons={home:'<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',trips:'<path d="M4 17h16l-2-9H6l-2 9ZM7 8l2-4h6l2 4M6 17v3m12-3v3"/>',more:'<path d="M4 6h16M4 12h16M4 18h16"/>'};
 if(rail){rail.innerHTML=['home','trips','more'].map(k=>`<button class="nav" type="button" data-mw-tab="${k}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${icons[k]}</svg><span>${tr(k)}</span></button>`).join('')}
 let current='home';
 function activeTab(section){current=section;for(const b of document.querySelectorAll('.mobile-nav button,.rail [data-mw-tab]')){const value=b.dataset.mwTab||(b.dataset.page==='home'?'home':b.dataset.page==='trips'?'trips':b.hasAttribute('data-open-menu')?'more':null);const selected=value===section;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}}
 function refresh(){if(trips.hidden)return;const snapshot=window.mishwarRiderFinancialSnapshot?.()||null,trip=window.mishwarRiderCurrentTrip?.()||null;const hasAccount=window.MishwarAccountContext?.snapshot()?.verified===true||window.mishwarRiderVerified===true;const amount=snapshot?(snapshot.balance/100).toFixed(2)+' ر.س':'— ر.س';const status=snapshot?tr('details'):hasAccount?tr('loading'):tr('guest');const destination=trip?.destination?String(trip.destination):'';trips.innerHTML=`<header class="mw-trips-title"><h1>${tr('trips')}</h1></header><button type="button" class="mw-rider-wallet-card" data-mw-wallet aria-label="${tr('wallet')}: ${amount}. ${status}"><span class="mw-label">${tr('wallet')}</span><strong dir="ltr" data-wallet-server-value>${amount}</strong><span class="mw-wallet-caption">${status}<span aria-hidden="true">‹</span></span></button><section class="mw-trip-list"><h2>${tr('active')}</h2>${trip?`<div class="mw-trip-current"><p>${destination.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p><button type="button" class="mw-action" data-mw-resume>${tr('resume')}</button></div>`:`<p>${tr('none')}</p>`}<button type="button" class="mw-open-history" data-mw-history>${tr('history')} <span aria-hidden="true">‹</span></button></section>`;}
 function showTrips(){trips.hidden=false;activeTab('trips');refresh();trips.scrollTop=0;}
 function showHome(){trips.hidden=true;activeTab('home');}
 function showMore(){activeTab('more');try{window.MishwarOpenRiderMore?.()}catch{activeTab(trips.hidden?'home':'trips')}}
 function navigate(section){if(section==='home')showHome();else if(section==='trips')showTrips();else showMore();}
 // Capture on the nav surface so the older modal-based Trips handler cannot run as well.
 nav.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;const section=button.dataset.page==='home'?'home':button.dataset.page==='trips'?'trips':button.hasAttribute('data-open-menu')?'more':null;if(!section)return;e.preventDefault();e.stopPropagation();navigate(section)},true);
 rail?.addEventListener('click',e=>{const b=e.target.closest('[data-mw-tab]');if(!b)return;e.preventDefault();e.stopPropagation();navigate(b.dataset.mwTab)},true);
 account.addEventListener('click',()=>window.MishwarOpenRiderSection?.('profile'));
 trips.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-mw-wallet'))window.MishwarOpenRiderSection?.('wallet');else if(b.hasAttribute('data-mw-history'))window.MishwarOpenRiderSection?.('trips');else if(b.hasAttribute('data-mw-resume'))showHome()});
 document.querySelector('#drawer')?.addEventListener('close',()=>activeTab(trips.hidden?'home':'trips'));
 for(const name of ['mishwar-live-ready','mishwar-trip-updated','mishwar-auth-changed','mishwar-account-reset','mishwar-language-changed'])window.addEventListener(name,()=>{if(name==='mishwar-account-reset'){trips.hidden=true;activeTab('home')}else{if(name==='mishwar-language-changed'){rail?.querySelectorAll('[data-mw-tab]').forEach(b=>b.querySelector('span').textContent=tr(b.dataset.mwTab))}refresh()}});
 activeTab('home');window.MishwarThreeNav={showTrips,showHome,refresh};
})();
