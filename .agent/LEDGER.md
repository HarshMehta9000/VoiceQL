# Ledger

updated: 2026-07-26T18:05:00Z
phase: 3 of 8  (repo reorganisation)
task: T3.3  README corrected, CI extended, committed
status: done
next command: P4 media generation. Read `node_modules/next/dist/docs/` before any component in P5.

## Done

- [x] T1.1 preflight. Node 20.20.2, 9.7G free, RAM 1.9G total, SQLite 3.40.0,
      Source Code Pro 14 faces, Noto Sans 10 faces.
- [x] T1.2 `/home/ec2-user/node20` reinstalled. It had been deleted earlier the
      same session during a disk cleanup, the exact failure section 2 warns
      about. System Node is 18.20.8 and cannot build Next 16.
- [x] T1.3 cloned to `/home/ec2-user/voiceql` at 5bc0b9b, 248K, 20 files.
- [x] T1.4 all ten brief findings re-derived with real sqlite3, plus one new.
- [x] T2.1 scaffolded Next 16.2.12 + React 19.2.4 + Tailwind 4 into `web/`,
      app router, src dir, no turbopack. 371 packages.
- [x] T2.2 vendored sql.js 1.14.1 into `web/public/sql/`
      (`sql-wasm.wasm` 644K, `sql-wasm.js` 45K). Never a CDN.
- [x] T2.3 `web/scripts/build-oracle.py`, 20 queries, 268 result cells,
      6 guard cases, written to `web/src/data/oracle.json`.
- [x] T2.4 `web/scripts/verify-oracle.mjs`, **382 assertions**, sql.js output
      identical to Python sqlite3 on every cell.
- [x] T2.5 `web/scripts/verify-findings.mjs`, **73 assertions**, all 11 findings
      reproduce against 5bc0b9b.
- [x] T2.6 four gates green: tsc clean, eslint clean, both verifiers, next build
      succeeds. Zero dashes in my files.
- [x] T3.1 README's two false demo blocks corrected in place, with a note that
      names the old figures, says why they were wrong, and points at `web/`.
      The rest of the README is untouched; P6 restructures it for the GIFs.
- [x] T3.2 seven new assertions that check the correction itself against the
      oracle, so a future wrong "fix" fails the build. Mutation tested both
      ways: 53,200 to 53,201 fails, Gadget X to Widget A fails.
- [x] T3.3 `.github/workflows/ci.yml` extended. Original `test` job preserved
      byte for byte; new `gates` job added.

**462 assertions total**, against a target of 150.

## Blocked

- none

## Corrections to the buildout brief

Load bearing. The site follows the repo, not the brief.

1. **F4: `mode=ro` is not the fix. `set_authorizer` is.** The brief offers them
   as equivalent. Measured on the six cases:
   - substring blocklist: **0 of 6**. Every single case is decided wrongly.
   - `mode=ro`: **4 of 6**. It cures the over blocking completely, all three
     legitimate reads pass, but it stops only `REPLACE`. `ATTACH DATABASE` and
     `PRAGMA table_info` both execute normally on a read only connection.
   - `set_authorizer`: **6 of 6**.
   E3 must show `set_authorizer`. Showing `mode=ro` as "the fix" would put a
   panel on the page that visibly fails two of its own cases. Keep `mode=ro` in
   the bench as the middle column: "the obvious fix, still not enough" is a
   better beat than a straight before and after.

2. **`SELECT created_at FROM query_history` is not a valid query.** The column
   is `timestamp`. It fails with "no such column" on every connection, so it
   cannot demonstrate over blocking. Replaced with a real audit query,
   `SELECT voice_input, generated_sql FROM query_history WHERE generated_sql
   LIKE '%DROP%'`, which is legitimate, uses only real columns, and is blocked
   for the right reason: `DROP` is a substring of its own search term. Note this
   replacement is what moved `mode=ro` from 3 of 6 to 4 of 6.

3. **"Not one test asserts a value" is too strong.** Six assertions compare with
   `==`. The verified claim is: *no test asserts the numeric correctness of any
   query result.* Every `==` is a round trip of a value the test itself inserted
   (lines 103, 104) or an echo of a mocked return (137, 186, 240, 278). E6 needs
   a fourth bucket, "asserts a value the test supplied", or it mis-sorts six
   cards. `verify-findings.mjs` pins this both ways: it asserts all six
   self supplied equalities exist, and asserts no test contains any of the seven
   true aggregate figures.

## Corrections to my own P1 recon

Both were caught by the gates, which is the point of the gates.

- The test suite has **50** assert statements, not 47. I miscounted the P1
  listing by hand.
