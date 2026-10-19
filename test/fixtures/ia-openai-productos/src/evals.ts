// Plataforma de Evals de OpenAI: solo lectura el 31/10/2026, cierre del dashboard y la API el 30/11/2026.
import OpenAI from 'openai';

const openai = new OpenAI();

export async function crearEval() {
  return openai.evals.create({
    name: 'Sentiment',
    data_source_config: { type: 'stored_completions', metadata: { usecase: 'chatbot' } },
    testing_criteria: [],
  });
}

export async function correr(evalId: string) {
  const run = await openai.evals.runs.create(evalId, { name: 'nightly', data_source: { type: 'jsonl', source: { type: 'file_id', id: 'file-abc' } } });
  return openai.evals.runs.outputItems.list(run.id, { eval_id: evalId });
}

export async function listarPorHttp() {
  const r = await fetch('https://api.openai.com/v1/evals?limit=20', {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  return r.json();
}
