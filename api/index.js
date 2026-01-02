import { request } from 'undici';

export default async function handler(req, res) {
  const { endpoint } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint' });
  }

  const url = `https://api.example.com/${endpoint}`;

  try {
    const response = await request(url, {
      method: req.method,
      headers: {
        ...req.headers,
        host: undefined,
      },
    });

    const body = await response.body.text();

    res.status(response.statusCode);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    res.send(body);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', detail: err.message });
  }
}
