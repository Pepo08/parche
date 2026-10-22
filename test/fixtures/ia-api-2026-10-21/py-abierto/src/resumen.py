# Rango sin tope: una instalación nueva trae la 2.0.0.
from anthropic import Anthropic

client = Anthropic()


def resumir(texto):
    return client.messages.create(model="claude-haiku-4-5", max_tokens=64, top_k=20, messages=[{"role": "user", "content": texto}])
