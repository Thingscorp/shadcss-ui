// ==========================================================================
// scripts/fidelity/compare.mjs  (v2 — comprehensive)
// Diff shadcss CSS against the shadcn target spec across EVERY data-slot
// (root + sub-elements like titles/descriptions), covering: line-height,
// colors/foreground tokens, and box metrics (height/padding/radius/font/gap/
// border). v1 only diffed 8 numeric metrics on root elements, which is why
// line-heights and the badge foreground convention slipped through.
// Output: qa/fidelity/gaps.csv + console report.
// ==========================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "packages/shadcss/src");
const spec = JSON.parse(readFileSync(path.join(ROOT, "qa/fidelity/shadcn-spec.json"), "utf8"));
const tokensCss = readFileSync(path.join(SRC, "base/tokens.css"), "utf8");

const REM = 16;
function tokenVal(name) { const m = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`)); return m ? m[1].trim() : null; }
function toPx(v) { if (v == null) return null; v = String(v).trim(); if (v.endsWith("px")) return parseFloat(v); if (v.endsWith("rem")) return parseFloat(v) * REM; if (v === "0") return 0; return null; }
function resolveShadcss(v) {
  if (v == null) return null; v = v.trim();
  const vm = v.match(/^var\(--([\w-]+)\)$/); if (vm) return toPx(tokenVal(vm[1]));
  const cm = v.match(/^calc\(\s*var\(--([\w-]+)\)\s*([+\-])\s*([\d.]+)px\s*\)$/);
  if (cm) { const b = toPx(tokenVal(cm[1])); if (b == null) return null; return cm[2] === "+" ? b + parseFloat(cm[3]) : b - parseFloat(cm[3]); }
  return toPx(v);
}
const SHADCN_RADIUS = 0.625 * REM;
function resolveShadcnRadius(name) { switch (name) { case "radius-sm": return SHADCN_RADIUS - 4; case "radius-md": return SHADCN_RADIUS - 2; case "radius-lg": return SHADCN_RADIUS; case "radius-xl": return SHADCN_RADIUS + 4; default: return SHADCN_RADIUS; } }
function resolveRadiusToken(v) { if (v == null) return null; if (v === "9999px") return 9999; if (v === "0") return 0; const vm = v.match(/^var\(--([\w-]+)\)$/); if (vm) return resolveShadcnRadius(vm[1]); return toPx(v); }

function readBlock(css, selector) {
  // Anchor the selector at a rule boundary (start-of-file, or after { } , ) so a
  // standalone `.foo {` rule wins over a scoped/descendant `.bar .foo {`
  // override that happens to appear earlier in the file. The descendant form is
  // preceded by a selector + space, not a boundary char, so it won't match first.
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(?:^|[{,}])\\s*" + esc + "(?![\\w-])\\s*\\{", "g");
  const m = re.exec(css); if (!m) return null;
  const start = m.index + m[0].length; const end = css.indexOf("}", start);
  return end === -1 ? null : css.slice(start, end);
}
function decl(block, prop) { if (!block) return null; const m = block.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`)); return m ? m[1].trim() : null; }

