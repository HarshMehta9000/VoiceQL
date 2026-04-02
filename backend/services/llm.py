import anthropic
import openai
import re
from config import settings
from database.db import get_schema

SYSTEM_PROMPT = """You are VoiceQL, a voice-activated SQL analytics assistant.

Your job:
1. Convert the user's natural language question into a valid SQLite SQL query.
2. Return ONLY a JSON object with two keys: "sql" and "summary".
   - "sql": the raw SQL string (no markdown, no backticks)
   - "summary": a single short sentence (under 20 words) summarizing the result for TTS playback

Rules:
- Only SELECT queries. Never INSERT, UPDATE, DELETE, DROP.
- Use only columns and tables from the schema provided.
- If the question is ambiguous, make the most reasonable assumption.
- For date ranges, use SQLite date() and strftime() functions.
- Always add a LIMIT 100 unless the user asks for aggregates only.

Database schema:
{schema}

Return ONLY valid JSON. No markdown. No explanation. Example:
{{"sql": "SELECT region, SUM(revenue) FROM sales GROUP BY region", "summary": "North leads with 23,700 in revenue."}}
"""

def _extract_json(text: str) -> dict:
    import json
    text = text.strip()
    # strip markdown code fences if model adds them
    text = re.sub(r"```(?:json)?", "", text).strip("`").strip()
    return json.loads(text)

async def generate_sql(voice_input: str) -> dict:
    """
    Returns {"sql": "...", "summary": "..."} from a natural language voice query.
    Tries Claude first (Anthropic), falls back to GPT-4o-mini if no Anthropic key.
    """
    schema = get_schema()
    system = SYSTEM_PROMPT.format(schema=schema)

    if settings.anthropic_api_key:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model=settings.llm_model,
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": voice_input}],
        )
        raw = response.content[0].text
    elif settings.openai_api_key:
        client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=512,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": voice_input},
            ],
        )
        raw = response.choices[0].message.content
    else:
        raise ValueError("No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env")

    print(f"[LLM] Raw response: {raw}")
    result = _extract_json(raw)
    print(f"[LLM] SQL: {result['sql']}")
    print(f"[LLM] Summary: {result['summary']}")
    return result
