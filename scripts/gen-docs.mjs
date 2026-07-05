// ==========================================================================
// scripts/gen-docs.mjs
// Generate a static docs site from registry.json into apps/www/docs/.
// Layout mirrors shadcn's docs: sticky header (brand + nav + search + theme
// toggle), three-column grid [left nav | main | right on-this-page TOC],
// breadcrumb, grouped nav, tabbed Preview/Code, copy-to-clipboard, command
// palette search. Built from the registry so it stays in sync; the docs
// dogfood shadcss's own CSS.
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

// ── SVG icons ──────────────────────────────────────────────────────────────
const BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" rx="1" x="3" y="3"/><rect width="7" height="5" rx="1" x="3" y="16"/><rect width="7" height="9" rx="1" x="14" y="3"/><rect width="7" height="5" rx="1" x="14" y="16"/></svg>`;
const SEARCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
const MENU_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;
const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>`;
const GITHUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;
const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

// ── CSS ────────────────────────────────────────────────────────────────────
const DOCS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap');

:root{
  --docs-header:3.5rem;
  --docs-sidebar:16rem;
  --docs-toc:14rem;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:calc(var(--docs-header) + 1rem)}
body{margin:0;font-family:'Geist',var(--font-sans,system-ui,sans-serif);background:var(--background);color:var(--foreground);-webkit-font-smoothing:antialiased}
a{color:inherit}

/* ---- sticky header ---- */
.docs-header{position:sticky;top:0;z-index:50;height:var(--docs-header);background:color-mix(in oklab,var(--background) 80%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.docs-header-inner{display:flex;align-items:center;gap:var(--space-3);height:100%;max-width:96rem;margin:0 auto;padding:0 var(--space-4) 0 var(--space-3)}
.docs-menu-btn{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:0;background:transparent;color:var(--foreground);cursor:pointer;border-radius:var(--radius-md);transition:background .15s}
.docs-menu-btn:hover{background:var(--accent);color:var(--accent-foreground)}
.docs-menu-btn svg{width:1.25rem;height:1.25rem}
@media(min-width:64rem){.docs-menu-btn{display:none}}
.docs-brand{display:flex;align-items:center;gap:var(--space-2);font-weight:600;text-decoration:none;color:var(--foreground);font-size:var(--text-sm)}
.docs-brand svg{width:1.25rem;height:1.25rem}

/* top nav links */
.docs-nav-top{display:none;align-items:center;gap:var(--space-1);margin-inline-start:var(--space-2)}
@media(min-width:48rem){.docs-nav-top{display:flex}}
.docs-nav-top a{padding:var(--space-2) var(--space-3);font-size:var(--text-sm);font-weight:500;color:var(--muted-foreground);text-decoration:none;border-radius:var(--radius-md);transition:all .15s}
.docs-nav-top a:hover{color:var(--foreground);background:var(--accent)}
.docs-nav-top a[aria-current="true"]{color:var(--foreground)}

.docs-header-spacer{flex:1}
.docs-search{position:relative;display:flex;align-items:center;width:100%;max-width:20rem;cursor:pointer}
@media(min-width:48rem){.docs-search{margin-inline-start:var(--space-4)}}
.docs-search input{width:100%;height:2.25rem;padding:0 var(--space-3) 0 2.25rem;font-size:var(--text-sm);color:var(--foreground);background:var(--muted);border:1px solid var(--border);border-radius:var(--radius-md);outline:none;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.docs-search input::placeholder{color:var(--muted-foreground)}
.docs-search input:focus{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 40%,transparent)}
.docs-search>svg{position:absolute;inset-inline-start:var(--space-3);width:1rem;height:1rem;color:var(--muted-foreground);pointer-events:none}
.docs-search-kbd{position:absolute;inset-inline-end:var(--space-2);font-size:var(--text-xs);color:var(--muted-foreground);background:var(--background);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1px 6px;pointer-events:none;font-family:'Geist Mono',ui-monospace,monospace}
.docs-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;border:1px solid var(--border);background:transparent;color:var(--foreground);border-radius:var(--radius-md);cursor:pointer;transition:all .15s}
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
.docs-footer{border-top:1px solid var(--border);padding:var(--space-8) var(--space-4);text-align:center;font-size:var(--text-sm);color:var(--muted-foreground)}
.docs-footer a{color:var(--foreground);text-decoration:none;font-weight:500}
.docs-footer a:hover{text-decoration:underline}
.docs-nav-label{font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);padding:var(--space-3) var(--space-3) var(--space-1)}
.docs-nav-group{display:flex;flex-direction:column;gap:1px;margin-bottom:var(--space-4)}
.docs-nav a{display:block;padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);font-size:var(--text-sm);color:var(--muted-foreground);text-decoration:none;line-height:1.3;transition:all .12s}
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
.docs-section h3{font-size:var(--text-lg);font-weight:600;margin:var(--space-6) 0 var(--space-3)}
.docs-section p{color:var(--foreground);line-height:1.6;margin-bottom:var(--space-3)}
.docs-section p:last-child{margin-bottom:0}
.docs-section code{font-family:'Geist Mono',ui-monospace,monospace;font-size:.85em;background:var(--muted);padding:.1em .35em;border-radius:var(--radius-sm)}
.docs-section ul{line-height:1.8;padding-inline-start:var(--space-6)}
.docs-section ul li{margin-bottom:var(--space-1)}

/* ---- code block with copy button ---- */
.docs-code-wrap{position:relative;margin:var(--space-2) 0}
pre.docs-code{background:var(--muted);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-4);overflow:auto;font-family:'Geist Mono',ui-monospace,monospace;font-size:var(--text-sm);line-height:1.6;margin:0}
pre.docs-code code{font-family:inherit;font-size:inherit;background:none;padding:0;border-radius:0}
.docs-copy-btn{position:absolute;top:var(--space-2);inset-inline-end:var(--space-2);display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:1px solid var(--border);background:var(--background);color:var(--muted-foreground);border-radius:var(--radius-md);cursor:pointer;opacity:0;transition:opacity .15s,background .15s}
.docs-code-wrap:hover .docs-copy-btn{opacity:1}
.docs-copy-btn:hover{background:var(--accent);color:var(--accent-foreground)}
.docs-copy-btn.copied{color:var(--success,green);border-color:var(--success,green)}

/* ---- tabbed Preview/Code ---- */
.docs-tabs{margin:var(--space-2) 0}
.docs-tabs-list{display:inline-flex;gap:2px;padding:2px;background:var(--muted);border:1px solid var(--border);border-radius:var(--radius-md);margin-bottom:0}
.docs-tabs-tab{padding:var(--space-1) var(--space-3);font-size:var(--text-sm);font-weight:500;color:var(--muted-foreground);background:transparent;border:0;border-radius:calc(var(--radius-md) - 2px);cursor:pointer;transition:all .15s}
.docs-tabs-tab:hover{color:var(--foreground)}
.docs-tabs-tab[aria-selected="true"]{background:var(--background);color:var(--foreground);box-shadow:var(--shadow-sm)}
.docs-tabs-panel{display:none}
.docs-tabs-panel[aria-hidden="false"]{display:block}

/* ---- preview container ---- */
.docs-preview{padding:var(--space-8);border:1px solid var(--border);border-radius:var(--radius-lg);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;background:var(--card);overflow:hidden;position:relative}
.docs-preview-block{padding:0;border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;max-height:32rem;background:var(--muted)}

/* ---- card grid ---- */
.docs-classes{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.docs-grid{display:grid;grid-template-columns:1fr;gap:var(--space-4)}
@media(min-width:48rem){.docs-grid{grid-template-columns:repeat(auto-fill,minmax(min(16rem,100%),1fr))}}
.docs-card{display:block;text-decoration:none;color:inherit;padding:var(--space-5);min-width:0;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--card);transition:border-color .2s,box-shadow .2s,transform .2s}
.docs-card:hover{border-color:color-mix(in oklab,var(--border) 50%,var(--foreground) 20%);box-shadow:var(--shadow-md);transform:translateY(-1px)}
.docs-card-title{font-size:var(--text-base);font-weight:600;margin-bottom:var(--space-1)}
.docs-card-desc{font-size:var(--text-sm);color:var(--muted-foreground);line-height:1.4}

/* ---- right on-this-page TOC ---- */
.docs-toc{display:none}
@media(min-width:80rem){
  .docs-toc{display:flex;flex-direction:column;gap:var(--space-2);position:sticky;top:var(--docs-header);align-self:start;height:calc(100vh - var(--docs-header));overflow-y:auto;padding:var(--space-8) var(--space-4) var(--space-8) var(--space-2)}
}
.docs-toc-label{font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);margin-bottom:var(--space-1)}
.docs-toc a{display:block;font-size:var(--text-sm);color:var(--muted-foreground);text-decoration:none;padding:.25rem 0;border-inline-start:2px solid transparent;padding-inline-start:var(--space-3);transition:color .12s,border-color .12s}
.docs-toc a:hover{color:var(--foreground)}
.docs-toc a[aria-current="true"]{color:var(--foreground);border-inline-start-color:var(--foreground)}

/* ---- command palette ---- */
.docs-cmdk{display:none;position:fixed;inset:0;z-index:100;align-items:flex-start;justify-content:center;padding-top:15vh}
.docs-cmdk[aria-hidden="false"]{display:flex}
.docs-cmdk-backdrop{position:absolute;inset:0;background:color-mix(in oklab,black 50%,transparent)}
.docs-cmdk-panel{position:relative;width:min(36rem,90vw);background:var(--background);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);overflow:hidden}
.docs-cmdk-input{width:100%;height:3rem;padding:0 var(--space-4);font-size:var(--text-sm);color:var(--foreground);background:transparent;border:0;border-bottom:1px solid var(--border);outline:none}
.docs-cmdk-input::placeholder{color:var(--muted-foreground)}
.docs-cmdk-list{max-height:24rem;overflow-y:auto;padding:var(--space-2)}
.docs-cmdk-item{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);font-size:var(--text-sm);color:var(--muted-foreground);cursor:pointer;text-decoration:none;transition:background .1s}
.docs-cmdk-item:hover,.docs-cmdk-item[aria-selected="true"]{background:var(--accent);color:var(--accent-foreground)}
.docs-cmdk-item-type{font-size:var(--text-xs);color:var(--muted-foreground);margin-inline-start:auto;text-transform:capitalize}
.docs-cmdk-empty{padding:var(--space-8);text-align:center;color:var(--muted-foreground);font-size:var(--text-sm)}

/* ---- callout ---- */
.docs-callout{display:flex;gap:var(--space-3);padding:var(--space-4);border-radius:var(--radius-lg);border:1px solid var(--border);margin:var(--space-4) 0}
.docs-callout-info{background:color-mix(in oklab,var(--info) 8%,transparent);border-color:color-mix(in oklab,var(--info) 30%,var(--border))}
.docs-callout-warning{background:color-mix(in oklab,var(--warning) 8%,transparent);border-color:color-mix(in oklab,var(--warning) 30%,var(--border))}
.docs-callout p{margin:0;font-size:var(--text-sm);line-height:1.6}

/* ---- footer ---- */
.docs-footer{border-top:1px solid var(--border);padding:var(--space-8) var(--space-4);text-align:center;color:var(--muted-foreground);font-size:var(--text-sm);max-width:96rem;margin:0 auto}
.docs-footer a{color:var(--foreground);text-decoration:none;font-weight:500}
`;

