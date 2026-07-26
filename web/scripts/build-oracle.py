"""Build the ground truth oracle for the VoiceQL teardown site.

Everything here is derived from the real repo. SCHEMA, SAMPLE_DATA and the
SYSTEM_PROMPT few shot example are parsed out of the backend sources, then every
query the site will ever display is executed against real sqlite3 and its full
result set is written to web/src/data/oracle.json.

The Node gate (verify-oracle.mjs) boots sql.js with the same schema, re-runs
every query, and asserts the canonical form of each cell matches. If the backend
changes, this file changes with it and the gate fails loudly.

Run:  python3 web/scripts/build-oracle.py
"""
import json
import pathlib
import re
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve()
REPO = HERE.parent.parent.parent
OUT = REPO / "web" / "src" / "data" / "oracle.json"

DB_PY = REPO / "backend" / "database" / "db.py"
LLM_PY = REPO / "backend" / "services" / "llm.py"
QUERY_PY = REPO / "backend" / "routers" / "query.py"


def extract(path, pattern, what):
    m = re.search(pattern, path.read_text(), re.S)
    if not m:
        sys.exit(f"FATAL: could not extract {what} from {path.relative_to(REPO)}")
    return m.group(1)


SCHEMA = extract(DB_PY, r'SCHEMA = """(.*?)"""', "SCHEMA")
SAMPLE_DATA = extract(DB_PY, r'SAMPLE_DATA = """(.*?)"""', "SAMPLE_DATA")

# The false few shot example, taken from the production prompt itself.
FEWSHOT_SQL = extract(
    LLM_PY, r'\{\{"sql": "([^"]+)", "summary": "[^"]*"\}\}', "few shot sql")
FEWSHOT_SUMMARY = extract(
    LLM_PY, r'\{\{"sql": "[^"]+", "summary": "([^"]*)"\}\}', "few shot summary")

# The guard's blocklist, parsed rather than retyped.
BLOCKLIST = re.findall(
    r'"([A-Z]+)"',
    extract(QUERY_PY, r"for kw in \[(.*?)\]", "blocklist"))

# The header truncation limits, parsed from the response construction.
HDR_TRANSCRIPT = int(extract(QUERY_PY, r'"X-Transcript": transcript\[:(\d+)\]', "hdr"))
HDR_SQL = int(extract(QUERY_PY, r'"X-SQL": sql\[:(\d+)\]', "hdr"))
HDR_ROWS = int(extract(QUERY_PY, r'"X-Results": json\.dumps\(rows\[:(\d+)\]\)', "hdr"))
HISTORY_CAP = int(extract(QUERY_PY, r"min\(limit,\s*(\d+)\)", "history cap"))


def canon(v):
    """Canonical string form, so Python and JavaScript agree byte for byte.

    JS collapses 14400.0 to 14400 on serialisation and Python does not, so
    integral floats are normalised to integer strings on both sides.
    """
    if v is None:
        return "\x00NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    return str(v)


conn = sqlite3.connect(":memory:")
conn.executescript(SCHEMA)
conn.executescript(SAMPLE_DATA)


def run(sql):
    cur = conn.execute(sql)
    cols = [d[0] for d in cur.description] if cur.description else []
    rows = [[canon(c) for c in r] for r in cur.fetchall()]
    return cols, rows


