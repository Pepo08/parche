# Prompts reutilizables desde Python, como en la guía "Migrate from prompt objects".
from openai import OpenAI

client = OpenAI()
prompt_id = "pmpt_123"


def responder(cliente, consulta):
    return client.responses.create(
        prompt={
            "id": prompt_id,
            "version": "1",
            "variables": {"customer_name": cliente, "issue": consulta},
        }
    )
