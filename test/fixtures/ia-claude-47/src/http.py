# Llamada directa a la API de Messages con requests, sin el SDK.
import os

import requests

ANTHROPIC = "https://api.anthropic.com"


def preguntar(texto):
    r = requests.post(
        f"{ANTHROPIC}/v1/messages",
        headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
        json={"model": "claude-opus-4-7", "max_tokens": 256, "top_k": 10, "messages": [{"role": "user", "content": texto}]},
        timeout=60,
    )
    return r.json()
