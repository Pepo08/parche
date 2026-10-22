// SDK 0.137.0: hoy manda 2023-06-01 y funciona; la suba a la 1.0.0 lo rompe.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export function responder(texto: string) {
  return client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 64, temperature: 0, messages: [{ role: 'user', content: texto }] });
}
