// ==========================================================================
// scripts/check-markup.mjs
// Encodes the exact regressions QA iterations 1–2 fixed, so they cannot
// silently return. Static checks on the showcase, CSS, and registry.
// No dependencies — plain Node.
// ==========================================================================

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = (p) => path.join(root, p);
const read = (p) => readFileSync(r(p), "utf8");

const errors = [];
const ok = [];
const fail = (m) => errors.push(m);
const pass = (m) => ok.push(m);

const html = read("apps/www/index.html");

// 1) Tag balance (cheap structural sanity)
const opens = (html.match(/<div\b/g) || []).length;
const closes = (html.match(/<\/div>/g) || []).length;
if (opens === closes) pass(`showcase <div> balance (${opens})`);
else fail(`showcase <div> imbalance: ${opens} open vs ${closes} close`);

// 2) anchor() must never appear in CSS without an anchor producer (iter-1 D2-001..)
// A producer is anchor-name, or position-anchor: auto, which uses the
// implicit anchor set by the popovertarget click that opened the panel.
// That second form was verified 2026-10-25 in Chrome 153: button x = menu x.
const compDir = "packages/shadcss/src/components";
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
for (const f of readdirSync(r(compDir)).filter((x) => x.endsWith(".css"))) {
  const css = stripComments(read(path.join(compDir, f)));
  if (/\banchor\(/.test(css) && !/anchor-name\s*:/.test(css) && !/position-anchor\s*:\s*auto/.test(css)) {
    fail(`${compDir}/${f}: uses anchor() with no anchor-name producer (broken positioning, D2-001)`);
  }
}
pass(`no anchor() without anchor-name in component CSS`);

// 3) navigation-menu-content must never carry the popover attribute (D2-002)
// Match only real markup: class="navigation-menu-content" ... popover (before the tag closes),
// so prose like an a11y note that mentions "popover" can't trip it.
if (/class="navigation-menu-content"[^>]*\bpopover\b/.test(html)) fail(`showcase: popover re-added to .navigation-menu-content (D2-002)`);
else pass(`navigation-menu-content has no popover`);
if (/class=\\?"navigation-menu-content\\?"[^>]*\bpopover\b/.test(read("packages/shadcss/registry.json"))) fail(`registry: popover on navigation-menu-content (D2-002)`);
else pass(`registry navigation-menu-content has no popover`);

// 4) No static aria-selected on tab triggers — CSS can't sync it (D2-005/008)
if (/tabs-trigger[^>]*aria-selected/.test(html)) fail(`showcase: static aria-selected on .tabs-trigger (CSS cannot sync — D2-005)`);
else pass(`no static aria-selected on tabs`);

// 5) No invalid CSS property the audits flagged
for (const f of readdirSync(r(compDir)).filter((x) => x.endsWith(".css"))) {
  if (/focus-visible-anchor\s*:/.test(read(path.join(compDir, f)))) fail(`${compDir}/${f}: invalid 'focus-visible-anchor' property (D-123)`);
}
pass(`no invalid focus-visible-anchor property`);

// 5b) The global closed-overlay safety guard must exist (the bug class that
//     shipped twice). Without it, any author `display` on a dialog/popover can
//     leave a closed overlay visible.
const resetCss = read("packages/shadcss/src/base/reset.css");
if (/dialog:not\(\[open\]\)\s*\{\s*display:\s*none/.test(resetCss) && /\[popover\]:not\(:popover-open\)\s*\{\s*display:\s*none/.test(resetCss))
  pass(`global closed-overlay guard present in reset.css`);
else fail(`missing global closed-overlay guard (dialog:not([open]) / [popover]:not(:popover-open) { display:none }) in reset.css`);

// 6) registry.json must be valid JSON (parse already happened in consistency, re-affirm)
try { JSON.parse(read("packages/shadcss/registry.json")); pass(`registry.json valid JSON`); }
catch (e) { fail(`registry.json invalid JSON: ${e.message}`); }

for (const m of ok) console.log(`  ok   ${m}`);
if (errors.length) {
  console.error(`\nMARKUP CHECK FAILED (${errors.length}):`);
  for (const m of errors) console.error(`  ✗ ${m}`);
  process.exit(1);
}
console.log(`\nMarkup check passed (${ok.length} checks).`);
