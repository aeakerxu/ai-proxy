// OpenAI 兼容的 Chat Completions 接口：POST /api/v1/chat/completions
// 依赖环境变量：DASHSCOPE_API_KEY（你的通义一串 Key）

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default async function handler(req, res) {
    // --- 自用鉴权 ---
  const clientToken = req.headers["x-access-token"] || req.headers["authorization"];
  const serverToken = process.env.CHAT_ACCESS_TOKEN;

  if (!clientToken || clientToken !== serverToken) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing access token" });
  }

  // 处理 CORS 预检
  if (req.method === "OPTIONS") {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "DASHSCOPE_API_KEY not set in Vercel" });
    }

    // OpenAI 兼容入参
    const {
      model = "qwen-plus",
      messages = [],
      temperature,
      top_p,
      stream
    } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages is required (array)" });
    }

    if (stream === true) {
      // 先做非流式，后面需要我再帮你升级
      return res.status(400).json({ error: "stream is not supported yet" });
    }

    // 转成通义 DashScope 的入参
    const dashBody = {
      model,
      input: { messages }
    };
    if (temperature !== undefined || top_p !== undefined) {
      dashBody.parameters = {};
      if (temperature !== undefined) dashBody.parameters.temperature = temperature;
      if (top_p !== undefined) dashBody.parameters.top_p = top_p;
    }

    // 请求通义
    const upstream = await fetch(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(dashBody)
      }
    );

    const raw = await upstream.json();

    if (!upstream.ok) {
      // 透传通义的错误
      return res.status(upstream.status).json(raw);
    }

    // 把通义的返回，转换成 OpenAI 风格
    const content =
      raw?.output?.text ??
      raw?.output?.choices?.[0]?.message?.content ??
      "";

    const usage = raw?.usage || {};
    const resp = {
      id: raw?.request_id || `chatcmpl_${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          finish_reason: raw?.output?.finish_reason || "stop",
          message: { role: "assistant", content }
        }
      ],
      usage: {
        prompt_tokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
        total_tokens:
          usage?.total_tokens ??
          ((usage?.input_tokens || 0) + (usage?.output_tokens || 0))
      }
    };

    return res.status(200).json(resp);
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
