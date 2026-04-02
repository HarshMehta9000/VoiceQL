import time
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response, JSONResponse
from services.stt import transcribe_audio
from services.llm import generate_sql
from services.tts import synthesize
from database.db import run_query, log_query

router = APIRouter()


@router.post("/voice")
async def voice_query(audio: UploadFile = File(...)):
    """
    Full pipeline: audio file -> Whisper STT -> Claude SQL -> SQLite -> Google TTS -> MP3

    Arduino sends a WAV file captured by EchoKit.
    Returns MP3 audio of the result summary + JSON header with SQL and data.

    Flow:
      1. Receive WAV from Arduino (EchoKit records, Arduino POSTs via WiFi)
      2. Transcribe with Whisper
      3. Generate SQL + summary with Claude
      4. Execute SQL on SQLite
      5. Synthesize summary with Google TTS
      6. Return MP3 audio (Arduino plays via EchoKit speaker)
      7. Also return result data in response headers for OLED display
    """
    t_start = time.time()

    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file too small or empty.")

    transcript = await transcribe_audio(audio_bytes, audio.content_type or "audio/wav")
    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe audio.")

    llm_result = await generate_sql(transcript)
    sql = llm_result["sql"]
    summary = llm_result["summary"]

    if any(kw in sql.upper() for kw in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE"]):
        raise HTTPException(status_code=403, detail="Only SELECT queries are allowed.")

    try:
        rows = run_query(sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL execution error: {e}")

    mp3_bytes = synthesize(summary)

    latency_ms = int((time.time() - t_start) * 1000)
    log_query(transcript, sql, summary, latency_ms)

    import json
    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={
            "X-Transcript": transcript[:80],
            "X-SQL": sql[:200],
            "X-Summary": summary[:80],
            "X-Row-Count": str(len(rows)),
            "X-Latency-Ms": str(latency_ms),
            "X-Results": json.dumps(rows[:3]),
        },
    )


@router.post("/text")
async def text_query(body: dict):
    """
    Text-only endpoint for testing without hardware.
    POST {"query": "Show total revenue by region"}
    Returns JSON with SQL, results, and summary.
    """
    t_start = time.time()
    voice_input = body.get("query", "").strip()
    if not voice_input:
        raise HTTPException(status_code=400, detail="Missing 'query' field.")

    llm_result = await generate_sql(voice_input)
    sql = llm_result["sql"]
    summary = llm_result["summary"]

    if any(kw in sql.upper() for kw in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE"]):
        raise HTTPException(status_code=403, detail="Only SELECT queries are allowed.")

    try:
        rows = run_query(sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL execution error: {e}")

    latency_ms = int((time.time() - t_start) * 1000)
    log_query(voice_input, sql, summary, latency_ms)

    return JSONResponse({
        "transcript": voice_input,
        "sql": sql,
        "summary": summary,
        "row_count": len(rows),
        "results": rows[:10],
        "latency_ms": latency_ms,
    })


@router.get("/history")
async def query_history(limit: int = 10):
    """Return recent query history — useful for OLED scroll or dashboard."""
    rows = run_query(f"SELECT * FROM query_history ORDER BY id DESC LIMIT {min(limit, 50)}")
    return {"history": rows}
