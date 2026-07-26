/**
 * The concurrency lab, element E4.
 *
 * THIS IS A MODEL, NOT A BENCHMARK. Nothing here was measured on running
 * hardware. It is a discrete event simulation whose per stage durations are the
 * README's own latency table, and its only claim is arithmetic: given those
 * numbers and the way the endpoint is written, this is what queueing does.
 *
 * The mechanism it models is F5. `/query/voice` is `async def`, so it runs on
 * the event loop. Whisper and Claude are awaited, so they yield and overlap
 * freely. `run_query`, `synthesize` and `log_query` are plain synchronous calls,
 * so they hold the loop for their whole duration and every other in flight
 * request waits.
 *
 * Both modes are the same simulation with one parameter changed: how many
 * requests can be inside the blocking section at once. On the loop that is 1.
 * Behind `run_in_threadpool` it is the pool size.
 */

export interface Stage {
  name: string;
  ms: number;
  /** true when the stage is awaited and therefore yields the event loop. */
  awaited: boolean;
  /** true when the stage happens on the client, before the request arrives. */
  client: boolean;
  source: string;
}

export type Mode = "as-written" | "threadpool";

export interface SimResult {
  mode: Mode;
  users: number;
  latencies: number[];
  p50: number;
  p99: number;
  max: number;
  /** Milliseconds the endpoint spends holding the loop, per request. */
  blockingMs: number;
  /** Milliseconds that overlap freely. */
  awaitedMs: number;
  clientMs: number;
  /** Requests that finish inside the README's "under 3 seconds" promise. */
  withinPromise: number;
}

export const PROMISE_MS = 3000;
export const DEFAULT_POOL = 40;

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  // Nearest rank. With small user counts this is the honest choice: it always
  // returns a value that some request actually experienced.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * Simulate `users` requests arriving together.
 *
 * Arriving together is the worst case and is stated as such on the page. A
 * Poisson arrival process would be more realistic and less legible; the point
 * being made is about serialisation, and simultaneous arrival isolates it.
 */
export function simulate(
  stages: readonly Stage[],
  users: number,
  mode: Mode,
  poolSize = DEFAULT_POOL,
): SimResult {
  const clientMs = stages
    .filter((s) => s.client)
    .reduce((a, s) => a + s.ms, 0);
  const awaitedMs = stages
    .filter((s) => !s.client && s.awaited)
    .reduce((a, s) => a + s.ms, 0);
  const blockingMs = stages
    .filter((s) => !s.client && !s.awaited)
    .reduce((a, s) => a + s.ms, 0);

  // How many requests may be inside the blocking section simultaneously.
  const servers = mode === "as-written" ? 1 : poolSize;

  // Every request clears its awaited work at the same instant, because they all
  // arrive together and awaited work overlaps freely.
  const readyAt = new Array<number>(users).fill(awaitedMs);

  // FIFO over `servers` identical workers.
  const free = new Array<number>(servers).fill(0);
  const latencies: number[] = [];

  for (let i = 0; i < users; i += 1) {
    // Earliest free worker.
    let w = 0;
    for (let k = 1; k < servers; k += 1) if (free[k] < free[w]) w = k;
    const start = Math.max(readyAt[i], free[w]);
    const done = start + blockingMs;
    free[w] = done;
    latencies.push(done + clientMs);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    mode,
    users,
    latencies,
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    blockingMs,
    awaitedMs,
    clientMs,
    withinPromise: sorted.filter((l) => l <= PROMISE_MS).length,
  };
}

/** The lowest user count at which p99 breaks the README's promise. */
export function breakingPoint(
  stages: readonly Stage[],
  mode: Mode,
  maxUsers = 64,
  poolSize = DEFAULT_POOL,
): number | null {
  for (let n = 1; n <= maxUsers; n += 1) {
    if (simulate(stages, n, mode, poolSize).p99 > PROMISE_MS) return n;
  }
  return null;
}
