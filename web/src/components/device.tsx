"use client";

/**
 * VoiceQL, running.
 *
 * The real state machine from arduino/VoiceQL.ino
 * (IDLE / RECORDING / SENDING / PLAYING / ERROR_STATE), the real per stage
 * timings from the README's latency table, and the real SQL executed against
 * the shared sql.js engine. The summary the device speaks is generated from
 * whatever the database actually returns, so this is a simulation of the
 * pipeline, not a replay of a recording.
 *
 * Board is an Arduino Uno R4 WiFi at its real footprint, 68.6 x 53.4mm, with
 * the SSD1306 128x64 OLED and the 12x8 LED matrix the R4 actually has.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutopilot } from "./use-autopilot";
import { useNow } from "./use-now";
import { useEngine } from "./engine-context";
import { group } from "@/lib/engine";

type DeviceState = "IDLE" | "RECORDING" | "SENDING" | "PLAYING";

const RECORD_MS = 1400;
const PLAY_MS = 1200;

/** Mirrors the summary shape the SYSTEM_PROMPT asks the model to produce. */
function summarise(qid: string, rows: (string | number | Uint8Array | null)[][]): string {
  if (!rows.length) return "No rows matched.";
  const [a, b] = rows[0];
  const n = typeof b === "number" ? group(b) : String(b);
  switch (qid) {
    case "revenue_by_region":
      return `${a} leads with ${n} in total revenue.`;
    case "q2_units_by_product":
      return `${a} had the highest units with ${n} sold in Q2.`;
    case "agg_units_by_product":
      return `${a} sold the most units, ${n}.`;
    case "readme_total_revenue":
      return `Total revenue is ${typeof a === "number" ? group(a) : String(a)}.`;
    case "readme_february_count":
      return `${typeof a === "number" ? group(a) : String(a)} sales happened in February.`;
    case "readme_lowest_region":
      return `${a} has the lowest revenue at ${n}.`;
    default:
      return `${a}: ${n}.`;
  }
}

