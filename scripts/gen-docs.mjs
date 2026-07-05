// ==========================================================================
// scripts/gen-docs.mjs
// Generate a static docs site from registry.json into apps/www/docs/.
// Layout mirrors shadcn's docs: sticky header (brand + search + theme toggle),
// three-column grid [left nav | main | right on-this-page TOC], breadcrumb,
// grouped nav. Built from the registry so it stays in sync; the docs dogfood
// shadcss's own CSS (raw tokens — no hsl() wrappers, which are invalid now
// that tokens are OKLCH).
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

// Tokens are OKLCH. Docs use them RAW — hsl(var(--x)) is invalid CSS and the
// whole point of this rewrite was that the old wrappers silently dropped.
const DOCS_CSS = `
:root{
  --docs-header:3.5rem;
  --docs-sidebar:16rem;
  --docs-toc:14rem;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:calc(var(--docs-header) + 1rem)}
body{margin:0;font-family:var(--font-sans,system-ui,sans-serif);background:var(--background);color:var(--foreground);-webkit-font-smoothing:antialiased}
a{color:inherit}

/* ---- sticky header ---- */
.docs-header{position:sticky;top:0;z-index:50;height:var(--docs-header);background:color-mix(in oklab,var(--background) 80%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.docs-header-inner{display:flex;align-items:center;gap:var(--space-3);height:100%;max-width:96rem;margin:0 auto;padding:0 var(--space-4) 0 var(--space-3)}
.docs-menu-btn{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:0;background:transparent;color:var(--foreground);cursor:pointer;border-radius:var(--radius-md)}
.docs-menu-btn:hover{background:var(--accent);color:var(--accent-foreground)}
.docs-menu-btn svg{width:1.25rem;height:1.25rem}
@media(min-width:64rem){.docs-menu-btn{display:none}}
.docs-brand{display:flex;align-items:center;gap:var(--space-2);font-weight:600;text-decoration:none;color:var(--foreground);font-size:var(--text-sm)}
.docs-brand svg{width:1.25rem;height:1.25rem}
.docs-header-spacer{flex:1}
.docs-search{position:relative;display:flex;align-items:center;width:100%;max-width:20rem}
@media(min-width:48rem){.docs-search{margin-inline-start:var(--space-4)}}
.docs-search input{width:100%;height:2.25rem;padding:0 var(--space-3) 0 2.25rem;font-size:var(--text-sm);color:var(--foreground);background:var(--muted);border:1px solid var(--border);border-radius:var(--radius-md);outline:none}
.docs-search input::placeholder{color:var(--muted-foreground)}
.docs-search input:focus{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 40%,transparent)}
.docs-search>svg{position:absolute;inset-inline-start:var(--space-3);width:1rem;height:1rem;color:var(--muted-foreground);pointer-events:none}
.docs-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;border:1px solid var(--border);background:transparent;color:var(--foreground);border-radius:var(--radius-md);cursor:pointer}
.docs-icon-btn:hover{background:var(--accent);color:var(--accent-foreground)}
.docs-icon-btn svg{width:1.1rem;height:1.1rem}

/* ---- three-column body ---- */
.docs-body{display:block;max-width:96rem;margin:0 auto}
@media(min-width:64rem){
  .docs-body{display:grid;grid-template-columns:var(--docs-sidebar) minmax(0,1fr)}
}
@media(min-width:80rem){
  .docs-body{grid-template-columns:var(--docs-sidebar) minmax(0,1fr) var(--docs-toc)}
}

/* ---- left nav ---- */
.docs-left{display:none;position:sticky;top:var(--docs-header);align-self:start;height:calc(100vh - var(--docs-header));overflow-y:auto;border-inline-end:1px solid var(--border);padding:var(--space-4) var(--space-2)}
@media(min-width:64rem){.docs-left{display:block}}
.docs-left[data-open="true"]{display:block;position:fixed;inset-block-start:var(--docs-header);inset-inline-start:0;width:min(var(--docs-sidebar),80vw);height:calc(100vh - var(--docs-header));background:var(--background);z-index:40;box-shadow:var(--shadow-lg)}
.docs-backdrop{display:none}
.docs-left[data-open="true"] ~ .docs-backdrop{display:block;position:fixed;inset:var(--docs-header) 0 0 0;background:color-mix(in oklab,black 50%,transparent);z-index:35}
.docs-nav-label{font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);padding:var(--space-3) var(--space-3) var(--space-1)}
.docs-nav-group{display:flex;flex-direction:column;gap:1px;margin-bottom:var(--space-4)}
.docs-nav a{display:block;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);font-size:var(--text-sm);color:var(--muted-foreground);text-decoration:none;line-height:1.3}
.docs-nav a:hover{background:var(--accent);color:var(--accent-foreground)}
.docs-nav a[aria-current="page"]{background:var(--accent);color:var(--foreground);font-weight:500}
.docs-nav a.docs-hidden{display:none}

/* ---- main content ---- */
.docs-main{padding:var(--space-6) var(--space-4) var(--space-16);min-width:0}
@media(min-width:48rem){.docs-main{padding:var(--space-8) var(--space-8) var(--space-20)}}
.docs-breadcrumb{display:flex;align-items:center;gap:var(--space-1);font-size:var(--text-sm);color:var(--muted-foreground);margin-bottom:var(--space-4)}
.docs-breadcrumb a{color:inherit;text-decoration:none}
.docs-breadcrumb a:hover{color:var(--foreground)}
.docs-breadcrumb span{opacity:.5}
.docs-h1{font-size:var(--text-3xl);font-weight:700;letter-spacing:-.025em;margin:0 0 var(--space-2)}
.docs-lead{color:var(--muted-foreground);font-size:var(--text-lg);margin:0 0 var(--space-4);line-height:1.5}
.docs-meta{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-6)}
.docs-section{margin-top:var(--space-8);scroll-margin-top:calc(var(--docs-header) + 1rem)}
.docs-section h2{font-size:var(--text-xl);font-weight:600;margin:0 0 var(--space-3);padding-bottom:var(--space-2);border-bottom:1px solid var(--border)}
.docs-section p{color:var(--foreground);line-height:1.6}
.docs-section code{font-family:var(--font-mono,ui-monospace,monospace);font-size:.85em;background:var(--muted);padding:.1em .35em;border-radius:var(--radius-sm)}
.docs-preview{padding:var(--space-8);border:1px solid var(--border);border-radius:var(--radius-lg);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;background:var(--card);overflow:hidden}
pre.docs-code{background:var(--muted);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-4);overflow:auto;font-family:var(--font-mono,ui-monospace,monospace);font-size:var(--text-sm);margin:var(--space-2) 0 0;line-height:1.6}
.docs-classes{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.docs-grid{display:grid;grid-template-columns:1fr;gap:var(--space-4)}
@media(min-width:48rem){.docs-grid{grid-template-columns:repeat(auto-fill,minmax(min(16rem,100%),1fr))}}

/* ---- right on-this-page TOC ---- */
.docs-toc{display:none}
@media(min-width:80rem){
  .docs-toc{display:flex;flex-direction:column;gap:var(--space-2);position:sticky;top:var(--docs-header);align-self:start;height:calc(100vh - var(--docs-header));overflow-y:auto;padding:var(--space-8) var(--space-4) var(--space-8) var(--space-2)}
}
.docs-toc-label{font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);margin-bottom:var(--space-1)}
.docs-toc a{display:block;font-size:var(--text-sm);color:var(--muted-foreground);text-decoration:none;padding:.25rem 0;border-inline-start:2px solid transparent;padding-inline-start:var(--space-3)}
.docs-toc a:hover{color:var(--foreground)}
.docs-toc a[aria-current="true"]{color:var(--foreground);border-inline-start-color:var(--foreground)}
`;

