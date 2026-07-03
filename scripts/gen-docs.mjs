// ==========================================================================
// scripts/gen-docs.mjs
// Generate a static docs site from registry.json into apps/www/docs/.
// One page per component (preview + markup + install + a11y contract + the
// status/js/support metadata), plus an index. Built from the registry so it
// stays in sync; the docs dogfood shadcss's own CSS.
// Exported as genDocs(repoRoot); also runnable directly.
// ==========================================================================

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PKG = "@russfranky/shadcss";

const badge = (label, val) => {
  const tone = {
    stable: "badge-success", partial: "badge-warning", "visual-only": "badge-secondary",
    none: "badge-success", trigger: "badge-info", consumer: "badge-warning",
  }[val] || "badge-secondary";
  return `<span class="badge ${tone}">${esc(label)}: ${esc(val)}</span>`;
};

const DOCS_CSS = `
:root{--docs-side:15rem}
*{box-sizing:border-box}
body{margin:0;font-family:var(--font-sans,system-ui,sans-serif);background:hsl(var(--background));color:hsl(var(--foreground))}
.docs-layout{display:grid;grid-template-columns:var(--docs-side) minmax(0,1fr);min-height:100vh}
.docs-sidebar{border-inline-end:1px solid hsl(var(--border));padding:var(--space-5) var(--space-4);position:sticky;top:0;align-self:start;height:100vh;overflow:auto}
.docs-brand{display:flex;align-items:center;gap:var(--space-2);font-weight:600;margin-bottom:var(--space-5)}
.docs-brand svg{width:1.25rem;height:1.25rem}
.docs-nav{display:flex;flex-direction:column;gap:1px}
.docs-nav a{display:block;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);font-size:var(--text-sm);color:hsl(var(--muted-foreground));text-decoration:none}
.docs-nav a:hover{background:hsl(var(--accent));color:hsl(var(--accent-foreground))}
.docs-nav a[aria-current="page"]{background:hsl(var(--accent));color:hsl(var(--foreground));font-weight:500}
.docs-nav-label{font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:hsl(var(--muted-foreground));padding:var(--space-3) var(--space-3) var(--space-1)}
.docs-main{padding:var(--space-8) var(--space-10);max-width:64rem;min-width:0}
.docs-breadcrumb{font-size:var(--text-sm);color:hsl(var(--muted-foreground));margin-bottom:var(--space-3)}
.docs-breadcrumb a{color:inherit}
.docs-h1{font-size:var(--text-3xl);font-weight:700;letter-spacing:-.025em;margin:0 0 var(--space-2)}
.docs-lead{color:hsl(var(--muted-foreground));font-size:var(--text-lg);margin:0 0 var(--space-4)}
.docs-meta{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-6)}
.docs-section{margin-top:var(--space-8)}
.docs-section h2{font-size:var(--text-xl);font-weight:600;margin:0 0 var(--space-3);padding-bottom:var(--space-2);border-bottom:1px solid hsl(var(--border))}
.docs-preview{padding:var(--space-8);border:1px solid hsl(var(--border));border-radius:var(--radius-lg);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;background:hsl(var(--card))}
pre.docs-code{background:hsl(var(--muted));border:1px solid hsl(var(--border));border-radius:var(--radius-md);padding:var(--space-4);overflow:auto;font-family:var(--font-mono,ui-monospace,monospace);font-size:var(--text-sm);margin:var(--space-2) 0 0}
.docs-classes{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.docs-toolbar{position:absolute;top:var(--space-5);inset-inline-end:var(--space-6)}
@media(max-width:820px){.docs-layout{grid-template-columns:1fr}.docs-sidebar{display:none}.docs-main{padding:var(--space-6)}}
`;

