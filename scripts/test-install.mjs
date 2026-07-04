// ==========================================================================
// scripts/test-install.mjs
// Install-matrix gate — the in-repo analog of shadcn-ui/ui-test-apps, kept
// lightweight (no heavy bundler devDep, which would undercut a zero-build CSS
// library). Two real gates, zero new dependencies:
//
//   1. ENTRY-POINT CONTRACT — bundlers (Vite/webpack/Parcel/esbuild) resolve a
//      bare `@import "@russfranky/shadcss"` by reading the package's `exports`
//      and `style` fields. We assert every declared entry point resolves to a
//      real, non-empty CSS file that actually contains our design tokens.
//      Catches the regression "field points at a missing/wrong file", which is
//      the real risk — once the field is correct, the bundler's node resolution
//      is the bundler's job (documented per-bundler in the README).
//
//   2. CLI ROUND-TRIP — runs the shipped CLI's `add` against the local
//      checkout (`--from`) for a representative component set, then asserts
//      every written file is byte-identical to its src/ original AND that
//      declared dependencies (base/tokens) were pulled. Catches "CLI copies
//      the wrong file" or "dep resolution broke" regressions.
// ==========================================================================

import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG_DIR = path.join(ROOT, "packages", "shadcss");
const pkgJson = JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
const registry = JSON.parse(readFileSync(path.join(PKG_DIR, "registry.json"), "utf8"));
const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

// --------------------------------------------------------------------------
// 1. ENTRY-POINT CONTRACT
// --------------------------------------------------------------------------
console.log("━ entry-point contract (what bundlers resolve) ━");
const entryPoints = [];
for (const [key, val] of Object.entries(pkgJson.exports || {})) entryPoints.push([`exports["${key}"]`, val]);
if (pkgJson.style) entryPoints.push(["style", pkgJson.style]);
if (pkgJson.main) entryPoints.push(["main", pkgJson.main]);

for (const [label, rel] of entryPoints) {
  const full = path.join(PKG_DIR, rel);
  if (!existsSync(full)) { bad(`${label} → ${rel}: file missing (bundler @import would 404)`); continue; }
  const css = readFileSync(full, "utf8");
  if (!css.trim()) { bad(`${label} → ${rel}: empty file`); continue; }
  // A valid shadcss entry either (a) carries our token definitions (the built
  // bundle) or (b) is the source aggregator that @imports base/tokens.css.
  // Both are legitimate bundler entry points; rejecting the aggregator would
  // be a false positive.
  const hasTokens = /--primary\b/.test(css);
  const importsTokens = /@import\s+["'][^"']*base\/tokens\.css["']/.test(css);
  if (!hasTokens && !importsTokens) { bad(`${label} → ${rel}: resolves but has no tokens and doesn't import base/tokens.css (wrong file?)`); continue; }
  ok(`${label} → ${rel} (${(css.length / 1024).toFixed(1)} KB, ${importsTokens ? "aggregator" : "tokens present"})`);
}
// Also assert every path in `files` exists (what npm publishes).
for (const f of pkgJson.files || []) {
  if (!existsSync(path.join(PKG_DIR, f))) bad(`files[] entry "${f}" missing from package (would break npm publish)`);
}

// --------------------------------------------------------------------------
// 2. CLI ROUND-TRIP
// --------------------------------------------------------------------------
console.log("\n━ CLI round-trip (shadcss add) ━");
const CLI = path.join(ROOT, "packages", "cli", "bin", "shadcss.mjs");
const tmp = mkdtempSync(path.join(os.tmpdir(), "shadcss-install-"));
// Sample spans: a leaf component, one with a base dep, and a pair to test
// multi-arg + dedup. `--from` points at the local package so no network/CDN.
const sample = ["button", "field", "card", "input"];
const args = [CLI, "add", ...sample, "--from", PKG_DIR, "--dir", path.join(tmp, "shadcss"), "--force"];
const cliOut = await new Promise((resolve) => {
  const p = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});

if (cliOut.code !== 0) {
  bad(`CLI exited ${cliOut.code}\n${cliOut.out}`);
} else {
  ok(`CLI add ${sample.join(" ")} exited 0`);
  // Resolve the full file set the CLI should have written (each component + deps).
  function resolveFiles(name, seen, files) {
    const e = registry.components.find((c) => c.name === name);
    if (!e) return;
    for (const dep of e.deps || []) {
      if (dep.startsWith("components/")) {
        const depName = dep.replace(/^components\//, "");
        if (!seen.has(depName)) resolveFiles(depName, seen, files);
      } else if (dep.startsWith("base/")) {
        const file = `src/${dep}.css`;
        if (!seen.has(file)) { seen.add(file); files.push(file); }
      }
    }
    if (!seen.has(e.file)) { seen.add(e.file); files.push(e.file); }
  }
  const expFiles = [];
  {
    const seen = new Set();
    for (const name of sample) resolveFiles(name, seen, expFiles);
  }
  let mismatches = 0, checked = 0;
  for (const f of expFiles) {
    const dest = path.join(tmp, "shadcss", f.replace(/^src\//, ""));
    const src = path.join(PKG_DIR, f);
    if (!existsSync(dest)) { bad(`CLI did not write ${f.replace(/^src\//, "")} (dep resolution broke)`); mismatches++; continue; }
    if (!existsSync(src)) { bad(`test harness: src ${f} missing`); continue; }
    checked++;
    if (readFileSync(src, "utf8") !== readFileSync(dest, "utf8")) {
      bad(`${f}: copied file ≠ src (byte mismatch)`);
      mismatches++;
    }
  }
  if (checked && !mismatches) ok(`all ${checked} copied files (components + base deps) byte-identical to src`);
}

rmSync(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nINSTALL MATRIX FAILED (${failures.length}):`);
  process.exit(1);
}
console.log("\nInstall matrix passed — package entry points resolve and the CLI copies components byte-faithfully.");
