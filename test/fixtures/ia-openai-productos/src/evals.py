# Evals desde el SDK de Python.
import openai

client = openai.OpenAI()


def resultados(eval_id, run_id):
    ev = client.evals.retrieve(eval_id)
    items = client.evals.runs.output_items.list(run_id, eval_id=eval_id)
    return ev, items


def cancelar(eval_id, run_id):
    return client.evals.runs.cancel(run_id, eval_id=eval_id)
