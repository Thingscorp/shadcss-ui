#!/usr/bin/env node
// ==========================================================================
// shadcss CLI — add / list / info / diff / check
//
// The "own the code, but updates still flow" answer to shadcn's #1 complaint:
//   - `add`   copies component CSS into your repo (ownership, shadcn-style)
//   - `diff`  shows how your copy has drifted from upstream (what shadcn can't)
//   - `check` lints your HTML for known a11y/markup foot-guns
//
// Zero dependencies. Reads the published @russfranky/shadcss registry from a
// CDN by default; `--from <dir>` reads a local checkout instead.
// ==========================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const PKG = "@russfranky/shadcss";
const DEFAULT_VERSION = "0.1.12"; // framework version this CLI ships against

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function die(msg) {
  console.error(C.red("error: ") + msg);
  process.exit(1);
}

// ---- source resolution: local dir or CDN ---------------------------------
function makeSource(opts) {
  if (opts.from) {
    const dir = path.resolve(opts.from);
    return {
      label: dir,
      async read(rel) {
        return readFile(path.join(dir, rel), "utf8");
      },
    };
  }
  const version = opts.version || DEFAULT_VERSION;
  const base = `https://cdn.jsdelivr.net/npm/${PKG}@${version}/`;
  return {
    label: `${PKG}@${version} (jsdelivr)`,
    async read(rel) {
      const url = base + rel;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
      return res.text();
    },
  };
}

async function loadRegistry(src) {
  let raw;
  try {
    raw = await src.read("registry.json");
  } catch (e) {
    die(`could not load registry from ${src.label}\n  ${e.message}`);
  }
  return JSON.parse(raw);
}

// Map a dependency string to a source-relative path.
//   "base/tokens" -> "src/base/tokens.css"   (a base layer)
//   "popover"     -> registry entry's file   (another component)
function depToPath(dep, registry) {
  if (dep.includes("/")) return `src/${dep}.css`;
  const e = registry.components.find((c) => c.name === dep);
  return e ? e.file : `src/components/${dep}.css`;
}

// Resolve the full set of files needed for a component, deps first.
function resolveFiles(name, registry, seen = new Set(), order = []) {
  const entry = registry.components.find((c) => c.name === name);
  if (!entry) die(`unknown component "${name}". Run \`shadcss list\` to see all.`);
  for (const dep of entry.deps || []) {
    const p = depToPath(dep, registry);
    if (!seen.has(p)) {
      seen.add(p);
      if (!dep.includes("/")) resolveFiles(dep, registry, seen, order); // recurse into component deps
      order.push({ kind: dep.includes("/") ? "base" : "component", path: p, name: dep });
    }
  }
  if (!seen.has(entry.file)) {
    seen.add(entry.file);
    order.push({ kind: "component", path: entry.file, name });
  }
  return order;
}

// ---- commands ------------------------------------------------------------
async function cmdList(src) {
  const reg = await loadRegistry(src);
  console.log(C.bold(`\n  ${reg.name} v${reg.version} — ${reg.components.length} components\n`));
  for (const c of reg.components) {
    console.log(`  ${C.cyan(c.name.padEnd(18))} ${C.dim(c.description || "")}`);
  }
  console.log("");
}

async function cmdInfo(src, name) {
  if (!name) die("usage: shadcss info <component>");
  const reg = await loadRegistry(src);
  const e = reg.components.find((c) => c.name === name);
  if (!e) die(`unknown component "${name}".`);
  console.log(C.bold(`\n  ${e.name}`));
  if (e.description) console.log(`  ${e.description}`);
  console.log(`\n  ${C.dim("file:")}    ${e.file}`);
  if (e.status || e.js || e.support)
    console.log(`  ${C.dim("status:")}  ${e.status || "stable"} ${C.dim("·")} js:${e.js || "none"} ${C.dim("·")} support:${e.support || "baseline"}`);
  console.log(`  ${C.dim("deps:")}    ${(e.deps || []).join(", ") || "none"}`);
  console.log(`  ${C.dim("classes:")} ${(e.classes || []).join(" ")}`);
  if (e.a11y) console.log(`  ${C.dim("a11y:")}    ${e.a11y}`);
  if (e.markup) console.log(`\n  ${C.dim("markup:")}\n  ${e.markup}`);
  console.log("");
}