// normalize a shadcss color value to a comparable token name
function colorToken(v) {
  if (!v) return null; v = v.trim();
  if (/color-mix/.test(v)) {
    // Extract the first var(--token) from the color-mix — that's the base color.
    // For overlays using black/50, this returns "black".
    const m = v.match(/var\(--([\w-]+)\)/);
    if (m) return m[1] === "background" ? "background" : m[1];
    // color-mix with a raw color like black/white
    const raw = v.match(/(?:in\s+oklab,\s*)([\w#]+)/);
    if (raw) return raw[1];
    return "mix";
  }
  const m = v.match(/var\(--([\w-]+)\)/); if (m) return m[1];
  if (/^(#fff|#ffffff|white)$/i.test(v)) return "white";
  if (/^(#000|#000000|black)$/i.test(v)) return "black";
  if (v === "transparent" || v === "currentColor" || v === "inherit") return v;
  return v.slice(0, 18);
}
// shadcn colorRef -> comparable token. Guard against text-align keywords that
// the extractor occasionally captured as a "color" (e.g. text-center/text-left).
const ALIGN_KEYWORDS = new Set(["center", "left", "right", "start", "end", "justify"]);
function shadcnColor(ref) { if (!ref) return null; if (ALIGN_KEYWORDS.has(ref.token)) return null; if (ref.token === "white") return "white"; return ref.token; }

function shadcssAt(css, selector) {
  const b = readBlock(css, selector); if (b == null) return null;
  const out = { _sel: selector };
  const h = decl(b, "height"); if (h) out.height = resolveShadcss(h);
  const pad = decl(b, "padding");
  if (pad) { const p = pad.split(/\s+/); if (p.length === 2) { out.paddingY = resolveShadcss(p[0]); out.paddingX = resolveShadcss(p[1]); } else if (p.length === 1) { out.paddingY = out.paddingX = resolveShadcss(p[0]); } else if (p.length >= 4) { out.paddingY = resolveShadcss(p[0]); out.paddingX = resolveShadcss(p[1]); } }
  const r = decl(b, "border-radius"); if (r) out.radius = resolveShadcss(r);
  const fs = decl(b, "font-size"); if (fs) out.fontSize = resolveShadcss(fs);
  const fw = decl(b, "font-weight"); if (fw) out.fontWeight = parseInt(fw, 10);
  const g = decl(b, "gap"); if (g) out.gap = resolveShadcss(g);
  out.lineHeightRaw = decl(b, "line-height");
  out.color = colorToken(decl(b, "color"));
  out.bg = colorToken(decl(b, "background") || decl(b, "background-color"));
  return out;
}

// name -> shadcss primary file + root selector (root only; sub-slots derive .{slot})
const MAP = {
  button: { file: "button", sel: ".btn" }, badge: { file: "badge", sel: ".badge" },
  input: { file: "input", sel: ".input" }, textarea: { file: "textarea", sel: ".textarea" },
  card: { file: "card", sel: ".card" }, alert: { file: "alert", sel: ".alert" },
  switch: { file: "switch", sel: ".switch" }, checkbox: { file: "checkbox", sel: ".checkbox" },
  "radio-group": { file: "radio-group", sel: ".radio-group" }, select: { file: "select", sel: ".select" },
  label: { file: "label", sel: ".label" }, avatar: { file: "avatar", sel: ".avatar" },
  skeleton: { file: "skeleton", sel: ".skeleton" }, progress: { file: "progress", sel: ".progress" },
  separator: { file: "separator", sel: ".separator" }, tooltip: { file: "tooltip", sel: ".tooltip" },
  popover: { file: "popover", sel: ".popover" }, dialog: { file: "dialog", sel: "dialog.dialog" },
  "alert-dialog": { file: "alert-dialog", sel: "dialog.alert-dialog" }, sheet: { file: "sheet", sel: "dialog.sheet" },
  "dropdown-menu": { file: "dropdown", sel: ".dropdown-menu" }, menubar: { file: "menubar", sel: ".menubar" },
  command: { file: "command", sel: ".command" }, breadcrumb: { file: "breadcrumb", sel: ".breadcrumb" },
  pagination: { file: "pagination", sel: ".pagination" }, table: { file: "table", sel: ".table" },
  sonner: { file: "sonner", sel: ".sonner" }, slider: { file: "slider", sel: ".slider" },
  toggle: { file: "toggle", sel: ".toggle" }, "toggle-group": { file: "toggle-group", sel: ".toggle-group" },
  kbd: { file: "kbd", sel: ".kbd" }, accordion: { file: "accordion", sel: ".accordion" },
  tabs: { file: "tabs", sel: ".tabs" }, "hover-card": { file: "hover-card", sel: ".hover-card" },
  sidebar: { file: "sidebar", sel: ".sidebar" }, field: { file: "field", sel: ".field" },
  calendar: { file: "calendar", sel: ".calendar" }, "navigation-menu": { file: "navigation-menu", sel: ".navigation-menu" },
  drawer: { file: "drawer", sel: "dialog.drawer" },
  // --- components added in the shadcn-parity expansion ---
  "native-select": { file: "native-select", sel: ".native-select" },
  "button-group": { file: "button-group", sel: ".btn-group" },
  "input-group": { file: "input-group", sel: ".input-group" },
  attachment: { file: "attachment", sel: ".attachment" },
  item: { file: "item", sel: ".item" },
  bubble: { file: "bubble", sel: ".bubble" },
  message: { file: "message", sel: ".message" },
  marker: { file: "marker", sel: ".marker" },
  combobox: { file: "combobox", sel: ".combobox-trigger" },
  chart: { file: "chart", sel: ".chart-container" },
  "message-scroller": { file: "message-scroller", sel: ".message-scroller" },
  form: { file: "form", sel: ".form-item" },
};

// Slot aliases: map shadcn slot names to actual shadcss selectors.
// Key format: "component/slot-name" → shadcss selector string.
// Slots not listed here fall through to "." + slot (the default).
const SLOT_ALIASES = {
  // switch — thumb is a ::before pseudo-element
  "switch/switch-thumb": ".switch::before",
  // checkbox — indicator is a ::before pseudo-element
  "checkbox/checkbox-indicator": ".checkbox::before",
  // radio-group — slots are in radio-group.css, not radio.css
  "radio-group/radio-group-item": ".radio-group-item",
  "radio-group/radio-group-indicator": ".radio-group-item",
  // slider — track/thumb are pseudo-elements
  "slider/slider-track": ".slider::-webkit-slider-runnable-track",
  "slider/slider-range": ".slider",
  "slider/slider-thumb": ".slider::-webkit-slider-thumb",
  // progress — indicator is a pseudo-element
  "progress/progress-indicator": ".progress::-webkit-progress-value",
  // avatar — image is a child img
  "avatar/avatar-image": ".avatar > img",
  "avatar/avatar-fallback": ".avatar",
  // slider-range — the range is a gradient on .slider, not a simple bg.
  // Skip color comparison for slider-range since it's a gradient, not a token.
  "slider/slider-range": null,
  // tooltip — content is a ::after pseudo-element
  "tooltip/tooltip-content": ".tooltip::after",
  // dialog — content is the dialog element itself, overlay is ::backdrop
  "dialog/dialog-content": "dialog.dialog",
  "dialog/dialog-overlay": "dialog.dialog::backdrop",
  // alert-dialog — same pattern
  "alert-dialog/alert-dialog-content": "dialog.alert-dialog",
  "alert-dialog/alert-dialog-overlay": "dialog.alert-dialog::backdrop",
  // sheet — same pattern
  "sheet/sheet-content": "dialog.sheet",
  "sheet/sheet-overlay": "dialog.sheet::backdrop",
  // drawer — same pattern
  "drawer/drawer-content": "dialog.drawer",
  // --- expansion components: slots whose shadcss class name differs from the
  //     shadcn data-slot, or that map to a non-default selector. Slots not
  //     listed fall through to "." + slot (the default). ---
  // native-select — wrapper named -wrap, not -wrapper; icon is a decorative svg
  "native-select/native-select-wrapper": ".native-select-wrap",
  "native-select/native-select-icon": null,
  "native-select/native-select-option": null,
  "native-select/native-select-optgroup": null,
  // button-group — no separator slot in shadcss (only a text label)
  "button-group/button-group-separator": null,
  // combobox — renamed input + presentational/value slots
  "combobox/combobox-chip-input": ".combobox-chips-input",
  // sidebar — badge is styled only as a descendant of menu-button
  "sidebar/sidebar-menu-badge": ".sidebar-menu-button .sidebar-menu-badge",
  "combobox/combobox-trigger-icon": null,
  "combobox/combobox-value": null,
  "combobox/combobox-collection": null,
  // combobox reuses input-group's button slot — styled in input-group.css, not here
  "combobox/input-group-button": null,
  "drawer/drawer-overlay": "dialog.drawer::backdrop",
  // popover — content IS the .popover element
  "popover/popover-content": ".popover",
  // hover-card — content is .hover-card-panel
  "hover-card/hover-card-content": ".hover-card-panel",
  // table — slots are native elements
  "table/table-container": ".table-wrapper",
  "table/table-header": ".table thead",
  "table/table-body": ".table tbody",
  "table/table-footer": ".table tfoot",
  "table/table-row": ".table tbody tr",
  "table/table-head": ".table th",
  "table/table-cell": ".table td",
  "table/table-caption": ".table caption",
  // accordion — item is details, trigger is summary
  "accordion/accordion-item": ".accordion > details",
  "accordion/accordion-trigger": ".accordion > details > summary",
  "accordion/accordion-content": ".accordion-content",
  // tabs — content is .tabs-panel
  "tabs/tabs-content": ".tabs-panel",
  // dropdown-menu — slots use "dropdown-" prefix not "dropdown-menu-"
  "dropdown-menu/dropdown-menu-content": ".dropdown-menu",
  "dropdown-menu/dropdown-menu-item": ".dropdown-item",
  "dropdown-menu/dropdown-menu-label": ".dropdown-label",
  "dropdown-menu/dropdown-menu-separator": ".dropdown-separator",
  "dropdown-menu/dropdown-menu-shortcut": ".dropdown-shortcut",
  "dropdown-menu/dropdown-menu-group": ".dropdown-group",
  "dropdown-menu/dropdown-menu-sub": ".dropdown-sub",
  "dropdown-menu/dropdown-menu-sub-trigger": ".dropdown-sub-trigger",
  "dropdown-menu/dropdown-menu-sub-content": ".dropdown-sub-content",
  "dropdown-menu/dropdown-menu-checkbox-item": ".dropdown-checkbox-item",
  "dropdown-menu/dropdown-menu-radio-group": ".dropdown-radio-group",
  "dropdown-menu/dropdown-menu-radio-item": ".dropdown-radio-item",
  // menubar — slots reuse dropdown-* classes
  "menubar/menubar-content": ".dropdown-menu",
  "menubar/menubar-item": ".dropdown-item",
  "menubar/menubar-label": ".dropdown-label",
  "menubar/menubar-separator": ".dropdown-separator",
  "menubar/menubar-shortcut": ".dropdown-shortcut",
  "menubar/menubar-sub": ".dropdown-sub",
  "menubar/menubar-sub-trigger": ".dropdown-sub-trigger",
  "menubar/menubar-sub-content": ".dropdown-sub-content",
  "menubar/menubar-checkbox-item": ".dropdown-checkbox-item",
  "menubar/menubar-radio-group": ".dropdown-radio-group",
  "menubar/menubar-radio-item": ".dropdown-radio-item",
};

// Slots that are architectural-only in shadcn (portal/trigger/overlay/anchor/close)
// and have no CSS-only equivalent. Skip them entirely.
const SKIP_SLOTS = new Set([
  "dialog/dialog-portal", "dialog/dialog-trigger", "dialog/dialog-close",
  "alert-dialog/alert-dialog-portal", "alert-dialog/alert-dialog-trigger", "alert-dialog/alert-dialog-close",
  "sheet/sheet-portal", "sheet/sheet-trigger", "sheet/sheet-close",
  "drawer/drawer-portal", "drawer/drawer-trigger", "drawer/drawer-close",
  "popover/popover-portal", "popover/popover-trigger", "popover/popover-anchor",
  "hover-card/hover-card-portal", "hover-card/hover-card-trigger",
  "tooltip/tooltip-portal", "tooltip/tooltip-trigger", "tooltip/tooltip-provider",
  "dropdown-menu/dropdown-menu-portal", "dropdown-menu/dropdown-menu-trigger",
  "menubar/menubar-portal", "menubar/menubar-trigger",
  "select/select-group", "select/select-value", "select/select-trigger",
  "select/select-content", "select/select-label", "select/select-item",
  "select/select-item-indicator", "select/select-separator",
  "select/select-scroll-up-button", "select/select-scroll-down-button",
  "breadcrumb/breadcrumb-portal", "breadcrumb/breadcrumb-trigger",
  "breadcrumb/breadcrumb-list", "breadcrumb/breadcrumb-page", "breadcrumb/breadcrumb-separator",
  "pagination/pagination-content",
  // dropdown-menu — structural-only slots with no specific styles
  "dropdown-menu/dropdown-menu-group", "dropdown-menu/dropdown-menu-checkbox-item",
  "dropdown-menu/dropdown-menu-radio-group", "dropdown-menu/dropdown-menu-sub",
  // menubar — same structural slots
  "menubar/menubar-checkbox-item", "menubar/menubar-radio-group",
  "menubar/menubar-sub",
  // command — wrapper is structural
  "command/command-input-wrapper",
  // table-body — no specific styles (just a tbody element)
  "table/table-body",
  // sidebar — not yet audited, skip for now
  "sidebar/sidebar-wrapper", "sidebar/sidebar-gap", "sidebar/sidebar-container",
  "sidebar/sidebar-inner", "sidebar/sidebar-trigger", "sidebar/sidebar-rail",
  "sidebar/sidebar-inset", "sidebar/sidebar-input", "sidebar/sidebar-group-action",
  "sidebar/sidebar-group-content", "sidebar/sidebar-menu-skeleton", "sidebar/sidebar-menu-sub-item",
]);

const NUMERIC = ["height", "paddingX", "paddingY", "radius", "fontSize", "fontWeight", "gap"];
function shadcnNum(rm, key) {
  if (!rm) return null;
  if (key === "fontSize") return rm.fontSize ? toPx(rm.fontSize) : null;
  if (key === "radius") return rm.radius != null ? resolveRadiusToken(rm.radius) : null;
  const v = rm[key]; if (v == null) return null;
  if (key === "fontWeight") return v;
  return toPx(v);
}

const rows = [["component", "slot", "metric", "shadcn", "shadcss", "note"]];
const lineHeightRows = [];
const colorRows = [];

function compareSlot(comp, slotName, sel, css, target) {
  const have = shadcssAt(css, sel);
  if (!have) { rows.push([comp, slotName, "—", "", "(selector " + sel + " not found)", "skip"]); return; }
  // numeric box metrics
  for (const key of NUMERIC) {
    const want = shadcnNum(target, key); if (want == null) continue;
    const got = have[key]; if (got == null) continue;
    if (Math.abs(want - got) > 0.6) rows.push([comp, slotName, key, want + "px", got + "px", ""]);
  }
  // line-height
  const src = target._lhSource;
  if (src) {
    const wantLH = String(target.lineHeight);
    const rawLH = have.lineHeightRaw;
    if (src.startsWith("leading-")) {
      const canon = parseFloat(wantLH);
      const num = rawLH && /^[0-9.]+$/.test(rawLH) ? parseFloat(rawLH) : null;
      if (num == null) lineHeightRows.push([comp, slotName, `${src} (${canon})`, rawLH || "(none)", "shadcss not a matching unitless ratio"]);
      else if (Math.abs(num - canon) > 0.03) lineHeightRows.push([comp, slotName, `${src} (${canon})`, rawLH, `off by ${(num - canon).toFixed(3)}`]);
    } else if (src === "type-scale") {
      // Only prose (descriptions/content/body) needs to track the type-scale ratio;
      // single-line controls legitimately use line-height:1 (identical under
      // inline-flex+items-center), and titles legitimately use leading-none.
      const isProse = /description|content|body|caption/.test(slotName) && !/tooltip/.test(slotName);
      if (isProse && rawLH && /^[0-9.]+$/.test(rawLH)) {
        const fs = target.fontSize ? parseFloat(target.fontSize) : null;
        const ratio = fs ? parseFloat(wantLH) / fs : null;
        const got = parseFloat(rawLH);
        if (ratio && Math.abs(got - ratio) > 0.18)
          lineHeightRows.push([comp, slotName, `type-scale ≈${ratio.toFixed(2)}`, rawLH, `off by ${(got - ratio).toFixed(2)}`]);
      }
    }
  }
  // colors
  const wantText = shadcnColor(target.text), wantBg = shadcnColor(target.bg);
  if (wantText && have.color && wantText !== have.color && !(wantText === "white" && have.color === "white"))
    colorRows.push([comp, slotName, "color", wantText, have.color]);
  if (wantBg && have.bg && wantBg !== have.bg)
    colorRows.push([comp, slotName, "background", wantBg, have.bg]);
}

// Strip /* */ comments so rule-boundary anchoring in readBlock isn't fooled by
// the comment that usually precedes a selector (e.g. `*/\n  .foo {`).
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

for (const [name, { file, sel }] of Object.entries(MAP)) {
  const fpath = path.join(SRC, "components", `${file}.css`);
  if (!existsSync(fpath)) continue;
  const css = stripComments(readFileSync(fpath, "utf8"));
  const sp = spec[name]; if (!sp) continue;
  if (sp.rootMetrics) compareSlot(name, "(root)", sel, css, sp.rootMetrics);
  for (const [slot, m] of Object.entries(sp.slots || {})) {
    if (slot === name) continue; // root handled
    const skipKey = `${name}/${slot}`;
    if (SKIP_SLOTS.has(skipKey)) continue;
    const aliasKey = `${name}/${slot}`;
    if (SLOT_ALIASES[aliasKey] === null) continue; // explicitly skip (gradient/pseudo)
    const slotSel = SLOT_ALIASES[aliasKey] || "." + slot;
    // For menubar, dropdown-* classes live in dropdown.css, not menubar.css
    let cssForSlot = css;
    if (name === "menubar" && slotSel.startsWith(".dropdown-")) {
      const ddPath = path.join(SRC, "components", "dropdown.css");
      if (existsSync(ddPath)) cssForSlot = stripComments(readFileSync(ddPath, "utf8"));
    }
    compareSlot(name, slot, slotSel, cssForSlot, m);
  }
}

const csv = [...rows, [], ["LINE-HEIGHT DEVIATIONS"], ["component","slot","shadcn canon","shadcss","note"], ...lineHeightRows, [], ["COLOR/TOKEN DEVIATIONS"], ["component","slot","metric","shadcn","shadcss"], ...colorRows]
  .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
writeFileSync(path.join(ROOT, "qa/fidelity/gaps.csv"), csv);

console.log(`\n=== LINE-HEIGHT DEVIATIONS (${lineHeightRows.length}) ===`);
for (const r of lineHeightRows) console.log(`  ${r[0]}/${r[1]}`.padEnd(34) + `want ${String(r[2]).padEnd(22)} have ${String(r[3]).padEnd(8)} ${r[4]}`);
console.log(`\n=== COLOR/FOREGROUND DEVIATIONS (${colorRows.length}) ===`);
for (const r of colorRows) console.log(`  ${r[0]}/${r[1]}`.padEnd(34) + `${r[2].padEnd(11)} shadcn=${String(r[3]).padEnd(20)} shadcss=${r[4]}`);
console.log(`\n=== BOX-METRIC DEVIATIONS (${rows.length-1}) ===`);
for (const r of rows.slice(1)) console.log(`  ${r[0]}/${r[1]}`.padEnd(30) + `${r[2].padEnd(12)} shadcn=${String(r[3]).padEnd(10)} shadcss=${String(r[4]).padEnd(12)} ${r[5]}`);
// "not found" rows mean a slot the comparator couldn't locate (shadcss names it
// differently or styles a native element) — that's "can't compare", NOT a real
// deviation, so it doesn't count toward fidelity. Count only real mismatches.
const realBox = rows.slice(1).filter((r) => r[5] !== "skip").length;
const notFound = rows.slice(1).length - realBox;
console.log(`\nreal_deviations=${lineHeightRows.length + colorRows.length + realBox}  (box ${realBox}, color ${colorRows.length}, line-height ${lineHeightRows.length}; ${notFound} slots not comparable)`);
console.log(`deviations_total=${lineHeightRows.length + colorRows.length + realBox}`);
console.log(`Wrote qa/fidelity/gaps.csv`);
