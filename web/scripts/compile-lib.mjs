/**
 * Compile the site's own TypeScript so Node can run it.
 *
 * The media generator must draw against the exact modules the page imports.
 * Reimplementing the query engine in the generator would let a GIF and the page
 * disagree, which is the entire failure this project is about.
 *
 * tsc emits .js, which Node treats as CommonJS unless the output directory
 * declares otherwise, so a package.json with {"type":"module"} is written into
 * the temp dir before anything is imported.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(HERE, "..");

export function compileLib() {
  // Emitted inside web/ rather than /tmp so that Node resolves sql.js from
  // web/node_modules the same way the browser bundle does. A temp dir outside
  // the project cannot see the dependency tree at all.
  const out = path.join(WEB, ".media-build");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  execFileSync(
    path.join(WEB, "node_modules/.bin/tsc"),
    [
      "--outDir", out,
      "--module", "esnext",
      "--moduleResolution", "bundler",
      "--target", "es2022",
      "--skipLibCheck",
      "--strict",
      "--rootDir", path.join(WEB, "src"),
      path.join(WEB, "src/lib/engine.ts"),
      path.join(WEB, "src/lib/theme.ts"),
      path.join(WEB, "src/lib/guard.ts"),
      path.join(WEB, "src/lib/concurrency.ts"),
      path.join(WEB, "src/lib/headers.ts"),
    ],
    { stdio: "inherit", cwd: WEB },
  );

  // Without this Node reads the emitted .js as CommonJS and every import fails.
  writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ type: "module" }, null, 2) + "\n",
  );

  return {
    dir: out,
    /** Import a compiled module by its path relative to src/. */
    load: (rel) => import(pathToFileURL(path.join(out, rel)).href),
    cleanup: () => rmSync(out, { recursive: true, force: true }),
  };
}
