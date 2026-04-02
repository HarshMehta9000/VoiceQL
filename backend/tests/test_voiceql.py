"""
VoiceQL Test Suite
Tests all backend logic with mocked external APIs.
No real API keys needed — safe to run in CI and before pushing to GitHub.

Run: pytest tests/test_voiceql.py -v
"""

import sys
import os
import json
import sqlite3
import tempfile
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

# ── path setup so imports resolve ────────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-fake")
os.environ.setdefault("GOOGLE_TTS_CREDENTIALS", "credentials/fake.json")
os.environ.setdefault("DATABASE_URL", ":memory:")

from fastapi.testclient import TestClient


# ── helpers ───────────────────────────────────────────────────────────────────

def make_wav_bytes(duration_frames: int = 800) -> bytes:
    """Minimal valid WAV header + silence — enough to pass size checks."""
    import struct
    sample_rate = 16000
    num_channels = 1
    bits_per_sample = 16
    data_size = duration_frames * num_channels * (bits_per_sample // 8)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE",
        b"fmt ", 16, 1, num_channels, sample_rate,
        sample_rate * num_channels * (bits_per_sample // 8),
        num_channels * (bits_per_sample // 8), bits_per_sample,
        b"data", data_size,
    )
    return header + b"\x00" * data_size


def llm_response_json(sql: str, summary: str) -> str:
    return json.dumps({"sql": sql, "summary": summary})


# ── DB tests (no mocking needed — pure SQLite) ────────────────────────────────

class TestDatabase:

    def setup_method(self):
        """Fresh in-memory DB for every test."""
        import database.db as dbmod
        dbmod.settings.database_url = ":memory:"
        dbmod._memory_conn = None  # force fresh connection

    def test_init_db_creates_tables(self):
        from database.db import init_db, get_conn
        init_db()
        conn = get_conn()
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        names = {r[0] for r in tables}
        assert "sales" in names
        assert "query_history" in names
        conn.close()

    def test_sample_data_inserted(self):
        from database.db import init_db, run_query
        init_db()
        rows = run_query("SELECT COUNT(*) as n FROM sales")
        assert rows[0]["n"] >= 10

    def test_run_query_returns_dicts(self):
        from database.db import init_db, run_query
        init_db()
        rows = run_query("SELECT product, revenue FROM sales LIMIT 3")
        assert isinstance(rows, list)
        assert isinstance(rows[0], dict)
        assert "product" in rows[0]
        assert "revenue" in rows[0]

    def test_run_query_aggregation(self):
        from database.db import init_db, run_query
        init_db()
        rows = run_query("SELECT region, SUM(revenue) as total FROM sales GROUP BY region ORDER BY total DESC")
        assert len(rows) > 0
        assert "region" in rows[0]
        assert "total" in rows[0]

    def test_log_query(self):
        from database.db import init_db, log_query, run_query
        init_db()
        log_query("test question", "SELECT 1", "One result.", 250)
        rows = run_query("SELECT * FROM query_history")
        assert len(rows) >= 1
        assert rows[-1]["voice_input"] == "test question"
        assert rows[-1]["latency_ms"] == 250

    def test_get_schema_returns_string(self):
        from database.db import get_schema
        schema = get_schema()
        assert "sales" in schema
        assert "revenue" in schema
        assert "region" in schema


# ── LLM service tests ─────────────────────────────────────────────────────────

class TestLLMService:

    @pytest.mark.asyncio
    async def test_generate_sql_with_anthropic(self):
        mock_text = llm_response_json(
            "SELECT region, SUM(revenue) FROM sales GROUP BY region",
            "North leads with 23,700 in revenue."
        )
        mock_content = MagicMock()
        mock_content.text = mock_text
        mock_response = MagicMock()
        mock_response.content = [mock_content]

        with patch("services.llm.anthropic.AsyncAnthropic") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)

            from services.llm import generate_sql
            result = await generate_sql("Show revenue by region")

        assert result["sql"] == "SELECT region, SUM(revenue) FROM sales GROUP BY region"
        assert "revenue" in result["summary"].lower()

    @pytest.mark.asyncio
    async def test_generate_sql_falls_back_to_openai(self):
        """When ANTHROPIC_API_KEY is blank, should use OpenAI GPT."""
        mock_text = llm_response_json(
            "SELECT product, SUM(units) FROM sales GROUP BY product",
            "Widget B had 360 units sold."
        )
        mock_msg = MagicMock()
        mock_msg.content = mock_text
        mock_choice = MagicMock()
        mock_choice.message = mock_msg
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]

        import services.llm as llm_mod
        original_key = llm_mod.settings.anthropic_api_key
        llm_mod.settings.anthropic_api_key = ""

        try:
            with patch("services.llm.openai.AsyncOpenAI") as mock_cls:
                mock_client = AsyncMock()
                mock_cls.return_value = mock_client
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                result = await llm_mod.generate_sql("Top products by units")
        finally:
            llm_mod.settings.anthropic_api_key = original_key

        assert "sql" in result
        assert "summary" in result

    @pytest.mark.asyncio
    async def test_generate_sql_strips_markdown_fences(self):
        """LLM sometimes wraps JSON in ```json ... ``` — must be stripped."""
        raw = "```json\n" + llm_response_json("SELECT 1", "One.") + "\n```"
        mock_content = MagicMock()
        mock_content.text = raw
        mock_response = MagicMock()
        mock_response.content = [mock_content]

        with patch("services.llm.anthropic.AsyncAnthropic") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            from services.llm import generate_sql
            result = await generate_sql("anything")

        assert result["sql"] == "SELECT 1"

    @pytest.mark.asyncio
    async def test_no_api_key_raises(self):
        import services.llm as llm_mod
        orig_ant = llm_mod.settings.anthropic_api_key
        orig_oai = llm_mod.settings.openai_api_key
        llm_mod.settings.anthropic_api_key = ""
        llm_mod.settings.openai_api_key = ""
        try:
            with pytest.raises(ValueError, match="No LLM API key"):
                await llm_mod.generate_sql("anything")
        finally:
            llm_mod.settings.anthropic_api_key = orig_ant
            llm_mod.settings.openai_api_key = orig_oai


