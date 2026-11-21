# HCT themes for shadcss

Generated color themes for shadcss, produced by Thingscorp/skills (skills/material-color-system). The generator does not live in this repo: shadcss stays zero-runtime, and this folder carries only generated CSS plus this mapping note.

## Use

Copy `example-theme.css` into your project and load it after the shadcss base styles. It sets the 19 standard theme variables (`--background`, `--primary`, `--accent`, and their `-foreground` pairs, plus `--border`, `--input`, `--ring`) for `:root` (light) and `.dark`.

The example is generated from seed `#6750A4`, unedited.

## Make your own

```bash
git clone https://github.com/Thingscorp/hct-color-kit
cd hct-color-kit && npm install
node integrations/shadcss/generate-theme.mjs --source '#YOURCOLOR' > theme.css
```

Every foreground/background pair in a generated theme is a designed pair from the kit, contrast-verified by the kit's eval harness (all text pairs at or above WCAG 4.5:1 across its seed set).

## Rules

- Never hand-edit a generated theme file. Regenerate it from its seed; the seed is the source of truth.
- If a theme in this folder ever differs from fresh generator output at the same seed, the theme here is wrong and gets regenerated, not patched.
- Mapping (kit role to variable) is documented in the kit repo under `integrations/shadcss/`.
