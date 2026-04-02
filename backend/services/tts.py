import os
from google.cloud import texttospeech
from config import settings

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_tts_credentials

_client = None

def _get_client():
    global _client
    if _client is None:
        _client = texttospeech.TextToSpeechClient()
    return _client

def synthesize(text: str) -> bytes:
    """
    Convert a short summary string to MP3 audio bytes via Google Cloud TTS.
    Returns raw MP3 bytes — send directly as audio/mpeg response or stream to EchoKit.
    """
    client = _get_client()

    synthesis_input = texttospeech.SynthesisInput(text=text)

    voice = texttospeech.VoiceSelectionParams(
        language_code=settings.tts_language,
        name=settings.tts_voice,
    )

    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=1.05,
        pitch=0.0,
    )

    response = client.synthesize_speech(
        input=synthesis_input,
        voice=voice,
        audio_config=audio_config,
    )

    print(f"[TTS] Synthesized {len(response.audio_content)} bytes for: {text!r}")
    return response.audio_content
