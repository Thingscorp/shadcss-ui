// ==========================================================================
// shadcss · scripts/build.mjs
// Bundle src/shadcss.css → dist/shadcss.css + dist/shadcss.min.css using lightningcss.
// Supports `--watch` for development.
// ==========================================================================

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { bundle, transform } from "lightningcss";
import { genDocs } from "../../../scripts/gen-docs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcEntry = path.join(root, "src", "shadcss.css");
const distDir = path.join(root, "dist");
const outCss = path.join(distDir, "shadcss.css");
const outMinCss = path.join(distDir, "shadcss.min.css");
const wwwCss = path.resolve(root, "..", "..", "apps", "www", "shadcss.min.css");
const registryPath = path.join(root, "registry.json");
const llmsOut = path.join(root, "llms.txt");
const wwwLlms = path.resolve(root, "..", "..", "apps", "www", "llms.txt");

// Lightning CSS encodes browser versions as (major << 16) | (minor << 8) | patch.
// Passing a bare `111` means version 0.0.111 — i.e. a prehistoric browser — which
// forces maximum downleveling (e.g. oklch() expanded to hex + lab(), bloating the
// bundle ~12%). These are real modern versions, all of which support oklch() and
// color-mix() natively, so the authored colors ship as-is. This baseline is also
// already implied by the framework's use of :has() and the Popover API.
const v = (major, minor = 0) => (major << 16) | (minor << 8);
const targets = {
  chrome: v(111),
  firefox: v(113),
  safari: v(16, 4),
  edge: v(111),
};

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function readAndBundle() {
  const { code } = bundle({
    filename: srcEntry,
    targets,
    drafts: { customMedia: true },
    nonStandard: { deepSelectorCombinator: true },
  });
  return { code };
}

async function minify(code) {
  const { code: minified } = transform({
    filename: "shadcss.css",
    code,
    minify: true,
    sourceMap: false,
    targets,
  });
  return minified;
}

// Generate llms.txt from registry.json — an LLM-friendly, machine-readable
// index so agents emit correct, accessible shadcss markup. Kept in sync on
// every build.
async function genLlms() {
  const reg = JSON.parse(await fs.readFile(registryPath, "utf8"));
  const L = [];
  L.push("# shadcss", "");
  L.push("> shadcn/ui's aesthetic as zero-runtime HTML + CSS. " + reg.components.length + " components, no React/Radix/Tailwind, no JS framework, zero dependencies. Theme via CSS custom-property design tokens.", "");
  L.push("Live demo: https://shadcss.vercel.app  ·  npm: @russfranky/shadcss  ·  CLI: npx @russfranky/shadcss-cli add <component>", "");
  L.push("## How to use");
  L.push("- Import the bundle (`@import \"@russfranky/shadcss\"` via a bundler, or `dist/shadcss.min.css` by path / CDN), or copy individual `src/components/<name>.css` files (each depends only on `src/base/tokens.css`).");
  L.push("- Write semantic HTML with the classes below. Prefer native elements; only add ARIA where the component's a11y contract says to.");
  L.push("- `js` legend: none = zero JS · trigger = one native one-liner (showModal()/showPopover()) · consumer = you write real JS for full behavior.");
  L.push("- `status` legend: stable · partial (works, limited) · visual-only (styling only; behavior needs JS).", "");
  L.push("## Components");
  for (const c of reg.components) {
    L.push("", `### ${c.name} — status:${c.status || "stable"} · js:${c.js || "none"} · support:${c.support || "baseline"}`);
    if (c.description) L.push(c.description);
    L.push(`Classes: ${(c.classes || []).join(" ")}`);
    if (c.a11y) L.push(`A11y: ${c.a11y}`);
    if (c.markup) L.push("Markup: " + c.markup);
  }
  if (reg.blocks && reg.blocks.length) {
    L.push("", "## Blocks", `Full-page section layouts composed from the components (${reg.blocks.length}). Copy the markup; layout glue lives in src/blocks.css (the \"blocks\" dep).`);
    for (const b of reg.blocks) {
      L.push("", `### ${b.name} — family:${b.family}`);
      if (b.description) L.push(b.description);
      L.push(`Deps: ${(b.deps || []).join(", ")}`);
      if (b.markup) L.push("Markup: " + b.markup);
    }
  }
  L.push("");
  await fs.writeFile(llmsOut, L.join("\n"));
  try { await fs.access(path.dirname(wwwLlms)); await fs.writeFile(wwwLlms, L.join("\n")); } catch {}
}