export function Device() {
  const { engine, ready, oracle, revision } = useEngine();
  const stages = oracle.stages;
  const totalMs = useMemo(() => stages.reduce((a, s) => a + s.ms, 0), [stages]);

  const askable = useMemo(
    () => oracle.queries.filter((q) =>
      ["revenue_by_region", "q2_units_by_product", "readme_total_revenue",
        "readme_lowest_region", "readme_february_count",
        "agg_units_by_product"].includes(q.id)),
    [oracle],
  );

  const [qid, setQid] = useState("revenue_by_region");
  const [state, setState] = useState<DeviceState>("IDLE");
  const [elapsed, setElapsed] = useState(0);

  const query = askable.find((q) => q.id === qid) ?? askable[0];
  const now = useNow();
  const blink = Math.round(now / 450) % 2 === 0;

  // Run the query for real, once, when the pipeline reaches SQLite.
  const result = useMemo(() => {
    if (!engine || !ready) return null;
    void revision;
    return engine.run(query.sql);
  }, [engine, ready, query.sql, revision]);

  const summary = result && !result.error ? summarise(query.id, result.rows) : "";

  // Autopilot flag mirrored into a ref so the timer can read it without
  // restarting. Synced in a dep-less effect, never assigned during render.
  const autoRef = useRef(true);
  const qidRef = useRef(qid);
  useEffect(() => {
    qidRef.current = qid;
  });

  // Drive the state machine on a timer. When a run finishes on autopilot the
  // board advances to the next question and presses its own button again, so
  // the section is always mid demonstration rather than waiting to be noticed.
  useEffect(() => {
    if (state === "IDLE") return;
    const started = performance.now() - elapsed;
    const id = window.setInterval(() => {
      const e = performance.now() - started;
      setElapsed(e);
      if (state === "RECORDING" && e >= RECORD_MS) {
        setState("SENDING");
        setElapsed(0);
      } else if (state === "SENDING" && e >= totalMs) {
        setState("PLAYING");
        setElapsed(0);
      } else if (state === "PLAYING" && e >= PLAY_MS) {
        setElapsed(0);
        if (autoRef.current) {
          const at = askable.findIndex((q) => q.id === qidRef.current);
          setQid(askable[(at + 1) % askable.length].id);
          setState("RECORDING");
        } else {
          setState("IDLE");
        }
      }
    }, 40);
    return () => window.clearInterval(id);
    // `elapsed` is deliberately not a dependency: it is the value this effect
    // writes, and including it would restart the timer on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, totalMs, askable]);

  const press = useCallback(() => {
    if (state !== "IDLE" || !ready) return;
    setElapsed(0);
    setState("RECORDING");
  }, [state, ready]);

  // One kick to get the loop started once SQLite is ready; after that the
  // state machine keeps itself going.
  const kick = useCallback(() => {
    if (!ready) return;
    setElapsed(0);
    setState((st) => (st === "IDLE" ? "RECORDING" : st));
  }, [ready]);
  const { takeOver: stopAuto, auto } = useAutopilot(kick, 1200);

  useEffect(() => {
    autoRef.current = auto;
  });

  const takeOver = useCallback(() => {
    autoRef.current = false;
    stopAuto();
  }, [stopAuto]);

  // Which pipeline stage is live, and the running latency the header reports.
  // Cumulative offsets are derived per item rather than accumulated into a
  // mutable local, which the React Compiler rejects.
  const stageStates = stages.map((s, i) => {
    const start = stages.slice(0, i).reduce((a, x) => a + x.ms, 0);
    const end = start + s.ms;
    const done = state === "PLAYING" || (state === "SENDING" && elapsed >= end);
    const active = state === "SENDING" && elapsed > start && !done;
    return { ...s, start, done, active };
  });
  const headerLatency = Math.round(
    Math.min(totalMs - stages[0].ms, Math.max(0, elapsed - stages[0].ms)),
  );

  // ---- OLED contents, matching drawResult() in the sketch ----
  const oledTitle = state === "IDLE" ? "VoiceQL ready"
    : state === "RECORDING" ? "Listening..."
      : state === "SENDING" ? "Thinking..." : "Q: " + query.natural.slice(0, 20);
  const oledBody = state === "PLAYING" ? summary
    : state === "SENDING"
      ? (stageStates.find((s) => s.active)?.name ?? "...")
      : state === "RECORDING" ? query.natural : "press the button";

  const rowCount = result?.rows.length ?? 0;

  return (
    <section id="device" className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-3 text-lg font-medium">
          <span className="eyebrow" style={{ color: "var(--brand)" }}>00</span>
          Try it
        </h2>
        <code className="mono text-xs" style={{ color: "var(--ink-muted)" }}>
          arduino/VoiceQL.ino + /query/voice
        </code>
      </div>

      <p className="mb-5 max-w-3xl text-sm" style={{ color: "var(--ink-secondary)" }}>
        Pick a question, press the button. The state machine, the stage timings
        and the SQL are the real ones; the answer is whatever SQLite returns
        right now, in your browser.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {askable.map((q) => (
          <button key={q.id} type="button"
            onClick={() => { takeOver(); setQid(q.id); }}
            disabled={state !== "IDLE"}
            className="mono rounded-full px-3 py-1 text-[11px]"
            style={{
              background: qid === q.id ? "var(--raised)" : "transparent",
              border: `1px solid ${qid === q.id ? "var(--brand)" : "var(--hairline)"}`,
              color: qid === q.id ? "var(--ink)" : "var(--ink-muted)",
              opacity: state === "IDLE" ? 1 : 0.5,
            }}>
            {q.natural}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[343px_1fr]">
        {/* ---------------- the board ---------------- */}
        <div className="panel p-4" style={{ background: "var(--raised)" }}>
          <div
            style={{
              width: 311, height: 242, position: "relative",
              background: "#0f3d2e", borderRadius: 8,
              border: "1px solid #165c45",
            }}
          >
            <div className="mono absolute" style={{
              top: 6, left: 10, fontSize: 8, color: "#8fd9bd", letterSpacing: 1,
            }}>
              ARDUINO UNO R4 WIFI
            </div>

            {/* SSD1306 128x64 OLED */}
            <div style={{
              position: "absolute", top: 26, left: 10,
              width: 256, height: 128, background: "#000",
              border: "2px solid #0a2b20", borderRadius: 3, padding: 6,
              overflow: "hidden",
            }}>
              <div className="mono" style={{ fontSize: 11, color: "#7fdbff" }}>
                {oledTitle}
              </div>
              <div style={{ height: 1, background: "#7fdbff", margin: "4px 0" }} />
              <div className="mono" style={{
                fontSize: 11, color: "#e8f7ff", lineHeight: 1.35,
                wordBreak: "break-word",
              }}>
                {oledBody}
                {state !== "IDLE" && state !== "PLAYING" && (
                  <span style={{ opacity: blink ? 1 : 0, color: "#7fdbff" }}>_</span>
                )}
              </div>
              {state === "PLAYING" && (
                <div className="mono" style={{ fontSize: 9, color: "#7fdbff", marginTop: 6 }}>
                  rows {rowCount} · {headerLatency}ms
                </div>
              )}
            </div>

            {/* mic input / speaker output, whichever is live */}
            <div className="absolute flex items-center gap-[2px]"
              style={{ top: 158, left: 10, width: 256, height: 14 }}>
              {Array.from({ length: 34 }, (_, b) => {
                const rec = state === "RECORDING";
                const play = state === "PLAYING";
                const a = Math.abs(
                  Math.sin(b * 0.6 + now * 0.011) * 0.6
                  + Math.sin(b * 1.7 - now * 0.019) * 0.4,
                );
                const env = Math.sin((b / 33) * Math.PI);
                const h = rec || play ? 2 + a * env * 12 : 2;
                return (
                  <span key={b} style={{
                    flex: 1, height: h, borderRadius: 1,
                    background: rec ? "var(--alarm)" : play ? "var(--data)" : "#0a2b20",
                  }} />
                );
              })}
            </div>

            {/* 12x8 LED matrix, the R4's own, used as the record indicator */}
            <div style={{
              position: "absolute", top: 180, left: 10,
              display: "grid", gridTemplateColumns: "repeat(12, 6px)", gap: 2,
            }}>
              {Array.from({ length: 96 }, (_, k) => {
                const col = k % 12;
                const lit = state === "RECORDING"
                  && col <= Math.floor((elapsed / RECORD_MS) * 12);
                return (
                  <span key={k} style={{
                    width: 6, height: 6, borderRadius: 1,
                    background: lit ? "var(--alarm)" : "#0a2b20",
                  }} />
                );
              })}
            </div>

            {/* push to talk */}
            {state === "IDLE" && ready && (
              <span aria-hidden style={{
                position: "absolute", right: 16, bottom: 16,
                width: 56, height: 56, borderRadius: "50%",
                border: "2px solid var(--brand)",
                transform: `scale(${1 + 0.18 * (0.5 + 0.5 * Math.sin(now / 300))})`,
                opacity: 0.5 - 0.4 * (0.5 + 0.5 * Math.sin(now / 300)),
                pointerEvents: "none",
              }} />
            )}
            <button type="button" onClick={() => { takeOver(); press(); }}
              disabled={state !== "IDLE" || !ready}
              aria-label="push to talk"
              style={{
                position: "absolute", right: 16, bottom: 16,
                width: 56, height: 56, borderRadius: "50%",
                background: state === "IDLE" ? "var(--brand)" : "#0a2b20",
                border: "3px solid #165c45",
                color: state === "IDLE" ? "#04121f" : "var(--ink-muted)",
                cursor: state === "IDLE" && ready ? "pointer" : "default",
                fontSize: 9, fontFamily: "var(--mono)",
              }}>
              {state === "IDLE" ? "PUSH" : state.slice(0, 4)}
            </button>

            <div className="mono absolute" style={{
              right: 16, bottom: 78, fontSize: 8, color: "#8fd9bd",
            }}>
              68.6 x 53.4mm
            </div>

            {/* WiFi radio, alive only while the board is on the air */}
            <div className="absolute" style={{ right: 20, top: 30 }}>
              {[0, 1, 2].map((r) => (
                <span key={r} style={{
                  display: "block", width: 6 + r * 7, height: 6 + r * 7,
                  border: "2px solid",
                  borderColor: state === "SENDING"
                    ? (Math.round(now / 260) % 3 >= r ? "var(--brand)" : "#0a2b20")
                    : "#0a2b20",
                  borderBottomColor: "transparent",
                  borderLeftColor: "transparent",
                  borderRadius: "50%",
                  position: "absolute", right: 0, top: -(r * 3.5),
                  transform: "rotate(-45deg)",
                }} />
              ))}
            </div>
          </div>

          <div className="mono mt-3 flex items-center gap-3 text-[11px]"
            style={{ color: "var(--ink-muted)" }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: state === "IDLE" ? "var(--baseline)"
                : state === "RECORDING" ? "var(--alarm)"
                  : state === "PLAYING" ? "var(--data)" : "var(--brand)",
              opacity: state === "IDLE" ? 1 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 150)),
            }} />
            <span>{Math.round(state === "IDLE" ? 0 : elapsed)}ms</span>
            state: <span style={{
              color: state === "IDLE" ? "var(--ink-muted)"
                : state === "RECORDING" ? "var(--alarm)" : "var(--brand)",
            }}>{state}</span>
            <span className="ml-3" style={{ color: "var(--ink-muted)" }}>
              {auto ? "autopilot" : "manual"}
            </span>
          </div>
        </div>

        {/* ---------------- the pipeline ---------------- */}
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="eyebrow">/query/voice, stage by stage</span>
            {/* WAV up, MP3 back down. Only moves while a request is in flight. */}
            <span className="relative inline-block" style={{
              width: 120, height: 10, borderRadius: 5,
              background: "var(--raised)", overflow: "hidden",
            }}>
              {state === "SENDING" && [0, 1, 2, 3].map((d) => (
                <span key={d} style={{
                  position: "absolute", top: 3, width: 4, height: 4,
                  borderRadius: "50%", background: "var(--brand)",
                  left: `${(((now / 9) + d * 30) % 120)}px`,
                }} />
              ))}
              {state === "PLAYING" && [0, 1, 2, 3].map((d) => (
                <span key={d} style={{
                  position: "absolute", top: 3, width: 4, height: 4,
                  borderRadius: "50%", background: "var(--data)",
                  left: `${120 - (((now / 9) + d * 30) % 120)}px`,
                }} />
              ))}
            </span>
          </div>
          {stageStates.map((s) => (
            <div key={s.name} className="mb-2">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="mono text-xs" style={{
                  color: s.done || s.active ? "var(--ink)" : "var(--ink-muted)",
                }}>
                  {s.name}
                </span>
                <span className="mono text-[10px]" style={{
                  color: s.client ? "var(--ink-muted)"
                    : s.awaited ? "var(--brand)" : "var(--alarm)",
                }}>
                  {s.client ? "client" : s.awaited ? "awaited" : "blocks the loop"}
                  {" · "}{s.ms}ms
                </span>
              </div>
              <div style={{ height: 6, background: "var(--raised)", borderRadius: 3 }}>
                <div style={{
                  height: 6, borderRadius: 3,
                  width: `${s.done ? 100 : s.active
                    ? Math.min(100, ((elapsed - s.start) / s.ms) * 100) : 0}%`,
                  background: s.client ? "var(--ink-muted)"
                    : s.awaited ? "var(--brand)" : "var(--alarm)",
                  boxShadow: s.active ? "0 0 8px currentColor" : "none",
                  opacity: s.active ? 0.75 + 0.25 * Math.sin(now / 90) : 1,
                  transition: "width 40ms linear",
                }} />
              </div>
            </div>
          ))}

          <div className="mt-4">
            <div className="eyebrow mb-2">response headers, as the sketch reads them</div>
            <div className="scroll-x">
              <table className="grid-table">
                <tbody>
                  <tr><td>X-Transcript</td><td>{state === "IDLE" ? "" : query.natural.slice(0, oracle.headerLimits.transcript)}</td></tr>
                  <tr><td>X-SQL</td><td>{state === "PLAYING" ? query.sql.slice(0, oracle.headerLimits.sql) : ""}</td></tr>
                  <tr><td>X-Summary</td><td style={{ color: "var(--data)" }}>{state === "PLAYING" ? summary : ""}</td></tr>
                  <tr><td>X-Row-Count</td><td className="num">{state === "PLAYING" ? rowCount : ""}</td></tr>
                  <tr><td>X-Latency-Ms</td><td className="num">{state === "PLAYING" ? totalMs - stages[0].ms : ""}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {state === "PLAYING" && (
            <p className="mt-4 text-xs" style={{ color: "var(--ink-secondary)" }}>
              The speaker says{" "}
              <strong style={{ color: "var(--data)" }}>{summary}</strong>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
