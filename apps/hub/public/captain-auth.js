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
        let html = '<button type="button" class="text-link" id="captain-pending-back" aria-label="رجوع">→ رجوع</button>';
        html += '<h2>بانتظار توثيق رقم الجوال</h2>';
        html += '<p class="intro">مرحبًا ' + esc(d.profile.name) + '. حسابك محفوظ، أرسل رمز حسابك إلى الإدارة عبر واتساب من رقمك المسجل، ثم انتظر اعتماد التوثيق.</p>';
        html += '<p dir="ltr">' + esc(d.profile.phone) + '</p>';
        html += '<p>رمز التوثيق الخاص بحسابك:</p>';
        html += '<p style="font-size:32px;letter-spacing:6px" dir="ltr">' + esc(d.verificationCode || '') + '</p>';
        html += '<a class="primary" href="https://wa.me/966548000536?text=' + encodeURIComponent('مرحبًا إدارة مشوار، أريد توثيق حساب كابتن.\nالاسم: ' + d.profile.name + '\nالجوال: ' + d.profile.phone + '\nرمز التوثيق: ' + (d.verificationCode || '')) + '" target="_blank" rel="noopener noreferrer">إرسال رمز التوثيق عبر واتساب ↗</a>';
        html += '<p class="intro">أرسل الرسالة من واتساب رقمك المسجل. تعتمد الإدارة الرقم بعد مطابقة الرسالة والرمز.</p>';
        html += '<button class="primary" id="refresh-account">تحديث الحالة</button>';
        html += '<button class="text-link" id="logout-account">تسجيل الخروج</button>';
        
        root().innerHTML = html;

        document.querySelector('#captain-pending-back').onclick = function () { return window.showCaptainWelcome(); };
        document.querySelector('#refresh-account').onclick = function () { location.reload(); };
        document.querySelector('#logout-account').onclick = async function () {
            await api('logout', {});
            location.reload();
        };
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