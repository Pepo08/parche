// Asistente de soporte con el SDK oficial de Anthropic (TypeScript).
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODELO = process.env.CLAUDE_MODEL || 'claude-opus-4-7';
const CREATIVIDAD = 0.3;

export async function responder(pregunta: string) {
  const r = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    temperature: 0.2,
    messages: [{ role: 'user', content: pregunta }],
  });
  return r.content;
}

export function resumir(texto: string) {
  return client.messages.stream({
    model: MODELO,
    max_tokens: 2048,
    top_p: 0.9,
    top_k: 40,
    messages: [{ role: 'user', content: `Resumí: ${texto}` }],
  });
}

export async function clasificar(texto: string) {
  const pedido: Anthropic.MessageCreateParams = {
    model: 'claude-sonnet-5-5',
    max_tokens: 256,
    temperature: CREATIVIDAD,
    messages: [{ role: 'user', content: texto }],
  };
  return client.messages.create(pedido);
}

export async function extraer(texto: string) {
  const params = { model: 'claude-opus-5' as const, max_tokens: 512, temperature: 0, messages: [{ role: 'user' as const, content: texto }] };
  return client.messages.create(params);
}

export async function etiquetar(texto: string) {
  return client.beta.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 128,
    temperature: 1,
    top_p: 0.99,
    messages: [{ role: 'user', content: texto }],
  });
}

export async function rapido(texto: string) {
  return client.messages.create({ model: 'claude-haiku-5-5', max_tokens: 64, top_p: 1, messages: [{ role: 'user', content: texto }] });
}