function sidebar(components, current) {
  const links = components
    .map((c) => `<a href="./${c.name}.html"${c.name === current ? ' aria-current="page"' : ""}>${esc(c.name)}</a>`)
    .join("\n");
  const blockLinks = BLOCKS
    .map((b) => `<a href="./block-${b.name}.html"${`block-${b.name}` === current ? ' aria-current="page"' : ""}>${esc(b.name)}</a>`)
    .join("\n");
  return `<aside class="docs-sidebar">
  <div class="docs-brand"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <a href="../index.html" style="color:inherit;text-decoration:none">shadcss</a></div>
  <div class="docs-nav-label">Getting started</div>
  <nav class="docs-nav"><a href="./index.html"${current === "__index" ? ' aria-current="page"' : ""}>Overview</a><a href="./retrofit.html"${current === "__retrofit" ? ' aria-current="page"' : ""}>Retrofit an existing app</a><a href="./support.html"${current === "__support" ? ' aria-current="page"' : ""}>Browser support &amp; limits</a><a href="./blocks.html"${current === "__blocks" ? ' aria-current="page"' : ""}>Blocks</a><a href="../index.html">Live demo</a></nav>
  <div class="docs-nav-label">Components</div>
  <nav class="docs-nav">${links}</nav>${BLOCKS.length ? `
  <div class="docs-nav-label">Blocks</div>
  <nav class="docs-nav">${blockLinks}</nav>` : ""}
</aside>`;
}

// Module-level registry state (set by genDocs) so per-page functions don't
// each need to thread the full registry through their signatures.
let COMPONENTS = [];
let BLOCKS = [];

const themeToggle = `<div class="docs-toolbar"><button class="btn btn-ghost btn-sm" aria-pressed="false" onclick="const d=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=d;this.setAttribute('aria-pressed',d==='dark')">Toggle theme</button></div>`;

function shell(title, body, components, current) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — shadcss docs</title>
<link rel="stylesheet" href="../shadcss.min.css">
<style>${DOCS_CSS}</style>
</head>
<body>
<div class="docs-layout">
${sidebar(components, current)}
<main class="docs-main">${themeToggle}
${body}
</main>
</div>
</body>
</html>`;
}

function componentPage(c, components) {
  const meta = [badge("status", c.status || "stable"), badge("js", c.js || "none"), `<span class="badge badge-outline">support: ${esc(c.support || "baseline")}</span>`].join(" ");
  const classes = (c.classes || []).map((cl) => `<span class="badge badge-secondary">.${esc(cl)}</span>`).join(" ");
  const importLine = `@import "${PKG}/${c.file}";`;
  const cli = `npx ${PKG}-cli add ${c.name}`;
  const a11y = c.a11y ? `<div class="docs-section"><h2>Accessibility</h2><div class="alert alert-info" role="alert"><div><div class="alert-description">${esc(c.a11y)}</div></div></div></div>` : "";
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Components</a> / ${esc(c.name)}</div>
<h1 class="docs-h1">${esc(c.name)}</h1>
<p class="docs-lead">${esc(c.description || "")}</p>
<div class="docs-meta">${meta}</div>

<div class="docs-section"><h2>Preview</h2>${
  c.js === "trigger"
    ? `<div class="docs-preview" style="justify-content:center;color:hsl(var(--muted-foreground));font-size:var(--text-sm)">This overlay stays hidden until triggered — <a href="../index.html" style="color:hsl(var(--primary));font-weight:500">open it in the live demo →</a></div>`
    : `<div class="docs-preview">${c.markup || ""}</div>`
}</div>

<div class="docs-section"><h2>Markup</h2><pre class="docs-code"><code>${esc(c.markup || "")}</code></pre></div>

<div class="docs-section"><h2>Install</h2>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm);margin:.25rem 0">Import the component CSS (depends on <code>base/tokens.css</code>):</p>
<pre class="docs-code"><code>${esc(importLine)}</code></pre>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm);margin:.75rem 0 .25rem">…or copy it into your repo with the CLI:</p>
<pre class="docs-code"><code>${esc(cli)}</code></pre>
</div>

${a11y}

<div class="docs-section"><h2>Classes</h2><div class="docs-classes">${classes}</div></div>

<div class="docs-section"><h2>Dependencies</h2><div class="docs-classes">${(c.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`).join(" ") || '<span class="badge badge-outline">none</span>'}</div></div>
`;
  return shell(c.name, body, components, c.name);
}

function indexPage(reg) {
  const cards = reg.components.map((c) => `
  <a class="card card-interactive" href="./${c.name}.html" style="text-decoration:none;color:inherit;padding:var(--space-4);min-width:0">
    <div class="card-title" style="font-size:var(--text-base)">${esc(c.name)}</div>
    <div class="card-description">${esc(c.description || "")}</div>
    <div style="margin-top:var(--space-2);display:flex;gap:.375rem;flex-wrap:wrap">${badge("js", c.js || "none")}</div>
  </a>`).join("\n");
  const body = `
