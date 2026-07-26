"use client";

/**
 * The hero: VoiceQL's whole loop, running on autopilot.
 *
 * Voice in as a live waveform, transcribed to a natural language question,
 * handed to the agent which writes SQL, executed against the real in browser
 * SQLite, and spoken back. Twelve questions cycle continuously. Click any of
 * them to jump; the reel resumes on its own.
 *
 * The SQL, the rows and the spoken sentence all come from the shared engine.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "./engine-context";
import { group } from "@/lib/engine";

// Phase boundaries in ms within one cycle. Kept tight: the whole loop is under
// five seconds so a visitor sees two or three complete answers without waiting.
const T_LISTEN = 1000;
const T_TRANSCRIBE = 1700;
const T_THINK = 2100;
const T_SQL = 2950;
const T_RUN = 3200;
const T_CYCLE = 4900;

type Phase = "listen" | "transcribe" | "think" | "sql" | "run" | "result";

function phaseOf(t: number): Phase {
  if (t < T_LISTEN) return "listen";
  if (t < T_TRANSCRIBE) return "transcribe";
  if (t < T_THINK) return "think";
  if (t < T_SQL) return "sql";
  if (t < T_RUN) return "run";
  return "result";
}

/** Deterministic pseudo noise so the waveform looks like speech, not a sine. */
function amp(bar: number, t: number, seed: number): number {
  const a = Math.sin((bar * 0.7 + seed * 3.1) + t * 0.012);
  const b = Math.sin((bar * 1.9 - seed * 1.7) + t * 0.021);
  const c = Math.sin((bar * 0.31 + seed) + t * 0.007);
  const env = Math.sin((bar / 47) * Math.PI); // quieter at the edges
  return Math.abs((a * 0.5 + b * 0.3 + c * 0.2)) * (0.35 + 0.65 * env);
}