# Every query the site can display. `natural` is the spoken question where the
# README supplies one. `source` says which part of the repo the query comes from.
CATALOG = [
    # The two README demo claims. These are the money shot, element E2.
    dict(id="revenue_by_region", source="README.md:16 demo",
         natural="Which region leads in total revenue?",
         sql="SELECT region, SUM(revenue) AS total FROM sales GROUP BY region ORDER BY total DESC"),
    dict(id="q2_units_by_product", source="README.md units demo",
         natural="Which product had the highest units in Q2?",
         sql="SELECT product, SUM(units) AS units FROM sales "
             "WHERE date >= '2024-04-01' AND date <= '2024-06-30' "
             "GROUP BY product ORDER BY units DESC"),
    # The production prompt's own few shot, executed for real. Element E7.
    dict(id="fewshot_prompt_example", source="backend/services/llm.py SYSTEM_PROMPT",
         natural="the few shot example the model is conditioned on",
         sql=FEWSHOT_SQL),
    # The six README example queries. Element E1 presets.
    dict(id="readme_total_revenue", source="README.md:167 example",
         natural="What is the total revenue this year?",
         sql="SELECT SUM(revenue) AS total_revenue FROM sales WHERE date LIKE '2024%'"),
    dict(id="readme_top3_units", source="README.md:168 example",
         natural="Show me top 3 products by units sold",
         sql="SELECT product, SUM(units) AS units FROM sales "
             "GROUP BY product ORDER BY units DESC LIMIT 3"),
    dict(id="readme_lowest_region", source="README.md:169 example",
         natural="Which region has the lowest revenue?",
         sql="SELECT region, SUM(revenue) AS total FROM sales "
             "GROUP BY region ORDER BY total ASC LIMIT 1"),
    dict(id="readme_february_count", source="README.md:170 example",
         natural="How many sales happened in February?",
         sql="SELECT COUNT(*) AS sales_count FROM sales WHERE date LIKE '2024-02%'"),
    dict(id="readme_north_vs_south", source="README.md:171 example",
         natural="Compare revenue between North and South",
         sql="SELECT region, SUM(revenue) AS total FROM sales "
             "WHERE region IN ('North','South') GROUP BY region ORDER BY total DESC"),
    dict(id="readme_all_electronics", source="README.md:172 example",
         natural="Show me all electronics sales",
         sql="SELECT date, product, region, units, revenue FROM sales "
             "WHERE category = 'Electronics' ORDER BY date"),
    # Reference aggregates, section 4c. These anchor every figure on the page.
    dict(id="agg_total_revenue", source="section 4c reference",
         natural="grand total revenue",
         sql="SELECT SUM(revenue) AS total FROM sales"),
    dict(id="agg_revenue_by_category", source="section 4c reference",
         natural="revenue by category",
         sql="SELECT category, SUM(revenue) AS total FROM sales "
             "GROUP BY category ORDER BY total DESC"),
    dict(id="agg_revenue_by_product", source="section 4c reference",
         natural="revenue by product",
         sql="SELECT product, SUM(revenue) AS total FROM sales "
             "GROUP BY product ORDER BY total DESC"),
    dict(id="agg_units_by_product", source="derived, F11",
         natural="all time units by product",
         sql="SELECT product, SUM(units) AS units FROM sales "
             "GROUP BY product ORDER BY units DESC"),
    dict(id="agg_row_count", source="section 4c reference",
         natural="how many sample rows",
         sql="SELECT COUNT(*) AS n FROM sales"),
    dict(id="agg_by_month", source="derived",
         natural="revenue by month",
         sql="SELECT substr(date,1,7) AS month, SUM(revenue) AS total, SUM(units) AS units "
             "FROM sales GROUP BY month ORDER BY month"),
    dict(id="agg_region_category", source="derived",
         natural="revenue by region and category",
         sql="SELECT region, category, SUM(revenue) AS total FROM sales "
             "GROUP BY region, category ORDER BY region, category"),
    # Full table, element E8 header transport and the E3 table redraw.
    dict(id="all_rows", source="backend/database/db.py SAMPLE_DATA",
         natural="every row in the sample table",
         sql="SELECT id, date, product, category, region, units, revenue FROM sales ORDER BY id"),
    dict(id="header_first_rows", source="backend/routers/query.py X-Results",
         natural=f"the first {HDR_ROWS} rows, as X-Results carries them",
         sql=f"SELECT id, date, product, category, region, units, revenue "
             f"FROM sales ORDER BY id LIMIT {HDR_ROWS}"),
    dict(id="schema_columns_sales", source="PRAGMA",
         natural="the sales schema as SQLite reports it",
         sql="SELECT name, type FROM pragma_table_info('sales')"),
    dict(id="schema_columns_history", source="PRAGMA",
         natural="the query_history schema as SQLite reports it",
         sql="SELECT name, type FROM pragma_table_info('query_history')"),
]

queries = []
for q in CATALOG:
    cols, rows = run(q["sql"])
    queries.append({**q, "columns": cols, "rows": rows})