// ---- nav grouping (mirrors shadcn's grouped sidebar) ----
// Categorize components for the left nav. Falls back to "Components".
function groupOf(name) {
  const sets = {
    "Getting Started": ["index", "__index", "retrofit", "__retrofit", "support", "__support"],
    "Blocks": [],
  };
  for (const [g, names] of Object.entries(sets)) if (names.includes(name)) return g;
  return "Components";
}

function leftNav(components, blocks, current) {
  const topLinks = `<div class="docs-nav-group">
    <a href="./index.html"${current === "__index" ? ' aria-current="page"' : ""}>Introduction</a>
    <a href="./retrofit.html"${current === "__retrofit" ? ' aria-current="page"' : ""}>Retrofit an existing app</a>
    <a href="./support.html"${current === "__support" ? ' aria-current="page"' : ""}>Browser support &amp; limits</a>
    <a href="../index.html">Live demo →</a>
  </div>`;
  const compLinks = components
    .map((c) => `<a href="./${c.name}.html" data-search="${esc(c.name + " " + (c.description || ""))}"${c.name === current ? ' aria-current="page"' : ""}>${esc(c.name)}</a>`)
    .join("\n");
  const blockLinks = (blocks || [])
    .map((b) => `<a href="./block-${b.name}.html" data-search="${esc(b.name + " " + (b.description || ""))}"${`block-${b.name}` === current ? ' aria-current="page"' : ""}>${esc(b.name)}</a>`)
    .join("\n");
  return `<nav class="docs-nav" aria-label="Components">
    <div class="docs-nav-label">Getting Started</div>
    ${topLinks}
    <div class="docs-nav-label">Components</div>
    <div class="docs-nav-group" id="docs-comp-list">${compLinks}</div>
    ${(blocks || []).length ? `<div class="docs-nav-label">Blocks</div><div class="docs-nav-group">${blockLinks}</div>` : ""}
  </nav>`;
}

const BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" rx="1" x="3" y="3"/><rect width="7" height="5" rx="1" x="3" y="16"/><rect width="7" height="9" rx="1" x="14" y="3"/><rect width="7" height="5" rx="1" x="14" y="16"/></svg>`;
const SEARCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
const MENU_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;
const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;

// Live client-side filter: typing in the search box hides non-matching nav
// links. No JS framework — ~8 lines. shadcn uses a command palette; this is
// the zero-build equivalent that fits shadcss's contract.
const SEARCH_JS = `<script>
(function(){
  var inp=document.querySelector('.docs-search input'); if(!inp)return;
  var links=document.querySelectorAll('#docs-comp-list a');
  inp.addEventListener('input',function(){
    var q=inp.value.toLowerCase().trim();
    links.forEach(function(a){
      var hay=(a.getAttribute('data-search')||a.textContent).toLowerCase();
      a.classList.toggle('docs-hidden', q && hay.indexOf(q)===-1);
    });
  });
  var left=document.querySelector('.docs-left');
  var menuBtn=document.querySelector('.docs-menu-btn');
  if(menuBtn&&left){menuBtn.addEventListener('click',function(){
    left.setAttribute('data-open', left.getAttribute('data-open')==='true'?'false':'true');
  });}
  var backdrop=document.querySelector('.docs-backdrop');
  if(backdrop&&left){backdrop.addEventListener('click',function(){left.setAttribute('data-open','false');});}
})();
</script>`;

// Build a right-side TOC from a page's <h2> sections. Each must carry an id.
function tocFromSections(html) {
  const sections = [...html.matchAll(/<div class="docs-section"[^>]*>\s*<h2[^>]*id="([^"]+)"[^>]*>([^<]+)<\/h2>/g)];
  if (!sections.length) return "";
  const items = sections.map((m) => `<a href="#${m[1]}">${esc(m[2])}</a>`).join("\n");
  return `<aside class="docs-toc" aria-label="On this page"><div class="docs-toc-label">On this page</div>${items}</aside>`;
}

// Make every <h2> in a section anchorable for the TOC.
function anchorHeadings(body) {
  let n = 0;
  return body.replace(/(<div class="docs-section"><h2>)/g, (m) => {
    // Pull the heading text to slugify.
    return m.replace("<h2>", () => {
      n++;
      return `<h2 id="section-${n}">`;
    });
  });
}

function header() {
  return `<header class="docs-header"><div class="docs-header-inner">
    <button class="docs-menu-btn" aria-label="Toggle navigation">${MENU_SVG}</button>
    <a class="docs-brand" href="../index.html">${BRAND_SVG} shadcss</a>
    <div class="docs-search">
      ${SEARCH_SVG}
      <input type="search" placeholder="Search components..." aria-label="Search components">
    </div>
    <div class="docs-header-spacer"></div>
    <button class="docs-icon-btn" id="docs-theme" aria-label="Toggle theme" aria-pressed="false"></button>
    <a class="docs-icon-btn" href="https://github.com/russfranky/shadcss-ui" aria-label="GitHub" rel="noopener"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>
  </div></header>`;
}

