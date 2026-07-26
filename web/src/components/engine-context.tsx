"use client";

/**
 * One engine, shared by every element on the page.
 *
 * The brief's rule: a change in one place moves everything. Each element reads
 * this same sql.js database, so when the guard bench executes a REPLACE and
 * mutates a row, the SQL console and the claim checker see the mutation too.
 * That is the point of the demonstration, not a side effect of it.
 */
import {
  createContext, useContext, useEffect, useMemo, useState, useCallback,
} from "react";
import { createEngine, type Engine, type OracleShape } from "@/lib/engine";
import oracleJson from "@/data/oracle.json";

const oracle = oracleJson as unknown as OracleShape;

interface EngineState {
  engine: Engine | null;
  ready: boolean;
  error: string | null;
  oracle: OracleShape;
  /** Bumped whenever the data changes, so elements can re-read. */
  revision: number;
  invalidate: () => void;
  reset: () => void;
}

const Ctx = createContext<EngineState | null>(null);

export function EngineProvider({ children }: { children: React.ReactNode }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    createEngine(oracle, "/sql")
      .then((e) => {
        if (cancelled) e.close();
        else setEngine(e);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const invalidate = useCallback(() => setRevision((r) => r + 1), []);

  const reset = useCallback(() => {
    if (!engine) return;
    engine.reset();
    setRevision((r) => r + 1);
  }, [engine]);

  const value = useMemo<EngineState>(
    () => ({
      engine,
      ready: engine !== null,
      error,
      oracle,
      revision,
      invalidate,
      reset,
    }),
    [engine, error, revision, invalidate, reset],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): EngineState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEngine must be used inside <EngineProvider>");
  return v;
}

export { oracle };
