import { riderSession, tokenHash } from "./rider-auth.js";
import { secretMatches } from "./operations.js";

const bj = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

export function allowedPush(endpoint) {
  try {
    const u = new URL(endpoint);
    return (
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      u.href.length < 2000 &&
      ([
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(u.hostname) ||
        u.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}

export async function pushAuthorization(env, endpoint) {
  const enc = (s) => new TextEncoder().encode(s);

  const header = base64url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));

  const claims = base64url(
    enc(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 43200,
        sub: env.VAPID_SUBJECT,
      }),
    ),
  );

  const input = header + "." + claims;

  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc(input),
  );

  return (
    "vapid t=" +
    input +
    "." +
    base64url(signature) +
    ", k=" +
    env.VAPID_PUBLIC_KEY
  );
}

export async function sendSignal(env, row) {
  if (
    !allowedPush(row.endpoint) ||
    !env.VAPID_PRIVATE_JWK ||
    !env.VAPID_PUBLIC_KEY
  )
    return;

  try {
    const response = await fetch(row.endpoint, {
      method: "POST",
      headers: {
        Authorization: await pushAuthorization(env, row.endpoint),
        TTL: "90",
        Urgency: "high",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });

    if ([404, 410].includes(response.status)) {
      await env.DB.prepare(
        "DELETE FROM push_subscriptions WHERE endpoint_hash=?",
      )
        .bind(row.endpoint_hash)
        .run();
    }
  } catch {}
}

export async function notifyAccount(env, role, actor, title, body, url, ctx) {
  await env.DB.prepare(
    `INSERT INTO app_notifications
     (id,role,actor_id,title,body,url,created_at)
     VALUES(?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      role,
      actor,
      title,
      body,
      url,
      new Date().toISOString(),
    )
    .run();

  const subscriptions = (
    await env.DB.prepare(
      `SELECT endpoint_hash,endpoint
       FROM push_subscriptions
       WHERE role=? AND actor_id=?
       LIMIT 5`,
    )
      .bind(role, actor)
      .all()
  ).results;

  const job = Promise.allSettled(subscriptions.map((s) => sendSignal(env, s)));

  if (ctx?.waitUntil) ctx.waitUntil(job);
  else await job;
}

export async function notifyAvailable(env, tripId, ctx) {
  const rows = (
    await env.DB.prepare(
      `SELECT a.id
       FROM captain_applications a
       JOIN captain_presence p
         ON p.application_id=a.id
       WHERE a.status='active'
         AND p.available=1
         AND NOT EXISTS(
           SELECT 1 FROM account_controls c
           WHERE c.role='captain'
             AND c.account_id=a.id
             AND c.suspended=1
         )
         AND NOT EXISTS(
           SELECT 1 FROM trips t
           WHERE t.driver_id=a.id
             AND t.status IN ('arriving','arrived','riding')
         )
         AND EXISTS(
           SELECT 1
           FROM trip_commerce tc
           JOIN ride_quotes q ON q.id=tc.quote_id
           WHERE tc.trip_id=?
             AND EXISTS(
               SELECT 1
               FROM json_each(
                 COALESCE(
                   (
                     SELECT value FROM platform_settings
                     WHERE key='captain_categories:'||a.id
                   ),
                   '["economy"]'
                 )
               )
               WHERE value=q.category
             )
         )
       LIMIT 100`,
    )
      .bind(tripId)
      .all()
  ).results;

  const job = Promise.allSettled(
    rows.map((r) =>
      notifyAccount(
        env,
        "captain",
        r.id,
        "طلب مشوار جديد",
        "افتح كابتن مشوار لعرض الطلب وقبوله.",
        "/dashboard",
        ctx,
      ),
    ),
  );

  if (ctx?.waitUntil) ctx.waitUntil(job);
  else await job;
}

export async function backgroundFor(
  request,
  env,
  role,
  actor,
  sessionHash = null,
) {
  let b = { action: "latest" };

  if (request.method === "POST") {
    try {
      b = await request.json();
    } catch {
      return bj({ error: "بيانات غير صالحة" }, 400);
    }
  } else {
    b.action = new URL(request.url).searchParams.get("action") || "latest";
  }

  if (b.action === "config") {
    return bj({
      publicKey: env.VAPID_PUBLIC_KEY || null,
      configured: !!(
        env.VAPID_PUBLIC_KEY &&
        env.VAPID_PRIVATE_JWK &&
        env.VAPID_SUBJECT
      ),
    });
  }

  if (b.action === "register") {
    const endpoint = b.subscription?.endpoint;

    if (!allowedPush(endpoint)) {
      return bj({ error: "خدمة إشعارات غير مدعومة" }, 400);
    }

    const hash = await tokenHash(endpoint);

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM push_subscriptions
       WHERE role=? AND actor_id=?`,
    )
      .bind(role, actor)
      .first();

    const existing = await env.DB.prepare(
      `SELECT endpoint_hash
       FROM push_subscriptions
       WHERE endpoint_hash=?`,
    )
      .bind(hash)
      .first();

    if (count.n >= 5 && !existing) {
      return bj({ error: "وصلت لحد الأجهزة المسجلة" }, 400);
    }

    await env.DB.prepare(
      `INSERT INTO push_subscriptions
       (endpoint_hash,endpoint,role,actor_id,session_hash,created_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(endpoint_hash)
       DO UPDATE SET
         role=excluded.role,
         actor_id=excluded.actor_id,
         session_hash=excluded.session_hash`,
    )
      .bind(hash, endpoint, role, actor, sessionHash, new Date().toISOString())
      .run();

    return bj({ ok: true });
  }

  if (b.action === "unregister") {
    const hash = await tokenHash(String(b.endpoint || ""));

    await env.DB.prepare(
      `DELETE FROM push_subscriptions
       WHERE endpoint_hash=? AND role=? AND actor_id=?`,
    )
      .bind(hash, role, actor)
      .run();

    return bj({ ok: true });
  }

  if (b.action === "latest") {
    const rows = (
      await env.DB.prepare(
        `SELECT id,title,body,url
         FROM app_notifications
         WHERE role=?
           AND actor_id=?
           AND read_at IS NULL
           AND created_at>?
         ORDER BY created_at DESC
         LIMIT 5`,
      )
        .bind(role, actor, new Date(Date.now() - 3600000).toISOString())
        .all()
    ).results;

    return bj({ notifications: rows });
  }

  if (b.action === "ack") {
    const ids = Array.isArray(b.ids) ? b.ids.slice(0, 5) : [];

    if (ids.length) {
      await env.DB.batch(
        ids.map((id) =>
          env.DB.prepare(
            `UPDATE app_notifications
             SET read_at=?
             WHERE id=? AND role=? AND actor_id=?`,
          ).bind(new Date().toISOString(), String(id), role, actor),
        ),
      );
    }

    return bj({ ok: true });
  }

  return bj({ error: "عملية غير معروفة" }, 400);
}

