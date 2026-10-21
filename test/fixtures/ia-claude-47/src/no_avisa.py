# Nada de esto da 400 (o no se puede saber): modelos anteriores, OpenAI, valores por defecto, modelos por variable.
import os

import anthropic
from openai import OpenAI

client = anthropic.Anthropic()
openai_client = OpenAI()

if os.getenv("PREMIUM"):
    modelo = "claude-opus-4-7"
else:
    modelo = "claude-sonnet-4-6"


def anteriores(texto):
    client.messages.create(model="claude-sonnet-4-6", max_tokens=64, temperature=0.2, messages=[])
    return client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=64, top_k=40, messages=[])


def openai_igual(texto):
    return openai_client.chat.completions.create(model="gpt-5.6-terra", temperature=0.2, messages=[{"role": "user", "content": texto}])


def por_defecto(texto):
    return client.messages.create(model="claude-opus-4-7", max_tokens=64, top_p=0.995, messages=[])


def segun_plan(texto):
    # `modelo` se asigna dos veces: no se sabe cuál llega.
    return client.messages.create(model=modelo, max_tokens=64, temperature=0.3, messages=[])


def con_parametro(texto, model="claude-opus-4-7", temperature=0.2):
    return client.messages.create(model=model, max_tokens=64, temperature=temperature, messages=[])


def desde_config(settings, texto):
    return client.messages.create(model=settings.CLAUDE_MODEL, max_tokens=64, temperature=0.2, messages=[])
