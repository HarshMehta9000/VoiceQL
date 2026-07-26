import { EngineProvider } from "@/components/engine-context";
import { AskAnything, DataExplorer, LatencyBudget } from "@/components/elements";
import { Device } from "@/components/device";
import { Terminal } from "@/components/terminal";
import { Hardware } from "@/components/hardware";
import oracleJson from "@/data/oracle.json";
import type { OracleShape } from "@/lib/engine";

const data = oracleJson as unknown as OracleShape;

function Stat({ value, label, tone = "var(--ink)" }: {
  value: string; label: string; tone?: string;
}) {
  return (
    <div className="panel p-4">
      <div className="mono text-3xl" style={{ color: tone }}>{value}</div>
      <div className="mono mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
    </div>
  );
}

export default function Page() {
  const total = data.stages.reduce((a, s) => a + s.ms, 0);

  return (
    <EngineProvider>
      <main>
        <header className="mx-auto w-full max-w-5xl px-5 pt-16 pb-6">
          <p className="eyebrow mb-4" style={{ color: "var(--brand)" }}>
            voiceql
          </p>
          <h1 className="mb-5 text-4xl leading-tight font-medium sm:text-5xl">
            Speak a data question.
            <br />
            <span style={{ color: "var(--brand)" }}>
              Get a spoken answer in under three seconds.
            </span>
          </h1>
          <p className="mb-6 max-w-2xl text-base" style={{ color: "var(--ink-secondary)" }}>
            An Arduino Uno R4 WiFi records your voice, a FastAPI backend runs it
            through Whisper for transcription and Claude for SQL, queries SQLite,
            and speaks the result back through the board. Everything below is
            playable: the database is real and runs in this page.
          </p>

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat value={`${(total / 1000).toFixed(2)}s`}
              label="button press to spoken answer" tone="var(--brand)" />
            <Stat value="12" label="rows of live sample data" />
            <Stat value={String(data.queries.filter((q) => q.source.includes("example")).length)}
              label="questions it ships with" />
            <Stat value="5" label="stages in the pipeline" />
          </div>
        </header>

        <Terminal />
        <Device />
        <AskAnything />
        <DataExplorer />
        <LatencyBudget />
        <Hardware />

        <footer className="mx-auto w-full max-w-5xl px-5 py-12 text-xs"
          style={{ color: "var(--ink-muted)" }}>
          <p>
            The database on this page is SQLite compiled to WebAssembly, loaded
            with the schema and the twelve sample rows from{" "}
            <code className="mono">backend/database/db.py</code>. Every figure
            you see is a query result, computed in your browser as you click.
          </p>
        </footer>
      </main>
    </EngineProvider>
  );
}