export function Terminal() {
  const { engine, ready, oracle } = useEngine();
  const demo = oracle.demo;

  const [idx, setIdx] = useState(0);
  const [t, setT] = useState(0);
  const [manual, setManual] = useState(false);
  const raf = useRef<number | null>(null);
  const started = useRef<number>(0);

  const item = demo[idx % demo.length];
  const phase = phaseOf(t);

  // Execute for real when the pipeline reaches the database.
  const live = useMemo(() => {
    if (!engine || !ready) return null;
    return engine.run(item.sql);
  }, [engine, ready, item.sql]);

  useEffect(() => {
    started.current = performance.now();
    const loop = () => {
      const e = performance.now() - started.current;
      if (e >= T_CYCLE) {
        started.current = performance.now();
        setT(0);
        setIdx((i) => (i + 1) % demo.length);
      } else {
        setT(e);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [demo.length]);

  const jump = useCallback((i: number) => {
    setIdx(i);
    setT(0);
    started.current = performance.now();
    setManual(true);
  }, []);

  // Typing progress for the two typed lines.
  const typedQuestion = item.spoken.slice(
    0,
    Math.ceil(
      Math.max(0, Math.min(1, (t - T_LISTEN) / (T_TRANSCRIBE - T_LISTEN)))
      * item.spoken.length,
    ),
  );
  const typedSql = item.sql.slice(
    0,
    Math.ceil(
      Math.max(0, Math.min(1, (t - T_THINK) / (T_SQL - T_THINK))) * item.sql.length,
    ),
  );

  const showRows = phase === "result";
  const rows = live && !live.error ? live.rows.slice(0, 4) : [];
  const cols = live?.columns ?? [];

  return (
    <section id="terminal" className="mx-auto w-full max-w-5xl px-5 pt-4 pb-8">
      <div className="panel overflow-hidden" style={{ background: "#0a0a09" }}>
        {/* title bar */}
        <div className="flex items-center gap-2 px-4 py-2"
          style={{ borderBottom: "1px solid var(--hairline)", background: "var(--raised)" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#d03b3b" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fab219" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#0ca30c" }} />
          <span className="mono ml-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
            voiceql &mdash; live
          </span>
          <span className="mono ml-auto text-[11px]" style={{ color: "var(--ink-muted)" }}>
            {(idx % demo.length) + 1}/{demo.length}
          </span>
        </div>

        <div className="p-4" style={{ minHeight: 340 }}>
          {/* ---- waveform ---- */}
          <div className="mb-3 flex items-center gap-3">
            <span className="mono text-[11px]" style={{
              color: phase === "listen" ? "var(--alarm)" : "var(--ink-muted)",
            }}>
              {phase === "listen" ? "REC" : "---"}
            </span>
            <div className="flex flex-1 items-center gap-[2px]" style={{ height: 40 }}>
              {Array.from({ length: 48 }, (_, b) => {
                const active = phase === "listen";
                const h = active ? 4 + amp(b, t, idx) * 34 : 3;
                return (
                  <span key={b} style={{
                    flex: 1, height: h, borderRadius: 1,
                    background: active ? "var(--brand)" : "var(--hairline)",
                    opacity: active ? 0.55 + amp(b, t, idx) * 0.45 : 1,
                  }} />
                );
              })}
            </div>
          </div>

          {/* ---- transcript ---- */}
          <div className="mono text-sm" style={{ minHeight: 26 }}>
            <span style={{ color: "var(--ink-muted)" }}>whisper &gt; </span>
            <span style={{ color: "var(--ink)" }}>
              {t >= T_LISTEN ? `"${typedQuestion}` : ""}
              {t >= T_LISTEN && t < T_TRANSCRIBE && (
                <span style={{ color: "var(--brand)" }}>_</span>
              )}
              {t >= T_TRANSCRIBE ? '"' : ""}
            </span>
          </div>

          {/* ---- agent ---- */}
          <div className="mono mt-2 text-sm" style={{ minHeight: 26 }}>
            <span style={{ color: "var(--ink-muted)" }}>claude &gt; </span>
            {phase === "think" && (
              <span style={{ color: "var(--ink-muted)" }}>writing SQL...</span>
            )}
            {t >= T_THINK && (
              <span style={{ color: "var(--brand)" }}>
                {typedSql}
                {t < T_SQL && <span>_</span>}
              </span>
            )}
          </div>

          {/* ---- execution ---- */}
          <div className="mono mt-2 text-sm" style={{ minHeight: 26 }}>
            {t >= T_SQL && (
              <>
                <span style={{ color: "var(--ink-muted)" }}>sqlite &gt; </span>
                <span style={{ color: "var(--data)" }}>
                  {live && !live.error
                    ? `${live.rows.length} row${live.rows.length === 1 ? "" : "s"}`
                    : "..."}
                </span>
              </>
            )}
          </div>

          {/* ---- rows ---- */}
          <div style={{ minHeight: 112 }}>
            {showRows && cols.length > 0 && (
              <div className="scroll-x mt-2">
                <table className="grid-table">
                  <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{
                        opacity: Math.min(1, (t - T_RUN - i * 60) / 200),
                      }}>
                        {r.map((cell, j) => (
                          <td key={j} className={typeof cell === "number" ? "num" : ""}>
                            {typeof cell === "number" ? group(cell) : String(cell ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---- spoken ---- */}
          <div className="mono mt-3 text-sm" style={{ minHeight: 26 }}>
            {showRows && (
              <>
                <span style={{ color: "var(--ink-muted)" }}>speaker &gt; </span>
                <span style={{ color: "var(--data)" }}>&ldquo;{item.summary}&rdquo;</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---- the reel ---- */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {demo.map((d, i) => (
          <button key={d.id} type="button" onClick={() => jump(i)}
            className="mono rounded px-2 py-1 text-[10px]"
            style={{
              background: i === idx % demo.length ? "var(--raised)" : "transparent",
              border: `1px solid ${i === idx % demo.length ? "var(--brand)" : "var(--hairline)"}`,
              color: i === idx % demo.length ? "var(--ink)" : "var(--ink-muted)",
            }}>
            {d.spoken.length > 34 ? `${d.spoken.slice(0, 34)}...` : d.spoken}
          </button>
        ))}
        <span className="mono self-center px-2 text-[10px]"
          style={{ color: "var(--ink-muted)" }}>
          {manual ? "click any question" : "cycling automatically"}
        </span>
      </div>
    </section>
  );
}
