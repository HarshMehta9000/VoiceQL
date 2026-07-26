/**
 * Gate 2 of 2, and the one that matters most.
 *
 * Every claim the site makes about the VoiceQL source is re-checked here
 * against the source itself. If upstream changes and a finding stops being
 * true, the build fails rather than the site quietly telling a lie.
 *
 * Two reading modes, on purpose:
 *
 *   published(path)  reads the file as it exists at BASE_COMMIT, the state the
 *                    world saw. The teardown is about that published state, and
 *                    P3 corrects the README's false demos in place, so those
 *                    claims must be checked against history rather than against
 *                    our own working tree.
 *
 *   working(path)    reads the current file. Used to assert that the backend
 *                    files this teardown analyses have NOT been altered by us,
 *                    so the analysis still describes real, shipped code.
 *
 * Run:  node scripts/verify-findings.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

/** The commit the teardown analyses. */
const BASE_COMMIT = "5bc0b9b";

let passed = 0;
const failures = [];

function check(name, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failures.push({ name, got, expected });
  return ok;
}

function published(rel) {
  return execFileSync("git", ["show", `${BASE_COMMIT}:${rel}`], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function working(rel) {
  return readFileSync(path.join(REPO, rel), "utf8");
}

/** 1-indexed line number of the first line matching `re`. */
function lineOf(text, re) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) if (re.test(lines[i])) return i + 1;
  return -1;
}

function countOf(text, re) {
  return (text.match(new RegExp(re, "g")) ?? []).length;
}

const README = published("README.md");
const LLM = published("backend/services/llm.py");
const QUERY = published("backend/routers/query.py");
const DB = published("backend/database/db.py");
const STT = published("backend/services/stt.py");
const MAIN = published("backend/main.py");
const TESTS = published("backend/tests/test_voiceql.py");
const INO = published("arduino/VoiceQL.ino");

// ---------------------------------------------------------------------------
// The backend files this teardown describes must still be the shipped ones.
// ---------------------------------------------------------------------------
const UNTOUCHED = [
  "backend/services/llm.py",
  "backend/routers/query.py",
  "backend/database/db.py",
  "backend/services/stt.py",
  "backend/main.py",
  "backend/tests/test_voiceql.py",
  "arduino/VoiceQL.ino",
];
for (const rel of UNTOUCHED) {
  check(`unmodified: ${rel}`, working(rel) === published(rel), true);
}

// ---------------------------------------------------------------------------
// F1  README's revenue demo states a figure the database contradicts
// ---------------------------------------------------------------------------
check("F1 README states 23,700", /23,700/.test(README), true);
check("F1 README credits North", /North leads with 23,700/.test(README), true);
check("F1 claim is on a known line", lineOf(README, /North leads with 23,700/) > 0, true);

// ---------------------------------------------------------------------------
// F2  the same false figure is in the production prompt and the tests
// ---------------------------------------------------------------------------
check("F2 SYSTEM_PROMPT exists", /SYSTEM_PROMPT/.test(LLM), true);
check("F2 few shot carries 23,700", /"summary": "North leads with 23,700 in revenue\."/.test(LLM), true);
check("F2 few shot sql is the region rollup",
  /"sql": "SELECT region, SUM\(revenue\) FROM sales GROUP BY region"/.test(LLM), true);
check("F2 the figure appears in the tests twice", countOf(TESTS, "23,700"), 2);

// ---------------------------------------------------------------------------
// F3  README's units demo names the wrong winner
// ---------------------------------------------------------------------------
check("F3 README states 360", /360/.test(README), true);
check("F3 README credits Widget B", /Widget B had the highest units with 360/.test(README), true);

