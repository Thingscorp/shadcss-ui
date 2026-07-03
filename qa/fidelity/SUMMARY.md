# shadcss → shadcn Pixel-Fidelity Audit

**Method:** cloned `shadcn-ui/ui` (`.refs/shadcn-ui`, gitignored) and wrote
`scripts/fidelity/*` to (1) parse shadcn's `new-york-v4` component `.tsx`
class strings into resolved CSS metrics (`qa/fidelity/shadcn-spec.json`), and
(2) diff them against shadcss's own component CSS (`qa/fidelity/gaps.csv`).
This is grounded in shadcn's actual source, not memory.

**Tool caveats (so the numbers are honest):**
- `radius = MISSING` rows are a comparator limitation (it doesn't resolve
  shadcss's nested `calc(var(--radius) - 2px)`); shadcss *does* set radius. The
  real radius issue is the **base value**, not absence.
- The focus-model diff is under-reported (only flagged switch/checkbox); in
  fact **every** interactive component uses `outline: 2px` while shadcn uses
  its signature `ring`.

## Root cause: shadcss clones *2023* shadcn, not *current* shadcn

| Dimension | shadcss (now) | current shadcn | Impact |
|---|---|---|---|
| Color space | HSL, cool-gray (hue **240**) | **OKLCH, neutral** (achromatic, C=0) | Every surface is subtly blue-tinted vs shadcn's true-neutral gray |
| Color values | 2023 palette + **AA-darkened** by prior QA | exact shadcn defaults | Prior iterations moved *away* from shadcn for WCAG AA |
| Opacity | `hsl(var(--x) / 0.9)` | `color-mix(in oklab, … 90%, transparent)` | hover/ring tints differ |
| `--radius` | `0.5rem` (8px) | `0.625rem` (10px) | every corner is 2px too sharp |
| Focus ring | `outline: 2px solid ring` | `border-ring` + `ring-[3px] ring/50` box-shadow | the signature shadcn focus look is absent |
| Font | system stack | **Geist** | text metrics/shape differ |

## Per-component metric gaps (the reliable ones from gaps.csv)

- **button**: height 40→**36** (`h-9`), add `py-2`; lg 44→**40**; icon 40→**36**; sm font xs→**sm**
- **input / textarea**: height 40→**36**; font 14→**16** (`text-base`, `md:text-sm`)
- **badge**: radius → **rounded-full**
- **card**: radius lg→**xl**; padding/gap → **24px** (`py-6`/`gap-6`/`px-6`)
- **alert**: paddingY 16→**12**; radius → lg
- **checkbox**: 20→**16** (`size-4`); **avatar**: 40→**32** (`size-8`); **toggle**: 40→**36**
- **destructive button**: text is literal **white** (not `--destructive-foreground`)
- **outline button**: `bg-background` + **shadow-xs** (shadcss has transparent, no shadow)

## Foundation sweep scope
- **51 files / 527** `hsl(var(…))` usages (54 with opacity) → migrate to
  `var(--token)` + `color-mix`. Mechanical, scriptable.

---

## Remediation (applied)

**Decisions (user):** exact shadcn OKLCH palette (revert AA darkening, new
theming contract); reference Geist with system fallback (no bundled font;
showcase loads Geist via Google Fonts so the demo matches shadcn).

1. **tokens.css → shadcn neutral OKLCH** (light/dark/auto), `--radius` 0.5→
   **0.625rem**, Geist added to `--font-sans`/`--font-mono`. Status tokens kept
   as shadcss extensions (full `hsl()` form).
2. **Color architecture migrated** by `scripts/fidelity/migrate-colors.mjs`:
   527 conversions across 51 files (`hsl(var(--x))`→`var(--x)`,
   `hsl(var(--x)/N)`→`color-mix(in oklab, var(--x) N%, transparent)`). 0 left.
3. **Focus model → shadcn ring** by `scripts/fidelity/migrate-focus.mjs`:
   22 blocks across 20 files (`outline:2px`→`border-ring` + `ring-[3px] ring/50`
   box-shadow). Inputs/textarea ring widened 2px/25%→3px/50%.
4. **Component metrics** aligned to the spec: button h40→36 (lg→40, icon→36,
   sm font→sm, rounded-md), destructive→white text + `dark:/60`, outline→
   bg-background+shadow-xs; input/textarea h→36 + shadow-xs + text-base→md:text-sm;
   badge→default-primary + rounded-full; card radius→xl; alert py→12 + bg-card +
   svg→16; checkbox→16px rounded-[4px] +shadow-xs; avatar→32px; toggle→36 + svg16.

**Verification:** build green (17.8 KB gz); `npm run check` 14/14;
`check:a11y` 0 critical, 0 markup-level serious (light+dark). Lightning CSS
downlevels OKLCH to exact sRGB hex (`--primary: #171717` = oklch(0.205)) + a
wide-gamut `lab()` fallback; `color-mix` preserved. Rendered both themes
(`qa/fidelity/shots/`) — neutral grays, rounded-full badges, 36px controls,
muted dark destructive, Geist text all confirmed shadcn-faithful.

**a11y policy change:** matching shadcn's exact palette re-introduces shadcn's
own sub-AA `color-contrast` combos (muted avatar fallback text, white-on-
destructive/info badges — 26 findings). The gate now treats serious
`color-contrast` as an **accepted fidelity tradeoff** (reported, not failing)
while still failing on critical + genuine markup-level serious issues.

## Polish pass (closed)
Secondary components aligned to shadcn source:
- **tooltip** → `bg-foreground text-background`, `px-3 py-1.5`, `rounded-md`, `text-xs`
- **kbd** → flat muted chip (`bg-muted`, no border/shadow), `font-sans`, `h-5 min-w-5 px-1 gap-1`, `text-muted-foreground`
- **navigation-menu trigger** → `h-9 px-4`
- **menubar** → bar `h-9 gap-1 shadow-xs`; trigger `px-2 py-1 rounded-sm`
- **sidebar menu-button** → `h-8 p-2 gap-2`, `svg-16`, normal weight (active = 500)

**Residual comparator rows (24) are all tool artifacts, not real gaps:**
nested-`calc()` radius reports MISSING (shadcss uses the radius vars correctly);
tooltip styling lives in `::after` (comparator can't read pseudo-elements);
`paddingY` flagged on height-driven boxes (button/input/nav-trigger use explicit
height, so `py` is non-constraining). Verified by rendering — see
`qa/fidelity/shots/`.

## Final state
build green (17.8 KB gz) · `npm run check` 14/14 · `check:a11y` 0 critical /
0 markup-level serious (26 color-contrast accepted as shadcn fidelity).

---

## 0.2.1 — line-height canon alignment + comprehensive comparator

The v1 comparator only diffed 8 numeric box-metrics on **root** elements — it
never compared line-height (resolver bundled it into the font-size string and
`compare.mjs` discarded the lh half), colors, or sub-elements. Rebuilt it (v2):
parses `leading-*`, keeps line-height, diffs colors/foreground tokens, and walks
**every `data-slot`** (titles/descriptions/etc.), not just roots.

Re-run found the line-height gaps and they're now fixed (comparator: **0
line-height deviations**):
- titles (card/dialog/alert-dialog/sheet/drawer/popover/hover-card/alert) → `1` (leading-none)
- field-label → `1.375` (snug); field-description → `1.5` (normal); field desc/error font → `text-sm`
- accordion content + all descriptions → `1.5`; popover-title weight → 500
- single-line controls keep `line-height:1` (identical under inline-flex+items-center)

Type-scale `--leading-*` tokens already matched Tailwind v4. Remaining comparator
rows are triaged: 2 parse artifacts (`text-center`/`left-*`), ~7 minor token
choices (input transparent-bg nuance, sidebar muted labels, tabs inactive dim),
and box-metric rows that are structural (shadcss has fewer sub-element classes)
or height-driven padding — logged in gaps.csv, not material.

## 0.2.2 — comparator covers the parity expansion (13 new components)

The v2 comparator iterated a hardcoded `MAP` of shadcss selectors, so the 13
components added in the shadcn-parity expansion (`native-select`, `button-group`,
`input-group`, `attachment`, `item`, `bubble`, `message`, `marker`, `combobox`,
`chart`, `message-scroller`, `direction`, `form`) were **silently skipped** —
`deviations=0` was real for the 36 mapped components but those 13 were never
compared. The `.refs/shadcn-ui` clone was also stale (predated `attachment`,
`bubble`, `message`, `marker`, `message-scroller`), so the spec had only 56 of
61 components.

Fixes:
1. Refreshed `.refs/shadcn-ui` to today's shadcn HEAD (`d0fae52`); spec now has
   all **61** components.
2. Added all 12 comparable new components to `MAP` (+ `direction` has no spec —
   it's a Radix JS provider with no CSS surface) and mapped their shadcn
   `data-slot`s to shadcss selectors (renamed ones via `SLOT_ALIASES`, e.g.
   `native-select-wrap`, `combobox-chips-input`; native/presentational slots
   nulled).
3. Hardened the comparator: `readBlock` now anchors selectors at rule boundaries
   and comments are stripped first, so a standalone `.foo {}` rule wins over a
   scoped `.bar .foo {}` override (the `attachment-content` line-height false
   positive was the wrong block being read). `bg-clip-*` no longer parses as a
   background color.

This re-surfaced real deviations, all now closed (comparator: **0 deviations,
0 not-comparable** across 61 components):
- line-heights: item-title 1.3→1.375, item-description 1.4→1.5, bubble-content 1.5→1.625
- combobox paddings: item/label py 4→6, empty 24→8, chips px 8→10 / py 4→6 / gap 4→6
- sidebar-menu-sub gap 2→4 (pre-existing, hidden before by the stale-block bug)
- split grouped `.header,.footer{}` selectors in item/message so each slot resolves