async function cmdAdd(src, names, opts) {
  if (!names.length) die("usage: shadcss add <component...> [--dir ./shadcss]");
  const reg = await loadRegistry(src);
  const outDir = path.resolve(opts.dir || "shadcss");

  // collect a unified, de-duplicated file set across all requested components
  const seen = new Set();
  const files = [];
  for (const name of names) resolveFiles(name, reg, seen, files);

  console.log(C.bold(`\n  Adding to ${C.cyan(path.relative(process.cwd(), outDir) || ".")}/ from ${src.label}\n`));
  let written = 0;
  for (const f of files) {
    const css = await src.read(f.path);
    // src/base/tokens.css -> <outDir>/base/tokens.css ; src/components/x.css -> <outDir>/components/x.css
    const rel = f.path.replace(/^src\//, "");
    const dest = path.join(outDir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    if (existsSync(dest) && !opts.force) {
      console.log(`  ${C.yellow("skip")}  ${rel} ${C.dim("(exists — use --force)")}`);
      continue;
    }
    await writeFile(dest, css);
    console.log(`  ${C.green("add ")}  ${rel}`);
    written++;
  }

  // friendly next-step snippet
  const importLines = files.map((f) => `@import "./${f.path.replace(/^src\//, "")}";`).join("\n");
  console.log(C.dim(`\n  ${written} file(s) written. Import them (order matters — base first):\n`));
  console.log(importLines.split("\n").map((l) => "    " + l).join("\n"));
  console.log("");
}

// minimal LCS line diff
function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(["  ", A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(["- ", A[i]]); i++; }
    else { out.push(["+ ", B[j]]); j++; }
  }
  while (i < n) out.push(["- ", A[i++]]);
  while (j < m) out.push(["+ ", B[j++]]);
  return out;
}

async function diffOne(src, entry, opts, reg) {
  const localPath = path.resolve(opts.dir || "shadcss", entry.file.replace(/^src\//, ""));
  let local;
  try { local = await readFile(localPath, "utf8"); }
  catch { return { skipped: true }; }
  const upstream = await src.read(entry.file);
  if (local === upstream) {
    console.log(C.green(`  ${entry.name}: up to date`));
    return { drift: 0 };
  }
  console.log(C.bold(`\n  ${entry.name}: your copy vs ${src.label}\n`));
  let changes = 0;
  for (const [mark, line] of lineDiff(local, upstream)) {
    if (mark === "  ") continue;
    changes++;
    const colored = mark === "- " ? C.red(mark + line) : C.green(mark + line);
    console.log("  " + colored);
  }
  console.log(C.dim(`\n  ${changes} changed line(s). (${C.red("-")} yours, ${C.green("+")} upstream)\n`));
  return { drift: changes };
}

async function cmdDiff(src, name, opts) {
  const reg = await loadRegistry(src);
  if (name) {
    const e = reg.components.find((c) => c.name === name);
    if (!e) die(`unknown component "${name}".`);
    const result = await diffOne(src, e, opts, reg);
    if (result.skipped) die(`no local copy at ${path.relative(process.cwd(), path.resolve(opts.dir || "shadcss", e.file.replace(/^src\//, "")))} — run \`shadcss add ${name}\` first.`);
    if (result.drift > 0) process.exit(1);
    return;
  }
  // No name — diff all local copies
  console.log(C.bold(`\n  Diffing all local copies against ${src.label}\n`));
  let totalDrift = 0;
  let checked = 0;
  for (const e of reg.components) {
    const result = await diffOne(src, e, opts, reg);
    if (!result.skipped) {
      checked++;
      totalDrift += result.drift;
    }
  }
  if (checked === 0) die(`no local copies found in ${opts.dir || "./shadcss"} — run \`shadcss add\` first.`);
  console.log(C.dim(`\n  ${checked} component(s) checked, ${totalDrift} total drifted line(s).\n`));
  if (totalDrift > 0) process.exit(1);
}

// consumer-facing markup foot-gun lint (mirrors the repo's check-markup guards)
async function cmdCheck(files) {
  if (!files.length) die("usage: shadcss check <file.html ...>");
  let problems = 0;
  for (const file of files) {
    let html;
    try { html = await readFile(path.resolve(file), "utf8"); }
    catch { console.log(C.red(`  cannot read ${file}`)); problems++; continue; }
    const checks = [
      [/tabs-trigger[^>]*aria-selected/, "static aria-selected on .tabs-trigger — CSS can't keep it in sync; use native radiogroup semantics"],
      [/navigation-menu-content"[^>]*\bpopover\b/, "popover on .navigation-menu-content — promotes to top layer and detaches from the trigger"],
      [/focus-visible-anchor\s*:/, "invalid 'focus-visible-anchor' CSS property"],
      [/<input[^>]*type="range"(?![^>]*aria-label)(?![^>]*aria-labelledby)/, "range slider without an accessible label (add aria-label)"],
    ];
    const hits = checks.filter(([re]) => re.test(html));
    if (hits.length) {
      console.log(C.bold(`\n  ${file}`));
      for (const [, msg] of hits) { console.log(`  ${C.red("✗")} ${msg}`); problems++; }
    } else {
      console.log(`  ${C.green("✓")} ${file}`);
    }
  }
  console.log("");
  if (problems) { console.error(C.red(`${problems} issue(s) found.`)); process.exit(1); }
  console.log(C.green("No known markup foot-guns found."));
}

const HELP = `
  ${C.bold("shadcss")} — add accessible, zero-runtime CSS components to your project

  ${C.bold("Usage")}
    shadcss <command> [options]

  ${C.bold("Commands")}
    list                       list all available components
    info <component>           show a component's classes, deps, and markup
    add <component...>         copy component CSS (+ its deps) into your project
    diff [component]           show how your copy differs from upstream (all if omitted)
    check <file.html ...>      lint HTML for known a11y/markup foot-guns

  ${C.bold("Options")}
    --dir <path>               target/local dir for add & diff (default: ./shadcss)
    --from <dir>               read from a local shadcss checkout instead of the CDN
    --version <v>              framework version to pull from the CDN
    --force                    overwrite existing files on add
    -h, --help                 show this help

  ${C.bold("Examples")}
    npx @russfranky/shadcss-cli list
    npx @russfranky/shadcss-cli add button card dialog
    npx @russfranky/shadcss-cli diff button
    npx @russfranky/shadcss-cli check ./index.html
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      from: { type: "string" },
      version: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) { console.log(HELP); return; }

  const src = makeSource(values);
  try {
    switch (cmd) {
      case "list": return await cmdList(src);
      case "info": return await cmdInfo(src, rest[0]);
      case "add": return await cmdAdd(src, rest, values);
      case "diff": return await cmdDiff(src, rest[0], values);
      case "check": return await cmdCheck(rest);
      default: die(`unknown command "${cmd}". Run \`shadcss --help\`.`);
    }
  } catch (e) {
    die(e.message);
  }
}

main();
