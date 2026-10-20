# Generación de video con la Videos API de OpenAI desde el SDK de Python, sincrónico y asíncrono.
from openai import AsyncOpenAI, OpenAI

client = OpenAI()


def generar(prompt):
    video = client.videos.create_and_poll(prompt=prompt, seconds="8")
    with client.videos.with_streaming_response.download_content(video.id) as respuesta:
        respuesta.stream_to_file("video.mp4")
    return video


def retocar(archivo):
    client.videos.edit(prompt="más luz", video=archivo)
    return client.videos.extend(prompt="cuatro segundos más", seconds="4", video=archivo)


async def esperar(video_id):
    aclient = AsyncOpenAI()
    video = await aclient.videos.retrieve(video_id)
    return await aclient.videos.poll(video.id)


def personaje(character_id):
    return client.videos.get_character(character_id)
