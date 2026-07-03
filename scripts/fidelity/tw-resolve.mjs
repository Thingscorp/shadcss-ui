// ==========================================================================
// scripts/fidelity/tw-resolve.mjs
// A focused Tailwind v4 -> concrete-CSS resolver. NOT a general Tailwind
// engine — it only knows the metric-bearing utilities shadcn actually uses in
// its component class strings (sizing, spacing, radius, type, border, shadow,
// ring, and color tokens). Enough to turn a shadcn cva class list into the
// resolved CSS values we diff shadcss against.
// ==========================================================================

// Tailwind spacing scale: 1 unit = 0.25rem. Includes the fractional steps
// shadcn uses (1.5, 2.5, 3.5) plus `px`.
export function spacing(n) {
  if (n === "px") return "1px";
  if (n === "0") return "0";
  const v = parseFloat(n);
  if (Number.isNaN(v)) return null;
  return `${v * 0.25}rem`;
}

const TEXT = {
  xs: { s: "0.75rem", lh: "1rem" },
  sm: { s: "0.875rem", lh: "1.25rem" },
  base: { s: "1rem", lh: "1.5rem" },
  lg: { s: "1.125rem", lh: "1.75rem" },
  xl: { s: "1.25rem", lh: "1.75rem" },
  "2xl": { s: "1.5rem", lh: "2rem" },
  "3xl": { s: "1.875rem", lh: "2.25rem" },
  "4xl": { s: "2.25rem", lh: "2.5rem" },
};

// Tailwind leading-* -> unitless line-height ratio (shadcn's explicit vocabulary).
const LEADING = { none: "1", tight: "1.25", snug: "1.375", normal: "1.5", relaxed: "1.625", loose: "2" };

const FONT_WEIGHT = {
  thin: 100, extralight: 200, light: 300, normal: 400,
  medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900,
};

// shadcn radius is driven by --radius via the registry-default subtract scale.
const RADIUS = {
  none: "0",
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
  xl: "var(--radius-xl)",
  "2xl": "calc(var(--radius) + 8px)",
  "3xl": "calc(var(--radius) + 12px)",
  full: "9999px",
  DEFAULT: "0.25rem",
};

const SHADOW = new Set(["none", "xs", "sm", "md", "lg", "xl", "2xl", "inner"]);

// Color utilities map to a shadcss/shadcn token name. `white`/`black` are
// literal. We record token + optional opacity (Tailwind /NN modifier).
function colorRef(rest) {
  // rest e.g. "primary", "primary-foreground", "destructive/90", "white",
  // "input/30", "accent-foreground"
  let opacity = null;
  let name = rest;
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    name = rest.slice(0, slash);
    opacity = parseInt(rest.slice(slash + 1), 10);
  }
  return { token: name, opacity };
}

