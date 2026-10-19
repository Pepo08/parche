// Nada de esto se apaga el 23/10/2026: Parche no tiene que avisar.
import OpenAI from 'openai';

const openai = new OpenAI();

// Fine-tuned cuyo modelo base empieza igual que uno retirado (gpt-4, gpt-4.1-nano), pero es otro modelo.
export const a = () => openai.responses.create({ model: 'ft:gpt-4o-mini-2024-07-18:acme::Aa1Bb2', input: 'hola' });
export const b = () => openai.responses.create({ model: 'ft:gpt-4o-2024-08-06:acme:resumen:Cc3Dd4', input: 'hola' });
export const c = () => openai.responses.create({ model: 'ft:gpt-4.1-mini-2025-04-14:acme::Ee5Ff6', input: 'hola' });
export const d = () => openai.responses.create({ model: 'ft:gpt-4.1-2025-04-14:acme::Gg7Hh8', input: 'hola' });

// "ft-gpt-4" es como lo nombra la página de OpenAI, no un ID que se pueda llamar; y "ft:gpt-4" sin el resto tampoco.
export const ETIQUETAS = { 'ft-gpt-4': 'nombre de la tabla', 'ft:gpt-4': 'incompleto' };

// Un modelo vigente y un nombre propio que contiene un ID retirado, pero no es ese ID.
export const e = () => openai.chat.completions.create({ model: 'gpt-4o', messages: [] });
export const f = () => openai.chat.completions.create({ model: 'gpt-4.1-nano-completions-proxy', messages: [] });
