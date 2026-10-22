// SDK de TypeScript 1.0.0: manda la API version 2026-10-21, donde los tres parámetros dan 400 con cualquier modelo.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function responder(texto: string) {
  await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 64, temperature: 0.2, messages: [{ role: 'user', content: texto }] });
  await client.messages.create({ model: 'claude-opus-4-7', max_tokens: 64, temperature: 1, messages: [] });
  await client.messages.create({ model: 'claude-opus-4-7', max_tokens: 64, top_k: 5, messages: [] });
  await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 64, temperature: undefined, messages: [] });
  return client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 64, messages: [] });
}
