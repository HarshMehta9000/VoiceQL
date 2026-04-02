import openai
import tempfile
import os
from config import settings

async def transcribe_audio(audio_bytes: bytes, content_type: str = "audio/wav") -> str:
    """
    Send raw audio bytes to OpenAI Whisper and return transcript.
    Audio comes from EchoKit over HTTP POST as multipart/form-data.
    """
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    suffix = ".wav" if "wav" in content_type else ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as f:
            response = await client.audio.transcriptions.create(
                model=settings.whisper_model,
                file=f,
                language="en",
                response_format="text",
            )
        transcript = str(response).strip()
        print(f"[STT] Transcribed: {transcript!r}")
        return transcript
    finally:
        os.unlink(tmp_path)
