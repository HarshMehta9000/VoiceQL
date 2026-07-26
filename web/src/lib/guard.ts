/**
 * The SQL guard, element E3.
 *
 * Three ways to decide whether a statement may run, scored against the same six
 * cases. The substring blocklist is reimplemented here exactly as
 * backend/routers/query.py writes it, so the bench runs the real rule rather
 * than a description of it. The other two verdicts are measured in Python by
 * build-oracle.py, because sql.js exposes neither a read only connection nor
 * set_authorizer.
 *
 * Measured result, pinned by verify-oracle.mjs:
 *   blocklist       0 of 6
 *   mode=ro         4 of 6
 *   set_authorizer  6 of 6
 */
import type { OracleGuardCase } from "./engine";

export type GuardMode = "blocklist" | "readonly" | "authorizer";

export interface BlocklistVerdict {
  allowed: boolean;
  /** The keyword that matched, for highlighting. */
  keyword: string | null;
  /** Character offset of the match in the original SQL. */
  index: number;
  /** The substring that actually triggered it, in original case. */
  matchedText: string | null;
}

/**
 * The real rule:
 *
 *   if any(kw in sql.upper() for kw in [...]): raise HTTPException(403)
 *
 * It is a substring test over the uppercased statement, which is why REPLACE
 * passes and why a column named created_at would not.
 */
export function blocklistVerdict(
  sql: string,
  blocklist: readonly string[],
): BlocklistVerdict {
  const upper = sql.toUpperCase();
  for (const kw of blocklist) {
    const i = upper.indexOf(kw);
    if (i !== -1) {
      return {
        allowed: false,
        keyword: kw,
        index: i,
        matchedText: sql.slice(i, i + kw.length),
      };
    }
  }
  return { allowed: true, keyword: null, index: -1, matchedText: null };
}

export function verdictFor(
  c: OracleGuardCase,
  mode: GuardMode,
  blocklist: readonly string[],
): boolean {
  if (mode === "blocklist") return blocklistVerdict(c.sql, blocklist).allowed;
  if (mode === "readonly") return c.readonly_allows;
  return c.authorizer_allows;
}

/** How many of the six cases this mode decides correctly. */
export function score(
  cases: readonly OracleGuardCase[],
  mode: GuardMode,
  blocklist: readonly string[],
): number {
  return cases.filter(
    (c) => verdictFor(c, mode, blocklist) === c.legitimate,
  ).length;
}

export const MODE_LABEL: Record<GuardMode, string> = {
  blocklist: "substring blocklist",
  readonly: "read only connection",
  authorizer: "set_authorizer",
};

export const MODE_NOTE: Record<GuardMode, string> = {
  blocklist: "what ships today",
  readonly: "the obvious fix, still not enough",
  authorizer: "decides all six correctly",
};
