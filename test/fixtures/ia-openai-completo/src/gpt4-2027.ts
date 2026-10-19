// GPT-4o, GPT-4o mini, GPT-4.1 y GPT-4.1 mini: OpenAI los apaga el 14/1/2027 (sección del 14/10/2026).
import OpenAI from 'openai';

const openai = new OpenAI();

export const resumir = (input: string) => openai.responses.create({ model: 'gpt-4o-2024-08-06', input });
export const traducir = (input: string) => openai.responses.create({ model: "gpt-4o-2024-11-20", input });
export const clasificar = (input: string) => openai.responses.create({ model: 'gpt-4o-mini-2024-07-18', input });
export const redactar = (input: string) => openai.responses.create({ model: `gpt-4.1-2025-04-14`, input });
export const etiquetar = (input: string) => openai.responses.create({ model: 'gpt-4.1-mini-2025-04-14', input });

// Fine-tuned sobre esas bases: se apagan el mismo día. Con el alias solo cuando tiene un único snapshot.
export const soporte = (input: string) => openai.responses.create({ model: 'ft:gpt-4o-2024-08-06:acme:soporte:Aa1Bb2', input });
export const legal = (input: string) => openai.responses.create({ model: 'ft:gpt-4o-2024-11-20:acme::Cc3Dd4', input });
export const ventas = (input: string) => openai.responses.create({ model: 'ft:gpt-4o-mini-2024-07-18:acme:ventas:Ee5Ff6:ckpt-step-300', input });
export const ventasViejo = (input: string) => openai.responses.create({ model: 'ft:gpt-4o-mini:acme::Gg7Hh8', input });
export const contratos = (input: string) => openai.responses.create({ model: 'ft:gpt-4.1-2025-04-14:acme:contratos:Ii9Jj0', input });
export const contratosViejo = (input: string) => openai.responses.create({ model: 'ft:gpt-4.1:acme::Kk1Ll2', input });
export const tickets = (input: string) => openai.responses.create({ model: 'ft:gpt-4.1-mini-2025-04-14:acme::Mm3Nn4', input });
export const ticketsViejo = (input: string) => openai.responses.create({ model: 'ft:gpt-4.1-mini:acme::Oo5Pp6', input });
