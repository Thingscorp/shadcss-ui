// ==========================================================================
// scripts/test-computed.mjs
// Runtime computed-style suite. Renders each component's registry markup in
// headless Chromium with the built shadcss bundle, reads the COMPUTED style of
// the root element, and asserts key metrics (height, border-radius, padding,
// font-size, gap) against the shadcn spec (qa/fidelity/shadcn-spec.json).
//
// This is the real version of what compare.mjs approximates with CSS text
// parsing: it proves the styles actually RENDER as specified — catching
// cascade breaks, unresolved vars, and layer-ordering bugs that static parsing
// cannot. Requires the built bundle (run `npm run build` first) + playwright.
// ==========================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { MAP } from "./fidelity/compare.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPEC = JSON.parse(readFileSync(path.join(ROOT, "scripts/fidelity/shadcn-spec.json"), "utf8"));
const REG = JSON.parse(readFileSync(path.join(ROOT, "packages/shadcss/registry.json"), "utf8"));
const CSS = readFileSync(path.join(ROOT, "packages/shadcss/dist/shadcss.min.css"), "utf8");

const REM = 16;
const px = (v) => {
  if (v == null) return null;
  v = String(v).trim();
  if (v.endsWith("px")) return parseFloat(v);
  if (v.endsWith("rem")) return parseFloat(v) * REM;
  if (v === "0") return 0;
  return null;
};
// Resolve a spec radius value (may be a token like var(--radius-md)) to px,
// the same way the build does: --radius = 0.625rem (10px), md = base-2, etc.
const RADIUS_BASE = 0.625 * REM;
function specRadiusPx(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (v === "9999px") return 9999;
  if (v === "0") return 0;
  if (v.startsWith("var(--radius-")) {
    const name = v.match(/--radius-([\w-]+)/)[1];
    const map = { sm: RADIUS_BASE - 4, md: RADIUS_BASE - 2, lg: RADIUS_BASE, xl: RADIUS_BASE + 4, "2xl": RADIUS_BASE + 8 };
    return map[name] ?? null;
  }
  // bare like "[[4px]]" (extractor artifact) or "4px"
  const m = v.match(/([\d.]+)px/);
  return m ? parseFloat(m[1]) : px(v);
}

// Which spec metric → which computed property + how to read it.
const CHECKS = [
  { metric: "height", read: (cs) => parseFloat(cs.height) },
  { metric: "paddingX", read: (cs) => parseFloat(cs.paddingLeft), label: "padding-left" },
  { metric: "paddingY", read: (cs) => parseFloat(cs.paddingTop), label: "padding-top" },
  { metric: "fontSize", read: (cs) => parseFloat(cs.fontSize), label: "font-size" },
  { metric: "gap", read: (cs) => parseFloat(cs.columnGap || cs.gap), label: "gap" },
  { metric: "radius", read: (cs) => parseFloat(cs.borderTopLeftRadius), label: "border-radius", specResolve: specRadiusPx },
];
// Tolerance: sub-pixel rendering + the spec rounding to nearest rem.
const TOL = 1.5;

const markupByName = {};
for (const c of REG.components) if (c.markup) markupByName[c.name] = c.markup;

// Components whose root is an overlay (hidden until triggered) or a pseudo-
// element: they cannot be measured on a static render. Skipped here; their
// visual fidelity is covered by compare.mjs's static parse + the showcase
// render check. Dialogs/popovers/sheets would need showModal()/showPopover().
const SKIP = new Set([
  "dialog", "alert-dialog", "sheet", "drawer", "popover", "hover-card", "tooltip",
  // tooltip/sidebar/sidebar-menu-badge metrics apply to ::after / descendants
  "sidebar",
]);

// Spec-extraction artifacts: the extractor attached a radius/font metric to a
// root whose shadcn source has no such class (verified against the .tsx).
// shadcss's computed value is correct; the spec value is wrong. Keyed as
// "component/metric" so we skip just the bogus metric, not the whole component.
const SPEC_ARTIFACTS = new Set([
  "tabs/radius",            // shadcn Tabs root: no rounded-*; spec has radius-lg
  "navigation-menu/radius", // shadcn root: no rounded-*; spec has radius-md
  "navigation-menu/fontSize", // shadcn root: no text-*; spec has 0.875rem
]);

// CSS selectors in MAP may target element+class (e.g. "dialog.dialog") or a
// bare class (".btn"). Build a querySelector-compatible string and tag the
// matched root with data-comp for retrieval.
const wrappers = [];
for (const name of Object.keys(SPEC)) {
  if (SKIP.has(name)) continue;
  const markup = markupByName[name];
  if (!markup) continue;
  wrappers.push(`<div class="shadcss-test-isolate" data-comp-wrap="${name}">${markup}</div>`);
}
const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${CSS}
.shadcss-test-isolate{padding:1rem}
body{margin:0;padding:0}
</style></head><body>${wrappers.join("\n")}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 2400 });
await page.setContent(html, { waitUntil: "networkidle" });

const deviations = [];
let checked = 0;
let compsMeasured = 0;
for (const name of Object.keys(SPEC)) {
  if (SKIP.has(name)) continue;
  const entry = MAP[name];
  if (!entry) continue;
  const wrap = await page.$(`[data-comp-wrap="${name}"]`);
  if (!wrap) continue;
  // Resolve the component root inside this wrapper using the shared selector.
  // For element+class selectors ("dialog.dialog"), the bare class also works
  // inside the wrapper; fall back to first child if neither matches.
  const selClass = entry.sel.match(/\.([\w-]+)/)?.[0] ?? null;
  const root = (selClass && await wrap.$(selClass)) || (await wrap.$(":scope > *"));
  if (!root) continue;
  const spec = SPEC[name].rootMetrics;
  if (!spec) continue;
  compsMeasured++;
  const cs = await root.evaluate((el) => {
    const s = getComputedStyle(el);
    return { height: s.height, paddingLeft: s.paddingLeft, paddingTop: s.paddingTop, fontSize: s.fontSize, columnGap: s.columnGap, gap: s.gap, borderTopLeftRadius: s.borderTopLeftRadius };
  });
  for (const chk of CHECKS) {
    const wantRaw = spec[chk.metric];
    if (wantRaw == null || wantRaw === "") continue;
    // skip padding checks on height-driven boxes where padding is non-constraining
    // (compare.mjs does the same); signal via presence of explicit height.
    if ((chk.metric === "paddingX" || chk.metric === "paddingY") && spec.height != null) continue;
    // input/textarea use text-base (16px) with a md:text-sm (14px) override —
    // faithful to shadcn. The spec records the base value; at desktop the
    // override correctly wins, so spec-vs-computed diverges by design. Skip.
    if (chk.metric === "fontSize" && (name === "input" || name === "textarea")) continue;
    if (SPEC_ARTIFACTS.has(`${name}/${chk.metric}`)) continue;
    const want = chk.specResolve ? chk.specResolve(wantRaw) : px(wantRaw);
    if (want == null) continue;
    const got = chk.read(cs);
    if (got == null) continue;
    checked++;
    if (Math.abs(got - want) > TOL) {
      deviations.push(`${name}/${chk.metric}: spec ${want}px, computed ${got}px (Δ${(got - want).toFixed(1)}px)`);
    }
  }
}

await browser.close();

if (deviations.length) {
  console.error(`\nCOMPUTED-STYLE FAILED (${deviations.length} deviations):`);
  for (const d of deviations) console.error(`  ✗ ${d}`);
  process.exit(1);
}
console.log(`Computed-style passed — ${checked} metric checks across ${compsMeasured} components, all within ${TOL}px of the shadcn spec.`);
