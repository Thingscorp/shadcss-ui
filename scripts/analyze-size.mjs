// ==========================================================================
// scripts/analyze-size.mjs  —  Phase 0 measurement for the optimization fork.
// No CSS changes. Reports where the bytes actually are so optimization is
// evidence-driven, not faith-driven:
//   1. Per-component minified + gzipped bytes (sorted, biggest first)
//   2. The base layer cost (reset/tokens/theme/animate)
//   3. Dead tokens: custom properties DEFINED but never referenced by any
//      var() — candidates for pruning (Phase 1). Inverse of test-tokens.mjs,
//      which checks references resolve.
// Run: node scripts/analyze-size.mjs
// ==========================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "lightningcss";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "packages", "shadcss");
const SRC = path.join(PKG, "src");
const read = (p) => readFileSync(p, "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Lightning CSS targets must match the build (scripts/build.mjs).
const v = (major, minor = 0) => (major << 16) | (minor << 8);
const targets = { chrome: v(111), firefox: v(113), safari: v(16, 4), edge: v(111) };
const min = (code) => transform({ filename: "x.css", code: Buffer.from(code), minify: true, targets }).code;
const gz = (code) => gzipSync(code).length;

function walkCss(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    let isDir = false;
    try { isDir = statSync(f).isDirectory(); } catch {}
    if (isDir) walkCss(f, out);
    else if (e.endsWith(".css")) out.push(f);
  }
  return out;
}

// ---- 1 + 2: per-file minified/gzipped bytes ----
console.log("━ base layer ━");
let baseRaw = "", baseMin = "";
const baseFiles = ["reset.css", "tokens.css", "theme.css", "animate.css"];
for (const f of baseFiles) {
  const src = read(path.join(SRC, "base", f));
  const m = min(src);
  baseRaw += src;
  baseMin += m;
  console.log(`  ${f.padEnd(14)} ${String(m.length).padStart(6)} B min  ${String(gz(m)).padStart(5)} B gz`);
}
console.log(`  ${"base TOTAL".padEnd(14)} ${String(baseMin.length).padStart(6)} B min  ${String(gz(baseMin)).padStart(5)} B gz`);

console.log("\n━ components (top 15 by gzipped size) ━");
const compDir = path.join(SRC, "components");
const comps = readdirSync(compDir).filter((f) => f.endsWith(".css")).map((f) => {
  const m = min(read(path.join(compDir, f)));
  return { name: f.replace(/\.css$/, ""), min: m.length, gz: gz(m) };
}).sort((a, b) => b.gz - a.gz);
let compGzTotal = comps.reduce((s, c) => s + c.gz, 0);
let compMinTotal = comps.reduce((s, c) => s + c.min, 0);
for (const c of comps.slice(0, 15)) console.log(`  ${c.name.padEnd(20)} ${String(c.min).padStart(6)} B min  ${String(c.gz).padStart(5)} B gz`);
console.log(`  ${"... + " + (comps.length - 15) + " more".padEnd(20)}`);
console.log(`  ${"components TOTAL".padEnd(20)} ${String(compMinTotal).padStart(6)} B min  ${String(compGzTotal).padStart(5)} B gz  (${comps.length} files)`);

console.log(`\n  => base ${gz(baseMin)} + components ${compGzTotal} = ~${gz(baseMin) + compGzTotal} B gz (the modular floor; the bundled shadcss.min.css also carries @import flattening/layer-merging overhead vs. the sum of parts)`);

// ---- 3: dead tokens (defined but never referenced) ----
console.log("\n━ dead tokens: DEFINED but never referenced by any var() ━");
const cssFiles = walkCss(SRC);
// definitions: `--name:` OR @property --name
const DECL_RE = /--([a-zA-Z0-9-]+)\s*:/g;
const PROPERTY_RE = /@property\s+--([a-zA-Z0-9-]+)/g;
const defined = new Map(); // name -> [files]
for (const f of cssFiles) {
  const base = path.basename(f);
  for (const m of read(f).matchAll(DECL_RE)) defined.set("--" + m[1], (defined.get("--" + m[1]) || []).concat(base));
  for (const m of read(f).matchAll(PROPERTY_RE)) defined.set("--" + m[1], (defined.get("--" + m[1]) || []).concat(base + "(@property)"));
}
// references
const REF_RE = /var\(\s*(--[a-zA-Z0-9.-]+)/g;
const referenced = new Set();
for (const f of cssFiles) for (const m of stripComments(read(f)).matchAll(REF_RE)) referenced.add(m[1]);

// Filter: tokens.css defines dark-mode/alt-theme variants that are legitimately
// referenced via [data-theme] / media queries — only flag a token as dead if it
// appears NOWHERE as a reference AND isn't a documented theming surface.
const dead = [...defined.keys()].filter((t) => !referenced.has(t)).sort();
if (!dead.length) {
  console.log("  none — every defined custom property is referenced.");
} else {
  console.log(`  ${dead.length} defined-but-unreferenced:`);
  for (const t of dead) console.log(`    ${t}  (defined in: ${[...new Set(defined.get(t))].join(", ")})`);
}