<div class="docs-breadcrumb">Documentation</div>
<h1 class="docs-h1">Components</h1>
<p class="docs-lead">${reg.components.length} zero-runtime HTML + CSS components. ${esc(reg.description || "")}</p>
<div class="docs-meta"><span class="badge badge-success">${reg.components.filter((c) => (c.js || "none") === "none").length} zero-JS</span> <span class="badge badge-info">${reg.components.filter((c) => c.js === "trigger").length} one-line trigger</span> <span class="badge badge-warning">${reg.components.filter((c) => c.js === "consumer").length} consumer-JS</span></div>
<div class="docs-section" style="margin-top:var(--space-4)"><div class="demo-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(16rem,100%),1fr));gap:var(--space-4)">${cards}</div></div>
`;
  return shell("Components", body, reg.components, "__index");
}

const SUPPORT_NOTES = {
  baseline: "All evergreen browsers.",
  "popover-api": "Popover API — Chrome 114+, Safari 17+, Firefox 125+.",
  "has-selector": "CSS :has() — Chrome 105+, Safari 15.4+, Firefox 121+.",
  dialog: "Native &lt;dialog&gt; showModal() — Chrome 37+, Safari 15.4+, Firefox 98+.",
  details: "Native &lt;details&gt;/&lt;summary&gt; — all evergreen browsers.",
};

function supportPage(reg) {
  const rows = reg.components
    .map((c) => `<tr><td><a href="./${c.name}.html" style="color:hsl(var(--primary));text-decoration:none">${esc(c.name)}</a></td><td>${badge("", c.status || "stable").replace(": ", "")}</td><td>${badge("", c.js || "none").replace(": ", "")}</td><td><code style="font-size:var(--text-xs)">${esc(c.support || "baseline")}</code></td></tr>`)
    .join("\n");
  const supportLegend = Object.entries(SUPPORT_NOTES).map(([k, v]) => `<li><code>${esc(k)}</code> — ${v}</li>`).join("");
  const needsJs = reg.components.filter((c) => c.js === "consumer" || c.status === "visual-only" || c.status === "partial");
  const limits = needsJs.map((c) => `<li><strong>${esc(c.name)}</strong> <span class="badge badge-secondary">${esc(c.status)}</span> — ${esc(c.a11y || c.description || "")}</li>`).join("");
  const body = `
<div class="docs-breadcrumb">Documentation</div>
<h1 class="docs-h1">Browser support &amp; limits</h1>
<p class="docs-lead">Honest about what works where. Every component declares its platform <code>support</code> and how much JavaScript it needs.</p>

<div class="docs-section"><h2>What "js" means</h2>
<div class="alert alert-info" role="alert"><div><div class="alert-description"><strong>none</strong> = zero JS · <strong>trigger</strong> = one native one-liner (<code>showModal()</code>/<code>showPopover()</code>) · <strong>consumer</strong> = you write real JS for full behavior (or add an optional <a href="https://www.npmjs.com/package/@russfranky/shadcss-js" style="color:hsl(var(--primary))">@russfranky/shadcss-js</a> helper).</div></div></div></div>

<div class="docs-section"><h2>Platform support</h2>
<ul style="line-height:1.9">${supportLegend}</ul></div>

<div class="docs-section"><h2>Limitations (${needsJs.length} components need JS or are visual-only)</h2>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm)">These are intentionally not "fake-accessible" CSS shells. They style the component; the interactive/keyboard layer is yours (or an optional helper).</p>
<ul style="line-height:1.8">${limits}</ul></div>

