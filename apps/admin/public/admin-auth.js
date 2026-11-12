(() => {
  let release;
  window.mishwarAdminAuthReady = new Promise(resolve => { release = resolve; });
  const style = document.createElement("style");
  style.textContent = `
    #mishwar-admin-auth{position:fixed;inset:0;z-index:99999;background:#f4f7f7;display:grid;place-items:center;padding:20px;font-family:Tajawal,Arial,sans-serif}
    #mishwar-admin-auth form{width:min(100%,390px);background:#fff;border:1px solid #dce5e5;border-radius:18px;padding:26px;box-shadow:0 18px 55px #0f33441a}
    #mishwar-admin-auth h1{font-size:22px;margin:0 0 8px;color:#083344}
    #mishwar-admin-auth p{color:#61747a;font-size:14px;line-height:1.8}
    #mishwar-admin-auth input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd5d7;border-radius:10px;font:inherit;margin:8px 0 14px}
    #mishwar-admin-auth button{width:100%;border:0;border-radius:10px;padding:13px;background:#083344;color:white;font:inherit;font-weight:700;cursor:pointer}
    #mishwar-admin-auth [role=alert]{color:#b42318;min-height:24px;font-size:13px}
    #mishwar-admin-logout{border:1px solid #d4dddd;background:#fff;color:#083344;border-radius:9px;padding:8px 12px;cursor:pointer;font:inherit;margin-inline-start:8px}
  `;
  document.head.append(style);
  const gate = document.createElement("section");
  gate.id = "mishwar-admin-auth";
  gate.innerHTML = `<form><h1>دخول إدارة مشوار</h1><p>اللوحة محمية بكلمة مرور خاصة بالإدارة. الجلسة تنتهي تلقائيًا بعد 8 ساعات.</p><label for="mishwar-admin-password">كلمة مرور الإدارة</label><input id="mishwar-admin-password" type="password" autocomplete="current-password" required minlength="16"><div role="alert" aria-live="polite"></div><button type="submit">دخول آمن</button></form>`;
  document.body.append(gate);
  const message = gate.querySelector("[role=alert]");
  async function check() {
    try {
      const r = await fetch("/api/admin-auth/session", { credentials: "same-origin", cache: "no-store" });
      const data = await r.json();
      if (r.ok && data.authenticated) {
        gate.remove();
        release(true);
        addLogout();
        return;
      }
      message.textContent = data.error || "أدخل كلمة مرور الإدارة للمتابعة.";
    } catch { message.textContent = "تعذر الاتصال بخدمة تسجيل الدخول."; }
  }
  function addLogout() {
    const actions = document.querySelector(".header-actions");
    if (!actions || document.getElementById("mishwar-admin-logout")) return;
    const button = document.createElement("button");
    button.id = "mishwar-admin-logout";
    button.type = "button";
    button.textContent = "تسجيل الخروج";
    button.addEventListener("click", async () => {
      await fetch("/api/admin-auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      location.reload();
    });
    actions.append(button);
  }
  gate.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = gate.querySelector("button");
    button.disabled = true;
    message.textContent = "جارٍ التحقق…";
    try {
      const r = await fetch("/api/admin-auth/login", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: gate.querySelector("input").value })
      });
      const data = await r.json();
      if (!r.ok || !data.authenticated) throw new Error(data.error || "تعذر تسجيل الدخول.");
      // A successful password response is not proof that the browser's
      // subsequent requests will be authenticated. Verify the issued cookie.
      const verification = await fetch("/api/admin-auth/session", { credentials: "same-origin", cache: "no-store" });
      const session = await verification.json();
      if (!verification.ok || !session.authenticated) {
        const reasons = {
          cookie_missing: "لم تُحفظ جلسة الدخول في المتصفح.",
          cookie_malformed: "بيانات جلسة الدخول غير مكتملة.",
          signature_invalid: "تعذر التحقق من توقيع الجلسة. راجع توحيد ADMIN_SESSION_SECRET في نشر Vercel.",
          payload_invalid: "بيانات جلسة الدخول غير صالحة.",
          expired: "انتهت صلاحية جلسة الدخول."
        };
        throw new Error(reasons[session.reason] || "لم يتم تأكيد جلسة الإدارة. أعد المحاولة أو راجع إعدادات النشر.");
      }
      gate.remove();
      release(true);
      addLogout();
    } catch (error) { message.textContent = error.message || "تعذر تسجيل الدخول."; }
    finally { button.disabled = false; }
  });
  check();
})();