// ── JS snippets ────────────────────────────────────────────────────────────
const THEME_JS = `<script>
(function(){
  var b=document.getElementById('docs-theme');
  if(!b)return;
  function icon(){return document.documentElement.dataset.theme==='dark'?${JSON.stringify(SUN_SVG)}:${JSON.stringify(MOON_SVG)};}
  function sync(){b.innerHTML=icon();b.setAttribute('aria-pressed',document.documentElement.dataset.theme==='dark');}
  sync();
  b.addEventListener('click',function(){
    document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
    sync();
  });
})();
</script>`;

const COPY_JS = `<script>
(function(){
  document.querySelectorAll('.docs-code-wrap').forEach(function(wrap){
    var btn=wrap.querySelector('.docs-copy-btn');
    if(!btn)return;
    var code=wrap.querySelector('code');
    btn.addEventListener('click',function(){
      if(!code)return;
      navigator.clipboard.writeText(code.textContent).then(function(){
        btn.innerHTML=${JSON.stringify(CHECK_SVG)};
        btn.classList.add('copied');
        setTimeout(function(){btn.innerHTML=${JSON.stringify(COPY_SVG)};btn.classList.remove('copied');},2000);
      });
    });
  });
})();
</script>`;

const TABS_JS = `<script>
(function(){
  document.querySelectorAll('.docs-tabs').forEach(function(tabs){
    var tabBtns=tabs.querySelectorAll('.docs-tabs-tab');
    var panels=tabs.querySelectorAll('.docs-tabs-panel');
    tabBtns.forEach(function(btn,i){
      btn.addEventListener('click',function(){
        tabBtns.forEach(function(b){b.setAttribute('aria-selected','false');});
        panels.forEach(function(p){p.setAttribute('aria-hidden','true');});
        btn.setAttribute('aria-selected','true');
        if(panels[i])panels[i].setAttribute('aria-hidden','false');
      });
    });
  });
})();
</script>`;

