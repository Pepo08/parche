# ChatKit por HTTP, como en la guía de ChatKit ("Existing hosted workflow").
import os

import requests

api_key = os.environ["OPENAI_API_KEY"]
workflow_id = "wf_123"


def crear_sesion(user_id):
    response = requests.post(
        "https://api.openai.com/v1/chatkit/sessions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "OpenAI-Beta": "chatkit_beta=v1",
        },
        json={"workflow": {"id": workflow_id}, "user": user_id},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["client_secret"]
