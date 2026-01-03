// OpenAI 兼容 Chat Completions，永远使用 stream=true 的 SSE（真流式）
// 依赖环境变量：DASHSCOPE_API_KEY（通义 Key）
// 自用鉴权：请求头 X-Access-Token 必须等于 CHAT_ACCESS_TOKEN

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Access-Token"
};

export default async function handler(req, res) {
  // 处理 CORS 预检
  if (req.method === "OPTIONS") {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  // --- 自用鉴权 ---
  const clientToken = req.headers["x-access-token"] || req.headers["authorization"];
  const serverToken = process.env.CHAT_ACCESS_TOKEN;
  if (!serverToken || !clientToken || clientToken !== serverToken) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing access token" });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "DASHSCOPE_API_KEY not set in Vercel" });
  }

  // 请求体（model / messages / temperature 等）原样转发
  const body = req.body || {};
  const dashUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  // 永远使用流式
  const upstreamBody = {
    ...body,
    stream: true
  };

  try {
    const upstream = await fetch(dashUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        // 通义流式是 SSE
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(upstreamBody)
    });

    // 下游也用 SSE
    res.writeHead(upstream.status, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      ...CORS_HEADERS
    });

    if (!upstream.body) {
      res.write(`data: ${JSON.stringify({ error: "No body from DashScope" })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    // 把上游 SSE 数据原样转发给浏览器
    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        // value 是 Uint8Array，直接写到下游
        res.write(Buffer.from(value));
      }
    }

    res.end();
  } catch (e) {
    // 出错时也用 SSE 的形式把错误发给前端
    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        ...CORS_HEADERS
      });
      res.write(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      res.status(500).json({ error: e?.message || String(e) });
    }
  }
}
