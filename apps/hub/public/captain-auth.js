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
        const r = await fetch('/api/auth/' + action, options);
        const d = await r.json();
        if (!r.ok) throw Error(d.error || 'تعذر تسجيل الدخول');
        return d;
    }

    function form(register) {
        register = register || false;
        const known = localStorage.getItem('mishwar-captain-registered') === 'yes';
        
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
        
        if (!known || register) {
            html += '<button class="text-link" id="switch-account">' + (register ? 'لدي حساب بالفعل' : 'تسجيل كابتن جديد') + '</button>';
        }
        
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
                location.reload();
            } catch (err) {
                document.querySelector('#account-error').textContent = err.message;
                b.disabled = false;
            }
        };
    }

    function pending(d) {
        const sms = d.smsConfigured === true;
        let html = '<button type="button" class="text-link" id="captain-pending-back">→ رجوع</button>';
        html += '<h2>توثيق رقم الجوال</h2><p class="intro">مرحبًا ' + esc(d.profile.name) + '، وثّق رقمك لاستكمال التسجيل.</p>';
        html += '<p dir="ltr">' + esc(d.profile.phone) + '</p>';
        if (sms) {
            html += '<button type="button" class="primary" id="captain-send-otp">إرسال رمز SMS</button>';
            html += '<form id="captain-otp-form" class="form-grid"><div class="field wide"><label>رمز التحقق</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required dir="ltr"></div><button class="primary wide">تأكيد الرمز</button></form>';
            html += '<p id="captain-otp-status" role="status"></p>';
        } else {
            html += '<p>خدمة الرسائل غير مهيأة حاليًا. تواصل مع الإدارة للتحقق اليدوي.</p>';
        }
        html += '<button class="primary" id="refresh-account">تحديث الحالة</button><button class="text-link" id="logout-account">تسجيل الخروج</button>';
        root().innerHTML = html;
        document.querySelector('#captain-pending-back').onclick = () => window.showCaptainWelcome();
        if(sms){
            const status = document.querySelector('#captain-otp-status');
            document.querySelector('#captain-send-otp').onclick = async e => {e.currentTarget.disabled=true;try{await api('phone-otp-start',{});status.textContent='تم طلب إرسال الرمز. افحص رسائلك.'}catch(err){status.textContent=err.message}finally{e.currentTarget.disabled=false}};
            document.querySelector('#captain-otp-form').onsubmit = async e => {e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{await api('phone-otp-check',{code:e.target.code.value});location.reload()}catch(err){status.textContent=err.message;btn.disabled=false}};
        }
        document.querySelector('#refresh-account').onclick = () => location.reload();
        document.querySelector('#logout-account').onclick = async () => {await api('logout',{});location.reload()};
    }

    window.showCaptainWelcome = function () {
        root().innerHTML = '<span class="kicker">كابتن مشوار</span><h2>كل طريق، فرصة جديدة</h2><p class="intro">أهلًا بك في مشوار. تابع حسابك وطلباتك من مكان واحد.</p><button class="primary" id="captain-enter">متابعة حسابي</button><a class="text-link" href="/install.html">تنزيل وتثبيت التطبيق</a>';
        document.querySelector('#captain-enter').onclick = function () { location.reload(); };
    };

    window.ensureCaptainAccount = async function () {
        try {
            const d = await api('session');
            if (!d.authenticated) { form(); return false; }
            if (!d.phoneVerified) { pending(d); return false; }
            if (d.application) {
                localStorage.setItem('mishwar-captain-registered', 'yes');
                if (d.application.status === 'active') { location.replace('/dashboard'); return false; }
            }
            window.captainAccount = d;
            return true;
        } catch (err) {
            root().innerHTML = '<p class="error-banner">' + esc(err.message) + '</p>';
            return false;
        }
    };
})();