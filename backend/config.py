from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_tts_credentials: str = "credentials/google_tts.json"
    database_url: str = "data/voiceql.db"
    max_query_history: int = 50
    whisper_model: str = "whisper-1"
    llm_model: str = "claude-sonnet-4-6"
    tts_language: str = "en-US"
    tts_voice: str = "en-US-Journey-F"

    class Config:
        env_file = ".env"

settings = Settings()
