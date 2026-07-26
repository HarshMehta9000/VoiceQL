"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock for animation.
 *
 * Components hold the timestamp at which something started in ordinary state,
 * set from the event handler that started it, and derive progress from
 * `useNow() - startedAt`. Nothing resets state from inside an effect, which is
 * what the React Compiler rejects and what causes cascading renders.
 */
export function useNow(active = true): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return now;
}

/** 0..1 across a window, clamped. */
export function progress(elapsed: number, from: number, to: number): number {
  if (to <= from) return 1;
  return Math.max(0, Math.min(1, (elapsed - from) / (to - from)));
}