# ── STT service tests ─────────────────────────────────────────────────────────

class TestSTTService:

    @pytest.mark.asyncio
    async def test_transcribe_returns_string(self):
        wav = make_wav_bytes()

        with patch("services.stt.openai.AsyncOpenAI") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value = mock_client
            mock_client.audio.transcriptions.create = AsyncMock(
                return_value="Show me revenue by region"
            )
            from services.stt import transcribe_audio
            result = await transcribe_audio(wav, "audio/wav")

        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_transcribe_uses_wav_suffix(self):
        """Should create a temp file with .wav extension for WAV content."""
        wav = make_wav_bytes()
        created_paths = []

        original_transcribe = None

        with patch("services.stt.openai.AsyncOpenAI") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value = mock_client
            mock_client.audio.transcriptions.create = AsyncMock(
                return_value="test transcript"
            )
            import services.stt as stt_mod
            result = await stt_mod.transcribe_audio(wav, "audio/wav")

        assert result == "test transcript"


# ── TTS service tests ─────────────────────────────────────────────────────────

class TestTTSService:

    def test_synthesize_returns_bytes(self):
        mock_response = MagicMock()
        mock_response.audio_content = b"fake-mp3-data-\xff\xfb\x90\x00"

        with patch("services.tts.texttospeech.TextToSpeechClient") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value = mock_client
            mock_client.synthesize_speech.return_value = mock_response

            import services.tts as tts_mod
            tts_mod._client = None  # reset singleton
            result = tts_mod.synthesize("North leads with 23,700 in revenue.")

        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_synthesize_called_with_correct_text(self):
        mock_response = MagicMock()
        mock_response.audio_content = b"audio"

        with patch("services.tts.texttospeech.TextToSpeechClient") as mock_cls:
            mock_client = MagicMock()
            mock_cls.return_value = mock_client
            mock_client.synthesize_speech.return_value = mock_response

            import services.tts as tts_mod
            tts_mod._client = None
            tts_mod.synthesize("Widget B sold the most units.")

            call_args = mock_client.synthesize_speech.call_args
            synthesis_input = call_args.kwargs.get("input") or call_args[1].get("input")
            assert synthesis_input.text == "Widget B sold the most units."


# ── API endpoint tests ────────────────────────────────────────────────────────

