// La llamada al modelo del nivel 2 (0.9.0), con el SDK oficial de Anthropic y la clave del cliente
// (`ANTHROPIC_API_KEY`, un secret de su repo). Sin herramientas: el modelo solo devuelve texto (un diff), nunca corre
// nada. El SDK es una dependencia opcional (13 MB): la Action lo instala solo con `ai-upgrades: 'true'`, y se carga
// recién acá; si no está, el error dice cómo instalarlo.
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const SDK = '@anthropic-ai/sdk';
export const SDK_MISSING = `El nivel 2 necesita el SDK de Anthropic (\`${SDK}\`), que es una dependencia opcional de Parche y no está `
  + `instalado. Instalalo con \`npm install ${SDK}@~0.133.0\` o, en la Action, prendé \`ai-upgrades: 'true'\`, que lo instala solo.`;

export async function loadSdk(load = () => import(SDK)) {
  try {
    return (await load()).default;
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') throw new Error(SDK_MISSING);
    throw err;
  }
}

// Los modelos con los que van `effort` y la vuelta a otro modelo si el primero declina el pedido (`fallbacks`). Con
// otro modelo configurado, el pedido sale sin esos dos campos.
const CURRENT = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

// → { text, model, stopReason, usage }. `client` es para los tests (un cliente falso, sin red).
export async function askModel({ system, user, model = DEFAULT_MODEL, apiKey = process.env.ANTHROPIC_API_KEY, client } = {}) {
  let c = client;
  if (!c) {
    if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY: el nivel 2 usa la clave del cliente (en GitHub Actions, un secret del repo pasado en el input `anthropic-api-key`).');
    const Anthropic = await loadSdk();
    c = new Anthropic({ apiKey });
  }
  const current = CURRENT.has(model);
  // Streaming: la respuesta puede ser larga, y así no corta por tiempo.
  const stream = c.beta.messages.stream({
    model,
    max_tokens: 32000,
    system,
    messages: [{ role: 'user', content: user }],
    ...(current ? { output_config: { effort: 'high' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new Error(`El modelo no quiso hacer el cambio${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`);
  if (message.stop_reason === 'max_tokens') throw new Error('La respuesta del modelo se cortó antes de terminar (max_tokens).');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, model: message.model, stopReason: message.stop_reason, usage: message.usage };
}
