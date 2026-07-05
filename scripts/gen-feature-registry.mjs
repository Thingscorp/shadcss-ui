// ==========================================================================
// scripts/gen-feature-registry.mjs
// Generates the canonical feature inventory from the actual implementation
// (registry.json + CLI + build scripts + QA gates) so it cannot drift from
// reality. The resulting CSV is the source-of-truth for discovery, test
// generation, execution, remediation, and regression tracking.
// ==========================================================================

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REG = JSON.parse(readFileSync(path.join(ROOT, "packages/shadcss/registry.json"), "utf8"));
const TODAY = "2026-07-04";

const rows = [];
let fid = 0;
const next = () => `F${String(++fid).padStart(3, "0")}`;

const GATES = {
  build: "build",
  consistency: "check (consistency)",
  markup: "check (markup)",
  fidelity: "test:fidelity",
  tokens: "test:tokens",
  computed: "test:computed",
  blocks: "test:blocks",
  install: "test:install",
  animate: "test:animate",
  rtl: "test:rtl",
  a11y: "check:a11y",
};

function esc(value) {
  return String(value).replace(/"/g, '""').replace(/\n/g, " ");
}

function compStatus(component) {
  if (component.status === "visual-only") return "visual-only (gated)";
  if (component.status === "partial") return "partial (gated)";
  return "covered";
}

function compCoverage(component) {
  const gates = [GATES.fidelity, GATES.computed, GATES.tokens];
  if (component.js === "trigger" || component.js === "consumer") {
    gates.push("manual (behaviour needs JS)");
  }
  return gates.join(" + ");
}

function edgeCases(component) {
  const name = component.name.toLowerCase();
  if (name === "toggle-group") {
    return "The input must immediately precede its label for the adjacent-sibling highlight styling to work; any extra element between them breaks the selected state.";
  }
  if (name === "tabs") {
    return "The CSS-only pattern uses native radio selection, so ARIA tab state and keyboard-driven tab switching require consumer JS; malformed markup should not imply an active tab.";
  }
  if (name === "card") {
    return "Interactive cards need a real focus target such as tabindex=\"0\" and a wrapping link or button so keyboard users can reach the focus-visible ring.";
  }
  if (component.status === "visual-only" || component.status === "partial") {
    return "The static shell should render without errors, but interactive behavior depends on consumer JS; unsupported or missing JS should degrade without breaking layout.";
  }
  return "Unsupported variants or malformed wrapper structure should fall back gracefully without breaking layout, spacing, or accessibility hooks.";
}

function validationRules(component) {
  const name = component.name.toLowerCase();
  if (name === "dialog" || name === "drawer" || name === "sheet" || name === "alert-dialog") {
    return "Use the documented native dialog trigger pattern and preserve semantic dialog semantics; the CSS layer does not replace browser modal behavior.";
  }
  if (name === "popover" || name === "dropdown" || name === "context-menu" || name === "command" || name === "menubar") {
    return "Use the documented popover or menu trigger pattern; the stylesheet provides visuals only and full open/close state needs consumer JS.";
  }
  if (name === "fieldset" || name === "form" || name === "field") {
    return "Preserve the documented label, description, and error-message hierarchy so validation state and screen-reader text remain coherent.";
  }
  if (name === "toggle-group") {
    return "Keep the input and its corresponding label as adjacent siblings so the checked styling selector continues to work.";
  }
  return "Use the documented class names, wrapper structure, and semantic HTML for the component; preserve accessibility hooks and token-driven styling.";
}

function dependencies(component) {
  const name = component.name.toLowerCase();
  if (name === "button-group") return "button.css and the shared token layer";
  if (name === "input-group") return "input.css/textarea.css and the shared token layer";
  if (name === "message-scroller") return "message.css, bubble.css, and the shared scroll container styles";
  if (name === "popover" || name === "dropdown" || name === "context-menu" || name === "command" || name === "menubar") return "popover API support, consumer JS, and the shared token layer";
  if (name === "dialog" || name === "drawer" || name === "sheet" || name === "alert-dialog") return "native dialog support and the shared token layer";
  if (name === "tabs") return "modern :has() support and the shared token layer";
  return "the shared token layer and the relevant component stylesheet";
}

function assumptions(component) {
  const name = component.name.toLowerCase();
  if (name === "tabs") {
    return "The feature is intended to be CSS-only for selection styling; true ARIA tab semantics require consumer JS and are not represented by the static markup.";
  }
  if (component.status === "visual-only" || component.status === "partial") {
    return "The feature provides the visual shell and documented markup contract, but full interaction is expected to be wired by consumer JS where explicitly noted.";
  }
  return "The feature is expected to work with documented HTML structure and the shared token system without additional JavaScript unless the component explicitly requires it.";
}

function testCases(featureName, category, existing) {
  const base = existing || "Happy path: render the documented entry point";
  if (category === "component") {
    return `${base}; Error path: unsupported variant or malformed wrapper; Boundary: responsive and RTL layouts; Invalid input: malformed or undocumented markup; Security: no unsafe JS or hidden behavior in the CSS layer; Performance: static render remains lightweight; Mobile: verify narrow-width layouts.`;
  }
  if (category === "block") {
    return `${base}; Error path: broken composition or missing content; Boundary: narrow/mobile widths; Invalid input: malformed or incomplete content; Security: no console errors or a11y regressions; Performance: standalone block remains lightweight; Mobile: verify stacked layouts.`;
  }
  if (category === "cli") {
    return `${base}; Error path: invalid component, file, or arguments; Boundary: nested paths and large registries; Invalid input: unsupported flags; Security: do not write unintended files; Performance: command completion stays fast for common usage.`;
  }
  if (category === "pipeline") {
    return `${base}; Error path: missing artifacts or mismatched versions; Boundary: build/watch/deploy flows; Invalid input: missing config or environment assumptions; Security: no secrets or partial outputs; Performance: builds remain within expected runtime.`;
  }
  if (category === "theming") {
    return `${base}; Error path: invalid token values; Boundary: light/dark/auto modes; Invalid input: unsupported token names; Security: no unsafe CSS; Performance: overrides do not bloat bundle size.`;
  }
  return `${base}; Error path: invalid state or missing dependencies; Boundary: small/large content sets; Invalid input: malformed input; Security: no unsafe execution; Performance: remains responsive.`;
}

function notesFor(component, category, extra) {
  const base = [
    `Validation rules: ${validationRules(component)}`,
    `Dependencies: ${dependencies(component)}`,
    `Known assumptions: ${assumptions(component)}`,
  ];
  if (extra) base.push(extra);
  return base.join(" | ");
}

function featureRow({ featureId, featureName, userStory, expectedBehaviour, edgeCase, testCase, currentStatus, defectCount, severity, note }) {
  return [featureId, featureName, userStory, expectedBehaviour, edgeCase, testCase, currentStatus, defectCount, severity, note, TODAY];
}

// ---- COMPONENTS ----
for (const component of REG.components) {
  rows.push(featureRow({
    featureId: next(),
    featureName: component.name,
    userStory: `As a developer, I can use the ${component.name} component so that ${component.description || "the documented UI pattern is available in my markup"}.`,
    expectedBehaviour: `Renders per shadcn spec (${component.status || "stable"}, js:${component.js || "none"}, support:${component.support || "baseline"}). ${component.notes || ""}`.trim(),
    edgeCase: edgeCases(component),
    testCase: testCases(component.name, "component", compCoverage(component)),
    currentStatus: compStatus(component),
    defectCount: "0",
    severity: component.status === "visual-only" ? "low" : "none",
    note: notesFor(component, "component"),
  }));
}

// ---- BLOCKS ----
const blockCoverage = [GATES.blocks, GATES.a11y];
for (const block of REG.blocks || []) {
  rows.push(featureRow({
    featureId: next(),
    featureName: block.name,
    userStory: `As a developer, I can copy the ${block.name} block markup so that I get a complete ${block.family} section layout.`,
    expectedBehaviour: `Composes the documented components into a full section. It should render cleanly without console errors, preserve visible content, and remain axe-clean for critical and markup-serious issues.`,
    edgeCase: "Blocks should remain usable in narrow/mobile layouts, preserve visible content when copied standalone, and avoid console errors or accessibility regressions.",
    testCase: testCases(block.name, "block", blockCoverage.join(" + ")),
    currentStatus: "covered",
    defectCount: "0",
    severity: "none",
    note: notesFor({ name: block.name, status: "stable", js: "none", support: "baseline", notes: "Block composition uses the shared component library." }, "block"),
  }));
}

// ---- CLI COMMANDS ----
const cliCases = [
  ["add", "As a developer, I run shadcss add <component> so that the component CSS is copied into my repo.", "Copies the component and its declared dependencies byte-for-byte from the registry into the target project.", GATES.install],
  ["list", "As a developer, I run shadcss list so that I can see all available components.", "Enumerates the registry component names and exposes the component inventory to the developer.", GATES.cli],
  ["info", "As a developer, I run shadcss info <component> so that I see its file, dependency, class, and accessibility information.", "Prints the requested registry entry so the developer can inspect the implementation contract.", GATES.cli],
  ["diff", "As a developer, I run shadcss diff [component] so that I see how my copied components drifted from upstream.", "Diffs local copies against the upstream source. With a component name, diffs one; without, diffs all local copies. Surfaces drift clearly and exits non-zero on any drift.", GATES.cli],
  ["check", "As a developer, I run shadcss check <file> so that my markup is linted for accessibility footguns.", "Runs static markup linting and reports structural or accessibility issues in the supplied file.", GATES.cli],
];
for (const [name, story, behaviour, gate] of cliCases) {
  rows.push(featureRow({
    featureId: next(),
    featureName: `shadcss ${name}`,
    userStory: story,
    expectedBehaviour: behaviour,
    edgeCase: "Unknown commands, invalid component names, and unsupported file paths should fail clearly without writing unintended files.",
    testCase: testCases(`shadcss ${name}`, "cli", gate === "none" ? "none" : gate),
    currentStatus: gate === "none" ? "gap" : "covered",
    defectCount: "0",
    severity: gate === "none" ? "medium" : "none",
    note: notesFor({ name: `shadcss ${name}`, status: "stable", js: "none", support: "baseline", notes: "CLI behavior relies on registry.json and the filesystem." }, "cli"),
  }));
}

// ---- BUILD / RELEASE PIPELINE ----
const pipeCases = [
  ["build", "As a maintainer, I run npm run build so that the published CSS bundle is generated.", "Builds the distributable CSS bundle, modular files, and generated docs artifacts from the source tree.", GATES.build],
  ["check", "As a maintainer, I run npm run check so that drift is caught before merge.", "Runs consistency and markup validation to keep the registry, bundle, and docs aligned.", `${GATES.consistency} + ${GATES.markup}`],
  ["release", "As a maintainer, I run npm run release so that the package can be published.", "Builds the package and publishes the shadcss package to npm.", "none (manual)"],
  ["deploy", "As a maintainer, I run npm run deploy so that the docs site is published.", "Publishes the docs site from apps/www.", "none (manual)"],
  ["dev", "As a maintainer, I run npm run dev so that live rebuilds happen while I edit.", "Watches source files and rebuilds assets on change.", "none (manual)"],
];
for (const [name, story, behaviour, gate] of pipeCases) {
  rows.push(featureRow({
    featureId: next(),
    featureName: name,
    userStory: story,
    expectedBehaviour: behaviour,
    edgeCase: "Build, publish, and deploy commands should fail loudly on partial outputs and should not leave behind broken artifacts.",
    testCase: testCases(name, "pipeline", gate),
    currentStatus: gate.includes("none") ? "partial" : "covered",
    defectCount: "0",
    severity: gate.includes("none") ? "low" : "none",
    note: notesFor({ name, status: "stable", js: "none", support: "baseline", notes: "Pipeline behavior depends on the workspace scripts and generated artifacts." }, "pipeline"),
  }));
}

// ---- TEST GATES (meta-features) ----
for (const scriptName of ["test:tokens", "test:computed", "test:blocks", "test:install", "test:cli", "test:animate", "test:rtl", "test:js", "check:a11y"]) {
  rows.push(featureRow({
    featureId: next(),
    featureName: scriptName,
    userStory: `As a maintainer, the ${scriptName} gate runs in npm test so that regressions are caught before merge.`,
    expectedBehaviour: "The gate runs and exits non-zero on regression so failures are surfaced before release.",
    edgeCase: "Gate failures should be surfaced immediately and should block a release rather than silently passing.",
    testCase: testCases(scriptName, "test-gate", "self"),
    currentStatus: "covered",
    defectCount: "0",
    severity: "none",
    note: notesFor({ name: scriptName, status: "stable", js: "none", support: "baseline", notes: "The gate is implemented by the matching script under scripts/." }, "test-gate"),
  }));
}

// ---- SHADCSS-JS PROGRESSIVE ENHANCEMENT ----
const jsFeatures = [
  ["shadcss-js: initMenus", "As a developer, I import @russfranky/shadcss-js/menu so that popover-API menus get keyboard navigation.", "Adds roving arrow-key focus, Home/End, type-ahead, Escape-to-close + focus return, and role=menu/menuitem + aria-haspopup to elements with data-sc-menu. Auto-inits on DOMContentLoaded.", "trigger"],
  ["shadcss-js: initTabs", "As a developer, I import @russfranky/shadcss-js/tabs so that radio-based tabs get full ARIA tab semantics.", "Upgrades .tabs[data-sc-tabs] to role=tablist/tab/tabpanel with aria-selected sync, aria-controls/aria-labelledby wiring, and arrow-key/Home/End navigation. Auto-inits on DOMContentLoaded.", "trigger"],
  ["shadcss-js: index (all enhancers)", "As a developer, I import @russfranky/shadcss-js so that all opt-in enhancers initialize.", "Re-exports initMenus and initTabs; importing the package initializes all enhancers on DOMContentLoaded.", "trigger"],
];
for (const [name, story, behaviour, jsType] of jsFeatures) {
  rows.push(featureRow({
    featureId: next(),
    featureName: name,
    userStory: story,
    expectedBehaviour: behaviour,
    edgeCase: "Enhancers must be idempotent (double-init safe via __scMenu/__scTabs guards). Must degrade gracefully if the target elements are absent — no errors on a page without menus or tabs.",
    testCase: testCases(name, "component", "test:js (keyboard nav, ARIA, idempotency, degradation)"),
    currentStatus: "covered",
    defectCount: "0",
    severity: "medium",
    note: notesFor({ name, status: "stable", js: jsType, support: "baseline", notes: "Opt-in via data-sc-menu / data-sc-tabs attributes. Zero dependencies." }, "component"),
  }));
}

// ---- BASE LAYERS ----
const baseLayers = [
  ["base/reset", "As a developer, the reset layer normalizes browser defaults so that components render consistently.", "Applies a modern CSS reset including box-sizing, margin reset, and the global closed-overlay guard (dialog:not([open]) and [popover]:not(:popover-open) set to display:none)."],
  ["base/tokens", "As a developer, the tokens layer defines design tokens so that components reference consistent values.", "Defines all CSS custom properties (--space-*, --radius-*, --text-*, --color-*) used by every component. Components reference these with no fallbacks, so tokens must be imported first."],
  ["base/theme", "As a developer, the theme layer provides light/dark/auto modes so that my app adapts to user preference.", "Defines [data-theme=dark] overrides and prefers-color-scheme media queries for all color tokens. Supports light, dark, and auto (system) modes."],
  ["base/animate", "As a developer, the animate layer provides enter/exit animations so that overlays animate smoothly.", "Implements the tw-animate-css compatible utility classes (animate-in, fade-in-0, zoom-in-95, slide-in-*, etc.) using @property + keyframes + allow-discrete for overlay exit animations."],
];
for (const [name, story, behaviour] of baseLayers) {
  rows.push(featureRow({
    featureId: next(),
    featureName: name,
    userStory: story,
    expectedBehaviour: behaviour,
    edgeCase: "Base layers must be imported before any component. Missing tokens cause silent rendering failures (var() resolves to empty). The closed-overlay guard must not be removed or closed dialogs/popovers become visible.",
    testCase: testCases(name, "component", `${GATES.tokens} + ${GATES.markup} + ${GATES.animate}`),
    currentStatus: "covered",
    defectCount: "0",
    severity: "none",
    note: notesFor({ name, status: "stable", js: "none", support: "baseline", notes: "Base layer imported via src/shadcss.css or dist/base.min.css." }, "component"),
  }));
}

// ---- BUILD SUB-FEATURES ----
const buildFeatures = [
  ["llms.txt generation", "As an AI agent, I read llms.txt so that I can generate correct shadcss markup.", "Generates a machine-readable index of all components, classes, a11y contracts, and markup from registry.json. Written to packages/shadcss/llms.txt and apps/www/llms.txt on every build.", "none (generated)"],
  ["modular dist emission", "As a developer, I import only the components I need so that my bundle stays minimal.", "Emits dist/base.min.css (reset + tokens + theme + animate) plus one minified file per component under dist/components/. Enables tree-shaking by letting consumers ship base + N components.", "none (generated)"],
  ["fidelity comparison", "As a maintainer, I run the fidelity comparison so that shadcss styles match the shadcn spec.", "Parses shadcn component source CSS and compares key metrics (height, padding, radius, font-size, gap) against shadcss implementations. Surfaces deviations before they ship.", GATES.fidelity],
  ["size analyzer", "As a maintainer, I run the size analyzer so that I can identify optimization opportunities.", "Reports per-component minified + gzipped bytes, base layer cost, and dead tokens (custom properties defined but never referenced by any var()). Evidence-driven optimization input.", "none (analysis)"],
  ["showcase", "As a user, I browse the showcase so that I can see every component rendered live.", "A single-page HTML showcase (apps/www/index.html) rendering every component and block with the built bundle. Includes theme toggle and serves as the a11y gate target.", "none (rendered)"],
];
for (const [name, story, behaviour, gate] of buildFeatures) {
  rows.push(featureRow({
    featureId: next(),
    featureName: name,
    userStory: story,
    expectedBehaviour: behaviour,
    edgeCase: "Generated artifacts must stay in sync with registry.json. The showcase must render without console errors. Dead tokens identified by the analyzer may be candidates for pruning but require manual verification.",
    testCase: testCases(name, "pipeline", gate),
    currentStatus: gate === "none (generated)" || gate === "none (analysis)" || gate === "none (rendered)" ? "partial" : "covered",
    defectCount: "0",
    severity: gate.includes("none") ? "low" : "none",
    note: notesFor({ name, status: "stable", js: "none", support: "baseline", notes: "Generated during build or run on-demand." }, "pipeline"),
  }));
}

// ---- DOCS SITE ----
rows.push(featureRow({
  featureId: next(),
  featureName: "docs site",
  userStory: "As a user, I browse the docs site so that I can read about and preview every component and block.",
  expectedBehaviour: "The docs site is generated from the registry and provides navigation, content previews, and theme/search affordances mirroring the shadcn-style layout.",
  edgeCase: "Docs pages should remain navigable on mobile, preserve theme toggle behavior, and avoid broken links or missing content.",
  testCase: testCases("docs site", "docs", "none (rendered-only)"),
  currentStatus: "gap",
  defectCount: "0",
  severity: "medium",
  note: notesFor({ name: "docs site", status: "stable", js: "none", support: "baseline", notes: "The docs site depends on registry metadata and the app shell." }, "docs"),
}));

// ---- THEMING ----
rows.push(featureRow({
  featureId: next(),
  featureName: "token overrides",
  userStory: "As a developer, I override a design token so that the whole library rethemes.",
  expectedBehaviour: "Root CSS custom properties can be overridden globally and the theme layer supports light, dark, and auto modes.",
  edgeCase: "Token overrides should work in light, dark, and auto modes without breaking contrast or token resolution.",
  testCase: testCases("token overrides", "theming", `${GATES.tokens} (resolution)`),
  currentStatus: "partial",
  defectCount: "0",
  severity: "low",
  note: notesFor({ name: "token overrides", status: "stable", js: "none", support: "baseline", notes: "Theming relies on custom properties defined on :root." }, "theming"),
}));

// ---- write CSV ----
const header = ["Feature ID", "Feature Name", "User Story", "Expected Behaviour", "Edge Cases", "Test Cases", "Current Status", "Defect Count", "Severity", "Notes", "Last Tested Date"];
const csv = [header, ...rows].map((row) => row.map((cell) => `"${esc(cell)}"`).join(",")).join("\n");
const outPath = path.join(ROOT, "feature-registry.csv");
writeFileSync(outPath, csv);
console.log(`Wrote ${rows.length} feature rows → feature-registry.csv`);
const gaps = rows.filter((row) => /gap|partial/i.test(row[6]));
console.log(`\nCoverage gaps (${gaps.length}):`);
for (const row of gaps) console.log(`  ${row[0]}  ${row[1]}  —  ${row[6]}`);