const SEARCH_JS = `<script>
(function(){
  var left=document.querySelector('.docs-left');
  var menuBtn=document.querySelector('.docs-menu-btn');
  if(menuBtn&&left){menuBtn.addEventListener('click',function(){
    left.setAttribute('data-open', left.getAttribute('data-open')==='true'?'false':'true');
  });}
  var backdrop=document.querySelector('.docs-backdrop');
  if(backdrop&&left){backdrop.addEventListener('click',function(){left.setAttribute('data-open','false');});}

  // ── Command palette ──
  var cmdk=document.getElementById('docs-cmdk');
  var cmdkInput=cmdk&&cmdk.querySelector('.docs-cmdk-input');
  var cmdkList=cmdk&&cmdk.querySelector('.docs-cmdk-list');
  var cmdkEmpty=cmdk&&cmdk.querySelector('.docs-cmdk-empty');
  var allItems=cmdkList?[...cmdkList.querySelectorAll('.docs-cmdk-item')]:[];
  var selectedIdx=-1;

  function openCmdk(){if(!cmdk)return;cmdk.setAttribute('aria-hidden','false');if(cmdkInput)cmdkInput.focus();}
  function closeCmdk(){if(!cmdk)return;cmdk.setAttribute('aria-hidden','true');if(cmdkInput)cmdkInput.value='';filterCmdk('');}
  function filterCmdk(q){
    q=q.toLowerCase().trim();
    var visible=0;
    allItems.forEach(function(item){
      var hay=(item.getAttribute('data-search')||item.textContent).toLowerCase();
      var match=!q||hay.indexOf(q)!==-1;
      item.style.display=match?'':'none';
      if(match)visible++;
    });
    if(cmdkEmpty)cmdkEmpty.style.display=visible?'none':'';
    selectedIdx=-1;
  }
  function moveSel(dir){
    var visible=allItems.filter(function(i){return i.style.display!=='none';});
    if(!visible.length)return;
    if(selectedIdx>=0)visible[selectedIdx].removeAttribute('aria-selected');
    selectedIdx=Math.max(0,Math.min(visible.length-1,(selectedIdx<0?0:selectedIdx)+dir));
    visible[selectedIdx].setAttribute('aria-selected','true');
    visible[selectedIdx].scrollIntoView({block:'nearest'});
  }
  function enterSel(){
    var visible=allItems.filter(function(i){return i.style.display!=='none';});
    if(selectedIdx>=0&&visible[selectedIdx])visible[selectedIdx].click();
  }

  // Open: search input click, or Cmd/Ctrl+K
  var searchInput=document.querySelector('.docs-search input');
  if(searchInput)searchInput.addEventListener('focus',function(e){e.target.blur();openCmdk();});
  document.addEventListener('keydown',function(e){
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openCmdk();}
    if(e.key==='Escape'&&cmdk&&cmdk.getAttribute('aria-hidden')==='false'){closeCmdk();}
    if(cmdk&&cmdk.getAttribute('aria-hidden')==='false'){
      if(e.key==='ArrowDown'){e.preventDefault();moveSel(1);}
      if(e.key==='ArrowUp'){e.preventDefault();moveSel(-1);}
      if(e.key==='Enter'){e.preventDefault();enterSel();}
    }
  });
  if(cmdkInput)cmdkInput.addEventListener('input',function(){filterCmdk(this.value);});
  var cmdkBackdrop=cmdk&&cmdk.querySelector('.docs-cmdk-backdrop');
  if(cmdkBackdrop)cmdkBackdrop.addEventListener('click',closeCmdk);
})();
</script>`;

// ── Header ─────────────────────────────────────────────────────────────────
function header(currentSection) {
  const navLinks = [
    { href: "../index.html", label: "Home", key: "home" },
    { href: "./index.html", label: "Docs", key: "docs" },
    { href: "./components.html", label: "Components", key: "components" },
    { href: "./blocks.html", label: "Blocks", key: "blocks" },
    { href: "./support.html", label: "Support", key: "support" },
  ];
  const navHtml = navLinks.map(l =>
    `<a href="${l.href}"${l.key === currentSection ? ' aria-current="true"' : ""}>${esc(l.label)}</a>`
  ).join("");
  return `<header class="docs-header"><div class="docs-header-inner">
    <button class="docs-menu-btn" aria-label="Toggle navigation">${MENU_SVG}</button>
    <a class="docs-brand" href="../index.html">${BRAND_SVG} shadcss</a>
    <nav class="docs-nav-top">${navHtml}</nav>
    <div class="docs-search">
      ${SEARCH_SVG}
      <input type="search" placeholder="Search documentation..." aria-label="Search documentation" readonly>
      <span class="docs-search-kbd">⌘K</span>
    </div>
    <div class="docs-header-spacer"></div>
    <button class="docs-icon-btn" id="docs-theme" aria-label="Toggle theme" aria-pressed="false"></button>
    <a class="docs-icon-btn" href="https://github.com/russfranky/shadcss-ui" aria-label="GitHub" rel="noopener">${GITHUB_SVG}</a>
  </div></header>`;
}

