# Contributing to shadcss-ui

PRs welcome.

## Adding or changing a component

- Each component is one file in `packages/shadcss/src/components/`. Keep it
  under 200 lines if you can.
- Use the design tokens (`var(--primary)`, …), never raw color values —
  consistency is by construction.
- Update `packages/shadcss/registry.json` when adding a component.
- Document the pattern in `packages/shadcss/AI_GUIDE.md` if it's one of the
  common interactive patterns.

## Checks

```bash
npm install
npm run build   # Lightning CSS bundle + minify (fails on invalid CSS)
npm run check   # static guards (consistency + markup)
```

`npm run build` must pass before a PR can be reviewed. Keep the 0-axe-violation
a11y bar for markup changes (see "Quality gates" in the README).

## License

By contributing, you agree your contributions are licensed under the MIT
license, like the repo.
