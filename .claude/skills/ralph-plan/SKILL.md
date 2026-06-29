---
name: ralph-plan
description: Generate or refresh the Ralph plan (.ralph/plan.md) and work items (.ralph/items.json) for a given goal. Resets loop state and seeds progress.
---

# ralph-plan

Given a `<goal>`, (re)write the Ralph durable state files:

## Steps

1. **Read the repo**: Understand the stack — package manager, build tool, test runner, lint, CI. Read `scripts/check.sh` to know what the verification gate enforces.

2. **Write `.ralph/plan.md`**: State the objective (the `<goal>`) and list non-negotiable invariants — things that must never break (public API, data formats, security properties, existing behavior).

3. **Write `.ralph/items.json`**: Break the goal into small, independently verifiable items. Each item:
   - Has a kebab-case `id`
   - Has a `category`
   - `passes: false`, `blocked: false`
   - `description`: what "done" looks like
   - `steps`: concrete actionable steps
   - `regression_notes`: what to re-check so existing behavior doesn't break
   - If the item requires owner-only or environment-gated action → `blocked: true`
   - Include a `runtime_contract` object at the top level

4. **Reset `.ralph/loop.md`**:
   ```
   running: false
   iteration: 0
   stop_reason: null
   ```

5. **Seed `.ralph/progress.md`** with one entry:
   ```
   ## <timestamp>
   Ralph plan generated for goal: <goal>. Awaiting first iteration.
   ```

## Invariants

- Items must be small enough that ONE item can be completed and verified in a single iteration.
- Each item must be independently verifiable by `bash scripts/check.sh`.
- Never create items that require secrets, prod access, or manual approval without `blocked: true`.
