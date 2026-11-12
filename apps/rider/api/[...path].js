import riderWorker from "../worker/index.js";

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
    const response = await riderWorker.fetch(request, env);
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
