# Resumidor de YouTube en Python: el cliente de Google usa `videos()`, con paréntesis, y no es la Videos API.
import os

import openai
from googleapiclient.discovery import build

youtube = build("youtube", "v3", developerKey=os.environ["YOUTUBE_API_KEY"])


def resumir(video_id):
    datos = youtube.videos().list(part="snippet", id=video_id).execute()
    texto = datos["items"][0]["snippet"]["description"]
    return openai.responses.create(model="gpt-5.6-terra", input=f"Resumí: {texto}").output_text
