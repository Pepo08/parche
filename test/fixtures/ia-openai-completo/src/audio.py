# Audio de OpenAI: voz (6/1/2027), transcripción (26/2/2027) y las familias de audio y realtime (20/1/2027).
from openai import OpenAI

client = OpenAI()


def hablar(texto):
    return client.audio.speech.create(model="tts-1", voice="alloy", input=texto)


def hablar_hd(texto):
    return client.audio.speech.create(model="tts-1-hd", voice="alloy", input=texto)


def hablar_mini(texto):
    return client.audio.speech.create(model="gpt-4o-mini-tts-2025-03-20", voice="alloy", input=texto)


def hablar_mini_nuevo(texto):
    return client.audio.speech.create(model='gpt-4o-mini-tts-2025-12-15', voice="alloy", input=texto)


def transcribir(archivo):
    return client.audio.transcriptions.create(model="whisper-1", file=archivo)


def transcribir_4o(archivo):
    return client.audio.transcriptions.create(model="gpt-4o-transcribe", file=archivo)


def transcribir_mini(archivo):
    return client.audio.transcriptions.create(model="gpt-4o-mini-transcribe", file=archivo)


def transcribir_hablantes(archivo):
    return client.audio.transcriptions.create(model="gpt-4o-transcribe-diarize", file=archivo)


def transcribir_mini_marzo(archivo):
    return client.audio.transcriptions.create(model="gpt-4o-mini-transcribe-2025-03-20", file=archivo)


def conversar():
    return client.realtime.connect(model="gpt-realtime")


def conversar_fijo():
    return client.realtime.connect(model="gpt-realtime-2025-08-28")


def conversar_mini():
    return client.realtime.connect(model="gpt-realtime-mini")


def conversar_mini_fijo():
    return client.realtime.connect(model="gpt-realtime-mini-2025-12-15")


def responder_con_voz(mensajes):
    return client.chat.completions.create(model="gpt-audio", modalities=["text", "audio"], messages=mensajes)


def responder_con_voz_fijo(mensajes):
    return client.chat.completions.create(model="gpt-audio-2025-08-28", modalities=["text", "audio"], messages=mensajes)


def responder_con_voz_mini(mensajes):
    return client.chat.completions.create(model="gpt-audio-mini", modalities=["text", "audio"], messages=mensajes)


def responder_con_voz_mini_fijo(mensajes):
    return client.chat.completions.create(model="gpt-audio-mini-2025-12-15", modalities=["text", "audio"], messages=mensajes)
