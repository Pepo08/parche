// Rango sin tope y sin lockfile: una instalación nueva trae la 1.0.0.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export function responder(texto) {
  return client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 64, temperature: 0.4, messages: [{ role: 'user', content: texto }] });
}
