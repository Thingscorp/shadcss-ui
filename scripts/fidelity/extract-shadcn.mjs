// ==========================================================================
// scripts/fidelity/extract-shadcn.mjs
// Parse shadcn's new-york-v4 component .tsx files into a resolved "target
// spec": for each component, the root element's concrete CSS metrics (height,
// padding, radius, font, gap, border, shadow, focus-ring, colors) derived from
// its Tailwind class strings. This is the authoritative source of truth we
// diff shadcss against. Output: scripts/fidelity/shadcn-spec.json
// ==========================================================================

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveClasses } from "./tw-resolve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const UI = path.join(ROOT, ".refs/shadcn-ui/apps/v4/registry/new-york-v4/ui");

if (!existsSync(UI)) {
  console.error(`shadcn reference not found at ${UI}\nRun: git clone --depth 1 https://github.com/shadcn-ui/ui .refs/shadcn-ui`);
  process.exit(1);
}

// Pull the contents of a balanced (...) or {...} starting at the opener index.
function balanced(src, openIdx, open = "(", close = ")") {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return "";
}

// Extract whitespace-separated class tokens from a JS string region that may
// contain concatenated "..." / '...' / `...` literals.
function classesFrom(region) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(region))) {
    for (const tok of m[2].split(/\s+/)) if (tok) out.push(tok);
  }
  return out;
}

// Parse a `key: "value"` map inside a variants sub-block ({ default: "...", sm: "..." }).
function parseVariantMap(block) {
  const map = {};
  // match  key:  <string-or-concat up to the next  key:  or end>
  const re = /(\w[\w-]*)\s*:\s*((?:["'`](?:\\.|[^"'`])*["'`]\s*\+?\s*)+)/g;
  let m;
  while ((m = re.exec(block))) {
    map[m[1]] = classesFrom(m[2]);
  }
  return map;
}

function extractCva(src) {
  const idx = src.indexOf("cva(");
  if (idx === -1) return null;
  const inner = balanced(src, src.indexOf("(", idx));
  // base = leading string literal(s) before the first comma at depth 0
  const baseMatch = inner.match(/^\s*((?:["'`](?:\\.|[^"'`])*["'`]\s*\+?\s*)+)/);
  const base = baseMatch ? classesFrom(baseMatch[1]) : [];
  const variants = {};
  // locate variants: { ... }
  const vIdx = inner.indexOf("variants:");
  if (vIdx !== -1) {
    const vBlock = balanced(inner, inner.indexOf("{", vIdx), "{", "}");
    for (const key of ["variant", "size"]) {
      const kIdx = vBlock.indexOf(`${key}:`);
      if (kIdx !== -1) {
        const kBlock = balanced(vBlock, vBlock.indexOf("{", kIdx), "{", "}");
        variants[key] = parseVariantMap(kBlock);
      }
    }
  }
  const defaults = {};
  const dIdx = inner.indexOf("defaultVariants:");
  if (dIdx !== -1) {
    const dBlock = balanced(inner, inner.indexOf("{", dIdx), "{", "}");
    for (const dm of dBlock.matchAll(/(\w+)\s*:\s*["']([\w-]+)["']/g)) defaults[dm[1]] = dm[2];
  }
  return { base, variants, defaults };
}

// data-slot="X" -> the className expression on the SAME element. Captures only
// the className value (a single string literal, or the balanced {cn(...)} /
// {`...`} expression) so it never bleeds into sibling elements' classes.
function extractDataSlots(src) {
  const slots = {};
  const re = /data-slot=["']([\w-]+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    if (slots[m[1]]) continue; // first (root-most) occurrence wins
    const after = src.slice(m.index);
    const cnIdx = after.indexOf("className");
    if (cnIdx === -1 || cnIdx > 400) continue; // must be on the same tag
    const tag = after.slice(cnIdx);
    const eq = tag.indexOf("=");
    if (eq === -1) continue;
    const c0 = tag.slice(eq + 1).match(/\S/);
    if (!c0) continue;
    let region = "";
    if (c0[0] === "{") {
      region = balanced(tag, tag.indexOf("{", eq), "{", "}");
    } else if (c0[0] === '"' || c0[0] === "'" || c0[0] === "`") {
      const sm = tag.slice(eq + 1).match(/(["'`])((?:\\.|(?!\1).)*)\1/);
      region = sm ? sm[0] : "";
    }
    const classes = classesFrom(region);
    if (classes.length) slots[m[1]] = classes;
  }
  return slots;
}

const files = readdirSync(UI).filter((f) => f.endsWith(".tsx"));
const spec = {};

for (const file of files) {
  const name = file.replace(/\.tsx$/, "");
  const src = readFileSync(path.join(UI, file), "utf8");
  const cva = extractCva(src);
  const slots = extractDataSlots(src);

  let rootClasses = null;
  let source = null;
  if (cva) {
    // default element = base + default variant + default size
    const dv = cva.variants.variant?.[cva.defaults.variant] ?? [];
    const ds = cva.variants.size?.[cva.defaults.size] ?? [];
    rootClasses = [...cva.base, ...dv, ...ds];
    source = "cva";
  } else if (slots[name]) {
    rootClasses = slots[name];
    source = "data-slot";
  } else {
    // fall back to the first data-slot found
    const first = Object.keys(slots)[0];
    if (first) { rootClasses = slots[first]; source = `data-slot:${first}`; }
  }

  spec[name] = {
    source,
    rootMetrics: rootClasses ? resolveClasses(rootClasses) : null,
    cva: cva
      ? {
          base: resolveClasses(cva.base),
          variants: Object.fromEntries(
            Object.entries(cva.variants.variant ?? {}).map(([k, v]) => [k, resolveClasses(v)])
          ),
          sizes: Object.fromEntries(
            Object.entries(cva.variants.size ?? {}).map(([k, v]) => [k, resolveClasses(v)])
          ),
          defaults: cva.defaults,
        }
      : null,
    slots: Object.fromEntries(
      Object.entries(slots).map(([k, v]) => [k, resolveClasses(v)])
    ),
  };
}

const outPath = path.join(__dirname, "shadcn-spec.json");
writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.log(`Extracted ${Object.keys(spec).length} components -> scripts/fidelity/shadcn-spec.json`);

// quick sanity print for a few
for (const c of ["button", "badge", "input", "card", "switch", "alert"]) {
  if (spec[c]) {
    const rm = spec[c].rootMetrics ?? {};
    const { _unknown, _raw, ...clean } = rm;
    console.log(`\n[${c}] (${spec[c].source})`, JSON.stringify(clean));
  }
}