// ── Left nav ───────────────────────────────────────────────────────────────
function leftNav(components, blocks, current) {
  const topLinks = `<div class="docs-nav-group">
    <a href="./index.html"${current === "__index" ? ' aria-current="page"' : ""}>Introduction</a>
    <a href="./installation.html"${current === "__installation" ? ' aria-current="page"' : ""}>Installation</a>
    <a href="./theming.html"${current === "__theming" ? ' aria-current="page"' : ""}>Theming</a>
    <a href="./cli.html"${current === "__cli" ? ' aria-current="page"' : ""}>CLI</a>
    <a href="./components.html"${current === "__components" ? ' aria-current="page"' : ""}>Components</a>
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
  return `<nav class="docs-nav" aria-label="Documentation">
    <div class="docs-nav-label">Getting Started</div>
    ${topLinks}
    <div class="docs-nav-label">Components</div>
    <div class="docs-nav-group" id="docs-comp-list">${compLinks}</div>
    ${(blocks || []).length ? `<div class="docs-nav-label">Blocks</div><div class="docs-nav-group">${blockLinks}</div>` : ""}
  </nav>`;
}

// ── Command palette data ───────────────────────────────────────────────────
function cmdkPalette(components, blocks) {
  const compItems = components.map(c =>
    `<a class="docs-cmdk-item" href="./${c.name}.html" data-search="${esc(c.name + " " + (c.description || ""))}"><span>${esc(c.name)}</span><span class="docs-cmdk-item-type">component</span></a>`
  ).join("");
  const blockItems = (blocks || []).map(b =>
    `<a class="docs-cmdk-item" href="./block-${b.name}.html" data-search="${esc(b.name + " " + (b.description || ""))}"><span>${esc(b.name)}</span><span class="docs-cmdk-item-type">block</span></a>`
  ).join("");
  const docItems = [
    { href: "./index.html", label: "Introduction", type: "docs" },
    { href: "./installation.html", label: "Installation", type: "docs" },
    { href: "./theming.html", label: "Theming", type: "docs" },
    { href: "./cli.html", label: "CLI Reference", type: "docs" },
    { href: "./components.html", label: "Components", type: "docs" },
    { href: "./retrofit.html", label: "Retrofit an existing app", type: "docs" },
    { href: "./support.html", label: "Browser support & limits", type: "docs" },
    { href: "./blocks.html", label: "Blocks overview", type: "docs" },
  ].map(d =>
    `<a class="docs-cmdk-item" href="${d.href}" data-search="${esc(d.label.toLowerCase())}"><span>${esc(d.label)}</span><span class="docs-cmdk-item-type">${d.type}</span></a>`
  ).join("");
  return `<div class="docs-cmdk" id="docs-cmdk" aria-hidden="true">
    <div class="docs-cmdk-backdrop"></div>
    <div class="docs-cmdk-panel">
      <input class="docs-cmdk-input" type="search" placeholder="Search documentation..." aria-label="Search">
      <div class="docs-cmdk-list">${docItems}${compItems}${blockItems}</div>
      <div class="docs-cmdk-empty">No results found.</div>
    </div>
  </div>`;
}

// ── TOC ────────────────────────────────────────────────────────────────────
function tocFromSections(html) {
  const sections = [...html.matchAll(/<div class="docs-section"[^>]*>\s*<h2[^>]*id="([^"]+)"[^>]*>([^<]+)<\/h2>/g)];
  if (!sections.length) return "";
  const items = sections.map((m) => `<a href="#${m[1]}">${esc(m[2])}</a>`).join("\n");
  return `<aside class="docs-toc" aria-label="On this page"><div class="docs-toc-label">On This Page</div>${items}</aside>`;
}

function anchorHeadings(body) {
  let n = 0;
  return body.replace(/(<div class="docs-section"><h2>)/g, (m) => {
    return m.replace("<h2>", () => {
      n++;
      return `<h2 id="section-${n}">`;
    });
  });
}

// ── Code block with copy button ────────────────────────────────────────────
function codeBlock(code) {
  return `<div class="docs-code-wrap"><pre class="docs-code"><code>${esc(code)}</code></pre><button class="docs-copy-btn" aria-label="Copy code">${COPY_SVG}</button></div>`;
}

// ── Tabbed Preview/Code ────────────────────────────────────────────────────
function previewCodeTabs(previewHtml, code) {
  return `<div class="docs-tabs">
    <div class="docs-tabs-list" role="tablist">
      <button class="docs-tabs-tab" role="tab" aria-selected="true">Preview</button>
      <button class="docs-tabs-tab" role="tab" aria-selected="false">Code</button>
    </div>
    <div class="docs-tabs-panel" role="tabpanel" aria-hidden="false">
      <div class="docs-preview">${previewHtml}</div>
    </div>
    <div class="docs-tabs-panel" role="tabpanel" aria-hidden="true">
      ${codeBlock(code)}
    </div>
  </div>`;
}

// ── Shell ──────────────────────────────────────────────────────────────────
function shell(title, body, components, current, section, blocks = BLOCKS) {
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
${header(section)}
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
<footer class="docs-footer">
  <p>shadcss · ${COMPONENTS.length} components · Open Source · MIT licensed</p>
  <p style="margin-top:var(--space-1)"><a href="https://github.com/russfranky/shadcss-ui">GitHub</a> · <a href="./support.html">Browser support</a> · <a href="./cli.html">CLI</a></p>
</footer>
${cmdkPalette(components, blocks)}
${THEME_JS}
${COPY_JS}
${TABS_JS}
${SEARCH_JS}
</body>
</html>`;
}