<div class="docs-section"><h2>Full matrix</h2>
<div style="overflow:auto"><table class="table" style="width:100%"><thead><tr><th scope="col">Component</th><th scope="col">Status</th><th scope="col">JS</th><th scope="col">Support</th></tr></thead><tbody>${rows}</tbody></table></div></div>
`;
  return shell("Browser support & limits", body, reg.components, "__support");
}

function retrofitPage(reg) {
  const body = `
<div class="docs-breadcrumb">Documentation</div>
<h1 class="docs-h1">Retrofit an existing app</h1>
<p class="docs-lead">shadcss is plain CSS, so you can drop it onto an existing server-rendered or static app — no build, no markup rewrite, no JS framework — and restyle it through a small adapter.</p>

<div class="docs-section"><h2>1. Add the CSS</h2>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm)">Vendor or link the bundle, then an adapter stylesheet of your own (loaded <em>after</em>, so its token-driven rules win). Set the theme on <code>&lt;html&gt;</code>.</p>
<pre class="docs-code"><code>&lt;html data-theme="dark"&gt;
  &lt;link rel="stylesheet" href="shadcss.min.css"&gt;
  &lt;link rel="stylesheet" href="app-adapter.css"&gt;</code></pre></div>

<div class="docs-section"><h2>2. Reuse what matches, alias what's close</h2>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm)">shadcss already styles <code>.btn</code>, <code>.btn-secondary</code>, <code>.input</code>, <code>.kbd</code>, <code>.card</code>, etc. Common convention names are built-in aliases: <code>.btn-primary</code>, <code>.btn-danger</code>/<code>.btn-error</code> → the right variant automatically. So existing Bootstrap-style buttons often just work.</p></div>

<div class="docs-section"><h2>3. Map your structural classes to tokens</h2>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm)">Your app's layout classes (sidebars, panels, custom buttons) won't exist in shadcss — restyle them with the design tokens. That's the whole adapter.</p>
<pre class="docs-code"><code>.sidebar { background: hsl(var(--card)); border-right: 1px solid hsl(var(--border)); }
.info-panel { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius-lg); }
.your-btn { background: transparent; border: 1px solid hsl(var(--border)); border-radius: var(--radius-md); }
.your-btn:hover { background: hsl(var(--accent)); }</code></pre>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm)">Every token lives on <code>:root</code> — see <a href="./index.html" style="color:hsl(var(--primary))">the components</a> and override any of them to retheme everything.</p></div>

<div class="docs-section"><h2>Reach for the real components — don't hand-roll</h2>
<div class="alert alert-warning" role="alert"><div><div class="alert-description">The most common retrofit mistake: re-styling your custom layout divs from scratch when a shadcss component already exists. Hand-rolling a sidebar with <code>height:100%; margin-top:auto</code> is fragile (the footer clips); the <code>sidebar</code> component already gives you a scrolling body + pinned footer for free. Before writing CSS, check the <a href="./index.html" style="color:hsl(var(--primary))">component list</a> — <code>sidebar</code>, <code>card</code>, <code>input</code>, <code>table</code>, <code>dialog</code>, <code>tabs</code> cover most app chrome.</div></div></div>
<p style="color:hsl(var(--muted-foreground));font-size:var(--text-sm);margin-top:var(--space-3)">Restructure to the component's classes (the markup is yours), then style only what's genuinely custom:</p>
<pre class="docs-code"><code>&lt;aside class="sidebar"&gt;
  &lt;div class="sidebar-content"&gt;          &lt;!-- scrolls --&gt;
    &lt;div class="sidebar-group"&gt;
      &lt;div class="sidebar-group-label"&gt;Folders&lt;/div&gt;
      &lt;div class="sidebar-menu"&gt;
        &lt;button class="sidebar-menu-button"&gt;Inbox&lt;/button&gt;
      &lt;/div&gt;
    &lt;/div&gt;
  &lt;/div&gt;
  &lt;div class="sidebar-footer"&gt;…&lt;/div&gt;       &lt;!-- pinned --&gt;
