/**
 * Generate every GIF and still the README uses.
 *
 * Media is generated, never recorded. There is no browser and no ffmpeg here.
 * Every frame is drawn against the site's own compiled modules and the same
 * SQLite build the page runs, so a number in a GIF comes from the same function
 * the page calls.
 *
 * One target per process on purpose: encoding several 760x420 clips in a single
 * Node process exhausts a 1.9GB box.
 *
 * Run:  node scripts/gen-media.mjs voice --qa
 *       node scripts/gen-media.mjs pipeline
 *       node scripts/gen-media.mjs data
 *       node scripts/gen-media.mjs card
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { compileLib, WEB } from "./compile-lib.mjs";
import { encodeGif, kb } from "./encode-gif.mjs";
import {
  newCanvas, panel, text, eyebrow, rule, bar, measure,
  phase, ease, group,
} from "./draw-kit.mjs";

const REPO = path.resolve(WEB, "..");
const OUT_DOCS = path.join(REPO, "docs/media");
const OUT_PUBLIC = path.join(WEB, "public/media");
const OUT_QA = path.join(OUT_DOCS, "qa");

const args = process.argv.slice(2);
const QA = args.includes("--qa");
const only = args.filter((a) => !a.startsWith("--"));

const W = 760;
const H = 420;
const DELAY = 50; // 20fps

const lib = compileLib();
const { createEngine } = await lib.load("lib/engine.js");
const { palette: P } = await lib.load("lib/theme.js");

const oracle = JSON.parse(
  readFileSync(path.join(WEB, "src/data/oracle.json"), "utf8"),
);
const engine = await createEngine(oracle, path.join(WEB, "public/sql"));

for (const d of [OUT_DOCS, OUT_PUBLIC]) mkdirSync(d, { recursive: true });
if (QA) {
  rmSync(OUT_QA, { recursive: true, force: true });
  mkdirSync(OUT_QA, { recursive: true });
}

function background(ctx) {
  ctx.fillStyle = P.plane;
  ctx.fillRect(0, 0, W, H);
}

function header(ctx, title, source) {
  eyebrow(ctx, "voiceql", 24, 30, P.brand);
  const x = 24 + measure(ctx, "VOICEQL", 9, "SCPMed", 1.2) + 14;
  text(ctx, title, x, 30, { size: 13, family: "SCPMed", color: P.ink });
  text(ctx, source, W - 24, 30, { size: 11, color: P.inkMuted, align: "right" });
  rule(ctx, 24, 46, W - 48, P.hairline);
}

function amp(b, t, seed) {
  const a = Math.sin(b * 0.7 + seed * 3.1 + t * 0.6);
  const c = Math.sin(b * 1.9 - seed * 1.7 + t * 1.05);
  const d = Math.sin(b * 0.31 + seed + t * 0.35);
  const env = Math.sin((b / 47) * Math.PI);
  return Math.abs(a * 0.5 + c * 0.3 + d * 0.2) * (0.35 + 0.65 * env);
}

/* -------------------------------------------------- 1. the hero: voice --- */
// Two full questions in one loop, so the point lands well inside two seconds
// and a reader who stays sees it happen twice with different data.

const DEMO = oracle.demo;
const PICKS = [0, 4]; // revenue by region, then lowest region
const SEG = 72; // frames per question, with a held ending

