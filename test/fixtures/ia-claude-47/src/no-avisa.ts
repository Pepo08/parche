// Nada de esto da 400: valores por defecto, modelos anteriores a Claude 4.7, otros proveedores, modelos que no se pueden
// saber y parámetros que no son un número escrito en el código.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const client = new Anthropic();
const openai = new OpenAI();
const model = 'claude-opus-4-7';

export async function porDefecto(texto: string) {
  await client.messages.create({ model: 'claude-opus-4-7', max_tokens: 64, temperature: 1, messages: [{ role: 'user', content: texto }] });
  await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 64, temperature: 1.0, messages: [] });
  await client.messages.create({ model: 'claude-opus-4-8', max_tokens: 64, top_p: 0.99, messages: [] });
  return client.messages.create({ model: 'claude-fable-5', max_tokens: 64, top_p: 1, messages: [] });
}

export async function modelosAnteriores(texto: string) {
  await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 64, temperature: 0.2, messages: [{ role: 'user', content: texto }] });
  await client.messages.create({ model: 'claude-opus-4-6', max_tokens: 64, top_p: 0.5, messages: [] });
  return client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 64, top_k: 40, messages: [] });
}

export async function otrosProveedores(texto: string) {
  await openai.chat.completions.create({ model: 'gpt-5.6-sol', temperature: 0.2, top_p: 0.5, messages: [{ role: 'user', content: texto }] });
  await openai.responses.create({ model: 'gpt-5.6-terra', temperature: 0, input: texto });
  const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({ model: 'gemini-2.5-pro', generationConfig: { temperature: 0.2 } });
  return gemini.generateContent(texto);
}

export async function modeloDesconocido(texto: string, config: { model: string }) {
  await client.messages.create({ model: config.model, max_tokens: 64, temperature: 0.2, messages: [] });
  await client.messages.create({ model: process.env.CLAUDE_MODEL!, max_tokens: 64, temperature: 0.2, messages: [] });
  return client.messages.create({ ...config, max_tokens: 64, temperature: 0.2, messages: [] });
}

// El parámetro `model` tapa a la constante de arriba: acá no se sabe qué modelo llega.
export function conParametro(model: string, texto: string) {
  return client.messages.create({ model, max_tokens: 64, temperature: 0.5, messages: [{ role: 'user', content: texto }] });
}

export function temperaturaVariable(texto: string, opciones: { temperatura: number }) {
  return client.messages.create({ model, max_tokens: 64, temperature: opciones.temperatura, messages: [] });
}

export function comentadoYEnTexto(texto: string) {
  console.log('model: claude-opus-4-7, temperature: 0.2');
  return client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 64,
    // temperature: 0.2,
    /* top_k: 40, */
    messages: [{ role: 'user', content: texto }],
  });
}
