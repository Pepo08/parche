"""Resúmenes y traducciones con el SDK oficial de Anthropic (Python)."""
import os

import anthropic

client = anthropic.Anthropic()
MODELO = os.getenv("CLAUDE_MODEL", "claude-opus-4-8")
TEMPERATURA: float = 0.4


def resumir(texto):
    return client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        temperature=0,  # queríamos respuestas "determinísticas"
        messages=[{"role": "user", "content": texto}],
    )


def traducir(texto):
    with client.messages.stream(
        model=MODELO,
        max_tokens=1024,
        top_k=50,
        messages=[{"role": "user", "content": f"Traducí: {texto}"}],
    ) as stream:
        return stream.get_final_message()


async def clasificar(aclient, texto):
    params = {
        "model": "claude-fable-5-1",
        "max_tokens": 64,
        "temperature": TEMPERATURA,
        "messages": [{"role": "user", "content": texto}],
    }
    return await aclient.messages.create(**params)


def auditar(texto):
    respuesta = client.messages.with_raw_response.create(model="claude-mythos-preview", max_tokens=256, top_p=0.5,
                                                         messages=[{"role": "user", "content": texto}])
    return respuesta.parse()
