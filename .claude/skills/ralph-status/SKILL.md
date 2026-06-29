---
name: ralph-status
description: Print the current Ralph loop state — branch, loop status, item counts, and recent progress.
---

# ralph-status

Print the current state of the Ralph loop.

## Steps

1. Print the current git branch.
2. Read and print `.ralph/loop.md` (running, iteration, stop_reason).
3. Read `.ralph/items.json` and print counts:
   - Total items
   - Passing (passes: true)
   - Blocked (blocked: true)
   - Remaining (passes: false, blocked: false)
4. Print the last 3 entries from `.ralph/progress.md`.
5. List the next eligible item (first where passes: false, blocked: false) with its id and description.
