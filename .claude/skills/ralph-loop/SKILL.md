---
name: ralph-loop
description: Run N iterations of the Ralph loop engine. Each iteration picks one unfinished item, does the work, runs the verification gate, and commits only on green.
---

# ralph-loop

Run the Ralph loop engine for N iterations (default: 1).

## Usage

```
/ralph-loop [N]
```

## Steps

1. Read `.ralph/loop.md`. If `running: false`, set it to `running: true` and clear `stop_reason`.
2. Invoke the engine:

   ```
   Workflow({scriptPath: ".claude/workflows/ralph-loop.js", args: {maxIterations: N}})
   ```

   If no Workflow support, run:
   ```
   node .claude/workflows/ralph-loop.js
   ```
   (or pass `--maxIterations=N` if using the shell fallback)

3. After the engine returns, print a summary: how many items completed, how many remain, current loop state.

## What the engine does (per iteration)

1. Reads `.ralph/loop.md` — stops if `running: false`.
2. Reads `.ralph/items.json`, `.ralph/plan.md`, `.ralph/prompt.md`, `.ralph/progress.md`.
3. Selects the FIRST item where `passes: false` and `blocked: false`.
4. Spawns ONE fresh agent with the item + per-iteration contract.
5. Runs `bash scripts/check.sh` — only flips `passes: true` if output ends with `ALL GATES PASS` (exit 0).
6. Commits the change (conventional-commit, no AI attribution).
7. Appends one entry to `.ralph/progress.md`.
8. Increments `.ralph/loop.md` iteration counter.
9. Stops after N iterations, or when no eligible items remain, or `running: false`.