export async function handleCaptainBackground(request, env) {
  const user = request.headers.get("oai-authenticated-user-id");

  if (!user) {
    return bj({ error: "سجل الدخول" }, 401);
  }

  const allowedOrigins = [
    new URL(request.url).origin,
    "https://mishwar-captain.vercel.app",
  ];

  if (
    request.method === "POST" &&
    !allowedOrigins.includes(request.headers.get("origin"))
  ) {
    return bj({ error: "غير مسموح" }, 403);
  }

  const app = await env.DB.prepare(
    `SELECT id
     FROM captain_applications
     WHERE user_id=? AND status='active'`,
  )
    .bind(user)
    .first();

  if (!app) {
    return bj({ error: "الحساب غير مفعّل" }, 403);
  }

  return backgroundFor(request, env, "captain", app.id);
}

export async function handleRiderBackground(request, env) {
  if (
    !(await secretMatches(
      request.headers.get("x-mishwar-key"),
      env.RIDER_SERVICE_KEY,
    ))
  ) {
    return bj({ error: "غير مسموح" }, 403);
  }

  let b;

  try {
    b = await request.json();
  } catch {
    return bj({ error: "بيانات غير صالحة" }, 400);
  }

  const session = await riderSession(env, b.sessionToken);

  if (!session) {
    return bj({ error: "فعّل رقمك أولًا" }, 401);
  }

  const inner = new Request(new URL("/background", request.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(b),
  });

  return backgroundFor(
    inner,
    env,
    "rider",
    "rider:" + session.actor,
    session.tokenHash,
  );
}
