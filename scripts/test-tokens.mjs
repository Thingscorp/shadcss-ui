// ==========================================================================
// scripts/test-tokens.mjs
// Static token-resolution test. Scans every var(--x) reference in src/ and
// asserts each either (a) resolves to a defined custom property somewhere in
// the base tokens/theme or a component file, or (b) carries its own fallback.
//
// Catches the bug class that text-parsing checks cannot: an orphaned or typo'd
// token reference (var(--space-15) that doesn't exist, with no fallback) would
// render as empty/0 and silently break a component, while still parsing fine.
// Zero browser cost — plain Node, no deps.
// ==========================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages", "shadcss", "src");

const read = (p) => readFileSync(p, "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Collect every CSS source file under src/ (recurse subdirs: base/, components/).
function walkCss(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry.endsWith(".css")) out.push(full);
    else {
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch {}
      if (isDir) walkCss(full, out);
    }
  }
  return out;
}
const cssFiles = walkCss(SRC);

// Gather every defined custom property name (--x) across all source. A token
// may be defined in base/tokens.css, base/theme.css, or scoped to a component
// (e.g. --cal-cell, sidebar-scoped vars). Definitions all count equally for
// resolution purposes. tokens.css packs several defs per line
// (--text-sm: …;  --leading-sm: …), so match after { ; or line-start.
// A custom-property DEFINITION always has the form `--name:` (colon after the
// name). A REFERENCE is `var(--name)` (no colon after the name). So `--name\s*:`,// matched anywhere, only ever appears at definition sites — including the
// multi-per-line tokens.css style (`--text-sm: …;  --leading-sm: …`).
const DECL_RE = /--([a-zA-Z0-9-]+)\s*:/g;
// @property registrations are also definitions: `@property --x { ... initial-value }`.
const PROPERTY_RE = /@property\s+--([a-zA-Z0-9-]+)/g;
const defined = new Set();
for (const f of cssFiles) {
  for (const m of read(f).matchAll(DECL_RE)) defined.add("--" + m[1]);
  for (const m of read(f).matchAll(PROPERTY_RE)) defined.add("--" + m[1]);
}

// Find every var(--x[, fallback]) usage. var() may nest (var(--a, var(--b)))
// and may appear in calc()/color-mix(); the regex captures the head token and
// whether a fallback follows on the same, simple form.
const errors = [];
const checked = new Set();
for (const f of cssFiles) {
  const css = stripComments(read(f));
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9.-]+)/g)) {
    const tok = m[1];
    const key = `${path.basename(f)}:${tok}`;
    if (checked.has(key)) continue;
    checked.add(key);

    // Determine whether THIS occurrence carries a fallback. Look at the text
    // right after the token: "var(--x)" (no fallback) vs "var(--x, …)".
    const after = css.slice(m.index + m[0].length);
    const hasFallback = /^\s*,/.test(after);

    if (!defined.has(tok) && !hasFallback) {
      errors.push(`${path.relative(ROOT, f)}: var(${tok}) has no definition and no fallback — resolves to empty`);
    }
  }
}

if (errors.length) {
  console.error(`\nTOKEN RESOLUTION FAILED (${errors.length} unresolved, no-fallback references):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`Token resolution passed — ${checked.size} var() references across ${cssFiles.length} files all resolve or carry a fallback (${defined.size} custom properties defined).`);
