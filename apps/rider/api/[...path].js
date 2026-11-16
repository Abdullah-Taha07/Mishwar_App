import riderWorker, {canonicalClientIp} from "../worker/index.js";

function sourceIp(req){
  // Vercel overwrites this header at its edge. Outside Vercel trust only the socket.
  const value=process.env.VERCEL==='1'?req.headers?.['x-vercel-forwarded-for']:req.socket?.remoteAddress;
  return canonicalClientIp(typeof value==='string'?value:'');
}

function nodeBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  if (Buffer.isBuffer(req.body) || typeof req.body === "string") return req.body;
  return JSON.stringify(req.body);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      // Platform identity headers are not authenticated on this public Node endpoint.
      if (key.toLowerCase().startsWith("oai-") || /^(cf-|x-forwarded-|x-vercel-|x-real-ip|x-mishwar-)/i.test(key)) continue;
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    const body = nodeBody(req);
    const request = new Request(url, {
      method: req.method || "GET",
      headers,
      ...(body === undefined ? {} : { body, duplex: "half" }),
    });
    const env = {
      HUB_URL: process.env.HUB_URL,
      HUB_ACCESS_TOKEN: process.env.HUB_ACCESS_TOKEN,
      HUB_SERVICE_KEY: process.env.HUB_SERVICE_KEY,
    };
    const response = await riderWorker.fetch(request, env, {trustedClientIp:sourceIp(req)});
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "transfer-encoding") res.setHeader(key, value);
    });
    const payload = Buffer.from(await response.arrayBuffer());
    res.end(payload);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "تعذر إكمال طلب الراكب على الخادم." }));
  }
}
