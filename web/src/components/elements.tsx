"use client";

/**
 * Showcase elements. These exist to make VoiceQL legible and playable: ask it
 * things, see the SQL it writes, explore the data it answers from, and see
 * where the two seconds go.
 *
 * Every figure comes from the shared sql.js engine at render time.
 */
import { useCallback, useMemo, useState } from "react";
import { useAutopilot } from "./use-autopilot";
import { useNow, progress } from "./use-now";
import { useEngine } from "./engine-context";
import { group, type QueryResult } from "@/lib/engine";

function Section({
  id, kicker, title, blurb, source, children,
}: {
  id: string; kicker: string; title: string; blurb: string; source: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-3 text-lg font-medium">
          <span className="eyebrow" style={{ color: "var(--brand)" }}>{kicker}</span>
          {title}
        </h2>
        <code className="mono text-xs" style={{ color: "var(--ink-muted)" }}>{source}</code>
      </div>
      <p className="mb-5 max-w-3xl text-sm" style={{ color: "var(--ink-secondary)" }}>
        {blurb}
      </p>
      {children}
    </section>
  );
}

function ResultTable({ result, reveal }: { result: QueryResult; reveal?: number }) {
  if (result.error) {
    return (
      <div className="mono rounded-md p-3 text-xs"
        style={{ background: "#1b1211", color: "var(--alarm)" }}>
        SQLite says: {result.error}
      </div>
    );
  }
  if (result.empty || !result.columns.length) {
    return <div className="mono p-3 text-xs" style={{ color: "var(--ink-muted)" }}>
      No rows returned.
    </div>;
  }
  return (
    <div className="scroll-x">
      <table className="grid-table">
        <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} style={reveal === undefined ? undefined : {
              opacity: Math.max(0, Math.min(1, (reveal - i * 55) / 180)),
              transform: `translateY(${(1 - Math.max(0, Math.min(1, (reveal - i * 55) / 180))) * 4}px)`,
            }}>
              {row.map((cell, j) => (
                <td key={j} className={typeof cell === "number" ? "num" : ""}>
                  {typeof cell === "number" ? group(cell) : String(cell ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------------------------------- ask it anything --- */

export function AskAnything() {
  const { engine, ready, oracle } = useEngine();
  const presets = useMemo(
    () => oracle.queries.filter((q) => q.source.includes("example")),
    [oracle],
  );
  const summaryFor = useCallback(
    (id: string) => oracle.demo.find((d) => d.id === id)?.summary ?? "",
    [oracle],
  );

  const [picked, setPicked] = useState(presets[0]?.id ?? "");
  const [draft, setDraft] = useState(presets[0]?.sql ?? "SELECT * FROM sales");
  const [runSql, setRunSql] = useState(presets[0]?.sql ?? "SELECT * FROM sales");
  const [startedAt, setStartedAt] = useState(0);

  const now = useNow();
  const elapsed = startedAt ? now - startedAt : 99999;

  // The agent's steps, as a timeline. Each has a window; the rail below marks
  // whichever is live so the section always reads as mid work.
  const STEPS = [
    { key: "schema", label: "reading schema", at: 0, to: 420 },
    { key: "generate", label: "generating SQL", at: 420, to: 1400 },
    { key: "execute", label: "executing", at: 1400, to: 1780 },
    { key: "speak", label: "summarising", at: 1780, to: 2200 },
  ] as const;
  const stepIndex = STEPS.findIndex((s) => elapsed >= s.at && elapsed < s.to);
  const typeP = progress(elapsed, 420, 1400);
  const scanP = progress(elapsed, 1400, 1780);
  const revealed = elapsed >= 1780;

  const result = useMemo(
    () => (engine && ready ? engine.run(runSql) : null),
    [engine, ready, runSql],
  );

  const ask = useCallback((id: string) => {
    const q = presets.find((p) => p.id === id);
    if (!q) return;
    setPicked(id);
    setDraft(q.sql);
    setRunSql(q.sql);
    setStartedAt(performance.now());
  }, [presets]);

  const next = useCallback(() => {
    if (!presets.length) return;
    const at = presets.findIndex((p) => p.id === picked);
    ask(presets[(at + 1) % presets.length].id);
  }, [presets, picked, ask]);
  const { takeOver, auto } = useAutopilot(next, 3400);

  const question = presets.find((p) => p.id === picked)?.natural ?? "";
  const summary = summaryFor(picked);
  const shownSql = revealed ? draft : draft.slice(0, Math.ceil(typeP * draft.length));

  return (
    <Section id="ask" kicker="01" title="Ask it anything"
      source="backend/services/llm.py"
      blurb="Watch the agent work: it reads the schema, writes SQL a token at a
        time, runs it against the twelve rows, then phrases the answer. Questions
        cycle on their own; click one to hold it, or edit the SQL and run it.">
      <div className="mb-4 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p.id} type="button"
            onClick={() => { takeOver(); ask(p.id); }} disabled={!ready}
            className="mono rounded-full px-3 py-1.5 text-[11px]"
            style={{
              background: picked === p.id ? "var(--raised)" : "transparent",
              border: `1px solid ${picked === p.id ? "var(--brand)" : "var(--hairline)"}`,
              color: picked === p.id ? "var(--ink)" : "var(--ink-muted)",
              transition: "border-color 200ms, background 200ms",
            }}>
            &ldquo;{p.natural}&rdquo;
          </button>
        ))}
      </div>

      {/* step rail */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STEPS.map((st, i) => {
          const done = elapsed >= st.to;
          const live = i === stepIndex;
          return (
            <span key={st.key} className="flex items-center gap-2">
              <span className="mono flex items-center gap-2 rounded-full px-3 py-1 text-[10px]"
                style={{
                  border: `1px solid ${live ? "var(--brand)" : done ? "var(--data)" : "var(--hairline)"}`,
                  color: live ? "var(--ink)" : done ? "var(--data)" : "var(--ink-muted)",
                  background: live ? "var(--raised)" : "transparent",
                }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: live ? "var(--brand)" : done ? "var(--data)" : "var(--baseline)",
                  opacity: live ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 130)) : 1,
                }} />
                {st.label}
              </span>
              {i < STEPS.length - 1 && <span style={{ color: "var(--hairline)" }}>&rarr;</span>}
            </span>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="panel p-4">
          <div className="mono mb-3 text-sm">
            <span style={{ color: "var(--ink-muted)" }}>you &gt; </span>
            <span style={{ color: "var(--ink)" }}>&ldquo;{question}&rdquo;</span>
          </div>

          <div className="eyebrow mb-2">the SQL it writes</div>
          <div className="relative">
            <textarea
              value={shownSql}
              onChange={(e) => { takeOver(); setStartedAt(0); setDraft(e.target.value); }}
              spellCheck={false} rows={2}
              className="mono w-full rounded-md p-3 text-xs"
              style={{
                background: "var(--raised)", color: "var(--brand)",
                border: `1px solid ${typeP > 0 && typeP < 1 ? "var(--brand)" : "var(--hairline)"}`,
                resize: "vertical", transition: "border-color 200ms",
              }} />
            {typeP > 0 && typeP < 1 && (
              <span className="mono absolute text-[10px]"
                style={{
                  right: 10, top: 10, color: "var(--brand)",
                  opacity: Math.round(now / 120) % 2 ? 1 : 0.25,
                }}>
                {Math.round(typeP * 100)}%
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => { takeOver(); setRunSql(draft); setStartedAt(performance.now()); }}
              disabled={!ready}
              className="mono rounded px-3 py-1.5 text-xs"
              style={{ background: "var(--brand)", color: "#04121f", opacity: ready ? 1 : 0.4 }}>
              {ready ? "run it" : "loading SQLite..."}
            </button>
            {scanP > 0 && scanP < 1 && (
              <span className="mono text-xs" style={{ color: "var(--warning)" }}>
                scanning {Math.round(scanP * 12)}/12 rows
              </span>
            )}
            {revealed && result && !result.error && (
              <span className="mono text-xs" style={{ color: "var(--data)" }}>
                {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
              </span>
            )}
            <span className="mono ml-auto text-[10px]" style={{ color: "var(--ink-muted)" }}>
              {auto ? "cycling" : "paused"}
            </span>
          </div>

          <div className="mt-4" style={{ minHeight: 132 }}>
            {revealed && result
              ? <ResultTable result={result} reveal={elapsed - 1780} />
              : (
                <div className="mono p-3 text-xs" style={{ color: "var(--ink-muted)" }}>
                  {scanP > 0
                    ? <span style={{ color: "var(--warning)" }}>running against SQLite...</span>
                    : "waiting on the agent"}
                </div>
              )}
          </div>

          {revealed && summary && (
            <div className="mono mt-3 text-sm">
              <span style={{ color: "var(--ink-muted)" }}>speaker &gt; </span>
              <span style={{ color: "var(--data)" }}>&ldquo;{summary}&rdquo;</span>
            </div>
          )}
        </div>

        {/* what the model is given */}
        <div className="panel p-4">
          <div className="eyebrow mb-2">schema it is shown</div>
          {[
            { t: "sales", c: ["id", "date", "product", "category", "region", "units", "revenue"] },
            { t: "query_history", c: ["id", "timestamp", "voice_input", "generated_sql", "result_summary", "latency_ms"] },
          ].map((tbl, ti) => (
            <div key={tbl.t} className="mb-3">
              <div className="mono mb-1 text-[11px]" style={{ color: "var(--ink)" }}>
                {tbl.t}
              </div>
              <div className="flex flex-wrap gap-1">
                {tbl.c.map((col, ci) => {
                  const lit = stepIndex === 0
                    && (ti * 7 + ci) <= progress(elapsed, 0, 420) * 13;
                  const used = revealed && runSql.toLowerCase().includes(col.toLowerCase());
                  return (
                    <span key={col} className="mono rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        border: `1px solid ${lit ? "var(--brand)" : used ? "var(--data)" : "var(--hairline)"}`,
                        color: lit ? "var(--brand)" : used ? "var(--data)" : "var(--ink-muted)",
                        transition: "color 200ms, border-color 200ms",
                      }}>
                      {col}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="mono mt-2 text-[10px]" style={{ color: "var(--ink-muted)" }}>
            columns in green are the ones this query touches
          </div>
        </div>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- the dataset --- */

export function DataExplorer() {
  const { engine, ready, revision } = useEngine();
  const [dim, setDim] = useState<"region" | "category" | "product">("region");
  const [startedAt, setStartedAt] = useState(0);

  const now = useNow();
  const elapsed = startedAt ? now - startedAt : 99999;
  const grow = progress(elapsed, 180, 900);
  const querying = elapsed < 180;

  const sql = `SELECT ${dim}, SUM(revenue), SUM(units) FROM sales GROUP BY ${dim} ORDER BY 2 DESC`;

  const rows = useMemo(() => {
    if (!engine || !ready) return [];
    void revision;
    const r = engine.run(
      `SELECT ${dim} AS k, SUM(revenue) AS revenue, SUM(units) AS units
       FROM sales GROUP BY ${dim} ORDER BY revenue DESC`,
    );
    return r.rows.map((x) => ({
      k: String(x[0]), revenue: Number(x[1]), units: Number(x[2]),
    }));
  }, [engine, ready, dim, revision]);

  const total = rows.reduce((a, r) => a + r.revenue, 0);
  const peak = Math.max(1, ...rows.map((r) => r.revenue));

  const dims = ["region", "category", "product"] as const;
  const change = useCallback((d: typeof dims[number]) => {
    setDim(d);
    setStartedAt(performance.now());
  }, []);
  const next = useCallback(() => {
    setDim((d) => {
      const nd = dims[(dims.indexOf(d) + 1) % dims.length];
      return nd;
    });
    setStartedAt(performance.now());
    // `dims` is a module-stable literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { takeOver, auto } = useAutopilot(next, 3200);

  return (
    <Section id="data" kicker="02" title="The data it answers from"
      source="backend/database/db.py"
      blurb="Twelve rows of sales, the sample set the project ships with. The
        grouping rotates on its own; every bar is a live SUM() over the same in
        browser database the questions above run against.">
      <div className="mb-3 flex flex-wrap gap-2">
        {dims.map((d) => (
          <button key={d} type="button" onClick={() => { takeOver(); change(d); }}
            className="mono rounded-full px-3 py-1.5 text-[11px]"
            style={{
              background: dim === d ? "var(--raised)" : "transparent",
              border: `1px solid ${dim === d ? "var(--brand)" : "var(--hairline)"}`,
              color: dim === d ? "var(--ink)" : "var(--ink-muted)",
              transition: "border-color 200ms, background 200ms",
            }}>
            by {d}
          </button>
        ))}
        <span className="mono self-center text-[10px]" style={{ color: "var(--ink-muted)" }}>
          {auto ? "cycling" : "paused"}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <code className="mono text-[11px]" style={{
          color: querying ? "var(--warning)" : "var(--brand)",
        }}>
          {sql}
        </code>
        {querying && (
          <span className="mono text-[10px]" style={{ color: "var(--warning)" }}>
            regrouping...
          </span>
        )}
      </div>

      <div className="panel p-4">
        {rows.map((r, i) => {
          const g = Math.max(0, Math.min(1, grow * 1.25 - i * 0.08));
          return (
            <div key={r.k} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="mono text-xs" style={{ color: "var(--ink)" }}>{r.k}</span>
                <span className="mono text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {group(r.revenue * g)}
                  <span style={{ color: "var(--ink-muted)" }}>
                    {" "}&middot; {group(r.units * g)} units
                  </span>
                </span>
              </div>
              <div style={{ height: 10, background: "var(--raised)", borderRadius: 5 }}>
                <div style={{
                  height: 10, borderRadius: 5,
                  width: `${(r.revenue / peak) * 100 * g}%`,
                  background: "var(--brand)",
                  boxShadow: g < 1 ? "0 0 8px var(--brand)" : "none",
                }} />
              </div>
            </div>
          );
        })}
        <div className="mono mt-4 border-t pt-3 text-xs"
          style={{ borderColor: "var(--hairline)", color: "var(--ink-muted)" }}>
          {group(total * Math.min(1, grow * 1.25))} total revenue across 12 rows
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------ latency budget --- */

export function LatencyBudget() {
  const { oracle } = useEngine();
  const stages = oracle.stages;
  const total = stages.reduce((a, s) => a + s.ms, 0);
  const [hover, setHover] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const now = useNow();

  // A playhead runs the pipeline end to end, over and over. Whichever stage it
  // is inside is the highlighted one, so the chart reads as a live request
  // rather than a static breakdown.
  const cycleMs = total + 700;
  const head = manual ? 0 : (now % cycleMs);
  const liveStage = (() => {
    let acc = 0;
    for (const s of stages) {
      acc += s.ms;
      if (head < acc) return s.name;
    }
    return null;
  })();
  const active = manual ? hover : liveStage;
  const takeOver = useCallback(() => setManual(true), []);
  const auto = !manual;

  return (
    <Section id="budget" kicker="03" title="Where the two seconds go"
      source="README.md latency table"
      blurb="Button press to spoken answer, broken down by stage. Hover a band to
        isolate it. Speech to text and the model dominate; the database is the
        cheapest thing in the whole pipeline.">
      <div className="panel p-4">
        <div className="relative mb-4 flex h-10 overflow-hidden rounded-md">
          {!manual && head <= total && (
            <span aria-hidden style={{
              position: "absolute", top: 0, bottom: 0, width: 2,
              left: `${(head / total) * 100}%`,
              background: "#fff", boxShadow: "0 0 10px #fff", zIndex: 2,
            }} />
          )}
          {stages.map((s, i) => (
            <div key={s.name}
              onMouseEnter={() => { takeOver(); setHover(s.name); }}
              title={`${s.name} ${s.ms}ms`}
              style={{
                width: `${(s.ms / total) * 100}%`,
                background: [
                  "var(--ink-muted)", "var(--brand)", "#6da7ec",
                  "var(--data)", "var(--warning)",
                ][i],
                opacity: active && active !== s.name ? 0.28 : 1,
                transition: "opacity 150ms",
                minWidth: 3,
              }} />
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {stages.map((s, i) => (
            <div key={s.name}
              onMouseEnter={() => { takeOver(); setHover(s.name); }}
              className="flex items-baseline justify-between gap-3 rounded px-2 py-1"
              style={{ background: active === s.name ? "var(--raised)" : "transparent" }}>
              <span className="flex items-baseline gap-2">
                <span style={{
                  width: 9, height: 9, borderRadius: 2, display: "inline-block",
                  background: [
                    "var(--ink-muted)", "var(--brand)", "#6da7ec",
                    "var(--data)", "var(--warning)",
                  ][i],
                }} />
                <span className="mono text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {s.name}
                </span>
              </span>
              <span className="mono text-xs" style={{ color: "var(--ink)" }}>
                {s.ms}ms
                <span style={{ color: "var(--ink-muted)" }}>
                  {" "}({Math.round((s.ms / total) * 100)}%)
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-baseline gap-3 border-t pt-3"
          style={{ borderColor: "var(--hairline)" }}>
          <span className="mono text-2xl" style={{ color: "var(--ink)" }}>
            {(total / 1000).toFixed(2)}s
          </span>
          <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>
            end to end, inside the 3 second target
          </span>
          <span className="mono ml-auto text-[10px]" style={{ color: "var(--ink-muted)" }}>
            {auto
              ? `t+${String(Math.min(Math.round(head), total)).padStart(4, "0")}ms`
              : "paused"}
          </span>
        </div>
      </div>
    </Section>
  );
}
