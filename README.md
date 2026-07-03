# shadcss/ui

> **Zero-runtime UI with the shadcn aesthetic — no React, no Tailwind, no Radix, no hydration.**
> 56 HTML/CSS components and patterns for server-rendered, static, HTMX, Astro, and AI-generated apps. ~16.7 KB gzipped, zero dependencies, zero JS runtime. Complex widgets are clearly marked.

[![live demo](https://img.shields.io/badge/demo-shadcss.vercel.app-black)](https://shadcss.vercel.app)
[![npm](https://img.shields.io/npm/v/@russfranky/shadcss)](https://www.npmjs.com/package/@russfranky/shadcss)
[![gzip size](https://img.shields.io/badge/gzipped-16.7%20KB-success)](./packages/shadcss/dist/shadcss.min.css)
[![no js framework](https://img.shields.io/badge/JS-no%20framework-black)](#)
[![components](https://img.shields.io/badge/components-56-blue)](./packages/shadcss#components-56)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE.md)

**▶ Live demo: [shadcss.vercel.app](https://shadcss.vercel.app)** · **📖 Docs: [/docs](https://shadcss.vercel.app/docs/)** · **🤖 [/llms.txt](https://shadcss.vercel.app/llms.txt)**

`shadcss` brings the shadcn/ui visual language to plain HTML and CSS. Where
shadcn uses React + Radix + Tailwind, shadcss is CSS you paste into any
server-rendered template — built on `:has()`, the Popover API, native
`<dialog>`, and design tokens.
**No JS framework. Zero dependencies. Zero framework lock-in.** The CSS bundle
ships 0 JS; native `<dialog>`/Popover/toast need a one-line native trigger
(`showModal()`/`showPopover()`).

> Not affiliated with, endorsed by, or sponsored by shadcn/ui. Inspired by its
> design language.

## Install

```html
<!-- CDN — pin a version in production so a future major can't break you -->
<link rel="stylesheet" href="https://unpkg.com/@russfranky/shadcss@0.1.12/dist/shadcss.min.css">
```

```bash
# npm
npm install @russfranky/shadcss
```

```css
/* Bare-specifier @import — resolves ONLY through a bundler (Vite, webpack,
   Parcel, esbuild, etc.) that honors the package "exports"/"style" field.
   Plain CSS has no Node resolution, so this 404s without a bundler. */
@import "@russfranky/shadcss";

/* Plain CSS / no bundler: import the built file by path instead. */
@import "@russfranky/shadcss/dist/shadcss.min.css";
```

## CLI — own the code *and* keep it updatable

```bash
npx @russfranky/shadcss-cli add button card dialog   # copy components (+ deps) into ./shadcss
npx @russfranky/shadcss-cli diff button              # see what changed upstream vs your copy
npx @russfranky/shadcss-cli check ./index.html       # lint HTML for a11y/markup foot-guns
npx @russfranky/shadcss-cli list                     # all 56 components
```

`add` gives you shadcn-style ownership (the CSS lives in your repo); `diff` answers shadcn's #1 complaint by showing exactly what changed upstream so fixes don't silently pass you by. Zero dependencies, fetches from the CDN. See [`packages/cli`](./packages/cli).

## Optional JS helpers (only where the platform falls short)

shadcss is zero-runtime CSS by default. For the few interactions the platform can't yet complete (menu keyboard nav, full ARIA tabs), `@russfranky/shadcss-js` ships **tiny, dependency-free, opt-in** helpers — ~1 KB each, per-element, no global runtime.

```html
<div class="dropdown-menu" popover id="m" data-sc-menu> … </div>
<div class="tabs" data-sc-tabs> … </div>
<script type="module">import "@russfranky/shadcss-js/menu"; import "@russfranky/shadcss-js/tabs";</script>
```

Without them the components stay accessible native HTML (tabs are a real radiogroup); with them you get the full keyboard/ARIA pattern. See [`packages/shadcss-js`](./packages/shadcss-js).

## Why shadcss — the common shadcn/ui complaints, answered

shadcss drops React, Radix, and Tailwind, which structurally removes most of the things people complain about with shadcn/ui:

| Common shadcn/ui complaint | shadcss answer |
| --- | --- |
| **"Your component, your problem"** — copy-paste code you must maintain; no `npm update` | shadcss is **both**: copy a single CSS file, *or* `npm install` the package and update it like any dependency. SemVer'd. |
| **Dependency bugs** (a `cmdk`/Radix breaking change breaks your components) | **Zero dependencies.** Nothing upstream can break you. |
| **Tailwind: "ugly" HTML, utility-class soup, no selector targeting** | Semantic classes (`<button class="btn">`), real CSS, theme via CSS variables. Readable markup, no utility soup. |
| **SSR / hydration mismatches** | **No JavaScript runtime → no hydration, ever.** Works in any SSR/SSG/server-rendered/email context. |
| **A11y breaks when you customize, with no safety net** | Ships an **axe-core a11y gate + markup guards** you can run against your own build (`npm run check`, `check:a11y`). Light *and* dark themes verified at **0 axe violations**. |
| **Not responsive by default** (dialogs/tables overflow on mobile) | Overlays clamp to the viewport (`min(size, 100vw - 2rem)`); tables scroll; OTP wraps; the calendar shrinks. **No horizontal overflow at 375px+.** |
| **"Too much freedom" — undisciplined edits create inconsistency** | Retheme by overriding **design tokens**, not by editing components — consistency by construction. |

**Honest about the trade-off:** like shadcn, the components are intentionally simple, and a class of interactivity (menu keyboard nav, command search, live toggles) still needs a few lines of *your* JavaScript — documented, never faked. shadcss is the accessible shadcn *aesthetic* with zero runtime, not a drop-in Radix replacement.

## Monorepo structure

This repository mirrors the [`shadcn-ui/ui`](https://github.com/shadcn-ui/ui) layout:

```
shadcss-ui/
├── apps/
│   └── www/              ← live component showcase + docs
└── packages/
    └── shadcss/          ← the framework (published to npm as `shadcss`)
        ├── src/          ← source CSS (base + 56 components)
        ├── dist/         ← built bundles
        ├── registry.json ← machine-readable component spec
        └── AI_GUIDE.md   ← patterns for AI code generation
```

## Develop

```bash
npm install        # install workspace deps
npm run build      # build the framework → packages/shadcss/dist
npm run dev        # rebuild on change (watch)
npm run www        # serve the showcase at http://localhost:3333
```

> The showcase (`apps/www/index.html`) links the built `shadcss.min.css`, which
> the framework build generates and copies in. Run `npm run build` first (the
> `www` dev/build scripts now do this for you) — opening the raw `index.html`
> before any build produces an unstyled page.

### Deploy the demo

```bash
VERCEL_TOKEN=xxx npm run deploy
```

Builds, stages a self-contained copy (CSS + doc-links repointed to GitHub), and ships it to the `shadcss` Vercel project → [shadcss.vercel.app](https://shadcss.vercel.app). The token is read from the environment (never committed); override the team/project with `VERCEL_SCOPE` / `VERCEL_PROJECT_ID` if needed.

## Quality gates (run locally)

```bash
npm install
npm run build      # Lightning CSS bundle + minify (fails on invalid CSS)
npm run check      # static guards (no browser needed)
```

`npm run check` runs two no-dependency guards that encode the regressions prior QA passes found, so they can't silently return:
- **`check-consistency.mjs`** — version sync, component count, gzip badge, "no absolutist 0-JS claim," "no false shadcn `$schema`" — all asserted against reality.
- **`check-markup.mjs`** — no `anchor()` without an `anchor-name` producer, no `popover` on `.navigation-menu-content`, no static `aria-selected` on tabs, no invalid `focus-visible-anchor`, balanced markup, valid registry JSON.

Runtime accessibility (headless Chromium + **axe-core**), one-time browser install:

```bash
npx playwright install chromium
npx serve apps/www -l 3333 &      # serve the built showcase
npm run check:a11y                # axe-core on light AND dark themes
```

`check:a11y` scans both themes (with a settle delay so it doesn't sample mid-transition colors) and **fails on any serious or critical** violation; moderate/minor are reported as warnings. The showcase currently passes at **0 violations of any impact in both light and dark** — the WCAG AA work (including a darkened status palette vs shadcn's defaults) is recorded in `qa/iteration-3/`.

## Documentation

- **Framework README** — [`packages/shadcss/README.md`](./packages/shadcss/README.md)
- **AI guide** — [`packages/shadcss/AI_GUIDE.md`](./packages/shadcss/AI_GUIDE.md)
- **Component registry** — [`packages/shadcss/registry.json`](./packages/shadcss/registry.json)

## License

MIT
