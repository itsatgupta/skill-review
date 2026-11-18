// Vercel serverless function: proxies the page's AI calls to the Anthropic API.
// The API key stays on the server; the browser never sees it.
const MODELS = {
  quick: process.env.MODEL_QUICK || 'claude-haiku-5-5',
  default: process.env.MODEL_DEFAULT || 'claude-sonnet-5-5',
  complex: process.env.MODEL_COMPLEX || 'claude-opus-5-5',
};
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 400000);

export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === 'GET') return res.status(200).json({ ok: !!key, auth: !!process.env.APP_PASSWORD });
  if (req.method !== 'POST') return res.status(405).json({ code: 'method', message: 'POST only' });
  if (!key) return res.status(503).json({ code: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' });
  if (process.env.APP_PASSWORD && req.headers['x-app-password'] !== process.env.APP_PASSWORD)
    return res.status(401).json({ code: 'not_granted', message: 'Wrong or missing team password.' });

  const { input, modelTier = 'default' } = req.body || {};
  const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  if (!Array.isArray(messages) || !messages.length || messages.at(-1).role !== 'user')
    return res.status(400).json({ code: 'bad_input', message: 'input must be a string or a messages array ending with a user turn.' });
  const size = messages.reduce((a, m) => a + String(m.content || '').length, 0);
  if (size > MAX_INPUT_CHARS) return res.status(413).json({ code: 'too_large', message: `Input is ${size} characters; the limit is ${MAX_INPUT_CHARS}.` });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELS[modelTier] || MODELS.default,
        max_tokens: modelTier === 'complex' ? 16000 : 8000,
        messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) return res.status(429).json({ code: 'rate_limited', message: 'Anthropic rate limit hit. Try again in a minute.' });
    if (!r.ok) return res.status(502).json({ code: 'upstream', message: (j.error && j.error.message) || `Anthropic API error ${r.status}` });
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return res.status(200).json({ text, truncated: j.stop_reason === 'max_tokens', model: j.model, usage: j.usage });
  } catch (e) {
    return res.status(502).json({ code: 'upstream', message: 'Could not reach the Anthropic API: ' + e.message });
  }
}
