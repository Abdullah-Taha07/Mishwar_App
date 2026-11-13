(()=>{
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={filter:'all',search:''};
  async function load(){
    const r=await fetch('/api/admin/phone-verifications',{cache:'no-store'});
    const d=await r.json();if(!r.ok)throw Error(d.error||'تعذر تحميل حالة التوثيق');return d;
  }
  let lastPayload='';
  window.renderPhoneVerifications=async target=>{
    try{
      const data=await load(),all=data.items||[];if(!target.isConnected)return;const signature=JSON.stringify(data);if(lastPayload===signature&&target.querySelector('#sms-accounts'))return;lastPayload=signature;const viewportScroll=target.scrollTop;
      const counts={verified:all.filter(x=>x.phone_verified_at).length,pending:all.filter(x=>!x.phone_verified_at).length,active:all.filter(x=>!x.phone_verified_at&&x.otp_active).length};
      target.innerHTML=`<section class="panel" style="padding:18px"><h3>مراقبة توثيق SMS — Authentica</h3><p class="info-note">${data.smsConfigured?'يُرسل الرمز إلى جوال الراكب أو الكابتن ويؤكده بنفسه. لا يوجد اعتماد يدوي من واتساب في هذه الصفحة.':'خدمة SMS غير مهيأة؛ راجع إعدادات Authentica على خادم العمليات.'} التوثيق يختلف عن اعتماد مستندات الكابتن في قسم طلبات الكباتن.</p><div class="metrics"><div class="metric"><b>${counts.verified}</b><small>أرقام موثقة</small></div><div class="metric"><b>${counts.pending}</b><small>بانتظار توثيق صاحب الحساب</small></div><div class="metric"><b>${counts.active}</b><small>طلبات رمز SMS ما زالت صالحة</small></div></div><label>بحث بالاسم أو الرقم <input id="sms-query" autocomplete="off" placeholder="بحث في الحسابات" value="${esc(state.search)}"></label><label>الحالة <select id="sms-filter"><option value="all">كل الحسابات</option><option value="verified">تم التوثيق</option><option value="pending">غير موثق</option><option value="active">رمز أُرسل ومفعّل</option></select></label><button type="button" id="sms-refresh" class="primary">تحديث حالة التوثيق</button></section><div id="sms-accounts"></div>`;
      const list=target.querySelector('#sms-accounts'),search=target.querySelector('#sms-query'),filter=target.querySelector('#sms-filter');filter.value=state.filter;
      const draw=()=>{
        const q=state.search.trim().toLowerCase();const items=all.filter(a=>(state.filter==='all'||state.filter==='verified'&&a.phone_verified_at||state.filter==='pending'&&!a.phone_verified_at||state.filter==='active'&&a.otp_active&&!a.phone_verified_at)&&(!q||String(a.name||'').toLowerCase().includes(q)||String(a.phone||'').includes(q)));
        list.innerHTML=items.map(a=>`<article class="panel" style="padding:16px;margin:10px 0"><strong>${esc(a.name)}</strong><p>${a.role==='captain'?'كابتن':'راكب'} · <span dir="ltr">${esc(a.phone)}</span></p><p>${a.phone_verified_at?'✓ موثّق — '+esc(a.verification_method==='authentica_sms'?'SMS Authentica':a.verification_method||'طريقة سابقة'):a.otp_active?'بانتظار إدخال رمز SMS من المستخدم':'لم يُكمل المستخدم توثيق جواله'}</p></article>`).join('')||'<p class="empty">لا توجد حسابات بهذه الحالة.</p>';
      };
      search.oninput=e=>{state.search=e.target.value;draw()};filter.onchange=e=>{state.filter=e.target.value;draw()};target.querySelector('#sms-refresh').onclick=()=>{lastPayload='';window.renderPhoneVerifications(target)};draw();target.scrollTop=viewportScroll;
    }catch(e){target.textContent=e.message}
  };
  setInterval(()=>{const content=document.querySelector('#content'),target=content?.querySelector('#page-data');if(document.hidden||content?.dataset.page!=='phone-verifications'||!target||document.activeElement?.matches('#sms-query,#sms-filter'))return;window.renderPhoneVerifications(target)},6000);
})();
