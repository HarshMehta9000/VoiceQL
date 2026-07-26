/**
 * Drawing primitives for the generated media.
 *
 * There is no browser and no ffmpeg on the build machine, so every frame is
 * drawn with @napi-rs/canvas and encoded directly. Nothing is screen recorded.
 *
 * Fonts are registered from /usr/share/fonts by absolute path, because
 * fontconfig lookup by family name is not reliable inside this canvas binding.
 */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";

const FONT_FILES = [
  ["/usr/share/fonts/adobe-source-code-pro/SourceCodePro-Regular.otf", "SCP"],
  ["/usr/share/fonts/adobe-source-code-pro/SourceCodePro-Bold.otf", "SCPBold"],
  ["/usr/share/fonts/adobe-source-code-pro/SourceCodePro-Medium.otf", "SCPMed"],
];

let fontsReady = false;
export function registerFonts() {
  if (fontsReady) return;
  for (const [file, family] of FONT_FILES) {
    if (!existsSync(file)) throw new Error(`missing font: ${file}`);
    GlobalFonts.registerFromPath(file, family);
  }
  fontsReady = true;
}

export function newCanvas(w, h) {
  registerFonts();
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

/** Easing. Motion that decelerates reads as physical rather than mechanical. */
export const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/** Clamp t into 0..1 across a frame window, then ease it. */
export function phase(frame, start, end, easing = ease.outCubic) {
  if (frame <= start) return 0;
  if (frame >= end) return 1;
  return easing((frame - start) / (end - start));
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function panel(ctx, x, y, w, h, { fill, stroke, r = 8, lineWidth = 1 }) {
  roundRect(ctx, x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

export function text(ctx, s, x, y, {
  size = 13, family = "SCP", color = "#fff", align = "left", alpha = 1,
  letterSpacing = 0,
} = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  let drawX = x;
  const w = measure(ctx, s, size, family, letterSpacing);
  if (align === "center") drawX = x - w / 2;
  if (align === "right") drawX = x - w;
  if (letterSpacing === 0) {
    ctx.fillText(s, drawX, y);
  } else {
    let cx = drawX;
    for (const ch of s) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + letterSpacing;
    }
  }
  ctx.restore();
  return w;
}

export function measure(ctx, s, size = 13, family = "SCP", letterSpacing = 0) {
  ctx.save();
  ctx.font = `${size}px ${family}`;
  let w = ctx.measureText(s).width;
  if (letterSpacing) w += letterSpacing * Math.max(0, s.length - 1);
  ctx.restore();
  return w;
}

/** A small uppercase label. Used for every section heading. */
export function eyebrow(ctx, s, x, y, color, alpha = 1) {
  return text(ctx, s.toUpperCase(), x, y, {
    size: 9, family: "SCPMed", color, alpha, letterSpacing: 1.2,
  });
}

/**
 * Wrap to a pixel width. Returns the lines; the caller places them, so a block
 * that grows cannot silently overflow the panel it sits in.
 */
export function wrap(ctx, s, maxWidth, size, family = "SCP") {
  const words = s.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (measure(ctx, trial, size, family) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Horizontal hairline. */
export function rule(ctx, x, y, w, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.restore();
}

/**
 * Data end cap: a 4px rounded end on the growing edge, anchored square to the
 * baseline. Thin marks, per the mark spec.
 */
export function bar(ctx, x, y, w, h, color, { radius = 4, alpha = 1 } = {}) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const r = Math.min(radius, w);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.max(0, w - r), y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Count from a to b with easing, rendered with thousands separators. */
export function counter(a, b, t) {
  return Math.round(a + (b - a) * t);
}

export function group(n) {
  return Math.round(n).toLocaleString("en-US");
}
