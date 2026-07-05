// ==========================================================================
// scripts/test-cli.mjs
// CLI gate — exercises every shipped command (list, info, check, diff) against
// the local checkout (--from), not just `add` (which test-install.mjs covers).
// Closes the registry gap F094–F097: 4 commands shipped with zero coverage.
// ==========================================================================

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "packages/cli/bin/shadcss.mjs");
const PKG = path.join(ROOT, "packages/shadcss");
const REG = JSON.parse(readFileSync(path.join(PKG, "registry.json"), "utf8"));
const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

// Run a CLI invocation, returning {code, stdout, stderr}.
async function run(args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn("node", [CLI, ...args], { cwd: opts.cwd || ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const out = { code: 0, stdout: "", stderr: "" };
    p.stdout.on("data", (d) => (out.stdout += d));
    p.stderr.on("data", (d) => (out.stderr += d));
    p.on("close", (c) => { out.code = c; resolve(out); });
  });
}

// ---- list ----
console.log("━ list ━");
let r = await run(["list", "--from", PKG]);
if (r.code !== 0) bad(`list exited ${r.code}`);
else {
  const listed = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  // every registry component name should appear in the listing
  const missing = REG.components.filter((c) => !listed.some((l) => l.includes(c.name)));
  if (missing.length) bad(`list omitted ${missing.length} component(s): ${missing.slice(0, 3).map((c) => c.name).join(", ")}`);
  else ok(`list shows all ${REG.components.length} components`);
}

// ---- info ----
console.log("\n━ info ━");
r = await run(["info", "button", "--from", PKG]);
if (r.code !== 0) bad(`info exited ${r.code}`);
else {
  const btn = REG.components.find((c) => c.name === "button");
  const want = ["button", "file:", "deps:", "classes:"];
  const missing = want.filter((w) => !r.stdout.includes(w));
  if (missing.length) bad(`info missing expected fields: ${missing.join(", ")}`);
  else ok(`info prints file/deps/classes for a component`);
}
// info on an unknown component must die non-zero
r = await run(["info", "nonexistent-component-xyz", "--from", PKG]);
if (r.code === 0) bad("info on unknown component should exit non-zero");
else ok("info rejects unknown component (exit non-zero)");
// info with no arg must die non-zero
r = await run(["info", "--from", PKG]);
if (r.code === 0) bad("info with no arg should exit non-zero");
else ok("info requires an argument");

// ---- check ----
console.log("\n━ check ━");
const tmp = mkdtempSync(path.join(os.tmpdir(), "shadcss-check-"));
const cleanHtml = path.join(tmp, "clean.html");
const dirtyHtml = path.join(tmp, "dirty.html");
writeFileSync(cleanHtml, `<div class="tabs-trigger">ok</div>`); // valid radiogroup-ish markup
writeFileSync(dirtyHtml, `<button class="tabs-trigger" aria-selected="true">x</button>`); // the flagged foot-gun
r = await run(["check", cleanHtml]);
if (r.code !== 0) bad(`check on clean file exited ${r.code}`);
else ok("check passes a clean file");
r = await run(["check", dirtyHtml]);
if (r.code === 0) bad("check on dirty file should exit non-zero (foot-gun present)");
else ok("check flags static aria-selected foot-gun (exit non-zero)");
// check on missing file
r = await run(["check", path.join(tmp, "nope.html")]);
if (r.code === 0) bad("check on missing file should exit non-zero");
else ok("check reports unreadable file (exit non-zero)");
rmSync(tmp, { recursive: true, force: true });

// ---- diff ----
console.log("\n━ diff ━");
// diff compares a local copy against upstream. With --from pointing at the
// package, a freshly-added copy should match -> 0 diffs -> exit 0.
const diffDir = mkdtempSync(path.join(os.tmpdir(), "shadcss-diff-"));
await run(["add", "badge", "--from", PKG, "--dir", path.join(diffDir, "shadcss")], { cwd: diffDir });
r = await run(["diff", "--from", PKG, "--dir", path.join(diffDir, "shadcss")], { cwd: diffDir });
if (r.code !== 0) bad(`diff on a fresh copy exited ${r.code} (should be 0 — no drift)`);
else ok("diff reports 0 drift on a freshly-added component");
// Now corrupt the copy and confirm diff flags it
const badgeCopy = path.join(diffDir, "shadcss/components/badge.css");
writeFileSync(badgeCopy, readFileSync(badgeCopy, "utf8").replace(".badge {", ".badge { display:none;"));
r = await run(["diff", "--from", PKG, "--dir", path.join(diffDir, "shadcss")], { cwd: diffDir });
if (r.code === 0) bad("diff on a corrupted copy should exit non-zero (drift detected)");
else ok("diff detects drift on a corrupted copy (exit non-zero)");
rmSync(diffDir, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nCLI SUITE FAILED (${failures.length}):`);
  process.exit(1);
}
console.log("\nCLI suite passed — list/info/check/diff all behave per spec.");