function sceneVoice(i) {
  const { ctx } = newCanvas(W, H);
  background(ctx);
  header(ctx, "voice to SQL, live", "whisper + claude + sqlite");

  const seg = Math.min(PICKS.length - 1, Math.floor(i / SEG));
  const t = i - seg * SEG;
  const item = DEMO[PICKS[seg]];
  const live = engine.run(item.sql);

  const listen = phase(t, 0, 12);
  const typeQ = phase(t, 10, 22, ease.outCubic);
  const typeS = phase(t, 24, 38, ease.outCubic);
  const ran = t >= 39;

  // waveform
  text(ctx, t < 12 ? "REC" : "---", 24, 78, {
    size: 11, family: "SCPMed", color: t < 12 ? P.alarm : P.inkMuted,
  });
  const wx = 62;
  const ww = W - 24 - wx;
  const bars = 48;
  for (let b = 0; b < bars; b += 1) {
    const on = t < 12;
    const h = on ? 4 + amp(b, t, seg) * 30 : 3;
    const bw = ww / bars;
    ctx.globalAlpha = on ? 0.55 + amp(b, t, seg) * 0.45 : 1;
    ctx.fillStyle = on ? P.brand : P.hairline;
    ctx.fillRect(wx + b * bw, 74 - h / 2, bw - 2, h);
    ctx.globalAlpha = 1;
  }
  void listen;

  // transcript
  const q = item.spoken.slice(0, Math.ceil(typeQ * item.spoken.length));
  text(ctx, "whisper >", 24, 116, { size: 12, color: P.inkMuted });
  text(ctx, typeQ > 0 ? `"${q}${typeQ < 1 ? "" : '"'}` : "", 108, 116, {
    size: 12, color: P.ink,
  });

  // sql
  text(ctx, "claude  >", 24, 146, { size: 12, color: P.inkMuted });
  if (t >= 22 && typeS === 0) {
    text(ctx, "writing SQL...", 108, 146, { size: 12, color: P.inkMuted });
  }
  if (typeS > 0) {
    const sqlText = item.sql.slice(0, Math.ceil(typeS * item.sql.length));
    const lines = [];
    let cur = "";
    for (const word of sqlText.split(" ")) {
      const trial = cur ? `${cur} ${word}` : word;
      if (measure(ctx, trial, 11) > W - 132) {
        lines.push(cur);
        cur = word;
      } else cur = trial;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 2).forEach((ln, k) => {
      text(ctx, ln, 108, 146 + k * 16, { size: 11, color: P.brand });
    });
  }

  // rows
  if (ran) {
    text(ctx, "sqlite  >", 24, 200, { size: 12, color: P.inkMuted });
    text(ctx, `${live.rows.length} rows`, 108, 200, { size: 12, color: P.data });

    const top = live.rows.slice(0, 4);
    const peak = Math.max(...top.map((r) => Number(r[1]) || 0), 1);
    const bx = 200;
    const bmax = W - 24 - bx - 80;
    top.forEach((r, k) => {
      const y = 224 + k * 26;
      const g = Math.max(0, Math.min(1, (t - 39 - k * 2) / 6));
      text(ctx, String(r[0]), 188, y + 12, {
        size: 11, color: P.inkSecondary, align: "right",
      });
      const v = (Number(r[1]) || 0) * g;
      bar(ctx, bx, y + 1, (v / peak) * bmax, 13, k === 0 ? P.data : P.seq[4]);
      if (g > 0.1) {
        text(ctx, group(v), bx + (v / peak) * bmax + 10, y + 12, {
          size: 11, color: k === 0 ? P.data : P.inkSecondary,
        });
      }
    });

    // spoken
    const sp = phase(t, 45, 50);
    if (sp > 0) {
      text(ctx, "speaker >", 24, 356, { size: 12, color: P.inkMuted });
      text(ctx, `"${item.summary}"`, 108, 356, {
        size: 12, family: "SCPMed", color: P.data, alpha: sp,
      });
    }
  }

  text(ctx, `${seg + 1} / ${PICKS.length}`, W - 24, H - 16, {
    size: 10, color: P.inkMuted, align: "right",
  });
  text(ctx, "real SQLite, running in the browser", 24, H - 16, {
    size: 10, color: P.inkMuted,
  });
  return ctx.getImageData(0, 0, W, H).data;
}

/* ------------------------------------------------------- 2. pipeline --- */

const STAGES = oracle.stages;
const TOTAL = STAGES.reduce((a, s) => a + s.ms, 0);

