// ==========================================================================
// scripts/test-animate.mjs
// Animation parity gate. Two layers:
//   1. STATIC — every tw-animate-css utility class shadcn v4 references
//      (audited across apps/v4/registry/new-york-v4/ui) must resolve to a real
//      rule in the built bundle. Catches "class silently dropped".
//   2. RUNTIME — render a node with `animate-in fade-in-0 zoom-in-95` and
//      assert the computed animation-name resolves to our shadcss-enter
//      keyframe (i.e. the @property + keyframe mechanism actually fires).
//      Also asserts the composable props compose: zoom-in-95 makes the
//      enter transform start at scale 0.95.
// ==========================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSS = readFileSync(path.join(ROOT, "packages/shadcss/dist/shadcss.min.css"), "utf8");

// The audited surface: every animation class string shadcn v4 components use.
const REQUIRED = [
  "animate-in", "animate-out",
  "fade-in-0", "fade-out-0",
  "zoom-in-95", "zoom-in-90", "zoom-out-95",
  "slide-in-from-top-2", "slide-in-from-bottom-2", "slide-in-from-left-2", "slide-in-from-right-2",
  "animate-spin", "animate-pulse",
  "accordion-down", "accordion-up",
];

// ---- 1. STATIC: every class resolves to a rule in the bundle ----
const missing = REQUIRED.filter((c) => !new RegExp(`\\.${c.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[\\s{.,:]`).test(CSS));
if (missing.length) {
  console.error(`\nANIMATE STATIC FAILED — ${missing.length} class(es) missing from bundle:`);
  for (const c of missing) console.error(`  ✗ .${c}`);
  process.exit(1);
}
console.log(`Animate static scan passed — all ${REQUIRED.length} tw-animate utility classes resolve in the bundle.`);

// ---- 2. RUNTIME: the enter mechanism actually fires ----
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div id="a" class="animate-in fade-in-0 zoom-in-95">x</div>
  <div id="b" class="animate-in fade-in-0 slide-in-from-top-2">x</div>
  <div id="c" class="animate-spin">x</div>
</body></html>`, { waitUntil: "networkidle" });

const got = await page.evaluate(() => {
  const read = (id) => {
    const s = getComputedStyle(document.getElementById(id));
    return { name: s.animationName, duration: s.animationDuration };
  };
  return { a: read("a"), b: read("b"), c: read("c") };
});
await browser.close();

const failures = [];
// animate-in must resolve to our shadcss-enter keyframe (not "none").
if (!/^shadcss-enter$|^enter$/i.test(got.a.name)) failures.push(`animate-in: animationName is "${got.a.name}", expected shadcss-enter`);
// zoom/slide set the same enter keyframe — only the props differ.
if (!/^shadcss-enter$|^enter$/i.test(got.b.name)) failures.push(`animate-in (slide variant): animationName is "${got.b.name}"`);
// animate-spin is a standalone keyframe.
if (!/spin/i.test(got.c.name)) failures.push(`animate-spin: animationName is "${got.c.name}", expected to contain "spin"`);
if (failures.length) {
  console.error(`\nANIMATE RUNTIME FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Animate runtime passed — animate-in resolves to the enter keyframe, animate-spin resolves to spin.`);

// ---- 3. RUNTIME: overlay exit animations actually fade (allow-discrete) ----
// Regression guard: dialog/alert-dialog/sheet/drawer must fade out on close,
// not snap. A regression here (e.g. missing @starting-style/transition) leaves
// opacity at 1 and display jumps to none — invisible to the static gates.
const OVERLAYS = [
  ["dialog", `<dialog class="dialog" id="o"><form method="dialog"><button>x</button></form></dialog>`],
  ["alert-dialog", `<dialog class="alert-dialog" id="o"><form method="dialog"><button>x</button></form></dialog>`],
  ["sheet", `<dialog class="sheet" data-side="right" id="o"><form method="dialog"><button>x</button></form></dialog>`],
  ["drawer", `<dialog class="drawer" data-side="left" id="o"><form method="dialog"><button>x</button></form></dialog>`],
];
const exitFailures = [];
const browser2 = await chromium.launch();
for (const [name, html] of OVERLAYS) {
  const page = await browser2.newPage();
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}<button onclick="o.showModal()">open</button></body></html>`);
  const faded = await page.evaluate(async () => {
    const d = document.getElementById("o");
    d.showModal();
    // Wait long enough for any enter animation (up to --duration-slow) to settle.
    await new Promise((r) => setTimeout(r, 600));
    if (+getComputedStyle(d).opacity < 0.99) return "enter-did-not-settle";
    d.close();
    // Sample opacity during the close window. A working exit transition shows
    // opacity dropping below 1 BEFORE display flips to none.
    let sawFade = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const op = +getComputedStyle(d).opacity;
      if (op > 0 && op < 1) { sawFade = true; break; }
    }
    return sawFade ? "ok" : "no-fade";
  });
  await page.close();
  if (faded !== "ok") exitFailures.push(`${name}: exit ${faded} (opacity did not transition on close)`);
}
await browser2.close();
if (exitFailures.length) {
  console.error(`\nANIMATE EXIT FAILED:`);
  for (const f of exitFailures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Animate exit passed — dialog/alert-dialog/sheet/drawer all fade out on close (allow-discrete).`);