// Resolve a list of class strings into a metrics object. Last-wins per prop.
// We intentionally ignore most layout/state utilities and capture only what
// determines visual fidelity. Unhandled classes are collected in `_unknown`.
export function resolveClasses(classes) {
  const m = {
    _unknown: [],
    _raw: classes.slice(),
  };
  const set = (k, v) => { if (v != null) m[k] = v; };

  for (const cls of classes) {
    // strip arbitrary-variant prefixes for capture but remember focus/hover/dark
    const colonIdx = cls.lastIndexOf(":");
    const variant = colonIdx === -1 ? "" : cls.slice(0, colonIdx);
    const base = colonIdx === -1 ? cls : cls.slice(colonIdx + 1);

    // ---- focus-visible ring model (shadcn signature) ----
    if (variant.includes("focus-visible")) {
      if (base === "border-ring") m.focusBorder = "ring";
      const ringM = base.match(/^ring-\[(\d+)px\]$/);
      if (ringM) m.focusRingWidth = `${ringM[1]}px`;
      const ringColor = base.match(/^ring-(.+)$/);
      if (ringColor && !/^\[/.test(ringColor[1]) && !/^\d/.test(ringColor[1])) {
        m.focusRingColor = colorRef(ringColor[1]);
      }
      continue;
    }
    // skip other stateful (hover/dark/aria/data) for the *base* metric capture,
    // but record hover bg/text since shadcss encodes those too.
    if (variant) {
      if (variant === "hover") {
        const bg = base.match(/^bg-(.+)$/);
        if (bg) (m.hover ??= {}).bg = colorRef(bg[1]);
        const tx = base.match(/^text-(.+)$/);
        if (tx) (m.hover ??= {}).text = colorRef(tx[1]);
      }
      continue;
    }

    // ---- sizing ----
    let mm;
    if ((mm = base.match(/^h-(.+)$/)) && spacing(mm[1])) set("height", spacing(mm[1]));
    else if ((mm = base.match(/^w-(.+)$/)) && spacing(mm[1])) set("width", spacing(mm[1]));
    else if ((mm = base.match(/^size-(.+)$/)) && spacing(mm[1])) { set("height", spacing(mm[1])); set("width", spacing(mm[1])); }
    else if ((mm = base.match(/^min-h-(.+)$/)) && spacing(mm[1])) set("minHeight", spacing(mm[1]));
    else if ((mm = base.match(/^min-w-(.+)$/)) && spacing(mm[1])) set("minWidth", spacing(mm[1]));
    // ---- padding ----
    else if ((mm = base.match(/^px-(.+)$/)) && spacing(mm[1])) set("paddingX", spacing(mm[1]));
    else if ((mm = base.match(/^py-(.+)$/)) && spacing(mm[1])) set("paddingY", spacing(mm[1]));
    else if ((mm = base.match(/^p-(.+)$/)) && spacing(mm[1])) { set("paddingX", spacing(mm[1])); set("paddingY", spacing(mm[1])); }
    else if ((mm = base.match(/^pl-(.+)$/)) && spacing(mm[1])) set("paddingLeft", spacing(mm[1]));
    else if ((mm = base.match(/^pr-(.+)$/)) && spacing(mm[1])) set("paddingRight", spacing(mm[1]));
    // ---- gap ----
    else if ((mm = base.match(/^gap-(.+)$/)) && spacing(mm[1])) set("gap", spacing(mm[1]));
    // ---- radius ----
    else if ((mm = base.match(/^rounded(?:-(.+))?$/))) set("radius", RADIUS[mm[1] ?? "DEFAULT"] ?? `[${mm[1]}]`);
    // ---- typography ----
    else if ((mm = base.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/))) { set("fontSize", TEXT[mm[1]].s); set("lineHeight", TEXT[mm[1]].lh); m._lhSource = "type-scale"; }
    else if ((mm = base.match(/^leading-(none|tight|snug|normal|relaxed|loose)$/))) { set("lineHeight", LEADING[mm[1]]); m._lhSource = "leading-" + mm[1]; }
    else if ((mm = base.match(/^leading-\[([^\]]+)\]$/))) { set("lineHeight", mm[1]); m._lhSource = "leading-arbitrary"; }
    else if ((mm = base.match(/^font-(\w+)$/)) && FONT_WEIGHT[mm[1]]) set("fontWeight", FONT_WEIGHT[mm[1]]);
    else if (base === "tracking-tight") set("letterSpacing", "-0.025em");
    else if (base === "tracking-wide") set("letterSpacing", "0.025em");
    // ---- border width ----
    else if (base === "border") set("border", "1px");
    else if ((mm = base.match(/^border-(\d+)$/))) set("border", `${mm[1]}px`);
    // ---- shadow ----
    else if ((mm = base.match(/^shadow(?:-(.+))?$/)) && SHADOW.has(mm[1] ?? "DEFAULT" === "DEFAULT" ? (mm[1] ?? "sm") : mm[1])) set("shadow", mm[1] ?? "sm");
    // ---- colors ----
    else if ((mm = base.match(/^bg-(.+)$/)) && !/^bg-clip-/.test(base)) set("bg", colorRef(mm[1]));
    else if ((mm = base.match(/^text-(.+)$/))) set("text", colorRef(mm[1]));
    else if ((mm = base.match(/^border-(.+)$/))) set("borderColor", colorRef(mm[1]));
    // ---- display (light touch) ----
    else if (["inline-flex", "flex", "grid", "inline-block", "block", "inline"].includes(base)) set("display", base);
    else m._unknown.push(cls);
  }
  return m;
}
