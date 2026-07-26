"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Advance something on a timer until the visitor takes over.
 *
 * Every element on this page moves on its own so the page is alive on arrival.
 * The moment someone clicks, their choice sticks and the timer stops: autoplay
 * that fights the user is worse than no autoplay.
 */
export function useAutopilot(
  advance: () => void,
  intervalMs: number,
): { takeOver: () => void; auto: boolean } {
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(advance, intervalMs);
    return () => window.clearInterval(id);
  }, [auto, advance, intervalMs]);

  const takeOver = useCallback(() => setAuto(false), []);
  return { takeOver, auto };
}