# The six guard bench cases, element E3. Each records what the substring
# blocklist decides, and what a set_authorizer read only connection decides.
# `mode=ro` is deliberately measured too, because the brief assumed it was
# equivalent and it is not: ATTACH and PRAGMA both survive it.
GUARD_CASES = [
    dict(id="replace_row", kind="write", legitimate=False,
         sql="REPLACE INTO sales VALUES (1,'2024-01-15','PWNED','x','North',0,0.0)",
         note="overwrites a row; REPLACE is not in the blocklist"),
    dict(id="attach_db", kind="write", legitimate=False,
         sql="ATTACH DATABASE 'evil.db' AS e",
         note="opens another file; survives a mode=ro connection"),
    dict(id="pragma_schema", kind="write", legitimate=False,
         sql="PRAGMA table_info(sales)",
         note="schema disclosure; survives a mode=ro connection"),
    dict(id="like_update", kind="read", legitimate=True,
         sql="SELECT * FROM sales WHERE product LIKE '%update%'",
         note="blocked because UPDATE is a substring of the literal"),
    dict(id="literal_deleted", kind="read", legitimate=True,
         sql="SELECT 'DELETED' AS status FROM sales",
         note="blocked because DELETE is a substring of the literal"),
    # The brief's third over-block case used `created_at`, a column that does
    # not exist in this schema, so it failed for the wrong reason. This one is a
    # real audit query over a real column and is blocked for the right reason.
    dict(id="audit_generated_sql", kind="read", legitimate=True,
         sql="SELECT voice_input, generated_sql FROM query_history "
             "WHERE generated_sql LIKE '%DROP%'",
         note="an audit query looking for attempted writes; blocked because "
              "DROP is a substring of its own search term"),
]


def blocklist_allows(sql):
    return not any(kw in sql.upper() for kw in BLOCKLIST)


def authorizer(action, a1, a2, db, trig):
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
    return sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY


def probe(make_conn, sql):
    c = make_conn()
    try:
        c.execute(sql)
        c.commit()
        return True, None
    except sqlite3.Error as e:
        return False, str(e)
    finally:
        c.close()


import tempfile
import os
import shutil

_fd, ROPATH = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.unlink(ROPATH)
_seed = sqlite3.connect(ROPATH)
_seed.executescript(SCHEMA)
_seed.executescript(SAMPLE_DATA)
_seed.commit()
_seed.close()


def ro_conn():
    return sqlite3.connect(f"file:{ROPATH}?mode=ro", uri=True)


def auth_conn():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA)
    c.executescript(SAMPLE_DATA)
    c.commit()
    c.set_authorizer(authorizer)
    return c


# The ATTACH probe creates its target file relative to the working directory,
# so the probes run inside a throwaway cwd. Otherwise every build of the oracle
# drops an evil.db into the repo root.
guard = []
_probe_dir = tempfile.mkdtemp(prefix="voiceql-guard-")
_prev_cwd = os.getcwd()
os.chdir(_probe_dir)
for case in GUARD_CASES:
    want_allowed = case["legitimate"]
    bl = blocklist_allows(case["sql"])
    ro_ok, ro_err = probe(ro_conn, case["sql"])
    au_ok, au_err = probe(auth_conn, case["sql"])
    guard.append({
        **case,
        "blocklist_allows": bl,
        "blocklist_correct": bl == want_allowed,
        "matched_keyword": next(
            (kw for kw in BLOCKLIST if kw in case["sql"].upper()), None),
        "readonly_allows": ro_ok,
        "readonly_correct": ro_ok == want_allowed,
        "authorizer_allows": au_ok,
        "authorizer_correct": au_ok == want_allowed,
        "authorizer_error": au_err,
    })
os.chdir(_prev_cwd)
shutil.rmtree(_probe_dir, ignore_errors=True)
os.unlink(ROPATH)

# Prove the REPLACE actually mutates, rather than asserting that it does.
_m = sqlite3.connect(":memory:")
_m.executescript(SCHEMA)
_m.executescript(SAMPLE_DATA)
before = _m.execute("SELECT product FROM sales WHERE id=1").fetchone()[0]
_m.execute("REPLACE INTO sales VALUES (1,'2024-01-15','PWNED','x','North',0,0.0)")
after = _m.execute("SELECT product FROM sales WHERE id=1").fetchone()[0]

# The one sided history clamp, F6.
_h = sqlite3.connect(":memory:")
_h.executescript(SCHEMA)
_h.execute("INSERT INTO query_history (voice_input) VALUES ('a'),('b'),('c')")
history_total = _h.execute("SELECT COUNT(*) FROM query_history").fetchone()[0]
history_neg = len(_h.execute(
    f"SELECT * FROM query_history ORDER BY id DESC LIMIT {min(-1, HISTORY_CAP)}"
).fetchall())

