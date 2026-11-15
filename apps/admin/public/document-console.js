(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {all:'كل الكباتن',pending:'بانتظار المراجعة',expired:'منتهي الصلاحية',missing:'مستند أو تاريخ ناقص',expiring:'ينتهي خلال ٣٠ يومًا',valid:'ساري لأكثر من ٣٠ يومًا',present:'مرفوع · لا يتطلب تاريخ انتهاء'};
  const decisions = {pending:labels.pending,approved:'معتمد',rejected:'مرفوض'};
  const names = {identity:'الهوية أو الإقامة',license:'رخصة القيادة',registration:'استمارة المركبة',insurance:'تأمين المركبة'};
  const number = n => Number(n || 0).toLocaleString('ar-SA');
  const normalize = v => String(v ?? '').normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).toLocaleLowerCase('ar').trim();
  const stamp = v => !v ? 'غير مسجل' : Number.isNaN(Date.parse(v)) ? esc(v) : esc(new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}));
  const pill = state => `<span class="pill doc-state-${esc(state)}">${esc(labels[state] || decisions[state] || state)}</span>`;
  async function api(path, body) {
    const response = await fetch('/api/admin/launch/'+path, {cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(25000),...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'تعذر تنفيذ العملية');
    return data;
  }
  window.renderDocuments = (initial, target) => {
    let data = initial;
    target.innerHTML = `<section class="panel document-controls" aria-label="بحث وتصفية المستندات"><p class="info-note">العدادات تحسب الكباتن، وقد يظهر الكابتن في أكثر من حالة. طلب التجديد لا يغيّر المستند الحالي حتى اعتماده. الصور الإضافية لا تتطلب تاريخ انتهاء.</p><div class="document-counters"></div><div class="document-filters"><label>بحث بالاسم أو الجوال أو المرجع<input type="search" data-doc-search placeholder="اسم الكابتن أو رقم الجوال" maxlength="100"></label><label>حالة المستندات<select data-doc-filter>${Object.entries(labels).filter(([k])=>k!=='present').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button class="secondary" data-doc-reset>مسح الفلاتر</button></div><p data-doc-result role="status" aria-live="polite"></p><p data-doc-message role="status" aria-live="polite"></p></section><div class="captain-document-list"></div>`;
    const search = target.querySelector('[data-doc-search]'), filter = target.querySelector('[data-doc-filter]'), list = target.querySelector('.captain-document-list');
    const message = target.querySelector('[data-doc-message]');
    function draw() {
      target.querySelector('.document-counters').innerHTML = ['total','pending','expired','missing','expiring','valid'].map(k=>`<div class="document-counter"><span>${k==='total'?'إجمالي الكباتن':labels[k]}</span><strong>${number(data.counters[k])}</strong></div>`).join('');
      const q = normalize(search.value), open = new Set([...list.querySelectorAll('details[open][data-captain]')].map(el=>el.dataset.captain));
      const items = data.items.filter(x=>(filter.value==='all'||x.states.includes(filter.value))&&[x.name,x.phone,x.id,x.reference].some(v=>normalize(v).includes(q)||normalize(v).replace(/[\s()+-]/g,'').includes(q.replace(/[\s()+-]/g,''))));
      target.querySelector('[data-doc-result]').textContent = `${number(items.length)} كابتن من ${number(data.items.length)} · آخر تحديث: ${new Date(data.asOf || Date.now()).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}`;
      list.innerHTML = items.map(x=>`<details class="panel captain-document-card" data-captain="${esc(x.id)}" ${open.has(x.id)?'open':''}><summary><div class="captain-identity"><strong>${esc(x.name || 'كابتن بلا اسم')}</strong><span><bdi dir="ltr">${esc(x.phone)}</bdi> · <bdi dir="ltr">${esc(x.reference)}</bdi></span></div><div class="status-strip">${x.states.map(pill).join('')}</div></summary><h3>المستندات الحالية · ${number(x.documents.length)}</h3><div class="captain-documents">${x.documents.map(d=>`<article class="document-tile"><h4>${esc(d.title)}</h4>${pill(d.state)}${d.pending?pill('pending'):''}<p>تاريخ الانتهاء: <bdi>${d.date?esc(d.date):d.state==='present'?'غير مطلوب':'غير مسجل'}</bdi></p>${d.present?`<a class="document-preview" href="/api/admin/launch/renewals?captain=${encodeURIComponent(x.id)}&amp;kind=${encodeURIComponent(d.kind)}" target="_blank" rel="noopener noreferrer">معاينة المستند ↗</a>`:'<span>لم يُرفع مستند</span>'}</article>`).join('')}</div><h3>طلبات التجديد · ${number(x.renewals.length)}</h3><div class="renewal-list">${x.renewals.map(r=>`<article class="renewal-card"><h4>${esc(names[r.kind] || r.kind)} ${pill(r.status)}</h4><p>الانتهاء الجديد: <bdi>${esc(r.expires_at)}</bdi> · تاريخ الطلب: ${stamp(r.created_at)}</p><a class="document-preview" href="/api/admin/launch/renewals?file=${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">معاينة المستند الجديد ↗</a>${r.status==='pending'?`<form data-renewal="${esc(r.id)}"><label class="document-confirm"><input type="checkbox" name="reviewed">راجعت المستند الجديد وتحققت من البيانات</label><label>ملاحظة المراجعة أو سبب الرفض (٣ أحرف على الأقل عند الرفض)<textarea name="reason" maxlength="500" rows="2"></textarea></label><div class="launch-admin-actions"><button name="decision" value="approved" class="primary">اعتماد التجديد</button><button name="decision" value="rejected" class="danger">رفض التجديد</button></div><p role="alert"></p></form>`:`<p>المراجع: ${esc(r.reviewed_by || 'غير مسجل تاريخيًا')} · ${stamp(r.reviewed_at)}</p><p>الملاحظة: ${esc(r.reason || 'لا توجد ملاحظة')}</p>`}</article>`).join('') || '<p class="empty">لا توجد طلبات تجديد.</p>'}</div><h3>سجل المراجعات · ${number(x.history.length)}</h3><div class="document-history">${x.history.map(h=>`<article><h4>${esc(names[h.kind] || h.kind)} ${pill(h.decision)}</h4><p>المراجع: ${esc(h.reviewer_id)} · ${stamp(h.reviewed_at)}</p><p>الانتهاء السابق: <bdi>${esc(h.previous_expiry || 'غير مسجل')}</bdi> · الانتهاء البديل: <bdi>${esc(h.replacement_expiry)}</bdi></p><p>${esc(h.reason || 'لا توجد ملاحظة')}</p></article>`).join('') || '<p>لا توجد مراجعات مسجلة في سجل المستندات. تظهر القرارات القديمة المتاحة ضمن طلبات التجديد.</p>'}</div></details>`).join('') || '<div class="panel empty">لا توجد نتائج مطابقة. جرّب تغيير البحث أو الحالة.</div>';
      list.querySelectorAll('[data-renewal]').forEach(form => {
        form.onsubmit = async event => {
          event.preventDefault();
          const decision = event.submitter?.value, reason = form.elements.reason.value.trim(), confirmReviewed = form.elements.reviewed.checked;
          const error = form.querySelector('[role=alert]');
          if (!['approved','rejected'].includes(decision)) return;
          if (decision==='approved'&&!confirmReviewed) { error.textContent='أكد مراجعة المستند قبل الاعتماد.'; return; }
          if (decision==='rejected'&&reason.length<3) { error.textContent='اكتب سبب الرفض من ٣ أحرف على الأقل.'; form.elements.reason.focus(); return; }
          const buttons = [...form.querySelectorAll('button')];
          buttons.forEach(b=>b.disabled=true);
          let saved = false;
          try {
            await api('renewals',{id:form.dataset.renewal,decision,reason,confirmReviewed});
            saved = true;
            message.textContent='حُفظ قرار المراجعة.';
            data = await api('documents');
            if (!target.isConnected) return;
            draw();
          } catch (err) {
            error.textContent = saved ? 'حُفظ القرار وتعذر تحديث القائمة. حدّث الصفحة لعرض الحالة الجديدة.' : err.message;
          } finally { if (!saved) buttons.forEach(b=>b.disabled=false); }
        };
      });
    }
    search.oninput=draw;
    filter.onchange=draw;
    target.querySelector('[data-doc-reset]').onclick=()=>{search.value='';filter.value='all';draw();search.focus();};
    draw();
  };
})();