function scenePipeline(i) {
  const { ctx } = newCanvas(W, H);
  background(ctx);
  header(ctx, "one request, stage by stage", "README latency table");

  const sweep = phase(i, 4, 56, ease.inOutCubic);
  const elapsed = sweep * TOTAL;

  const rowsTop = 84;
  const rowH = 46;
  const barX = 300;
  const barMax = W - 24 - barX - 70;

  STAGES.forEach((s, k) => {
    const start = STAGES.slice(0, k).reduce((a, x) => a + x.ms, 0);
    const end = start + s.ms;
    const done = elapsed >= end;
    const active = elapsed > start && !done;
    const partial = Math.max(0, Math.min(1, (elapsed - start) / s.ms));
    const y = rowsTop + k * rowH;

    text(ctx, s.name, 24, y + 14, {
      size: 12, family: active ? "SCPMed" : "SCP",
      color: done || active ? P.ink : P.inkMuted,
    });
    const tag = s.client ? "on the board" : s.awaited ? "awaited" : "synchronous";
    text(ctx, tag, 24, y + 30, {
      size: 9, family: "SCPMed",
      color: s.client ? P.inkMuted : s.awaited ? P.brand : P.data,
    });
    text(ctx, `${s.ms}ms`, barX - 14, y + 14, {
      size: 11, color: done || active ? P.ink : P.inkMuted, align: "right",
    });

    const w = (s.ms / TOTAL) * barMax;
    ctx.fillStyle = "#1a1a19";
    ctx.fillRect(barX, y + 3, Math.max(w, 3), 14);
    bar(ctx, barX, y + 3, Math.max(w * partial, partial > 0 ? 3 : 0), 14,
      s.client ? P.inkMuted : s.awaited ? P.brand : P.data, { radius: 3 });
    rule(ctx, 24, y + 34, W - 48, P.hairline, 0.4);
  });

  const y = rowsTop + STAGES.length * rowH + 10;
  text(ctx, `${(elapsed / 1000).toFixed(2)}s`, 24, y + 26, {
    size: 30, family: "SCPBold", color: P.brand,
  });
  text(ctx, `of ${(TOTAL / 1000).toFixed(2)}s, button press to spoken answer`,
    130, y + 26, { size: 12, color: P.inkSecondary });

  text(ctx, "the database is the cheapest step in the pipeline", 24, H - 16, {
    size: 10, color: P.inkMuted,
  });
  return ctx.getImageData(0, 0, W, H).data;
}

/* ----------------------------------------------------------- 3. data --- */

const DIMS = ["region", "category", "product"];
const DIM_SEG = 24;

function sceneData(i) {
  const { ctx } = newCanvas(W, H);
  background(ctx);
  header(ctx, "twelve rows, grouped live", "backend/database/db.py");

  const seg = Math.floor(i / DIM_SEG) % DIMS.length;
  const t = i - Math.floor(i / DIM_SEG) * DIM_SEG;
  const dim = DIMS[seg];
  const grow = phase(t, 3, 16, ease.outCubic);

  const res = engine.run(
    `SELECT ${dim} AS k, SUM(revenue) AS revenue, SUM(units) AS units
     FROM sales GROUP BY ${dim} ORDER BY revenue DESC`,
  );

  // pills
  let px = 24;
  DIMS.forEach((d, k) => {
    const label = `by ${d}`;
    const w = measure(ctx, label, 11, "SCPMed") + 26;
    panel(ctx, px, 62, w, 26, {
      fill: k === seg ? "#1a1a19" : "transparent",
      stroke: k === seg ? P.brand : P.hairline, r: 13,
    });
    text(ctx, label, px + w / 2, 79, {
      size: 11, family: k === seg ? "SCPMed" : "SCP", align: "center",
      color: k === seg ? P.ink : P.inkMuted,
    });
    px += w + 10;
  });

  text(ctx,
    `SELECT ${dim}, SUM(revenue) FROM sales GROUP BY ${dim} ORDER BY 2 DESC`,
    24, 112, { size: 11, color: P.brand });

  const top = res.rows.slice(0, 5);
  const peak = Math.max(...top.map((r) => Number(r[1]) || 0), 1);
  const bx = 150;
  const bmax = W - 24 - bx - 96;

  top.forEach((r, k) => {
    const y = 138 + k * 42;
    const g = Math.max(0, Math.min(1, grow * 1.25 - k * 0.08));
    text(ctx, String(r[0]), 138, y + 15, {
      size: 12, color: P.ink, align: "right",
    });
    const v = (Number(r[1]) || 0) * g;
    ctx.fillStyle = "#1a1a19";
    ctx.fillRect(bx, y + 2, bmax, 16);
    bar(ctx, bx, y + 2, (v / peak) * bmax, 16, P.brand);
    text(ctx, group(v), bx + bmax + 12, y + 15, {
      size: 12, family: "SCPMed", color: P.inkSecondary,
    });
    text(ctx, `${group((Number(r[2]) || 0) * g)} units`, 138, y + 30, {
      size: 9, color: P.inkMuted, align: "right",
    });
  });

  const total = res.rows.reduce((a, r) => a + (Number(r[1]) || 0), 0);
  text(ctx, `${group(total * Math.min(1, grow * 1.25))} total revenue`, 24, H - 16, {
    size: 10, color: P.inkMuted,
  });
  return ctx.getImageData(0, 0, W, H).data;
}