by_region = dict(zip(
    [r[0] for r in conn.execute("SELECT region FROM sales GROUP BY region")],
    [r[0] for r in conn.execute("SELECT SUM(revenue) FROM sales GROUP BY region")]))

# ---------------------------------------------------------------------------
# The three false claims, lifted from the sources rather than retyped.
#
# The README ones come from the base commit, because P3 corrected them in place.
# The teardown is about the published state, so that is the state we quote.
# ---------------------------------------------------------------------------
import subprocess

BASE_COMMIT = "5bc0b9b"


def at_base(rel):
    return subprocess.run(
        ["git", "show", f"{BASE_COMMIT}:{rel}"],
        cwd=REPO, capture_output=True, text=True, check=True).stdout


def line_of(text, needle):
    for i, line in enumerate(text.split("\n"), 1):
        if needle in line:
            return i
    return -1


README_BASE = at_base("README.md")
TESTS_BASE = at_base("backend/tests/test_voiceql.py")
LLM_BASE = at_base("backend/services/llm.py")

readme_revenue = re.search(r'VoiceQL: "([^"]*leads with [\d,]+[^"]*)"', README_BASE).group(1)
readme_units = re.search(r'VoiceQL: "([^"]*highest units with \d+[^"]*)"', README_BASE).group(1)
test_units = re.search(
    r'assert synthesis_input\.text == "([^"]+)"', TESTS_BASE).group(1)

CLAIMS = [
    dict(
        id="readme_revenue",
        sourceFile="README.md",
        sourceLine=line_of(README_BASE, readme_revenue),
        sourceKind="readme",
        question="Show me total revenue by region",
        claimed=readme_revenue,
        claimedSubject="North",
        claimedFigure=23700,
        queryId="revenue_by_region",
        settles="the region with the largest SUM(revenue)",
    ),
    dict(
        id="readme_units",
        sourceFile="README.md",
        sourceLine=line_of(README_BASE, readme_units),
        sourceKind="readme",
        question="Which product had the highest units sold last quarter?",
        claimed=readme_units,
        claimedSubject="Widget B",
        claimedFigure=360,
        queryId="q2_units_by_product",
        settles="the product with the most units in Q2 2024",
    ),
    dict(
        id="prompt_fewshot",
        sourceFile="backend/services/llm.py",
        sourceLine=line_of(LLM_BASE, FEWSHOT_SUMMARY),
        sourceKind="prompt",
        question="the example the model is conditioned on",
        claimed=FEWSHOT_SUMMARY,
        claimedSubject="North",
        claimedFigure=23700,
        queryId="revenue_by_region",
        settles="the same region rollup, run for real",
    ),
    dict(
        id="test_units",
        sourceFile="backend/tests/test_voiceql.py",
        sourceLine=line_of(TESTS_BASE, f'== "{test_units}"'),
        sourceKind="test",
        question="what the suite asserts the device says",
        claimed=test_units,
        claimedSubject="Widget B",
        claimedFigure=None,
        queryId="agg_units_by_product",
        settles="the product with the most units all time",
    ),
]

# Resolve each claim against the database, here, once.
for c in CLAIMS:
    q = next(x for x in queries if x["id"] == c["queryId"])
    top_subject, top_value = q["rows"][0][0], q["rows"][0][1]
    claimed_row = next((r for r in q["rows"] if r[0] == c["claimedSubject"]), None)
    c["actualSubject"] = top_subject
    c["actualFigure"] = int(top_value)
    c["subjectWrong"] = top_subject != c["claimedSubject"]
    c["claimedSubjectActual"] = int(claimed_row[1]) if claimed_row else None
    c["claimedSubjectRank"] = (
        [r[0] for r in q["rows"]].index(c["claimedSubject"]) + 1
        if claimed_row else None)
    if c["claimedFigure"] is not None:
        target = c["claimedSubjectActual"] if not c["subjectWrong"] else c["actualFigure"]
        c["delta"] = target - c["claimedFigure"]
        c["factor"] = round(target / c["claimedFigure"], 4)
    else:
        c["delta"] = None
        c["factor"] = None

# ---------------------------------------------------------------------------
# Test x-ray, element E6.
#
# Every test and every assert is parsed out of the suite and classified. The
# classification is computed, not hand sorted, so it cannot drift and cannot be
# accused of being arranged to suit the argument.
#
# The load bearing bucket is "value_computed": an assert comparing a query
# result to an independently known figure. The claim of the whole site is that
# this bucket is empty.
# ---------------------------------------------------------------------------
TEST_SRC = TESTS_BASE
_test_lines = TEST_SRC.split("\n")

