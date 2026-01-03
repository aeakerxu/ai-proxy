export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      tip: "Use POST https://api.awaker.top/api with JSON body"
    });
  }

  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "DASHSCOPE_API_KEY not found in environment variables"
      });
    }

    const upstream = await fetch(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(req.body)
      }
    );

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    return res.status(500).json({
      error: err.message || String(err)
    });
  }
}
