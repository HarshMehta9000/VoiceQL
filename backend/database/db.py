import sqlite3
import os
from config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    product TEXT NOT NULL,
    category TEXT NOT NULL,
    region TEXT NOT NULL,
    units INTEGER NOT NULL,
    revenue REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS query_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    voice_input TEXT,
    generated_sql TEXT,
    result_summary TEXT,
    latency_ms INTEGER
);
"""

SAMPLE_DATA = """
INSERT OR IGNORE INTO sales (date, product, category, region, units, revenue) VALUES
('2024-01-15', 'Widget A', 'Electronics', 'North', 120, 14400.00),
('2024-01-20', 'Widget B', 'Electronics', 'South', 85, 8500.00),
('2024-02-05', 'Gadget X', 'Accessories', 'East', 200, 6000.00),
('2024-02-18', 'Widget A', 'Electronics', 'West', 95, 11400.00),
('2024-03-10', 'Gadget Y', 'Accessories', 'North', 310, 9300.00),
('2024-03-22', 'Widget B', 'Electronics', 'East', 140, 14000.00),
('2024-04-01', 'Widget A', 'Electronics', 'South', 175, 21000.00),
('2024-04-15', 'Gadget X', 'Accessories', 'West', 90, 2700.00),
('2024-05-05', 'Widget B', 'Electronics', 'North', 220, 22000.00),
('2024-05-20', 'Gadget Y', 'Accessories', 'South', 180, 5400.00),
('2024-06-01', 'Widget A', 'Electronics', 'East', 130, 15600.00),
('2024-06-14', 'Gadget X', 'Accessories', 'North', 250, 7500.00);
"""

# Shared connection for :memory: (reused across calls so tables persist)
_memory_conn: sqlite3.Connection | None = None

def get_conn() -> sqlite3.Connection:
    global _memory_conn
    if settings.database_url == ":memory:":
        if _memory_conn is None:
            _memory_conn = sqlite3.connect(":memory:", check_same_thread=False)
            _memory_conn.row_factory = sqlite3.Row
        return _memory_conn
    os.makedirs(os.path.dirname(settings.database_url) if os.path.dirname(settings.database_url) else ".", exist_ok=True)
    conn = sqlite3.connect(settings.database_url)
    conn.row_factory = sqlite3.Row
    return conn

def _close_conn(conn: sqlite3.Connection):
    """Only close non-memory connections."""
    if settings.database_url != ":memory:":
        conn.close()

def init_db():
    global _memory_conn
    if settings.database_url == ":memory:":
        _memory_conn = None  # reset so a fresh shared conn is created
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.executescript(SAMPLE_DATA)
    conn.commit()
    print("[DB] Initialized with sample sales data.")

def run_query(sql: str) -> list[dict]:
    conn = get_conn()
    try:
        cursor = conn.execute(sql)
        rows = [dict(row) for row in cursor.fetchall()]
        return rows
    finally:
        _close_conn(conn)

def log_query(voice_input: str, sql: str, summary: str, latency_ms: int):
    conn = get_conn()
    conn.execute(
        "INSERT INTO query_history (voice_input, generated_sql, result_summary, latency_ms) VALUES (?,?,?,?)",
        (voice_input, sql, summary, latency_ms),
    )
    conn.commit()
    _close_conn(conn)

def get_schema() -> str:
    return """
    Table: sales
    Columns: id, date (TEXT YYYY-MM-DD), product (TEXT), category (TEXT),
             region (TEXT: North/South/East/West), units (INTEGER), revenue (REAL)

    Table: query_history
    Columns: id, timestamp, voice_input, generated_sql, result_summary, latency_ms
    """
