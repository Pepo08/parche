// El cliente fija la API version anterior: el repo eligió quedarse en 2023-06-01 para este pedido.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ defaultHeaders: { 'anthropic-version': '2023-06-01' } });

export function creativo(texto: string) {
  return client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 64, temperature: 0.9, messages: [{ role: 'user', content: texto }] });
}
