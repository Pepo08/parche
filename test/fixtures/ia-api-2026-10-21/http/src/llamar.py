# HTTP directo desde Python con el header nuevo.
import os

import requests


def llamar(texto):
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2026-10-21"},
        json={"model": "claude-opus-4-6", "max_tokens": 64, "top_p": 0.5, "messages": [{"role": "user", "content": texto}]},
    )
    return r.json()