// Emit a modular dist for tree-shaking: `dist/base.min.css` (reset + tokens +
// theme — the prerequisite every component references) plus one minified file
// per component under `dist/components/`. Lets a consumer ship only the
// components they use (base + N components) instead of the full bundle.
// Some components reuse another's classes (see registry `deps`); include those
// too. Returns the component count.
async function emitModular() {
  const srcDir = path.join(root, "src");
  const distComponents = path.join(distDir, "components");
  await ensureDir(distComponents);

  // base.min.css — prime layer order, then reset/tokens/theme.
  let baseCss = "@layer reset, theme, components;\n";
  for (const f of ["base/reset.css", "base/tokens.css", "base/theme.css"])
    baseCss += (await fs.readFile(path.join(srcDir, f), "utf8")) + "\n";
  const { code: baseMin } = transform({ filename: "base.css", code: Buffer.from(baseCss), minify: true, targets });
  await fs.writeFile(path.join(distDir, "base.min.css"), baseMin);

  const compDir = path.join(srcDir, "components");
  const names = (await fs.readdir(compDir)).filter((f) => f.endsWith(".css"));
  for (const f of names) {
    const { code: min } = transform({ filename: f, code: await fs.readFile(path.join(compDir, f)), minify: true, targets });
    await fs.writeFile(path.join(distComponents, f.replace(/\.css$/, ".min.css")), min);
  }
  return names.length;
}

async function build() {
  const t0 = performance.now();
  await ensureDir(distDir);
  await genLlms();
  // Regenerate the docs site from the registry (apps/www/docs/). Guard the
  // sibling-app path so an isolated package build never fails on its account.
  try { genDocs(path.resolve(root, "..", "..")); } catch { /* apps/www absent */ }
  const { code } = readAndBundle();

  await fs.writeFile(outCss, code);
  const minified = await minify(code);
  await fs.writeFile(outMinCss, minified);

  // Copy the minified bundle into the showcase app for the local dev preview.
  // The showcase is a sibling app that may be absent (e.g. when the package is
  // built in isolation), so guard the copy and never fail the package build on
  // its account.
  try {
    await fs.access(path.dirname(wwwCss));
    await fs.writeFile(wwwCss, minified);
  } catch {
    // apps/www not present — skip the showcase copy.
  }

  const modularCount = await emitModular();

  const kbRaw = (code.length / 1024).toFixed(1);
  const kbMin = (minified.length / 1024).toFixed(1);
  const kbGzip = (gzipSync(minified).length / 1024).toFixed(1);
  const dt = (performance.now() - t0).toFixed(0);

  console.log(
    `\n  shadcss build complete (${dt}ms)\n` +
    `  ─────────────────────────────────────\n` +
    `  dist/shadcss.css        ${kbRaw.padStart(7)} KB  (expanded)\n` +
    `  dist/shadcss.min.css    ${kbMin.padStart(7)} KB  (minified)\n` +
    `  gzipped             ${kbGzip.padStart(7)} KB  (over the wire)\n` +
    `  dist/base.min.css + dist/components/*.min.css  (${modularCount} modular files)\n`
  );
}

async function watch() {
  await build();
  console.log("  Watching for changes…\n");
  const srcDir = path.join(root, "src");
  let debounce;
  const { watch } = await import("node:fs");
  watch(srcDir, { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(build, 100);
  });
}

const isWatch = process.argv.includes("--watch");
if (isWatch) {
  watch().catch((e) => { console.error(e); process.exit(1); });
} else {
  build().catch((e) => { console.error(e); process.exit(1); });
}