/* ---------------------------------------------------- 4. social card --- */

function socialCard() {
  const SW = 1200;
  const SH = 630;
  const { canvas, ctx } = newCanvas(SW, SH);
  ctx.fillStyle = P.plane;
  ctx.fillRect(0, 0, SW, SH);

  eyebrow(ctx, "voiceql", 72, 96, P.brand);
  text(ctx, "Speak a data question.", 72, 196, {
    size: 62, family: "SCPBold", color: P.ink,
  });
  text(ctx, "Get a spoken answer in", 72, 268, {
    size: 62, family: "SCPBold", color: P.brand,
  });
  text(ctx, "under three seconds.", 72, 340, {
    size: 62, family: "SCPBold", color: P.brand,
  });

  text(ctx,
    "Arduino Uno R4 WiFi, Whisper, Claude, SQLite, Google TTS.",
    72, 402, { size: 20, color: P.inkSecondary });

  // waveform flourish
  for (let b = 0; b < 64; b += 1) {
    const h = 6 + amp(b, 3.2, 1) * 74;
    ctx.fillStyle = b % 3 === 0 ? P.brand : P.hairline;
    ctx.fillRect(72 + b * 17, 520 - h / 2, 11, h);
  }

  const stages = STAGES.map((s) => `${s.ms}ms`).join("  +  ");
  text(ctx, `${stages}  =  ${(TOTAL / 1000).toFixed(2)}s`, 72, 596, {
    size: 17, family: "SCPMed", color: P.inkMuted,
  });

  return canvas.toBuffer("image/png");
}

/* ------------------------------------------------------------ drive --- */

const targets = {
  voice: {
    file: "voice-to-sql.gif", frames: SEG * PICKS.length, render: sceneVoice,
    qa: [0, 12, 26, 45, 60, 132], budgetKb: 800,
  },
  pipeline: {
    file: "pipeline.gif", frames: 64, render: scenePipeline,
    qa: [0, 20, 40, 60], budgetKb: 900,
  },
  data: {
    file: "data-live.gif", frames: DIM_SEG * 3, render: sceneData,
    qa: [0, 10, 24, 48], budgetKb: 900,
  },
};

let failed = 0;

if (!only.length || only.includes("card")) {
  const png = socialCard();
  writeFileSync(path.join(OUT_DOCS, "social-card.png"), png);
  writeFileSync(path.join(OUT_PUBLIC, "social-card.png"), png);
  console.log(`social-card.png      ${kb(png.length).padStart(7)}  1200x630`);
}

for (const [name, t] of Object.entries(targets)) {
  if (only.length && !only.includes(name)) continue;
  if (QA) {
    for (const f of t.qa) {
      if (f >= t.frames) continue;
      const { canvas, ctx } = newCanvas(W, H);
      const img = ctx.createImageData(W, H);
      img.data.set(t.render(f));
      ctx.putImageData(img, 0, 0);
      writeFileSync(
        path.join(OUT_QA, `${name}-f${String(f).padStart(3, "0")}.png`),
        canvas.toBuffer("image/png"),
      );
    }
  }
  const res = encodeGif({
    width: W, height: H, frames: t.frames, delay: DELAY,
    render: t.render, out: path.join(OUT_DOCS, t.file),
  });
  writeFileSync(
    path.join(OUT_PUBLIC, t.file),
    readFileSync(path.join(OUT_DOCS, t.file)),
  );
  const over = res.bytes / 1024 > t.budgetKb;
  if (over) failed += 1;
  console.log(
    `${t.file.padEnd(20)} ${kb(res.bytes).padStart(7)}  ${res.frames}f `
    + `${res.seconds.toFixed(1)}s  moved ${(res.changedShare * 100).toFixed(0)}%`
    + `  budget ${t.budgetKb}KB${over ? "  OVER" : ""}`,
  );
}

engine.close();
lib.cleanup();
if (failed) process.exit(1);