// ── Component page ─────────────────────────────────────────────────────────
function componentPage(c, idx) {
  const meta = [badge("status", c.status || "stable"), badge("js", c.js || "none"), `<span class="badge badge-outline">support: ${esc(c.support || "baseline")}</span>`].join(" ");
  const classes = (c.classes || []).map((cl) => `<span class="badge badge-secondary">.${esc(cl)}</span>`).join(" ");
  const importLine = `@import "${PKG}/${c.file}";`;
  const cli = `npx ${PKG}-cli add ${c.name}`;
  const a11y = c.a11y ? `<div class="docs-section"><h2>Accessibility</h2><div class="docs-callout docs-callout-info"><p>${esc(c.a11y)}</p></div></div>` : "";

  const previewContent = c.js === "trigger"
    ? `<div style="justify-content:center;color:var(--muted-foreground);font-size:var(--text-sm)">This overlay stays hidden until triggered — <a href="../index.html" style="color:var(--primary);font-weight:500">open it in the live demo →</a></div>`
    : (c.markup || "");

  const prev = idx > 0 ? COMPONENTS[idx - 1] : null;
  const next = idx < COMPONENTS.length - 1 ? COMPONENTS[idx + 1] : null;
  const prevNext = `<div style="display:flex;justify-content:space-between;gap:var(--space-4);margin-top:var(--space-12);padding-top:var(--space-6);border-top:1px solid var(--border)">
    ${prev ? `<a href="./${prev.name}.html" style="text-decoration:none;color:inherit;flex:1"><div style="font-size:var(--text-xs);color:var(--muted-foreground);margin-bottom:var(--space-1)">← Previous</div><div style="font-size:var(--text-sm);font-weight:500">${esc(prev.name)}</div></a>` : '<div style="flex:1"></div>'}
    ${next ? `<a href="./${next.name}.html" style="text-decoration:none;color:inherit;flex:1;text-align:right"><div style="font-size:var(--text-xs);color:var(--muted-foreground);margin-bottom:var(--space-1)">Next →</div><div style="font-size:var(--text-sm);font-weight:500">${esc(next.name)}</div></a>` : '<div style="flex:1"></div>'}
  </div>`;

  const body = `
<div class="docs-breadcrumb"><a href="./components.html">Components</a><span>/</span>${esc(c.name)}</div>
<h1 class="docs-h1">${esc(c.name)}</h1>
<p class="docs-lead">${esc(c.description || "")}</p>
<div class="docs-meta">${meta}</div>

<div class="docs-section"><h2>Preview</h2>${previewCodeTabs(previewContent, c.markup || "")}</div>

<div class="docs-section"><h2>Installation</h2>
<p>Import the component CSS (depends on <code>base/tokens.css</code>):</p>
${codeBlock(importLine)}
<p style="margin-top:var(--space-3)">…or copy it into your repo with the CLI:</p>
${codeBlock(cli)}
</div>

${a11y}

<div class="docs-section"><h2>Classes</h2><div class="docs-classes">${classes}</div></div>

<div class="docs-section"><h2>Dependencies</h2><div class="docs-classes">${(c.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`).join(" ") || '<span class="badge badge-outline">none</span>'}</div></div>

${prevNext}
`;
  return shell(c.name, body, COMPONENTS, c.name, "components");
}

// ── Index page ────────────────────────────────────────────────────────────
function indexPage(reg) {
  const cards = reg.components.map((c) => `
  <a class="docs-card" href="./${c.name}.html">
    <div class="docs-card-title">${esc(c.name)}</div>
    <div class="docs-card-desc">${esc(c.description || "")}</div>
    <div style="margin-top:var(--space-2);display:flex;gap:.375rem;flex-wrap:wrap">${badge("js", c.js || "none")}</div>
  </a>`).join("\n");
  const body = `
<div class="docs-breadcrumb"><span>Documentation</span></div>
<h1 class="docs-h1">Introduction</h1>
<p class="docs-lead">${reg.components.length} zero-runtime HTML + CSS components. ${esc(reg.description || "")} Open Source. Open Code.</p>
<div class="docs-meta"><span class="badge badge-success">${reg.components.filter((c) => (c.js || "none") === "none").length} zero-JS</span> <span class="badge badge-info">${reg.components.filter((c) => c.js === "trigger").length} one-line trigger</span> <span class="badge badge-warning">${reg.components.filter((c) => c.js === "consumer").length} consumer-JS</span></div>

<div class="docs-section"><h2>Open Code</h2>
<p>shadcss hands you the actual component code. You have full control to customize and extend the components to your needs. This means:</p>
<ul>
<li><strong>Full Transparency</strong> — You see exactly how each component is built.</li>
<li><strong>Easy Customization</strong> — Modify any part of a component to fit your design and functionality requirements.</li>
<li><strong>AI Integration</strong> — Access to the code makes it straightforward for LLMs to read, understand, and even improve your components.</li>
</ul>
<p>In a typical library, if you need to change a button's behavior, you have to override styles or wrap the component. With shadcss, you simply edit the component CSS directly.</p>
</div>

<div class="docs-section"><h2>Composition</h2>
<p>Every component in shadcss shares a common, composable interface. If a component does not exist, you bring it in, make it composable, and adjust its style to match and work with the rest of the design system.</p>
<p>A shared, composable interface means it's predictable for both your team and LLMs. You are not learning different APIs for every new component.</p>
</div>

<div class="docs-section"><h2>Distribution</h2>
<p>shadcss is also a code distribution system. It defines a schema for components and a CLI to distribute them.</p>
<ul>
<li><strong>Schema</strong> — A flat-file structure (<code>registry.json</code>) that defines the components, their dependencies, and properties.</li>
<li><strong>CLI</strong> — A command-line tool (<code>npx @russfranky/shadcss-cli</code>) to distribute and install components across projects.</li>
</ul>
<p>You can use the schema to distribute your components to other projects or have AI generate completely new components based on existing schema.</p>
</div>

