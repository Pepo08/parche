# Fine-tuned de los modelos base de completions (babbage-002 y davinci-002).
from openai import OpenAI

client = OpenAI()


def sugerir(prompt):
    return client.completions.create(model="ft:babbage-002:acme:autocompletar:4Rr5Tt", prompt=prompt)


def redactar(prompt):
    return client.completions.create(model='ft:davinci-002:acme::6Yy7Uu', prompt=prompt)
