// ==========================================================================
// scripts/test-blocks.mjs
// Block smoke + a11y suite. Renders every block's markup from registry.json in
// headless Chromium, and for each asserts:
//   1. no console errors / failed resource loads during render
//   2. the root rendered real content (not an empty fragment)
//   3. axe-core finds no critical or markup-level serious violations
//
// Blocks were previously ungated (no fidelity, no a11y, no smoke). This is
// their first automated coverage. Requires the built bundle + playwright.
// ==========================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REG = JSON.parse(readFileSync(path.join(ROOT, "packages/shadcss/registry.json"), "utf8"));
const CSS = readFileSync(path.join(ROOT, "packages/shadcss/dist/shadcss.min.css"), "utf8");
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");

const failures = [];
let scanned = 0;

const browser = await chromium.launch();

for (const b of REG.blocks || []) {
  if (!b.markup) continue;
  scanned++;
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 });
  // Render the block in a sized, well-formed document (lang+title) so document-
  // level axe rules (html-has-lang, document-title) — which describe the host
  // page, not the block snippet — don't false-positive. Axe is scoped to the
  // block container below.
  await page.setContent(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${b.name}</title><style>${CSS}body{margin:0}</style></head><body><div id="block-root">${b.markup}</div></body></html>`, { waitUntil: "networkidle" });

  // (2) content presence — the block produced at least one visible element.
  const hasContent = await page.evaluate(() => {
    const el = document.getElementById("block-root").firstElementChild;
    return !!(el && el.getBoundingClientRect().height > 0);
  });

  // (1) console/page errors.
  const renderErrors = [...consoleErrors, ...pageErrors];

  // (3) axe scan — scoped to the block root, so document-level rules don't
  // fire. Same policy as check-a11y.mjs: color-contrast serious is an accepted
  // fidelity tradeoff.
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => await axe.run(document.getElementById("block-root"), { resultTypes: ["violations"] }));
  const serious = (results.violations || []).filter((v) => v.impact === "serious" && v.id !== "color-contrast");
  const critical = (results.violations || []).filter((v) => v.impact === "critical");

  await page.close();

  const reasons = [];
  if (renderErrors.length) reasons.push(`${renderErrors.length} console error(s): ${renderErrors.slice(0, 2).join("; ")}`);
  if (!hasContent) reasons.push("rendered no visible content");
  if (critical.length) reasons.push(`${critical.length} critical a11y (${critical.map((v) => v.id).join(",")})`);
  if (serious.length) reasons.push(`${serious.length} serious a11y (${serious.map((v) => v.id).join(",")})`);
  if (reasons.length) failures.push(`${b.name}: ${reasons.join(" | ")}`);
}

await browser.close();

if (failures.length) {
  console.error(`\nBLOCK SUITE FAILED (${failures.length}/${scanned}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Block suite passed — ${scanned} blocks render clean (no console errors, visible content, axe-clean for critical/markup-serious).`);
