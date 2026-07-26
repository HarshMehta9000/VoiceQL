/**
 * The one palette. Both the site and scripts/gen-media.mjs read these values,
 * so a GIF can never drift from the page it advertises.
 *
 * Dark instrument panel. Steps are the validated dark column of the reference
 * data viz palette, checked against this surface with the palette validator:
 * lightness band, chroma floor, all-pairs CVD separation (worst 9.4 deutan),
 * normal vision floor (worst 20.9) and contrast all pass for the three
 * categorical slots in use.
 *
 * Colour is never the only channel here. Every claim card carries an icon and a
 * word ("claimed" / "actual"), every guard verdict carries a label, and every
 * chart that uses more than one hue also direct labels its marks.
 */

export const palette = {
  // Surfaces
  plane: "#0d0d0c",
  surface: "#121210",
  raised: "#1a1a19",
  hairline: "#2c2c2a",
  baseline: "#383835",

  // Ink
  ink: "#ffffff",
  inkSecondary: "#c3c2b7",
  inkMuted: "#898781",

  // The three accents the brief asks for
  brand: "#3987e5", // blue, structure and chrome
  data: "#199e70", // aqua, measured truth
  alarm: "#d03b3b", // red, the false claim

  // Status, reserved. Never reused as a series colour.
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",

  // Categorical slots, in fixed order. Never cycled, never reordered.
  series: ["#3987e5", "#d95926", "#199e70"] as const,

  // Single hue sequential ramp, light to dark, for magnitude across categories.
  // A bar chart of one measure gets one hue, not four.
  seq: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"] as const,
} as const;

export const font = {
  mono: "Source Code Pro",
  sans: "Noto Sans",
  monoPath: "/usr/share/fonts/adobe-source-code-pro",
  sansPath: "/usr/share/fonts/google-noto",
} as const;

/** Thousands separators, matching how the README writes its figures. */
export function group(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
