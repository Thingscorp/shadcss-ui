// ==========================================================================
// .claude/workflows/ralph-loop.js
// Ralph loop engine — generic, repo-agnostic.
// Each iteration: read .ralph/ state → pick ONE unfinished item → spawn a
// fresh agent → run the gate → flip passes:true only if gate is green →
// commit → append progress. State is durable in .ralph/, never in memory.
// ==========================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

export const meta = {
  name: "ralph-loop",
  description:
    "Self-verifying autonomous work loop. Each iteration is a fresh agent that reads durable .ralph/ state, picks one unfinished item, does the work, runs the verification gate, and commits only on green.",
  phases: ["read-state", "select-item", "spawn-agent", "verify-gate", "persist"],
};

const RALPH_DIR = path.resolve(process.cwd(), ".ralph");

function readRalph(file) {
  const p = path.join(RALPH_DIR, file);
  if (!existsSync(p)) throw new Error(`Missing .ralph/${file}`);
  return readFileSync(p, "utf8");
}

function writeRalph(file, content) {
  writeFileSync(path.join(RALPH_DIR, file), content, "utf8");
}

function parseLoopMd(raw) {
  const running = /^running:\s*(\w+)/m.exec(raw);
  const iteration = /^iteration:\s*(\d+)/m.exec(raw);
  const stopReason = /^stop_reason:\s*(.*)$/m.exec(raw);
  return {
    running: running ? running[1] === "true" : false,
    iteration: iteration ? parseInt(iteration[1], 10) : 0,
    stopReason: stopReason ? stopReason[1].trim() : null,
    raw,
  };
}

function serializeLoopMd(state) {
  return [
    `running: ${state.running}`,
    `iteration: ${state.iteration}`,
    `stop_reason: ${state.stopReason ?? "null"}`,
  ].join("\n") + "\n";
}

function parseItems(raw) {
  return JSON.parse(raw);
}

function selectNextItem(items) {
  return items.items.find((i) => !i.passes && !i.blocked) ?? null;
}

function runGate() {
  try {
    const output = execSync("bash scripts/check.sh", {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 300000,
    });
    const green = output.trim().endsWith("ALL GATES PASS");
    return { green, output };
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    return { green: false, output };
  }
}

function appendProgress(entry) {
  const existing = readRalph("progress.md");
  const ts = new Date().toISOString();
  const block = `\n## ${ts}\n${entry}\n`;
  writeRalph("progress.md", existing + block);
}

function commitItem(itemId) {
  execSync('git add .ralph/ packages/ apps/ scripts/ 2>/dev/null || true', {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  execSync(`git commit -m "fix(ralph): close ${itemId}"`, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

export async function main(args) {
  const maxIterations = args?.maxIterations ?? 1;
  const contract = parseItems(readRalph("items.json"));
  const runtimeContract = contract.runtime_contract || {};
  let completed = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    // 1. Read loop state
    const loopState = parseLoopMd(readRalph("loop.md"));
    if (!loopState.running) {
      console.log(`[ralph] stopping: running is false (stop_reason: ${loopState.stopReason})`);
      return { completed, reason: "running:false", iteration: loopState.iteration };
    }

    // 2. Read all durable state
    const items = parseItems(readRalph("items.json"));
    const plan = readRalph("plan.md");
    const prompt = readRalph("prompt.md");

    // 3. Select the FIRST item where passes:false and blocked:false
    const item = selectNextItem(items);
    if (!item) {
      const newLoop = { ...loopState, running: false, stopReason: "all items pass or remaining blocked" };
      writeRalph("loop.md", serializeLoopMd(newLoop));
      console.log("[ralph] stopping: no eligible items remain");
      return { completed, reason: "no-eligible-items", iteration: loopState.iteration };
    }

    console.log(`[ralph] iteration ${loopState.iteration + 1}: selected item "${item.id}" — ${item.description}`);

    // 4. Build the per-iteration prompt for the fresh agent
    const agentPrompt = [
      `# Ralph Iteration — Item: ${item.id}`,
      ``,
      `## Per-Iteration Contract`,
      prompt,
      ``,
      `## Plan & Invariants`,
      plan,
      ``,
      `## Your Item`,
      `ID: ${item.id}`,
      `Category: ${item.category}`,
      `Description: ${item.description}`,
      `Steps:`,
      ...item.steps.map((s) => `  - ${s}`),
      `Regression notes: ${item.regression_notes}`,
      ``,
      `## Runtime Contract`,
      JSON.stringify(runtimeContract, null, 2),
      ``,
      `Do exactly this ONE item. Run \`bash scripts/check.sh\` when done. Only flip passes:true if the gate ends with "ALL GATES PASS". Commit with a conventional-commit message (no AI attribution). Append one entry to .ralph/progress.md.`,
    ].join("\n");

    // 5. Spawn ONE agent (fresh context)
    // In Claude's Workflow system, we'd use agent(). In a shell fallback,
    // this would be re-invoking the CLI with the prompt.
    // The agent does the work, runs the gate, and flips the item.
    try {
      const agent = await import("node:child_process");
      // Attempt to spawn a sub-agent via the available mechanism.
      // If running inside Claude Workflow, agent() is available globally.
      if (typeof globalThis.agent === "function") {
        await globalThis.agent(agentPrompt);
      } else {
        // Shell fallback: print the prompt for manual or external orchestration
        console.log("[ralph] No agent() available — printing prompt for external runner:");
        console.log("---AGENT-PROMPT-START---");
        console.log(agentPrompt);
        console.log("---AGENT-PROMPT-END---");
      }
    } catch {
      console.log("[ralph] Agent spawn failed — printing prompt for external runner:");
      console.log("---AGENT-PROMPT-START---");
      console.log(agentPrompt);
      console.log("---AGENT-PROMPT-END---");
    }

    // 6. Run the verification gate ourselves to confirm
    const gate = runGate();
    if (gate.green) {
      console.log(`[ralph] gate GREEN for item "${item.id}" — flipping passes:true`);

      // Flip the item
      item.passes = true;
      writeRalph("items.json", JSON.stringify(items, null, 2) + "\n");

      // Commit
      if (runtimeContract.require_commit !== false) {
        commitItem(item.id);
      }

      // Append progress
      if (runtimeContract.require_progress_append !== false) {
        appendProgress(`Item "${item.id}" passed all gates.\n\nGate output:\n\`\`\`\n${gate.output.trim().split("\n").slice(-5).join("\n")}\n\`\`\``);
      }

      completed++;
    } else {
      console.log(`[ralph] gate RED for item "${item.id}" — NOT flipping passes:true`);
      console.log(gate.output.slice(-500));
      appendProgress(`Item "${item.id}" FAILED gates. Item remains passes:false.\n\nGate output (tail):\n\`\`\`\n${gate.output.trim().split("\n").slice(-10).join("\n")}\n\`\`\``);
    }

    // 7. Increment iteration counter
    const updatedLoop = parseLoopMd(readRalph("loop.md"));
    updatedLoop.iteration = loopState.iteration + 1;
    writeRalph("loop.md", serializeLoopMd(updatedLoop));
  }

  console.log(`[ralph] completed ${completed} iteration(s)`);
  return { completed, reason: "max-iterations-reached" };
}