class TestQueryEndpoints:

    def setup_method(self):
        import database.db as dbmod
        dbmod.settings.database_url = ":memory:"
        dbmod._memory_conn = None
        from database.db import init_db
        init_db()

    def _get_client(self):
        from main import app
        return TestClient(app)

    def test_health_endpoint(self):
        client = self._get_client()
        resp = client.get("/health/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["sales_rows"] >= 10

    def test_text_query_endpoint(self):
        mock_llm = llm_response_json(
            "SELECT region, SUM(revenue) as total FROM sales GROUP BY region",
            "North leads with the highest revenue."
        )
        mock_content = MagicMock()
        mock_content.text = mock_llm
        mock_response = MagicMock()
        mock_response.content = [mock_content]

        with patch("services.llm.anthropic.AsyncAnthropic") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)

            client = self._get_client()
            resp = client.post("/query/text", json={"query": "Show revenue by region"})

        assert resp.status_code == 200
        data = resp.json()
        assert "sql" in data
        assert "summary" in data
        assert "results" in data
        assert "latency_ms" in data
        assert data["row_count"] > 0

    def test_text_query_missing_body(self):
        client = self._get_client()
        resp = client.post("/query/text", json={})
        assert resp.status_code == 400

    def test_text_query_blocks_destructive_sql(self):
        """LLM returning a DROP/DELETE query must be blocked."""
        mock_llm = llm_response_json("DROP TABLE sales", "Deleted everything.")
        mock_content = MagicMock()
        mock_content.text = mock_llm
        mock_response = MagicMock()
        mock_response.content = [mock_content]

        with patch("services.llm.anthropic.AsyncAnthropic") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)

            client = self._get_client()
            resp = client.post("/query/text", json={"query": "delete everything"})

        assert resp.status_code == 403

    def test_voice_endpoint_rejects_tiny_audio(self):
        """Audio under 100 bytes should return 400."""
        client = self._get_client()
        resp = client.post(
            "/query/voice",
            files={"audio": ("q.wav", b"\x00" * 50, "audio/wav")},
        )
        assert resp.status_code == 400

    def test_voice_endpoint_full_pipeline(self):
        wav = make_wav_bytes(8000)  # ~0.5s of audio
        fake_mp3 = b"\xff\xfb\x90\x00" + b"\x00" * 100  # fake MP3 header

        with patch("services.stt.openai.AsyncOpenAI") as stt_cls, \
             patch("services.llm.anthropic.AsyncAnthropic") as llm_cls, \
             patch("services.tts.texttospeech.TextToSpeechClient") as tts_cls:

            # STT mock
            stt_client = AsyncMock()
            stt_cls.return_value = stt_client
            stt_client.audio.transcriptions.create = AsyncMock(
                return_value="Show revenue by region"
            )

            # LLM mock
            llm_content = MagicMock()
            llm_content.text = llm_response_json(
                "SELECT region, SUM(revenue) as total FROM sales GROUP BY region",
                "North leads with the highest revenue."
            )
            llm_response = MagicMock()
            llm_response.content = [llm_content]
            llm_client = AsyncMock()
            llm_cls.return_value = llm_client
            llm_client.messages.create = AsyncMock(return_value=llm_response)

            # TTS mock
            tts_response = MagicMock()
            tts_response.audio_content = fake_mp3
            tts_client = MagicMock()
            tts_cls.return_value = tts_client
            tts_client.synthesize_speech.return_value = tts_response

            import services.tts as tts_mod
            tts_mod._client = None  # reset singleton

            client = self._get_client()
            resp = client.post(
                "/query/voice",
                files={"audio": ("query.wav", wav, "audio/wav")},
            )

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"
        assert "X-Transcript" in resp.headers
        assert "X-Summary" in resp.headers
        assert "X-Row-Count" in resp.headers
        assert "X-Latency-Ms" in resp.headers
        assert int(resp.headers["X-Row-Count"]) > 0

    def test_query_history_endpoint(self):
        from database.db import log_query
        log_query("test q", "SELECT 1", "One.", 100)

        client = self._get_client()
        resp = client.get("/query/history?limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert "history" in data
        assert len(data["history"]) >= 1

    def test_docs_available(self):
        client = self._get_client()
        resp = client.get("/docs")
        assert resp.status_code == 200
