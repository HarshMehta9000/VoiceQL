/**
 * Header transport, element E8.
 *
 * `/query/voice` returns MP3 audio as the body, so the structured result has
 * nowhere to go but the response headers. backend/routers/query.py packs three
 * result rows into `X-Results` as JSON, the statement into `X-SQL` truncated at
 * 200 characters, and the transcript into `X-Transcript` at 80.
 *
 * Two consequences, both reproduced here rather than described:
 *
 * 1. HTTP header values are latin-1 by specification. A product name containing
 *    any character outside that range cannot be encoded, and the response
 *    raises while building, after the query has already run and the audio has
 *    already been synthesised and paid for.
 * 2. Header blocks have practical size ceilings around 8KB. The Arduino reads
 *    these with httpClient.header(), on a board with 32KB of SRAM.
 */

export const LATIN1_MAX = 0xff;
export const HEADER_CEILING_BYTES = 8192;

export interface HeaderPack {
  headers: Record<string, string>;
  /** Byte length of the whole header block as it goes on the wire. */
  bytes: number;
  /** Header names whose values cannot be latin-1 encoded. */
  unencodable: string[];
  /** True when the pack exceeds the practical ceiling. */
  overCeiling: boolean;
}

export function isLatin1(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > LATIN1_MAX) return false;
  }
  return true;
}

/** The first character that cannot be encoded, for pointing at it in the UI. */
export function firstUnencodable(s: string): { char: string; index: number } | null {
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > LATIN1_MAX) return { char: s[i], index: i };
  }
  return null;
}

/**
 * Rebuild the response header block exactly as query.py does.
 * `limits` come from the oracle, which parsed them out of the Python source.
 */
export function packHeaders(
  rows: Record<string, unknown>[],
  sql: string,
  transcript: string,
  summary: string,
  rowCount: number,
  latencyMs: number,
  limits: { transcript: number; sql: number; rows: number },
): HeaderPack {
  const headers: Record<string, string> = {
    "X-Transcript": transcript.slice(0, limits.transcript),
    "X-SQL": sql.slice(0, limits.sql),
    "X-Summary": summary,
    "X-Row-Count": String(rowCount),
    "X-Latency-Ms": String(latencyMs),
    "X-Results": JSON.stringify(rows.slice(0, limits.rows)),
  };

  let bytes = 0;
  const unencodable: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    // name + ": " + value + CRLF
    bytes += k.length + 2 + v.length + 2;
    if (!isLatin1(v)) unencodable.push(k);
  }

  return {
    headers,
    bytes,
    unencodable,
    overCeiling: bytes > HEADER_CEILING_BYTES,
  };
}

/** How many rows fit under the ceiling, given the observed bytes per row. */
export function rowsUntilCeiling(bytesForNRows: number, n: number): number {
  if (n <= 0 || bytesForNRows <= 0) return 0;
  return Math.floor(HEADER_CEILING_BYTES / (bytesForNRows / n));
}
