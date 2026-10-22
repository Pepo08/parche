# SDK de Python 1.4.0: el parámetro directo ya tira TypeError; por extra_body funciona hasta la 2.0.0.
import anthropic

client = anthropic.Anthropic()


def resumir(texto):
    client.messages.create(model="claude-sonnet-4-6", max_tokens=64, temperature=0.2, messages=[])
    return client.messages.create(model="claude-sonnet-4-6", max_tokens=64, messages=[], extra_body={"temperature": 0.2})