- The guard raises `HTTPException(status_code=403, ...)`, not
  `HTTPException(403, ...)`. It also appears **twice**, at `query.py:44` and
  `query.py:88`, because `voice_query` and `text_query` each carry their own
  copy of the blocklist. F5's event loop problem is likewise duplicated:
  `text_query` calls `run_query` and `log_query` directly at lines 91 and 96.

## New finding, not in the brief

**F11. A third false claim, inside the test suite.**
`backend/tests/test_voiceql.py:278` asserts the TTS layer is handed
`"Widget B sold the most units."` All time units by product: Gadget X 540,
Widget A 520, Gadget Y 490, Widget B 445. Widget B is last, not first.

So this is not two bad README demos. It is three false claims spanning README,
production prompt and test suite, and each names a winner or a figure the
database contradicts. The test suite does not merely fail to catch the bug, it
encodes a third instance of it. That is the spine of the site.

## Verified, unchanged from the brief

F1 North 53,200 not 23,700, off by 29,500, factor 2.24x, and 23,700 matches 0 of
11 candidate aggregates. F2 the figure sits in `llm.py:26` SYSTEM_PROMPT,
`README.md:16`, and `test_voiceql.py` at 122 and 258. F3 Q2 winner is Gadget X
340; Widget B had 220 in Q2 and 445 all time; 360 matches nothing. F5
`voice_query` is `async def`, awaits STT and LLM, calls `run_query`,
`synthesize` and `log_query` directly at query.py 47, 51, 54. F6 `min(limit,50)`
is one sided, `?limit=-1` yields `LIMIT -1` and returns the whole table. F7
`X-Results` carries 3 rows at about 128 bytes each, latin-1 only, 8KB ceiling
near 64 rows. F8 five `print()` calls leak transcript and raw model output, no
`logging` import anywhere. F9 all three CORS lists are `["*"]`, README line 126
says `--host 0.0.0.0`, no auth dependency. F10 `delay(50)` debounce at
`VoiceQL.ino:103`.

Reference aggregates reproduced exactly, in both engines: total 137,800; North
53,200 / East 35,600 / South 34,900 / West 14,100; Electronics 106,900 /
Accessories 30,900; Widget A 62,400 / Widget B 44,500 / Gadget X 16,200 /
Gadget Y 14,700; Q2 units Gadget X 340 / Widget A 305 / Widget B 220 /
Gadget Y 180.

README latency table sums to 2,010ms and is labelled "~2s". `X-Latency-Ms`
starts after the request arrives, so it excludes the 200ms record and POST row
and covers 1,810ms of the 2,010ms claim.

Test suite is 22 tests, 50 asserts. The six README example queries are at
`README.md:167` to `172` and are wired into E1 as presets.

## Decisions

- **Oracle parses the backend, never transcribes it.** `SCHEMA`, `SAMPLE_DATA`,
  the few shot SQL and summary, the blocklist keywords, the header truncation
  limits and the history cap are all regex extracted from the Python sources at
  build time. If upstream edits any of them the oracle changes and the gate
  fails. Every future gate must do the same.
- **`canon()` is duplicated in Python and JS on purpose.** JS collapses 14400.0
  to 14400 on serialisation and Python does not, so both sides normalise
  integral floats to integer strings before comparing. The two implementations
  must stay in sync; they are the only reason cell comparison is byte exact.
- **`verify-findings.mjs` reads from `git show 5bc0b9b:<path>`, not the working
  tree.** P3 corrects the README's false demos in place, so a gate reading the
  working tree would fail the moment we fix the thing we are documenting. The
  teardown is about the published state. The gate separately asserts the seven
  backend files we analyse are byte identical to the base commit, so the
  analysis always describes real shipped code.
- **sql.js loaded via `locateFile` from `public/sql/`** in the gate as well as
  the browser, so the gate proves the exact artifact the page will fetch.
- `backend/tests/`, not `tests/`. The brief's 4b F2 path is wrong.
- `web/AGENTS.md` arrived from the create-next-app template and warns that
  Next 16 has breaking changes and that `node_modules/next/dist/docs/` must be
  read before writing components. **Read it in P5.** Merge that warning into the
  P6 handoff rather than overwriting the file.
- Upstream `docs/WIRING.md` and the README carry em dashes. The README gets
  cleaned when P3 and P6 rewrite it. WIRING.md is left alone, since P3 says do
  not churn the tidy parts of the repo.

## Gate commands

```
cd web
npx tsc --noEmit
npx eslint src scripts
npm run verify:oracle      # 382 assertions
npm run verify:findings    # 73 assertions
npm run build
npm run gates              # all of the above in order
python3 scripts/build-oracle.py   # regenerate the oracle after a backend change
```