<div class="docs-section"><h2>Beautiful Defaults</h2>
<p>shadcss comes with a large collection of components that have carefully chosen default styles. They are designed to look good on their own and to work well together as a consistent system:</p>
<ul>
<li><strong>Good Out-of-the-Box</strong> — Your UI has a clean and minimal look without extra work.</li>
<li><strong>Unified Design</strong> — Components naturally fit with one another. Each component is built to match the others, keeping your UI consistent.</li>
<li><strong>Easily Customizable</strong> — If you want to change something, it's simple to override and extend the defaults.</li>
</ul>
</div>

<div class="docs-section"><h2>AI-Ready</h2>
<p>The design of shadcss makes it easy for AI tools to work with your code. Its open code and consistent API allow AI models to read, understand, and even generate new components.</p>
<p>An AI model can learn how your components work and suggest improvements or even create new components that integrate with your existing design.</p>
</div>

<div class="docs-section"><h2>Getting Started</h2>
<p>Read the <a href="./installation.html" style="color:var(--primary)">Installation guide</a> to add shadcss to your project, or browse the <a href="./components.html" style="color:var(--primary)">components</a>.</p>
</div>
`;
  return shell("shadcss", body, COMPONENTS, "__index", "docs");
}

// ── Components listing page ────────────────────────────────────────────────
function componentsPage(reg) {
  const cards = reg.components.map((c) => `
  <a class="docs-card" href="./${c.name}.html">
    <div class="docs-card-title">${esc(c.name)}</div>
    <div class="docs-card-desc">${esc(c.description || "")}</div>
    <div style="margin-top:var(--space-2);display:flex;gap:.375rem;flex-wrap:wrap">${badge("js", c.js || "none")}</div>
  </a>`).join("\n");
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Components</div>
<h1 class="docs-h1">Components</h1>
<p class="docs-lead">${reg.components.length} components available. Browse all components below.</p>
<div class="docs-meta"><span class="badge badge-success">${reg.components.filter((c) => (c.js || "none") === "none").length} zero-JS</span> <span class="badge badge-info">${reg.components.filter((c) => c.js === "trigger").length} one-line trigger</span> <span class="badge badge-warning">${reg.components.filter((c) => c.js === "consumer").length} consumer-JS</span></div>
<div class="docs-section"><h2>All Components</h2><div class="docs-grid">${cards}</div></div>
`;
  return shell("Components", body, COMPONENTS, "__components", "components");
}

// ── Installation page ──────────────────────────────────────────────────────
function installationPage() {
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Installation</div>
<h1 class="docs-h1">Installation</h1>
<p class="docs-lead">How to add shadcss to your project and structure your app.</p>

<div class="docs-section"><h2>Use the CLI</h2>
<p>The fastest way to get started is the CLI. Initialize a new project or add components to an existing one:</p>
${codeBlock(`npx ${PKG}-cli add button`)}
<p>This copies the component CSS and its dependencies into your project. Run <code>npx ${PKG}-cli list</code> to see all available components.</p>
</div>

<div class="docs-section"><h2>Manual Setup</h2>
<p>If you prefer to set things up manually:</p>
<h3>1. Install the package</h3>
${codeBlock(`npm install ${PKG}`)}
<h3>2. Import the CSS</h3>
<p>Import the full bundle or just the base tokens + individual components:</p>
${codeBlock(`/* Full bundle */\n@import "${PKG}/dist/shadcss.min.css";\n\n/* Or: base + individual components */\n@import "${PKG}/dist/base.min.css";\n@import "${PKG}/dist/components/button.css";\n@import "${PKG}/dist/components/input.css";`)}
<h3>3. Set the theme</h3>
<p>Set <code>data-theme</code> on the <code>&lt;html&gt;</code> element. The library supports <code>light</code>, <code>dark</code>, and <code>auto</code> (system preference via <code>prefers-color-scheme</code>).</p>
${codeBlock(`<html data-theme="dark">`)}
</div>

<div class="docs-section"><h2>Framework Guides</h2>
<h3>Vite</h3>
<p>Add the CSS import to your entry CSS file:</p>
${codeBlock(`/* src/main.css */\n@import "${PKG}/dist/shadcss.min.css";`)}
<h3>Next.js</h3>
<p>Add the CSS import to your global stylesheet:</p>
${codeBlock(`/* app/globals.css */\n@import "${PKG}/dist/shadcss.min.css";`)}
<h3>Plain HTML</h3>
<p>Link the stylesheet directly — no build step required:</p>
${codeBlock(`<link rel="stylesheet" href="https://unpkg.com/${PKG}/dist/shadcss.min.css">`)}
</div>

<div class="docs-section"><h2>Using the CLI</h2>
<p>The CLI can add, list, inspect, diff, and check components:</p>
${codeBlock(`# Add a component\nnpx ${PKG}-cli add button\n\n# Add multiple components\nnpx ${PKG}-cli add button input card\n\n# List all components\nnpx ${PKG}-cli list\n\n# Get info about a component\nnpx ${PKG}-cli info button\n\n# Diff your copies against upstream\nnpx ${PKG}-cli diff\n\n# Lint your markup\nnpx ${PKG}-cli check index.html`)}
<p>See the <a href="./cli.html" style="color:var(--primary)">CLI reference</a> for full documentation.</p>
</div>
`;
  return shell("Installation", body, COMPONENTS, "__installation", "docs");
}

// ── Theming page ───────────────────────────────────────────────────────────
function themingPage() {
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Theming</div>
<h1 class="docs-h1">Theming</h1>
<p class="docs-lead">Customize the design tokens to make shadcss your own. Every color, radius, spacing, and font is a CSS custom property.</p>

<div class="docs-section"><h2>How theming works</h2>
<p>shadcss uses CSS custom properties (design tokens) defined on <code>:root</code>. Override any of them to retheme the entire library. No build step, no preprocessor — just CSS.</p>
${codeBlock(`:root {
  /* Override the primary color */
  --primary: oklch(0.55 0.25 250);
  --primary-foreground: oklch(0.98 0.01 250);

  /* Override the radius scale */
  --radius: 0.75rem;

  /* Override the font */
  --font-sans: 'Inter', system-ui, sans-serif;
}`)}
</div>

<div class="docs-section"><h2>Dark mode</h2>
<p>Set <code>data-theme="dark"</code> on the <code>&lt;html&gt;</code> element to switch to dark mode. The theme layer defines all color token overrides for dark mode.</p>
${codeBlock(`<html data-theme="dark">`)}
<p>For auto (system preference), don't set <code>data-theme</code> — the library uses <code>prefers-color-scheme</code> media queries as a fallback.</p>
</div>

<div class="docs-section"><h2>Token reference</h2>
<h3>Colors</h3>
<p>All colors are defined in OKLCH for wide-gamut precision:</p>
${codeBlock(`--background, --foreground
--card, --card-foreground
--popover, --popover-foreground
--primary, --primary-foreground
--secondary, --secondary-foreground
--muted, --muted-foreground
--accent, --accent-foreground
--destructive, --destructive-foreground
--border, --input, --ring
--info, --info-foreground
--success, --success-foreground
--warning, --warning-foreground`)}
<h3>Radius</h3>
${codeBlock(`--radius-sm, --radius-md, --radius-lg, --radius-xl, --radius-2xl`)}
<h3>Spacing</h3>
${codeBlock(`--space-0 through --space-16`)}
<h3>Typography</h3>
${codeBlock(`--text-xs, --text-sm, --text-base, --text-lg, --text-xl, --text-2xl, --text-3xl
--leading-tight, --leading-normal, --leading-relaxed
--font-sans, --font-mono`)}
</div>

<div class="docs-section"><h2>Creating a custom theme</h2>
<p>Create a stylesheet loaded <em>after</em> the shadcss bundle. Override the tokens you want to change:</p>
${codeBlock(`/* my-theme.css — loaded after shadcss.min.css */
:root {
  --primary: oklch(0.6 0.2 30);
  --primary-foreground: oklch(0.98 0.01 30);
  --radius: 0.5rem;
  --font-sans: 'Geist', system-ui, sans-serif;
}

[data-theme="dark"] {
  --primary: oklch(0.7 0.2 30);
  --primary-foreground: oklch(0.1 0.01 30);
}`)}
</div>
`;
  return shell("Theming", body, COMPONENTS, "__theming", "docs");
}

