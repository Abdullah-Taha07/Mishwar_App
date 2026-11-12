import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "__Host-mishwar_admin";
function validSession(req) {
  const secret = process.env.ADMIN_SESSION_SECRET || "";
  if (secret.length < 32) return false;
  const match = String(req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!match) return false;
  const [payload, signature] = match[1].split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.role === "admin" && Number.isFinite(session.exp) && session.exp > Date.now();
  } catch { return false; }
}
function bodyOf(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  return Buffer.isBuffer(req.body) || typeof req.body === "string" ? req.body : JSON.stringify(req.body);
}
export default async function handler(req, res) {
  if (!validSession(req)) {
    res.status(401).setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({ error: "سجّل دخول الإدارة أولًا." }));
  }
  if (!["GET", "POST"].includes(req.method)) return res.status(405).end();
  if (req.method === "POST" && req.headers.origin !== `https://${req.headers.host}`) {
    return res.status(403).end();
  }
  const hub = (process.env.HUB_URL || "").replace(/\/+$/, "");
  const serviceKey = process.env.ADMIN_SERVICE_KEY || "";
  if (!hub || !serviceKey) {
    res.status(503).setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "اتصال الإدارة بالخادم المركزي غير مهيأ." }));
  }
  try {
    const incoming = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
    const suffix = incoming.pathname.replace(/^\/api\/admin\/?/, "");
    if (!suffix || suffix.includes("..")) return res.status(404).end();
    const target = `${hub}/internal/administration/${suffix}${incoming.search}`;
    const headers = new Headers({
      "x-mishwar-key": serviceKey,
      "Content-Type": req.headers["content-type"] || "application/json",
    });
    const body = bodyOf(req);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      ...(body === undefined ? {} : { body, duplex: "half" }),
      signal: AbortSignal.timeout(25000),
    });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (!["set-cookie", "transfer-encoding", "content-encoding"].includes(key.toLowerCase())) res.setHeader(key, value);
    });
    res.setHeader("Cache-Control", "no-store");
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "تعذر الاتصال بالخادم المركزي." }));
  }
}