// Theme toggle: set the right icon (sun/moon) based on current state, inline JS.
const THEME_JS = `<script>
(function(){
  var b=document.getElementById('docs-theme');
  function icon(){return document.documentElement.dataset.theme==='dark'?${JSON.stringify(SUN_SVG)}:${JSON.stringify(MOON_SVG)};}
  function sync(){b.innerHTML=icon();b.setAttribute('aria-pressed',document.documentElement.dataset.theme==='dark');}
  sync();
  b.addEventListener('click',function(){
    document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
    sync();
  });
})();
</script>`;

function shell(title, body, components, current, blocks = BLOCKS) {
  const anchored = anchorHeadings(body);
  const toc = tocFromSections(anchored);
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — shadcss docs</title>
<link rel="stylesheet" href="../shadcss.min.css">
<style>${DOCS_CSS}</style>
</head>
<body>
${header()}
<div class="docs-body">
<aside class="docs-left">
${leftNav(components, blocks, current)}
</aside>
<main class="docs-main">
${anchored}
</main>
${toc}
<div class="docs-backdrop"></div>
</div>
${THEME_JS}
${SEARCH_JS}
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
<div class="docs-breadcrumb"><a href="./index.html">Components</a><span>/</span>${esc(c.name)}</div>
<h1 class="docs-h1">${esc(c.name)}</h1>
<p class="docs-lead">${esc(c.description || "")}</p>
<div class="docs-meta">${meta}</div>

<div class="docs-section"><h2>Preview</h2>${
  c.js === "trigger"
    ? `<div class="docs-preview" style="justify-content:center;color:var(--muted-foreground);font-size:var(--text-sm)">This overlay stays hidden until triggered — <a href="../index.html" style="color:var(--primary);font-weight:500">open it in the live demo →</a></div>`
    : `<div class="docs-preview">${c.markup || ""}</div>`
}</div>

<div class="docs-section"><h2>Markup</h2><pre class="docs-code"><code>${esc(c.markup || "")}</code></pre></div>

<div class="docs-section"><h2>Install</h2>
<p style="color:var(--muted-foreground);font-size:var(--text-sm);margin:.25rem 0">Import the component CSS (depends on <code>base/tokens.css</code>):</p>
<pre class="docs-code"><code>${esc(importLine)}</code></pre>
<p style="color:var(--muted-foreground);font-size:var(--text-sm);margin:.75rem 0 .25rem">…or copy it into your repo with the CLI:</p>
<pre class="docs-code"><code>${esc(cli)}</code></pre>
</div>

${a11y}

<div class="docs-section"><h2>Classes</h2><div class="docs-classes">${classes}</div></div>

<div class="docs-section"><h2>Dependencies</h2><div class="docs-classes">${(c.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`).join(" ") || '<span class="badge badge-outline">none</span>'}</div></div>
`;
  return shell(c.name, body, COMPONENTS, c.name);
}

function indexPage(reg) {
  const cards = reg.components.map((c) => `
  <a class="card card-interactive" href="./${c.name}.html" style="text-decoration:none;color:inherit;padding:var(--space-4);min-width:0">
    <div class="card-title" style="font-size:var(--text-base)">${esc(c.name)}</div>
    <div class="card-description">${esc(c.description || "")}</div>
    <div style="margin-top:var(--space-2);display:flex;gap:.375rem;flex-wrap:wrap">${badge("js", c.js || "none")}</div>
  </a>`).join("\n");
  const body = `
<div class="docs-breadcrumb"><span>Documentation</span></div>
<h1 class="docs-h1">shadcss</h1>
<p class="docs-lead">${reg.components.length} zero-runtime HTML + CSS components. ${esc(reg.description || "")}</p>
<div class="docs-meta"><span class="badge badge-success">${reg.components.filter((c) => (c.js || "none") === "none").length} zero-JS</span> <span class="badge badge-info">${reg.components.filter((c) => c.js === "trigger").length} one-line trigger</span> <span class="badge badge-warning">${reg.components.filter((c) => c.js === "consumer").length} consumer-JS</span></div>
<div class="docs-section"><div class="docs-grid">${cards}</div></div>
`;
  return shell("shadcss", body, COMPONENTS, "__index");
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
    .map((c) => `<tr><td><a href="./${c.name}.html" style="color:var(--primary);text-decoration:none">${esc(c.name)}</a></td><td>${badge("", c.status || "stable").replace(": ", "")}</td><td>${badge("", c.js || "none").replace(": ", "")}</td><td><code style="font-size:var(--text-xs)">${esc(c.support || "baseline")}</code></td></tr>`)
    .join("\n");
  const supportLegend = Object.entries(SUPPORT_NOTES).map(([k, v]) => `<li><code>${esc(k)}</code> — ${v}</li>`).join("");
  const needsJs = reg.components.filter((c) => c.js === "consumer" || c.status === "visual-only" || c.status === "partial");
  const limits = needsJs.map((c) => `<li><strong>${esc(c.name)}</strong> <span class="badge badge-secondary">${esc(c.status)}</span> — ${esc(c.a11y || c.description || "")}</li>`).join("");
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Browser support</div>
<h1 class="docs-h1">Browser support &amp; limits</h1>
<p class="docs-lead">Honest about what works where. Every component declares its platform <code>support</code> and how much JavaScript it needs.</p>

<div class="docs-section"><h2>What "js" means</h2>
<div class="alert alert-info" role="alert"><div><div class="alert-description"><strong>none</strong> = zero JS · <strong>trigger</strong> = one native one-liner (<code>showModal()</code>/<code>showPopover()</code>) · <strong>consumer</strong> = you write real JS for full behavior (or add an optional <a href="https://www.npmjs.com/package/@russfranky/shadcss-js" style="color:var(--primary)">@russfranky/shadcss-js</a> helper).</div></div></div></div>

<div class="docs-section"><h2>Platform support</h2>
<ul style="line-height:1.9">${supportLegend}</ul></div>

<div class="docs-section"><h2>Limitations (${needsJs.length} components need JS or are visual-only)</h2>
<p style="color:var(--muted-foreground);font-size:var(--text-sm)">These are intentionally not "fake-accessible" CSS shells. They style the component; the interactive/keyboard layer is yours (or an optional helper).</p>
<ul style="line-height:1.8">${limits}</ul></div>

<div class="docs-section"><h2>Full matrix</h2>
<div style="overflow:auto"><table class="table" style="width:100%"><thead><tr><th scope="col">Component</th><th scope="col">Status</th><th scope="col">JS</th><th scope="col">Support</th></tr></thead><tbody>${rows}</tbody></table></div></div>
`;
  return shell("Browser support & limits", body, COMPONENTS, "__support");
}

function retrofitPage(reg) {
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Retrofit</div>
<h1 class="docs-h1">Retrofit an existing app</h1>
<p class="docs-lead">shadcss is plain CSS, so you can drop it onto an existing server-rendered or static app — no build, no markup rewrite, no JS framework — and restyle it through a small adapter.</p>

<div class="docs-section"><h2>1. Add the CSS</h2>
<p style="color:var(--muted-foreground);font-size:var(--text-sm)">Vendor or link the bundle, then an adapter stylesheet of your own (loaded <em>after</em>, so its token-driven rules win). Set the theme on <code>&lt;html&gt;</code>.</p>
<pre class="docs-code"><code>&lt;html data-theme="dark"&gt;
  &lt;link rel="stylesheet" href="shadcss.min.css"&gt;
  &lt;link rel="stylesheet" href="app-adapter.css"&gt;</code></pre></div>

<div class="docs-section"><h2>2. Reuse what matches, alias what's close</h2>
<p style="color:var(--muted-foreground);font-size:var(--text-sm)">shadcss already styles <code>.btn</code>, <code>.btn-secondary</code>, <code>.input</code>, <code>.kbd</code>, <code>.card</code>, etc. Common convention names are built-in aliases: <code>.btn-primary</code>, <code>.btn-danger</code>/<code>.btn-error</code> → the right variant automatically. So existing Bootstrap-style buttons often just work.</p></div>

<div class="docs-section"><h2>3. Map your structural classes to tokens</h2>
<p style="color:var(--muted-foreground);font-size:var(--text-sm)">Your app's layout classes (sidebars, panels, custom buttons) won't exist in shadcss — restyle them with the design tokens. That's the whole adapter.</p>
<pre class="docs-code"><code>.sidebar { background: var(--card); border-right: 1px solid var(--border); }
.info-panel { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.your-btn { background: transparent; border: 1px solid var(--border); border-radius: var(--radius-md); }
.your-btn:hover { background: var(--accent); }</code></pre>
<p style="color:var(--muted-foreground);font-size:var(--text-sm)">Every token lives on <code>:root</code> — see <a href="./index.html" style="color:var(--primary)">the components</a> and override any of them to retheme everything.</p></div>

<div class="docs-section"><h2>Reach for the real components — don't hand-roll</h2>
<div class="alert alert-warning" role="alert"><div><div class="alert-description">The most common retrofit mistake: re-styling your custom layout divs from scratch when a shadcss component already exists. Hand-rolling a sidebar with <code>height:100%; margin-top:auto</code> is fragile (the footer clips); the <code>sidebar</code> component already gives you a scrolling body + pinned footer for free. Before writing CSS, check the <a href="./index.html" style="color:var(--primary)">component list</a> — <code>sidebar</code>, <code>card</code>, <code>input</code>, <code>table</code>, <code>dialog</code>, <code>tabs</code> cover most app chrome.</div></div></div>
<p style="color:var(--muted-foreground);font-size:var(--text-sm);margin-top:var(--space-3)">Restructure to the component's classes (the markup is yours), then style only what's genuinely custom:</p>
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
  return shell("Retrofit an existing app", body, COMPONENTS, "__retrofit");
}

function blockPage(b) {
  const meta = [`<span class="badge badge-secondary">family: ${esc(b.family)}</span>`, ...(b.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`)].join(" ");
  const body = `
<div class="docs-breadcrumb"><a href="./blocks.html">Blocks</a><span>/</span>${esc(b.name)}</div>
<h1 class="docs-h1">${esc(b.name)}</h1>
<p class="docs-lead">${esc(b.description || "")}</p>
<div class="docs-meta">${meta}</div>

<div class="docs-section"><h2>Preview</h2>
<div class="docs-preview" style="padding:0;background:var(--muted);overflow:hidden;max-height:32rem">${b.markup || ""}</div></div>

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
<div class="docs-grid">${items.map((b) => `
  <a class="card card-interactive" href="./block-${b.name}.html" style="text-decoration:none;color:inherit;padding:var(--space-4);min-width:0">
    <div class="card-title" style="font-size:var(--text-base)">${esc(b.name)}</div>
    <div class="card-description">${esc(b.description || "")}</div>
  </a>`).join("")}</div></div>`).join("");
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Blocks</div>
<h1 class="docs-h1">Blocks</h1>
<p class="docs-lead">${(reg.blocks || []).length} full-page section layouts composed from the components — copy-paste HTML templates. Mirrors shadcn's blocks.</p>
${sections}`;
  return shell("Blocks", body, COMPONENTS, "__blocks");
}

// Module-level registry state (set by genDocs) so per-page functions don't
// each need to thread the full registry through their signatures.
let COMPONENTS = [];
let BLOCKS = [];

export function genDocs(repoRoot) {
  const reg = JSON.parse(readFileSync(path.join(repoRoot, "packages", "shadcss/registry.json"), "utf8"));
  COMPONENTS = reg.components;
  BLOCKS = reg.blocks || [];
  const out = path.join(repoRoot, "apps/www/docs");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "index.html"), indexPage(reg));
  writeFileSync(path.join(out, "support.html"), supportPage(reg));
  writeFileSync(path.join(out, "retrofit.html"), retrofitPage(reg));
  writeFileSync(path.join(out, "blocks.html"), blocksIndex(reg));
  for (const c of reg.components) writeFileSync(path.join(out, `${c.name}.html`), componentPage(c, reg.components));
  if (reg.blocks && reg.blocks.length) {
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