&lt;/aside&gt;</code></pre></div>

<div class="docs-section"><h2>Case study: Cleanshot Sorter</h2>
<div class="alert alert-info" role="alert"><div><div class="alert-description">A plain HTML/CSS/JS Express app was restyled to the shadcss look with <strong>zero markup or JS changes</strong> — one vendored stylesheet plus a ~120-line adapter mapping its existing classes to tokens. The app's buttons (<code>.btn</code>, <code>.btn-secondary</code>, <code>.btn-danger</code>) mapped directly; only the bespoke layout classes needed glue.</div></div></div></div>
`;
  return shell("Retrofit an existing app", body, reg.components, "__retrofit");
}

function blockPage(b) {
  const meta = [`<span class="badge badge-secondary">family: ${esc(b.family)}</span>`, ...(b.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`)].join(" ");
  const body = `
<div class="docs-breadcrumb"><a href="./blocks.html">Blocks</a> / ${esc(b.name)}</div>
<h1 class="docs-h1">${esc(b.name)}</h1>
<p class="docs-lead">${esc(b.description || "")}</p>
<div class="docs-meta">${meta}</div>

<div class="docs-section"><h2>Preview</h2>
<div class="docs-preview" style="padding:0;background:hsl(var(--muted));overflow:hidden;max-height:32rem">${b.markup || ""}</div></div>

<div class="docs-section"><h2>Markup</h2><pre class="docs-code"><code>${esc(b.markup || "")}</code></pre></div>

<div class="docs-section"><h2>Dependencies</h2><div class="docs-classes">${(b.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`).join(" ") || '<span class="badge badge-outline">none</span>'}</div></div>
`;
  return shell(b.name, body, COMPONENTS, `block-${b.name}`);
}

function blocksIndex(reg) {
  const families = {};
  for (const b of reg.blocks || []) (families[b.family] ??= []).push(b);
  const sections = Object.entries(families).map(([fam, items]) => `
<div class="docs-section"><h2>${esc(fam)} (${items.length})</h2>
<div class="demo-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(18rem,100%),1fr));gap:var(--space-4)">${items.map((b) => `
  <a class="card card-interactive" href="./block-${b.name}.html" style="text-decoration:none;color:inherit;padding:var(--space-4);min-width:0">
    <div class="card-title" style="font-size:var(--text-base)">${esc(b.name)}</div>
    <div class="card-description">${esc(b.description || "")}</div>
  </a>`).join("\n")}</div></div>`).join("\n");
  const body = `
<div class="docs-breadcrumb">Documentation</div>
<h1 class="docs-h1">Blocks</h1>
<p class="docs-lead">${(reg.blocks || []).length} full-page section layouts composed from the components — copy-paste HTML templates. Mirrors shadcn's blocks.</p>
${sections}`;
  return shell("Blocks", body, reg.components, "__blocks");
}

export function genDocs(repoRoot) {
  const reg = JSON.parse(readFileSync(path.join(repoRoot, "packages/shadcss/registry.json"), "utf8"));
  BLOCKS = reg.blocks || [];
  COMPONENTS = reg.components;
  const out = path.join(repoRoot, "apps/www/docs");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "index.html"), indexPage(reg));
  writeFileSync(path.join(out, "support.html"), supportPage(reg));
  writeFileSync(path.join(out, "retrofit.html"), retrofitPage(reg));
  for (const c of reg.components) writeFileSync(path.join(out, `${c.name}.html`), componentPage(c, reg.components));
  if (reg.blocks && reg.blocks.length) {
    writeFileSync(path.join(out, "blocks.html"), blocksIndex(reg));
    for (const b of reg.blocks) writeFileSync(path.join(out, `block-${b.name}.html`), blockPage(b));
  }
  return reg.components.length;
}

// run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const n = genDocs(root);
  console.log(`generated docs for ${n} components → apps/www/docs/`);
}
