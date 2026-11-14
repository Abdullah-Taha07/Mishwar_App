// @ts-nocheck
(function () {
    const root = function () { return document.querySelector('#app'); };
    
    const esc = function (s) {
        if (s === undefined || s === null) return '';
        return String(s)
            .split('&').join('&')
            .split('<').join('<')
            .split('>').join('>')
            .split('"').join('"')
            .split("'").join('');
    };

    async function api(action, body) {
        const options = { credentials: 'same-origin' };
        if (body) {
            options.method = 'POST';
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }
        let r;
        try {
            const requestOptions = { ...options, cache: 'no-store' };
            if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') requestOptions.signal = AbortSignal.timeout(12000);
            r = await fetch('/api/auth/' + action, requestOptions);
        } catch (error) {
            throw Error(error?.name === 'TimeoutError' || error?.name === 'AbortError'
                ? 'استغرق الاتصال بالخادم وقتًا طويلًا. تحقق من الشبكة ثم أعد المحاولة.'
                : 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.');
        }
        let d;
        try { d = await r.json(); }
        catch { throw Error('الخادم أعاد استجابة غير صالحة. تحقق من تحديث Vercel واتصال Cloudflare.'); }
        if (!r.ok) throw Error(d.error || 'تعذر تسجيل الدخول');
        return d;
    }

    function form(register) {
        register = register || false;
        // A previously used device must still allow a different captain to register.
        
        let html = '<button type="button" class="text-link" id="captain-account-back" aria-label="رجوع">→ رجوع</button>';
        html += '<span class="kicker">كابتن مشوار</span>';
        html += '<h2>' + (register ? 'إنشاء حساب كابتن' : 'تسجيل الدخول') + '</h2>';
        html += '<p class="intro">' + (register ? 'حساب واحد لكل كابتن. بعد توثيق رقمك تكمل المراحل الثلاث: بياناتك الشخصية، بيانات المركبة، ثم المستندات.' : 'ادخل برقمك وكلمة مرورك لمتابعة الطلب أو استقبال الرحلات بعد التفعيل.') + '</p>';
        html += '<form id="captain-account" class="form-grid">';
        
        if (register) {
            html += '<div class="field wide"><label>البريد الإلكتروني</label><input name="email" type="email" dir="ltr" maxlength="150" autocomplete="email" required></div>';
            html += '<div class="field wide"><label>الاسم الكامل</label><input name="name" required minlength="3" maxlength="100" autocomplete="name"></div>';
        }
        
        html += '<div class="field wide"><label>رقم الجوال السعودي</label><input name="phone" type="tel" required dir="ltr" autocomplete="tel" placeholder="05XXXXXXXX"></div>';
        html += '<div class="field wide"><label>كلمة المرور — ٦ خانات فأكثر</label><input name="password" type="password" required minlength="6" maxlength="128" autocomplete="' + (register ? 'new-password' : 'current-password') + '"></div>';
        html += '<p id="account-error" role="alert"></p>';
        html += '<button class="primary wide">' + (register ? 'إنشاء الحساب' : 'تسجيل الدخول') + '</button>';
        html += '</form>';
        html += '<button class="recovery-link" data-account-recovery>نسيت كلمة المرور؟ استعادة حسابي</button>';
        
        html += '<button type="button" class="text-link" id="switch-account">' + (register ? 'لدي حساب بالفعل' : 'تسجيل كابتن جديد') + '</button>';
        
        root().innerHTML = html;

        document.querySelector('#captain-account-back').onclick = function () {
            return register ? form(false) : window.showCaptainWelcome();
        };
        
        const switchBtn = document.querySelector('#switch-account');
        if (switchBtn) {
            switchBtn.addEventListener('click', function () { form(!register); });
        }
        
        document.querySelector('#captain-account').onsubmit = async function (e) {
            e.preventDefault();
            const b = e.target.querySelector('button');
            b.disabled = true;
            try {
                await api(register ? 'register' : 'password-login', Object.fromEntries(new FormData(e.target)));
                const confirmed=await api('session');
                if(!confirmed.authenticated)throw Error('الجهاز لم يحتفظ بجلسة الدخول. افتح الموقع في Safari ثم أعد تسجيل الدخول.');
                try{sessionStorage.removeItem('mishwar-captain-last-dashboard-hop')}catch{}
                location.replace('/launch');
            } catch (err) {
                document.querySelector('#account-error').textContent = err.message;
                b.disabled = false;
            }
        };
    }

    function cooldownOtp(button, seconds=60) {
        let left=Math.max(1,Math.min(300,Number(seconds)||60));
        const original=button.textContent;
        button.disabled=true;
        const tick=()=>{
            if(!button.isConnected){clearInterval(timer);return}
            button.textContent='إعادة الإرسال بعد '+left+' ثانية';
            if(left--<=0){clearInterval(timer);button.disabled=false;button.textContent=original}
        };
        const timer=setInterval(tick,1000);tick();
    }

    let captainVerificationTimer=null;
    function pollCaptainVerification(){
        if(captainVerificationTimer)clearInterval(captainVerificationTimer);
        captainVerificationTimer=setInterval(async()=>{
            if(document.hidden||!document.querySelector('#captain-otp-form'))return;
            try{const status=await api('session');if(status.authenticated&&status.phoneVerified){clearInterval(captainVerificationTimer);captainVerificationTimer=null;window.dispatchEvent(new Event('mishwar-captain-verified'));}}
            catch(error){console.warn('Verification synchronization delayed',error?.message||error)}
        },6000);
    }
    function pending(d) {
        const sms = d.smsConfigured === true;
        let html = '<button type="button" class="text-link" id="captain-pending-back">→ رجوع</button>';
        html += '<h2>توثيق رقم الجوال</h2><p class="intro">مرحبًا ' + esc(d.profile.name) + '، وثّق رقمك لاستكمال التسجيل.</p>';
        html += '<p dir="ltr">' + esc(d.profile.phone) + '</p>';
        if (sms) {
            html += '<button type="button" class="primary" id="captain-send-otp">إرسال رمز SMS</button>';
            html += '<form id="captain-otp-form" class="form-grid"><div class="field wide"><label>رمز التحقق</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" required dir="ltr"></div><button class="primary wide">تأكيد الرمز</button></form>';
            html += '<p id="captain-otp-status" role="status"></p>';
        } else {
            html += '<p>خدمة الرسائل غير مهيأة حاليًا. تواصل مع الإدارة للتحقق اليدوي.</p>';
        }
        html += '<button class="primary" id="refresh-account">تحديث الحالة</button><button class="text-link" id="logout-account">تسجيل الخروج</button>';
        root().innerHTML = html;
        document.querySelector('#captain-pending-back').onclick = () => window.showCaptainWelcome();
        if(sms){
            pollCaptainVerification();
            const status = document.querySelector('#captain-otp-status');
            document.querySelector('#captain-send-otp').onclick = async e => {
                const button = e.currentTarget;
                button.disabled = true;
                try {
                    const result = await api('phone-otp-start',{});
                    if (!button.isConnected) return;
                    const notice = document.querySelector('#captain-otp-status');
                    if (notice) notice.textContent = result.alreadyVerified ? 'رقمك موثّق بالفعل.' : 'تم طلب إرسال الرمز. افحص رسائلك.';
                    if (result.alreadyVerified) { window.dispatchEvent(new Event('mishwar-captain-verified')); return; }
                    cooldownOtp(button,result.retryAfter||60);
                } catch(err) {
                    const notice = document.querySelector('#captain-otp-status');
                    if (notice) notice.textContent = err.message;
                    if (button.isConnected) button.disabled = false;
                }
            };
            document.querySelector('#captain-otp-form').onsubmit = async e => {
                e.preventDefault();
                const form = e.currentTarget;
                const btn = form.querySelector('button');
                const code = form.elements.namedItem('code').value;
                btn.disabled = true;
                try { await api('phone-otp-check',{code}); window.dispatchEvent(new Event('mishwar-captain-verified')); }
                catch(err) {
                    const notice = document.querySelector('#captain-otp-status');
                    if (notice) notice.textContent = err.message;
                    if (btn.isConnected) btn.disabled = false;
                }
            };
        }
        document.querySelector('#refresh-account').onclick = () => location.reload();
        document.querySelector('#logout-account').onclick = async () => {try{await api('logout',{});window.captainAccount=null;try{sessionStorage.removeItem('mishwar-captain-last-dashboard-hop')}catch{};location.replace('/launch?login=1#login')}catch(e){const rootElement=root();rootElement.querySelector('#captain-otp-status')?.replaceChildren(document.createTextNode(e.message));alert(e.message)}};
    }

    window.showCaptainWelcome = function () {
        root().innerHTML = '<span class="kicker">كابتن مشوار</span><h2>كل طريق، فرصة جديدة</h2><p class="intro">أهلًا بك في مشوار. تابع حسابك وطلباتك من مكان واحد.</p><button class="primary" id="captain-enter">متابعة حسابي</button><a class="text-link" href="/launch?login=1#login">تسجيل الدخول</a><a class="text-link" href="/install.html">تنزيل وتثبيت التطبيق</a>';
        document.querySelector('#captain-enter').onclick = function () { form(false); };
    };

    window.ensureCaptainAccount = async function () {
        try {
            const params = new URLSearchParams(location.search);
            if (params.get('login') === '1' || location.hash === '#login') { form(false); return false; }
            if (location.hash === '#register') { form(true); return false; }
            const d = await api('session');
            if (!d.authenticated) { form(); return false; }
            if (!d.phoneVerified) { pending(d); return false; }
            if (d.application) {
                localStorage.setItem('mishwar-captain-registered', 'yes');
                if (d.application.status === 'active') {
                    const key='mishwar-captain-last-dashboard-hop';
                    let recent=0;
                    try{recent=Number(sessionStorage.getItem(key))||0}catch{}
                    if(Date.now()-recent<20000){
                        form(false);
                        document.querySelector('#account-error').textContent='تم إيقاف تحويل متكرر إلى لوحة الكابتن. جرّب تسجيل الدخول من هنا، وإذا استمرت المشكلة افتح الرابط في Safari مباشرة.';
                        return false;
                    }
                    try{
                        const options={method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'watch'})};
                        if(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function')options.signal=AbortSignal.timeout(10000);
                        const check=await fetch('/api/driver',options);
                        if(!check.ok){
                            form(false);
                            document.querySelector('#account-error').textContent=check.status===401||check.status===403?'جلسة الكابتن غير صالحة للوحة التشغيل. سجّل الدخول من جديد.':'تعذر الاتصال بلوحة التشغيل. حاول تسجيل الدخول مجددًا.';
                            return false;
                        }
                    }catch(e){
                        form(false);
                        document.querySelector('#account-error').textContent='تعذر الوصول إلى لوحة التشغيل. تحقق من الاتصال وأعد المحاولة.';
                        return false;
                    }
                    try{sessionStorage.setItem(key,String(Date.now()))}catch{}
                    location.replace('/dashboard');
                    return false;
                }
            }
            window.captainAccount = d;
            return true;
        } catch (err) {
            root().innerHTML = '<p class="error-banner">' + esc(err.message) + '</p>';
            return false;
        }
    };
})();