// ==========================================================================
// scripts/test.mjs — the canonical single-command gate.
// Runs, in order: build → consistency+markup → fidelity → token-resolution →
// computed-style → a11y (auto-serves apps/www on :3333 for the runtime check).
// Exits non-zero on the first failing gate. Equivalent to the old manual
// scripts/check.sh but self-contained (no separate `npm run www` terminal).
// ==========================================================================

import { spawn } from "node:child_process";
import * as net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = new URL("..", import.meta.url).pathname;
const ran = []; // {name, ok, output}

function run(cmd, args, { env } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    p.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
    p.on("close", (code) => resolve({ ok: code === 0, output: out }));
  });
}

const gates = [
  { name: "build",            cmd: "npm", args: ["run", "build"] },
  { name: "consistency+markup", cmd: "npm", args: ["run", "check"] },
  { name: "fidelity",         cmd: "node", args: ["scripts/fidelity/compare.mjs"] },
  { name: "token-resolution", cmd: "node", args: ["scripts/test-tokens.mjs"] },
  { name: "computed-style",   cmd: "node", args: ["scripts/test-computed.mjs"] },
  { name: "blocks",           cmd: "node", args: ["scripts/test-blocks.mjs"] },
  { name: "install",          cmd: "node", args: ["scripts/test-install.mjs"] },
  { name: "cli",              cmd: "node", args: ["scripts/test-cli.mjs"] },
  { name: "animate",          cmd: "node", args: ["scripts/test-animate.mjs"] },
  { name: "rtl",              cmd: "node", args: ["scripts/test-rtl.mjs"] },
];

let failed = null;
for (const g of gates) {
  console.log(`\n━━━ ${g.name} ━━━`);
  const r = await run(g.cmd, g.args);
  ran.push({ ...g, ...r });
  if (!r.ok && !failed) failed = g.name;
  if (failed) break; // stop at first failure — later gates depend on a build
}

// a11y needs the showcase served. Only run if nothing earlier failed.
if (!failed) {
  console.log(`\n━━━ a11y (serving apps/www on :3333) ━━━`);
  const server = spawn("npx", ["serve", "apps/www", "-l", "3333"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", () => {}); // swallow "already in use" etc.
  // Wait for the port to accept connections (max ~15s).
  let up = false;
  for (let i = 0; i < 30; i++) {
    await delay(500);
    up = await new Promise((res) => {
      const sock = net.connect({ host: "127.0.0.1", port: 3333 }, () => { sock.end(); res(true); });
      sock.on("error", () => res(false));
    });
    if (up) break;
  }
  let r;
  if (!up) {
    console.error("  could not start showcase server — skipping a11y (FAIL)");
    r = { ok: false, output: "server did not come up on :3333" };
  } else {
    r = await run("node", ["scripts/check-a11y.mjs"], { env: { A11Y_URL: "http://127.0.0.1:3333/index.html" } });
  }
  server.kill("SIGTERM");
  ran.push({ name: "a11y", ...r });
  if (!r.ok && !failed) failed = "a11y";
}

// Summary
console.log(`\n${"━".repeat(48)}\nSUMMARY`);
for (const g of ran) console.log(`  ${g.ok ? "✓" : "✗"} ${g.name}`);
if (failed) {
  console.error(`\nFAILED at gate: ${failed}`);
  process.exit(1);
}
console.log(`\nAll gates passed.`);
