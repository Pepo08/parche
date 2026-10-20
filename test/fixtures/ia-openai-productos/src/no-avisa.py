# Usa el SDK de OpenAI, pero nada de esto es un producto que cierra.
import openai
from chatkit.server import ChatKitServer
from phoenix.evals.models import OpenAIModel

client = openai.OpenAI()
modelo = OpenAIModel(model="gpt-6-sol")


class MiServidor(ChatKitServer):
    pass


def imagen(texto):
    return client.images.generate(model="gpt-image-2.5-sunburst", prompt=texto)


def respuesta(texto):
    return client.responses.create(model="gpt-6-sol", input=texto)