// ---------------------------------------------------------------------------
// F4  the SQL guard is a substring blocklist
// ---------------------------------------------------------------------------
const blocklistMatch = QUERY.match(/for kw in \[(.*?)\]/s);
check("F4 blocklist is present", blocklistMatch !== null, true);
const KEYWORDS = [...blocklistMatch[1].matchAll(/"([A-Z]+)"/g)].map((m) => m[1]);
check("F4 blocklist contents", KEYWORDS,
  ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE"]);
check("F4 the test is a substring test", /kw in sql\.upper\(\)/.test(QUERY), true);
check("F4 it raises 403", /HTTPException\(status_code=403/.test(QUERY), true);
check("F4 the guard is duplicated in both endpoints",
  countOf(QUERY, "status_code=403"), 2);
check("F4 REPLACE is not blocked", KEYWORDS.includes("REPLACE"), false);
check("F4 ATTACH is not blocked", KEYWORDS.includes("ATTACH"), false);
check("F4 PRAGMA is not blocked", KEYWORDS.includes("PRAGMA"), false);
check("F4 no read only connection is used", /mode=ro/.test(DB), false);
check("F4 no authorizer is installed", /set_authorizer/.test(DB), false);

// ---------------------------------------------------------------------------
// F5  synthesize() and the sqlite calls block the event loop
// ---------------------------------------------------------------------------
check("F5 voice_query is async def", /async def voice_query/.test(QUERY), true);
check("F5 STT is awaited", /await transcribe_audio\(/.test(QUERY), true);
check("F5 LLM is awaited", /await generate_sql\(/.test(QUERY), true);
check("F5 synthesize is NOT awaited", /await synthesize\(/.test(QUERY), false);
check("F5 run_query is NOT awaited", /await run_query\(/.test(QUERY), false);
check("F5 log_query is NOT awaited", /await log_query\(/.test(QUERY), false);
check("F5 no threadpool anywhere", /run_in_threadpool/.test(QUERY), false);
check("F5 synthesize is called directly", /^\s*mp3_bytes = synthesize\(/m.test(QUERY), true);

// ---------------------------------------------------------------------------
// F6  the history limit clamp is one sided
// ---------------------------------------------------------------------------
const clamp = QUERY.match(/min\(limit,\s*(\d+)\)/);
check("F6 clamp is present", clamp !== null, true);
check("F6 clamp caps at 50", Number(clamp[1]), 50);
check("F6 there is no lower bound", /max\(limit/.test(QUERY), false);
check("F6 the limit is interpolated into SQL", /LIMIT \{min\(limit/.test(QUERY), true);

// ---------------------------------------------------------------------------
// F7  result rows travel in HTTP headers
// ---------------------------------------------------------------------------
check("F7 X-Results carries rows", /"X-Results": json\.dumps\(rows\[:3\]\)/.test(QUERY), true);
check("F7 X-SQL truncates at 200", /"X-SQL": sql\[:200\]/.test(QUERY), true);
check("F7 X-Transcript truncates at 80", /"X-Transcript": transcript\[:80\]/.test(QUERY), true);

// ---------------------------------------------------------------------------
// F8  print() leaks transcript and raw model output
// ---------------------------------------------------------------------------
check("F8 raw model output is printed", /print\(f"\[LLM\] Raw response: \{raw\}"\)/.test(LLM), true);
check("F8 the transcript is printed", /print\(f"\[STT\] Transcribed: /.test(STT), true);
check("F8 no logging module is used", /import logging/.test(LLM + STT + QUERY), false);

// ---------------------------------------------------------------------------
// F9  open CORS, no auth
// ---------------------------------------------------------------------------
check("F9 origins are wildcard", /allow_origins=\["\*"\]/.test(MAIN), true);
check("F9 methods are wildcard", /allow_methods=\["\*"\]/.test(MAIN), true);
check("F9 headers are wildcard", /allow_headers=\["\*"\]/.test(MAIN), true);
check("F9 README binds 0.0.0.0", /--host 0\.0\.0\.0/.test(README), true);
check("F9 no auth dependency", /Depends\(|APIKeyHeader|HTTPBearer/.test(QUERY), false);

// ---------------------------------------------------------------------------
// F10  blocking debounce inside a non blocking state machine
// ---------------------------------------------------------------------------
check("F10 delay(50) debounce is present", /delay\(50\);\s*\/\/ debounce/.test(INO), true);
check("F10 it sits in a state machine", /IDLE|RECORDING|SENDING|PLAYING|ERROR_STATE/.test(INO), true);

// ---------------------------------------------------------------------------
// F11  a third false claim, inside the test suite
// ---------------------------------------------------------------------------
check("F11 the test asserts Widget B leads on units",
  /assert synthesis_input\.text == "Widget B sold the most units\."/.test(TESTS), true);

// ---------------------------------------------------------------------------
// The spine: 22 tests, and not one asserts a computed result value
// ---------------------------------------------------------------------------
const testCount = countOf(TESTS, "def test_");
check("22 tests", testCount, 22);

const asserts = TESTS.split("\n").filter((l) => /^\s*assert /.test(l));
check("50 assert statements", asserts.length, 50);

// Every equality assertion is either a round trip of a value the test itself
// supplied, or an echo of a mocked return. None checks a query aggregate.
const VALUE_EQUALITY_IS_SELF_SUPPLIED = [
  'rows[-1]["voice_input"] == "test question"',
  'rows[-1]["latency_ms"] == 250',
  'result["sql"] == "SELECT region, SUM(revenue) FROM sales GROUP BY region"',
  'result["sql"] == "SELECT 1"',
  'result == "test transcript"',
  'synthesis_input.text == "Widget B sold the most units."',
];
for (const frag of VALUE_EQUALITY_IS_SELF_SUPPLIED) {
  check(`self supplied equality present: ${frag.slice(0, 34)}`, TESTS.includes(frag), true);
}

// The load bearing negative: no test compares a query result to a real total.
const REAL_AGGREGATES = ["53200", "53,200", "137800", "137,800", "35600", "34900", "14100"];
for (const n of REAL_AGGREGATES) {
  check(`no test asserts the true figure ${n}`, TESTS.includes(n), false);
}
check("no test asserts a revenue total at all", /assert\s+.*SUM\(revenue\).*==\s*\d/.test(TESTS), false);

// ---------------------------------------------------------------------------
// The correction itself must be right.
//
// P3 rewrote the README's two demo blocks. Those replacement figures were typed
// by a human, so they are checked against the oracle rather than trusted. If
// anyone "fixes" this README again with another invented number, this fails.
// ---------------------------------------------------------------------------
const oracle = JSON.parse(
  readFileSync(path.join(REPO, "web/src/data/oracle.json"), "utf8"),
);
const READMENOW = working("README.md");


// The example answers in the README are generated from the database. Each one
// must still be exactly what the query returns, so a stale README fails here
// rather than shipping a number the product does not produce.
for (const d of oracle.demo.slice(0, 8)) {
  check(`README example present: ${d.spoken.slice(0, 30)}`,
    READMENOW.includes(`| "${d.spoken}" | "${d.summary}" |`), true);
}
check("README quotes the true revenue leader",
  READMENOW.includes("North leads with 53,200 in total revenue."), true);
check("README quotes the true Q2 unit leader",
  READMENOW.includes("Gadget X had the highest units with 340 sold in Q2."), true);
check("README no longer states the old revenue figure",
  /23,700/.test(READMENOW), false);
check("README no longer states the old Q2 figure",
  /highest units with 360/.test(READMENOW), false);
check("README links the interactive walkthrough", /\(web\/\)/.test(READMENOW), true);

// ---------------------------------------------------------------------------
// Test x-ray (E6). The classification is computed by build-oracle.py, so these
// assertions check the computation, not a hand sorted list.
// ---------------------------------------------------------------------------
check("x-ray parsed every test", oracle.tests.length, testCount);
check("x-ray parsed every assert",
  oracle.tests.reduce((n, t) => n + t.asserts.length, 0), asserts.length);

const buckets = oracle.assertBuckets;
check("buckets account for every assert",
  Object.values(buckets).reduce((a, b) => a + b, 0), asserts.length);

// The whole argument of the site, as a number.
check("no assert compares against a computed result",
  buckets.value_computed ?? 0, 0);
check("the suite is mostly shape checks", buckets.shape, 30);
check("eight equality asserts, all self supplied", buckets.value_self_supplied, 8);
check("no assert is left unclassified", buckets.other ?? 0, 0);

// The async tests must be in there. Six of the 22 are `async def`, and a parser
// that only matched `def test_` silently dropped them while still totalling the
// right number of asserts, which is exactly the kind of quiet miscount this
// project is about.
check("async tests were parsed",
  oracle.tests.filter((t) => /voice|query_endpoint|history|health/.test(t.name)).length > 0,
  true);
check("every parsed test has a source line",
  oracle.tests.every((t) => t.line > 0), true);
check("the claim carrying test is line 278",
  oracle.tests.some((t) => t.asserts.some((a) => a.line === 278)), true);

// ---------------------------------------------------------------------------
// Claims (E2). Four instances of three wrong assertions.
// ---------------------------------------------------------------------------
check("four claims resolved", oracle.claims.length, 4);
for (const c of oracle.claims) {
  check(`claim ${c.id}: has a real source line`, c.sourceLine > 0, true);
  check(`claim ${c.id}: resolves to a real subject`,
    typeof c.actualSubject === "string" && c.actualSubject.length > 0, true);
}
check("two claims name the wrong subject entirely",
  oracle.claims.filter((c) => c.subjectWrong).length, 2);
check("the README revenue claim is off by 29,500",
  oracle.claims.find((c) => c.id === "readme_revenue").delta, 29500);
check("the prompt repeats the same wrong figure",
  oracle.claims.find((c) => c.id === "prompt_fewshot").claimedFigure,
  oracle.claims.find((c) => c.id === "readme_revenue").claimedFigure);
check("Widget B is fourth on all time units",
  oracle.claims.find((c) => c.id === "test_units").claimedSubjectRank, 4);

// ---------------------------------------------------------------------------
// Latency arithmetic, section 4d
// ---------------------------------------------------------------------------
const steps = [...README.matchAll(/\|\s*[^|]*?\|\s*[~<]?(\d+)ms\s*\|/g)].map((m) => Number(m[1]));
check("5 timed steps in the README table", steps.length, 5);
check("they sum to 2010ms", steps.reduce((a, b) => a + b, 0), 2010);
check("README labels the total ~2s", /\*\*~2s\*\*/.test(README), true);
check("the record and POST step is 200ms", steps[0], 200);
check("X-Latency-Ms covers 1810ms of it", 2010 - steps[0], 1810);

// ---------------------------------------------------------------------------
console.log("=".repeat(58));
if (failures.length) {
  console.log(`FINDINGS GATE FAILED  ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) {
    console.log(`  FAIL ${f.name}`);
    console.log(`       got      ${JSON.stringify(f.got)}`);
    console.log(`       expected ${JSON.stringify(f.expected)}`);
  }
  process.exit(1);
}
console.log(`FINDINGS GATE PASSED  ${passed} assertions`);
console.log(`  11 findings still reproduce against ${BASE_COMMIT}`);
console.log(`  ${testCount} tests, ${asserts.length} asserts, 0 assert a computed result`);
