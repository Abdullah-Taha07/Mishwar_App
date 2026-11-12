import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "__Host-mishwar_admin";
const MAX_AGE = 8 * 60 * 60;

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
function secretReady() {
  return typeof process.env.ADMIN_SESSION_SECRET === "string" &&
    process.env.ADMIN_SESSION_SECRET.length >= 32 &&
    typeof process.env.ADMIN_LOGIN_PASSWORD === "string" &&
    process.env.ADMIN_LOGIN_PASSWORD.length >= 16;
}
function sign(payload) {
  return createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function inspectCookie(req) {
  const raw = String(req.headers.cookie || "");
  const match = raw.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!match) return { authenticated: false, reason: "cookie_missing" };
  const [payload, signature, extra] = match[1].split(".");
  if (!payload || !signature || extra) return { authenticated: false, reason: "cookie_malformed" };
  if (!safeEqual(sign(payload), signature)) return { authenticated: false, reason: "signature_invalid" };
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.role !== "admin" || !Number.isFinite(session.exp)) return { authenticated: false, reason: "payload_invalid" };
    if (session.exp <= Date.now()) return { authenticated: false, reason: "expired" };
    return { authenticated: true };
  } catch { return { authenticated: false, reason: "payload_invalid" }; }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  return origin === `https://${req.headers.host}`;
}

export default async function handler(req, res) {
  if (!secretReady()) return json(res, 503, { error: "إعداد دخول الإدارة غير مكتمل على Vercel." });
  const action = String(req.query?.action || "");
  if (req.method === "GET" && action === "session") {
    return json(res, 200, inspectCookie(req));
  }
  if (req.method !== "POST" || !sameOrigin(req)) {
    return json(res, 403, { error: "طلب غير مسموح." });
  }
  if (action === "login") {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!safeEqual(password, process.env.ADMIN_LOGIN_PASSWORD)) {
      return json(res, 401, { error: "كلمة المرور غير صحيحة." });
    }
    const payload = Buffer.from(JSON.stringify({ role: "admin", exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
    const value = `${payload}.${sign(payload)}`;
    res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`);
    return json(res, 200, { authenticated: true });
  }
  if (action === "logout") {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return json(res, 200, { authenticated: false });
  }
  return json(res, 404, { error: "المسار غير موجود." });
}