// ── CLI page ───────────────────────────────────────────────────────────────
function cliPage() {
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>CLI</div>
<h1 class="docs-h1">CLI Reference</h1>
<p class="docs-lead">The shadcss CLI lets you add components, list available ones, inspect metadata, diff your copies against upstream, and lint markup.</p>

<div class="docs-section"><h2>add</h2>
<p>Copies a component and its declared dependencies from the registry into your project.</p>
${codeBlock(`npx ${PKG}-cli add <component> [component...] [options]`)}
<h3>Options</h3>
<ul>
<li><code>--from &lt;path&gt;</code> — Use a local checkout instead of the npm package</li>
<li><code>--dir &lt;path&gt;</code> — Target directory (default: <code>./shadcss</code>)</li>
<li><code>--force</code> — Overwrite existing files</li>
</ul>
<h3>Example</h3>
${codeBlock(`npx ${PKG}-cli add button input card --dir src/styles`)}
</div>

<div class="docs-section"><h2>list</h2>
<p>Enumerates all available components in the registry.</p>
${codeBlock(`npx ${PKG}-cli list`)}
</div>

<div class="docs-section"><h2>info</h2>
<p>Prints metadata for a component: file, dependencies, classes, and accessibility information.</p>
${codeBlock(`npx ${PKG}-cli info <component>`)}
</div>

<div class="docs-section"><h2>diff</h2>
<p>Compares your local copies against the upstream source. With a component name, diffs one; without, diffs all local copies. Exits non-zero on any drift.</p>
${codeBlock(`npx ${PKG}-cli diff [component]`)}
</div>

<div class="docs-section"><h2>check</h2>
<p>Runs static markup linting and reports structural or accessibility issues in the supplied file.</p>
${codeBlock(`npx ${PKG}-cli check <file>`)}
</div>
`;
  return shell("CLI Reference", body, COMPONENTS, "__cli", "docs");
}

// ── Support page ───────────────────────────────────────────────────────────
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
<div class="docs-callout docs-callout-info"><p><strong>none</strong> = zero JS · <strong>trigger</strong> = one native one-liner (<code>showModal()</code>/<code>showPopover()</code>) · <strong>consumer</strong> = you write real JS for full behavior (or add an optional <a href="https://www.npmjs.com/package/@russfranky/shadcss-js" style="color:var(--primary)">@russfranky/shadcss-js</a> helper).</p></div></div>

<div class="docs-section"><h2>Platform support</h2>
<ul>${supportLegend}</ul></div>

<div class="docs-section"><h2>Limitations (${needsJs.length} components need JS or are visual-only)</h2>
<p>These are intentionally not "fake-accessible" CSS shells. They style the component; the interactive/keyboard layer is yours (or an optional helper).</p>
<ul>${limits}</ul></div>

<div class="docs-section"><h2>Full matrix</h2>
<div style="overflow:auto"><table class="table" style="width:100%"><thead><tr><th scope="col">Component</th><th scope="col">Status</th><th scope="col">JS</th><th scope="col">Support</th></tr></thead><tbody>${rows}</tbody></table></div></div>
`;
  return shell("Browser support & limits", body, COMPONENTS, "__support", "support");
}

