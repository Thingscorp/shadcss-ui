---
name: ralph-stop
description: Halt the Ralph loop by setting running:false in loop.md. Does not touch items.
---

# ralph-stop

Stop the Ralph loop.

## Steps

1. Read `.ralph/loop.md`.
2. Set `running: false`.
3. Set `stop_reason: "stopped by owner"`.
4. Write the updated `.ralph/loop.md`.
5. Print confirmation.

Does NOT modify `.ralph/items.json` or any other state. The loop can be resumed by running `/ralph-loop` again (which sets `running: true`).
