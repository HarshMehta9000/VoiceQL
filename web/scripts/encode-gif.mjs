/**
 * Two pass GIF encoding with a single global palette and inter frame
 * differencing.
 *
 * Why both, from the first encode rather than as a later optimisation: a 760x420
 * clip encoded naively runs well over 2MB, and the hero has an 800KB budget
 * because someone on mobile data sees roughly two seconds of it.
 *
 *   pass 1  render a sample of frames, quantise them together into ONE palette
 *           of 255 colours. A per frame palette would both cost bytes and make
 *           colours crawl between frames.
 *   pass 2  render every frame, map to that palette, and mark pixels that did
 *           not change since the previous frame as transparent (index 255) with
 *           dispose: 1, so each frame stores only what moved.
 *
 * Frames are produced by a callback and encoded as they are produced. A full
 * RGBA frame at this size is 1.27MB and there is not RAM on this box to hold
 * ninety of them.
 */
import gifenc from "gifenc";
import { writeFileSync } from "node:fs";

// gifenc ships CommonJS, so the named exports come off the default import.
const { GIFEncoder, quantize, applyPalette } = gifenc;

const TRANSPARENT_INDEX = 255;

/**
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.frames        total frame count
 * @param {number} opts.delay         ms per frame
 * @param {(i:number)=>Uint8ClampedArray} opts.render  returns RGBA for frame i
 * @param {string} opts.out           output path
 * @param {number} [opts.sampleEvery] palette sampling stride
 */
export function encodeGif({
  width, height, frames, delay, render, out, sampleEvery = 4,
}) {
  // ---- pass 1: one palette for the whole clip -----------------------------
  const samples = [];
  for (let i = 0; i < frames; i += sampleEvery) {
    samples.push(Uint8Array.from(render(i)));
  }
  // Always include the last frame; held final states carry colours the
  // sampling stride can miss.
  samples.push(Uint8Array.from(render(frames - 1)));

  const combined = new Uint8Array(samples.reduce((n, s) => n + s.length, 0));
  let off = 0;
  for (const s of samples) {
    combined.set(s, off);
    off += s.length;
  }
  samples.length = 0;

  // 255 rather than 256, leaving the top index free to mean "unchanged".
  const palette = quantize(combined, 255, { format: "rgb565" });
  while (palette.length < 256) palette.push([0, 0, 0]);

  // ---- pass 2: encode, storing only what moved ----------------------------
  const gif = GIFEncoder();
  let previous = null;
  let changedTotal = 0;
  let pixelTotal = 0;

  for (let i = 0; i < frames; i += 1) {
    const rgba = Uint8Array.from(render(i));
    const indexed = applyPalette(rgba, palette, "rgb565");

    if (previous) {
      let changed = 0;
      for (let p = 0; p < indexed.length; p += 1) {
        if (indexed[p] === previous[p]) {
          indexed[p] = TRANSPARENT_INDEX;
        } else {
          changed += 1;
        }
      }
      changedTotal += changed;
      pixelTotal += indexed.length;
      gif.writeFrame(indexed, width, height, {
        palette: i === 0 ? palette : undefined,
        transparent: true,
        transparentIndex: TRANSPARENT_INDEX,
        delay,
        dispose: 1,
      });
      // The diff must compare against what was actually shown, not the
      // masked frame, so rebuild the previous state.
      for (let p = 0; p < indexed.length; p += 1) {
        if (indexed[p] !== TRANSPARENT_INDEX) previous[p] = indexed[p];
      }
    } else {
      previous = Uint8Array.from(indexed);
      pixelTotal += indexed.length;
      changedTotal += indexed.length;
      gif.writeFrame(indexed, width, height, {
        palette,
        delay,
        dispose: 1,
      });
    }
  }

  gif.finish();
  const bytes = gif.bytes();
  writeFileSync(out, bytes);

  return {
    bytes: bytes.length,
    frames,
    seconds: (frames * delay) / 1000,
    /** Share of pixels that actually changed, the differencing win. */
    changedShare: pixelTotal ? changedTotal / pixelTotal : 1,
  };
}

export function kb(n) {
  return `${(n / 1024).toFixed(0)}KB`;
}
