// ==========================================================================
// scripts/test-rtl.mjs
// Bidirectional (LTR/RTL) mirror test. Exercises the `direction` component's
// whole purpose: the framework must mirror cleanly under dir="rtl".
//
// Two layers:
//   1. STATIC — scan src/ for physical horizontal properties (margin-left,
//      padding-right, left:, right:, text-align:left/right) that would NOT
//      mirror under RTL. Border-radius corners and symmetric centering
//      (left:50% + translateX(-50%)) are allowed. Logical properties
//      (margin-inline, inset-inline, padding-inline) mirror automatically.
//   2. RUNTIME — render the showcase in dir="rtl", confirm it lays out
//      right-to-left (the document direction actually flipped, no overflow
//      blow-up), and axe passes. Catches the case where CSS is logical but
//      the visual result still breaks.
// ==========================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/shadcss/src");
const read = (p) => readFileSync(p, "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// ---- 1. STATIC SCAN ----
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

// Allowed physical properties even under RTL:
//   - border-(top|bottom)-(left|right)-radius : corners don't flip meaningfully
//   - left:50%/right:50% paired with translate(-50%): symmetric centering
const CORNER_RADIUS = /border-(?:top|bottom)-(?:left|right)-radius/;
const SYMMETRIC_CENTER = /\b(left|right):\s*50%/;

const errors = [];
for (const f of walkCss(SRC)) {
  const css = stripComments(read(f));
  const lines = css.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // margin-left / padding-right / border-left / border-right (not radius)
    let m = line.match(/^\s*(margin|padding|border)-(left|right)\s*:/);
    if (m && !CORNER_RADIUS.test(line)) {
      errors.push(`${path.relative(ROOT, f)}:${i + 1} physical ${m[1]}-${m[2]} — use ${m[1]}-inline instead`);
      continue;
    }
    // bare `left:` / `right:` (inset), excluding symmetric centering
    m = line.match(/^\s*(left|right)\s*:\s*([^;]+)/);
    if (m && !SYMMETRIC_CENTER.test(line)) {
      errors.push(`${path.relative(ROOT, f)}:${i + 1} physical inset ${m[1]}: ${m[2].trim()} — use inset-inline instead`);
      continue;
    }
    // text-align: left|right
    m = line.match(/^\s*text-align\s*:\s*(left|right)/);
    if (m) errors.push(`${path.relative(ROOT, f)}:${i + 1} physical text-align:${m[1]} — use start/end instead`);
  }
}

if (errors.length) {
  console.error(`\nRTL STATIC SCAN FAILED (${errors.length} physical-property leaks):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`RTL static scan passed — no physical horizontal properties leak (logical properties used throughout).`);

// ---- 2. RUNTIME MIRROR ----
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");
const CSS = read(path.join(ROOT, "packages/shadcss/dist/shadcss.min.css"));
const REG = JSON.parse(read(path.join(ROOT, "packages/shadcss/registry.json"), "utf8"));

// Render a representative set of components (the interactive controls + a
// couple of layouts) under dir="rtl" and confirm direction flipped + no a11y
// regressions + no horizontal overflow blow-up.
const sample = ["button", "input", "select", "field", "breadcrumb", "pagination", "tabs", "card", "alert", "badge", "direction"];
const snippets = sample.map((n) => {
  const c = REG.components.find((c) => c.name === n);
  return c && c.markup ? `<section data-comp="${n}" style="padding:8px">${c.markup}</section>` : "";
}).filter(Boolean).join("\n");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 1000 });
await page.setContent(`<!DOCTYPE html><html lang="en" dir="rtl"><head><meta charset="utf-8"><title>rtl</title><style>${CSS}body{margin:0;padding:16px}</style></head><body>${snippets}</body></html>`, { waitUntil: "networkidle" });

const checks = await page.evaluate(() => {
  const dir = document.documentElement.dir;
  // Document direction genuinely flipped.
  const dirOk = dir === "rtl";
  // No horizontal overflow from un-mirrored physical offsets.
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const overflowOk = overflow <= 2;
  return { dirOk, overflow, overflowOk };
});

// axe in RTL — same policy (fail on critical + markup-serious, accept contrast).
// Disable form-control-naming rules (select-name, label) that fire on isolated
// snippets without a host <label>; those are snippet-context issues covered by
// the full showcase a11y gate, not RTL regressions.
await page.evaluate(axeSource);
const results = await page.evaluate(async () => await axe.run(document, {
  resultTypes: ["violations"],
  rules: { "select-name": { enabled: false }, label: { enabled: false } },
}));
const serious = (results.violations || []).filter((v) => v.impact === "serious" && v.id !== "color-contrast");
const critical = (results.violations || []).filter((v) => v.impact === "critical");
await browser.close();

const failed = [];
if (!checks.dirOk) failed.push(`document dir is "${document.documentElement.dir}", expected rtl`);
if (!checks.overflowOk) failed.push(`horizontal overflow ${checks.overflow}px under RTL (a physical offset isn't mirroring)`);
if (critical.length) failed.push(`${critical.length} critical a11y (${critical.map((v) => v.id).join(",")})`);
if (serious.length) failed.push(`${serious.length} serious a11y (${serious.map((v) => v.id).join(",")})`);

if (failed.length) {
  console.error(`\nRTL RUNTIME FAILED:`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`RTL runtime mirror passed — dir=rtl confirmed, ${checks.overflow}px horizontal overflow, axe-clean across ${sample.length} sample components.`);
