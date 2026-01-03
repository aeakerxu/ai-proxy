// OpenAI 兼容 Chat Completions，支持 stream=true 的 SSE（服务端推送）
// 依赖环境变量：DASHSCOPE_API_KEY（通义的一串 Key）
// 保留自用鉴权：请求头 X-Access-Token 必须等于 CHAT_ACCESS_TOKEN

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Access-Token"
};

export default async function handler(req, res) {
  // CORS 预检
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
      stream = false
    } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages is required (array)" });
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

    // 请求通义（此步先用非流式拿到完整文本；下一步再接“上游流式”）
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
      return res.status(upstream.status).json(raw);
    }

    // 统一提取文本与使用量
    const fullText =
      raw?.output?.text ??
      raw?.output?.choices?.[0]?.message?.content ??
      "";

    const usage = raw?.usage || {};
    const usageObj = {
      prompt_tokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
      total_tokens:
        usage?.total_tokens ??
        ((usage?.input_tokens || 0) + (usage?.output_tokens || 0))
    };

    if (!stream) {
      // 一次性返回 OpenAI 兼容响应
      const resp = {
        id: raw?.request_id || `chatcmpl_${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            finish_reason: raw?.output?.finish_reason || "stop",
            message: { role: "assistant", content: fullText }
          }
        ],
        usage: usageObj
      };
      return res.status(200).json(resp);
    }

    // ===== stream === true：SSE =====
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      ...CORS_HEADERS
    });

    // 工具：写一条 SSE 数据
    const send = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    // OpenAI SSE 规范：先发一个框架消息（可选）
    send({
      id: raw?.request_id || `chatcmpl_${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
    });

    // 将完整文本切片逐段发送（把“管线打通”，体验接近真流式）
    const chunkSize = 40; // 每块字数，可按需调整
    for (let i = 0; i < fullText.length; i += chunkSize) {
      const piece = fullText.slice(i, i + chunkSize);
      send({
        id: raw?.request_id || `chatcmpl_${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }]
      });
    }

    // 收尾：发送停用标记，再附加 usage
    send({
      id: raw?.request_id || `chatcmpl_${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: usageObj
    });

    // OpenAI 风格结尾
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    try {
      // 若是流式已开始，按 SSE 错误格式返回
      res.write(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
}