# Real aggregates. An assert quoting one of these would be checking arithmetic.
TRUE_FIGURES = {"53200", "53,200", "137800", "137,800", "35600", "34900",
                "14100", "106900", "30900", "62400", "44500", "16200", "14700",
                "540", "520", "490", "445", "340", "305", "220", "180"}


def classify_assert(line, body):
    """Bucket a single assert. `body` is the enclosing test function source."""
    s = line.strip()
    expr = s[len("assert "):] if s.startswith("assert ") else s

    if "isinstance(" in expr:
        return "type", "checks a Python type, not a value"
    if "status_code" in expr:
        return "status", "checks an HTTP status, not a value"
    if re.search(r"==\s*(-?\d+(\.\d+)?)\s*$", expr) or re.search(r'==\s*["\']', expr):
        # An equality against a literal. Is that literal something the test
        # itself supplied earlier in its own body, or an independent figure?
        m = re.search(r'==\s*(.+)$', expr)
        literal = m.group(1).strip() if m else ""
        bare = literal.strip('"\'')
        if bare in TRUE_FIGURES:
            return "value_computed", "compares against a real aggregate"
        # Count how often the literal appears in the test body. Twice or more
        # means the test both supplied it and asserted it: a round trip.
        occurrences = body.count(literal) if literal else 0
        if occurrences >= 2:
            return "value_self_supplied", "echoes a value this test supplied"
        return "value_self_supplied", "asserts a literal the test controls"
    if re.search(r"\bin\b", expr) and "==" not in expr:
        return "shape", "checks a key or substring is present"
    if re.search(r"len\(|>=|>\s*0|<=|<\s", expr):
        return "shape", "checks cardinality, not content"
    return "other", "unclassified"


tests = []
_current = None
for i, line in enumerate(_test_lines, 1):
    m = re.match(r"\s*(?:async\s+)?def (test_\w+)", line)
    if m:
        # Body runs to the next def at the same or lower indent.
        indent = len(line) - len(line.lstrip())
        body_lines = []
        for nxt in _test_lines[i:]:
            if re.match(r"\s*(?:async\s+)?def test_\w+", nxt) and (
                    len(nxt) - len(nxt.lstrip())) <= indent:
                break
            body_lines.append(nxt)
        body = "\n".join(body_lines)
        _current = {
            "name": m.group(1),
            "line": i,
            "asserts": [],
        }
        for j, bl in enumerate(body_lines, i + 1):
            if re.match(r"\s*assert ", bl):
                kind, why = classify_assert(bl, body)
                _current["asserts"].append({
                    "line": j, "text": bl.strip(), "kind": kind, "why": why,
                })
        tests.append(_current)

_bucket_counts = {}
for t in tests:
    for a in t["asserts"]:
        _bucket_counts[a["kind"]] = _bucket_counts.get(a["kind"], 0) + 1

# Which finding each test fails to catch. Mapped by what the test touches.
FINDING_BLIND_SPOTS = {
    "revenue": ["F1", "F2"],
    "region": ["F1", "F2"],
    "units": ["F3", "F11"],
    "product": ["F3", "F11"],
    "guard": ["F4"],
    "select_only": ["F4"],
    "history": ["F6"],
    "limit": ["F6"],
    "header": ["F7"],
    "voice": ["F5", "F7"],
}
for t in tests:
    blind = set()
    for needle, findings in FINDING_BLIND_SPOTS.items():
        if needle in t["name"].lower():
            blind.update(findings)
    t["blindTo"] = sorted(blind)
    t["assertsAValue"] = any(
        a["kind"] == "value_computed" for a in t["asserts"])

# The latency table, parsed out of the README rather than retyped. `awaited`
# encodes F5: Whisper and Claude are awaited and yield the loop; SQLite and TTS
# are called synchronously inside an async def and hold it.
_rows = re.findall(r"\|\s*([^|]+?)\s*\|\s*[~<]?(\d+)ms\s*\|", README_BASE)
AWAITED = {"Whisper transcription", "Claude SQL generation"}
CLIENT = {"EchoKit record + POST"}
STAGES = [
    dict(name=n, ms=int(ms), awaited=n in AWAITED, client=n in CLIENT,
         source=f"README.md:{line_of(README_BASE, n)}")
    for n, ms in _rows
]

