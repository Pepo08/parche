// HTTP directo con 2023-06-01: con Claude Sonnet 4.6 el parámetro se acepta y la versión no cambia sola.
export async function llamar(texto) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 64, temperature: 0.7, messages: [{ role: 'user', content: texto }] }),
  });
  return res.json();
}
