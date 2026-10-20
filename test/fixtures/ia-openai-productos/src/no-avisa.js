// Nada de esto es de OpenAI: Parche no tiene que avisar.

// Otra librería con un cliente que también tiene `evals` (el archivo no usa el SDK ni el host de OpenAI).
import { Client } from '@acme/llm-observability';

const acme = new Client();
export const crear = () => acme.evals.create({ name: 'regresion' });
export const listar = () => fetch('https://api.acme.dev/v1/evals');

// Portkey también tiene /v1/prompts (POST https://api.portkey.ai/v1/prompts/:id/completions).
export const portkey = (id) => fetch(`https://api.portkey.ai/v1/prompts/${id}/completions`, { method: 'POST' });

// Otros prompts y workflows: un objeto `prompt` propio y un ID de workflow de otro sistema.
export const config = { prompt: { system: 'Sos un asistente.', id: 'soporte-v2' } };
export const tarea = { workflowId: 'wf_123', queue: 'facturas' };
const pmpt_count = 3;
export { pmpt_count };
