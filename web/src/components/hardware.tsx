"use client";

/**
 * The hardware, element 05. The state machine is the one in
 * arduino/VoiceQL.ino: IDLE / RECORDING / SENDING / PLAYING / ERROR_STATE.
 * Click a state to see what the board is doing and what the OLED shows.
 */
import { useCallback, useState } from "react";
import { useAutopilot } from "./use-autopilot";
import { useNow } from "./use-now";

type S = "IDLE" | "RECORDING" | "SENDING" | "PLAYING" | "ERROR_STATE";

const STATES: { id: S; on: string; oled: string; next: string; tone: string }[] = [
  {
    id: "IDLE", tone: "var(--ink-muted)",
    on: "Waiting on the push to talk button. The LED matrix is dark.",
    oled: "VoiceQL ready", next: "button press",
  },
  {
    id: "RECORDING", tone: "var(--alarm)",
    on: "EchoKit captures audio into a WAV buffer. The 12x8 LED matrix fills "
      + "left to right as the buffer does.",
    oled: "Listening...", next: "button release or buffer full",
  },
  {
    id: "SENDING", tone: "var(--brand)",
    on: "The WAV is POSTed to /query/voice as multipart form data over WiFi. "
      + "The board blocks here waiting on the response.",
    oled: "Thinking...", next: "HTTP 200 with an MP3 body",
  },
  {
    id: "PLAYING", tone: "var(--data)",
    on: "The MP3 body streams to the EchoKit speaker while the OLED prints the "
      + "transcript and the summary read from the response headers.",
    oled: "Q: <transcript>", next: "playback finished",
  },
  {
    id: "ERROR_STATE", tone: "var(--warning)",
    on: "WiFi dropped, the OLED failed to initialise, or the backend returned "
      + "a non 200. The sketch halts here.",
    oled: "Error", next: "reset",
  },
];

const PARTS = [
  ["Arduino Uno R4 WiFi", "WiFi, HTTP, orchestration", "68.6 x 53.4mm"],
  ["EchoKit", "Mic array, speaker", "I2S"],
  ["SSD1306 OLED", "Transcript and result", "128x64, I2C 0x3C"],
  ["Push button + 10k", "Push to talk", "digital in"],
];

export function Hardware() {
  const [sel, setSel] = useState<S>("IDLE");
  const s = STATES.find((x) => x.id === sel)!;
  const now = useNow();

  const next = useCallback(
    () => setSel((cur) => {
      const at = STATES.findIndex((x) => x.id === cur);
      return STATES[(at + 1) % STATES.length].id;
    }),
    [],
  );
  const { takeOver, auto } = useAutopilot(next, 2400);

  return (
    <section id="hardware" className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-3 text-lg font-medium">
          <span className="eyebrow" style={{ color: "var(--brand)" }}>04</span>
          The board
        </h2>
        <code className="mono text-xs" style={{ color: "var(--ink-muted)" }}>
          arduino/VoiceQL.ino
        </code>
      </div>
      <p className="mb-5 max-w-3xl text-sm" style={{ color: "var(--ink-secondary)" }}>
        The sketch is a five state machine. It steps through on its own; click
        any state to hold it and see what the board does and what the OLED shows.
        {" "}<span className="mono" style={{ fontSize: 11 }}>
          {auto ? "(stepping)" : "(held)"}
        </span>
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATES.map((st, i) => (
          <div key={st.id} className="flex items-center gap-2">
            <button type="button" onClick={() => { takeOver(); setSel(st.id); }}
              className="mono rounded px-3 py-1.5 text-[11px]"
              style={{
                background: sel === st.id ? "var(--raised)" : "transparent",
                border: `1px solid ${sel === st.id ? st.tone : "var(--hairline)"}`,
                color: sel === st.id ? st.tone : "var(--ink-muted)",
              }}>
              {st.id}
            </button>
            {i < STATES.length - 1 && (
              <span style={{ color: "var(--hairline)" }}>&rarr;</span>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <div className="eyebrow mb-2" style={{ color: s.tone }}>{s.id}</div>
          <p className="mb-4 text-sm" style={{ color: "var(--ink-secondary)" }}>
            {s.on}
          </p>
          <div className="eyebrow mb-2">what the OLED shows</div>
          <div style={{
            background: "#000", border: "2px solid var(--hairline)",
            borderRadius: 3, padding: 8, width: 200,
          }}>
            <div className="mono" style={{ fontSize: 11, color: "#7fdbff" }}>
              {s.oled}
              <span style={{ opacity: Math.round(now / 450) % 2 ? 1 : 0 }}>_</span>
            </div>
            <div style={{ height: 1, background: "#7fdbff", margin: "4px 0" }} />
          </div>
          <div className="mono mt-3 text-[11px]" style={{ color: "var(--ink-muted)" }}>
            leaves on: {s.next}
          </div>
        </div>

        <div className="panel p-4">
          <div className="eyebrow mb-2">bill of materials</div>
          <div className="scroll-x">
            <table className="grid-table">
              <thead><tr><th>part</th><th>role</th><th>spec</th></tr></thead>
              <tbody>
                {PARTS.map(([a, b, c]) => (
                  <tr key={a}>
                    <td style={{ color: "var(--ink)" }}>{a}</td>
                    <td>{b}</td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