// ── Retrofit page ──────────────────────────────────────────────────────────
function retrofitPage() {
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Retrofit</div>
<h1 class="docs-h1">Retrofit an existing app</h1>
<p class="docs-lead">shadcss is plain CSS, so you can drop it onto an existing server-rendered or static app — no build, no markup rewrite, no JS framework — and restyle it through a small adapter.</p>

<div class="docs-section"><h2>1. Add the CSS</h2>
<p>Vendor or link the bundle, then an adapter stylesheet of your own (loaded <em>after</em>, so its token-driven rules win). Set the theme on <code>&lt;html&gt;</code>.</p>
${codeBlock(`<html data-theme="dark">
  <link rel="stylesheet" href="shadcss.min.css">
  <link rel="stylesheet" href="app-adapter.css">`)}</div>

<div class="docs-section"><h2>2. Reuse what matches, alias what's close</h2>
<p>shadcss already styles <code>.btn</code>, <code>.btn-secondary</code>, <code>.input</code>, <code>.kbd</code>, <code>.card</code>, etc. Common convention names are built-in aliases: <code>.btn-primary</code>, <code>.btn-danger</code>/<code>.btn-error</code> → the right variant automatically. So existing Bootstrap-style buttons often just work.</p></div>

<div class="docs-section"><h2>3. Map your structural classes to tokens</h2>
<p>Your app's layout classes (sidebars, panels, custom buttons) won't exist in shadcss — restyle them with the design tokens. That's the whole adapter.</p>
${codeBlock(`.sidebar { background: var(--card); border-right: 1px solid var(--border); }
.info-panel { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.your-btn { background: transparent; border: 1px solid var(--border); border-radius: var(--radius-md); }
.your-btn:hover { background: var(--accent); }`)}
<p>Every token lives on <code>:root</code> — see <a href="./theming.html" style="color:var(--primary)">Theming</a> and override any of them to retheme everything.</p></div>

<div class="docs-section"><h2>Reach for the real components — don't hand-roll</h2>
<div class="docs-callout docs-callout-warning"><p>The most common retrofit mistake: re-styling your custom layout divs from scratch when a shadcss component already exists. Hand-rolling a sidebar with <code>height:100%; margin-top:auto</code> is fragile (the footer clips); the <code>sidebar</code> component already gives you a scrolling body + pinned footer for free. Before writing CSS, check the <a href="./index.html" style="color:var(--primary)">component list</a> — <code>sidebar</code>, <code>card</code>, <code>input</code>, <code>table</code>, <code>dialog</code>, <code>tabs</code> cover most app chrome.</p></div>
<p>Restructure to the component's classes (the markup is yours), then style only what's genuinely custom:</p>
${codeBlock(`<aside class="sidebar">
  <div class="sidebar-content">          <!-- scrolls -->
    <div class="sidebar-group">
      <div class="sidebar-group-label">Folders</div>
      <div class="sidebar-menu">
        <button class="sidebar-menu-button">Inbox</button>
      </div>
    </div>
  </div>
  <div class="sidebar-footer">…</div>       <!-- pinned -->
</aside>`)}</div>
`;
  return shell("Retrofit an existing app", body, COMPONENTS, "__retrofit", "docs");
}

// ── Block page ─────────────────────────────────────────────────────────────
function blockPage(b) {
  const meta = [`<span class="badge badge-secondary">family: ${esc(b.family)}</span>`, ...(b.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`)].join(" ");
  const body = `
<div class="docs-breadcrumb"><a href="./blocks.html">Blocks</a><span>/</span>${esc(b.name)}</div>
<h1 class="docs-h1">${esc(b.name)}</h1>
<p class="docs-lead">${esc(b.description || "")}</p>
<div class="docs-meta">${meta}</div>

<div class="docs-section"><h2>Preview</h2>
<div class="docs-preview-block">${b.markup || ""}</div></div>

<div class="docs-section"><h2>Code</h2>${codeBlock(b.markup || "")}</div>

<div class="docs-section"><h2>Dependencies</h2><div class="docs-classes">${(b.deps || []).map((d) => `<span class="badge badge-outline">${esc(d)}</span>`).join(" ") || '<span class="badge badge-outline">none</span>'}</div></div>
`;
  return shell(b.name, body, COMPONENTS, `block-${b.name}`, "blocks");
}

// ── Blocks index ───────────────────────────────────────────────────────────
function blocksIndex(reg) {
  const families = {};
  for (const b of reg.blocks || []) (families[b.family] ??= []).push(b);
  const sections = Object.entries(families).map(([fam, items]) => `
<div class="docs-section"><h2>${esc(fam)} (${items.length})</h2>
<div class="docs-grid">${items.map((b) => `
  <a class="docs-card" href="./block-${b.name}.html">
    <div class="docs-card-title">${esc(b.name)}</div>
    <div class="docs-card-desc">${esc(b.description || "")}</div>
  </a>`).join("")}</div></div>`).join("");
  const body = `
<div class="docs-breadcrumb"><a href="./index.html">Docs</a><span>/</span>Blocks</div>
<h1 class="docs-h1">Blocks</h1>
<p class="docs-lead">${(reg.blocks || []).length} full-page section layouts composed from the components — copy-paste HTML templates. Mirrors shadcn's blocks.</p>
${sections}`;
  return shell("Blocks", body, COMPONENTS, "__blocks", "blocks");
}

// ── Module-level registry state ────────────────────────────────────────────
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
  writeFileSync(path.join(out, "components.html"), componentsPage(reg));
  writeFileSync(path.join(out, "installation.html"), installationPage());
  writeFileSync(path.join(out, "theming.html"), themingPage());
  writeFileSync(path.join(out, "cli.html"), cliPage());
  writeFileSync(path.join(out, "support.html"), supportPage(reg));
  writeFileSync(path.join(out, "retrofit.html"), retrofitPage());
  writeFileSync(path.join(out, "blocks.html"), blocksIndex(reg));
  for (const [i, c] of reg.components.entries()) writeFileSync(path.join(out, `${c.name}.html`), componentPage(c, i));
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