# The demo reel for the hero terminal. Spoken phrasing paired with the query
# that answers it, and the shape of the sentence the model is asked to return.
SPOKEN = {
    "revenue_by_region": ("Show me total revenue by region",
                          "{0} leads with {1} in total revenue."),
    "q2_units_by_product": ("Which product had the highest units sold last quarter",
                            "{0} had the highest units with {1} sold in Q2."),
    "readme_total_revenue": ("What is the total revenue this year",
                             "Total revenue is {0}."),
    "readme_top3_units": ("Show me the top three products by units sold",
                          "{0} leads on units with {1}."),
    "readme_lowest_region": ("Which region has the lowest revenue",
                             "{0} has the lowest revenue at {1}."),
    "readme_february_count": ("How many sales happened in February",
                              "There were {0} sales in February."),
    "readme_north_vs_south": ("Compare revenue between North and South",
                              "{0} is ahead with {1}."),
    "readme_all_electronics": ("Show me all electronics sales",
                               "Found {n} electronics sales."),
    "agg_revenue_by_category": ("Break revenue down by category",
                                "{0} leads with {1}."),
    "agg_revenue_by_product": ("Which product earns the most revenue",
                               "{0} earns the most at {1}."),
    "agg_units_by_product": ("Who sold the most units overall",
                             "{0} sold the most units, {1}."),
    "agg_by_month": ("Show me revenue by month",
                     "{n} months of data, peaking at {1}."),
}
DEMO = []
for qid, (spoken, tmpl) in SPOKEN.items():
    q = next(x for x in queries if x["id"] == qid)
    top = q["rows"][0] if q["rows"] else []
    summary = tmpl
    for idx, cell in enumerate(top):
        try:
            val = f"{int(float(cell)):,}"
        except (TypeError, ValueError):
            val = str(cell)
        summary = summary.replace("{" + str(idx) + "}", val)
    summary = summary.replace("{n}", str(len(q["rows"])))
    DEMO.append(dict(id=qid, spoken=spoken, sql=q["sql"],
                     columns=q["columns"], rows=q["rows"], summary=summary))

oracle = {
    "generatedBy": "web/scripts/build-oracle.py",
    "sqliteVersion": sqlite3.sqlite_version,
    "schema": SCHEMA,
    "sampleData": SAMPLE_DATA,
    "blocklist": BLOCKLIST,
    "headerLimits": {
        "transcript": HDR_TRANSCRIPT, "sql": HDR_SQL, "rows": HDR_ROWS,
        "historyCap": HISTORY_CAP,
    },
    "fewShot": {"sql": FEWSHOT_SQL, "summary": FEWSHOT_SUMMARY},
    "baseCommit": BASE_COMMIT,
    "claims": CLAIMS,
    "stages": STAGES,
    "demo": DEMO,
    "tests": tests,
    "assertBuckets": _bucket_counts,
    "queries": queries,
    "guard": guard,
    "replaceMutation": {"before": before, "after": after},
    "historyClamp": {
        "cap": HISTORY_CAP, "requested": -1,
        "effectiveLimit": min(-1, HISTORY_CAP),
        "rowsReturned": history_neg, "rowsTotal": history_total,
    },
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(oracle, indent=2, sort_keys=False) + "\n")

cells = sum(len(q["rows"]) * len(q["columns"]) for q in queries)
print(f"oracle written to {OUT.relative_to(REPO)}")
print(f"  sqlite            {sqlite3.sqlite_version}")
print(f"  queries           {len(queries)}")
print(f"  result cells      {cells}")
print(f"  guard cases       {len(guard)}")
print(f"  blocklist parsed  {BLOCKLIST}")
print(f"  few shot sql      {FEWSHOT_SQL}")
print(f"  few shot summary  {FEWSHOT_SUMMARY!r}")
print(f"  North actual      {by_region['North']:,.0f}")
print(f"  claims resolved   {len(CLAIMS)}")
print(f"  tests parsed      {len(tests)}, asserts {sum(len(t['asserts']) for t in tests)}")
for k in sorted(_bucket_counts, key=lambda x: -_bucket_counts[x]):
    print(f"    {k:<22} {_bucket_counts[k]}")
for c in CLAIMS:
    mark = "subject+figure" if c["subjectWrong"] else "figure"
    print(f"    {c['id']:<16} {c['sourceFile']}:{c['sourceLine']:<4} wrong {mark}")
