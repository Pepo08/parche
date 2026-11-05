// Nada de esto figura con fecha en la página de deprecaciones de OpenAI: Parche no tiene que avisar.
import OpenAI from 'openai';

const openai = new OpenAI();

// gpt-4o tiene tres snapshots que se apagan en fechas distintas: un fine-tuned sobre el alias es ambiguo.
export const e = () => openai.responses.create({ model: 'ft:gpt-4o:acme::Qq7Rr8', input: 'hola' });

// Los reemplazos que recomienda OpenAI empiezan igual que modelos retirados, pero son otros.
export const g = () => openai.responses.create({ model: 'gpt-realtime-2.1', input: 'hola' });
export const h = () => openai.responses.create({ model: 'gpt-realtime-2.1-mini', input: 'hola' });
export const i = () => openai.responses.create({ model: 'gpt-realtime-1.5', input: 'hola' });
export const j = () => openai.responses.create({ model: 'gpt-audio-1.5', input: 'hola' });
export const k = () => openai.images.generate({ model: 'gpt-image-2.5-sunburst', prompt: 'hola' });
export const l = () => openai.responses.create({ model: 'gpt-6-luna', input: 'hola' });
export const m = () => openai.responses.create({ model: 'gpt-6-sol', input: 'hola' });
export const n = () => openai.audio.transcriptions.create({ model: 'gpt-transcribe', file: null });
export const o = () => openai.audio.transcriptions.create({ model: 'gpt-live-transcribe', file: null });

// El endpoint nuevo de traducciones y un tipo de herramienta que no es un modelo.
export const p = () => fetch('https://api.openai.com/v1/realtime/translations', { method: 'POST' });
export const q = () => openai.responses.create({ model: 'gpt-6-sol', tools: [{ type: 'computer_use_preview' }], input: 'hola' });
