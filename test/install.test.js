import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installerArguments } from "../src/install.js";
const executable = fileURLToPath(
  new URL("../bin/am-i-nerfed.js", import.meta.url),
);
const adapter = fileURLToPath(
  new URL("../src/skills-interactive.js", import.meta.url),
);
test("skill installer leaves native agent, scope, method and confirmation choices interactive", () => {
  const args = installerArguments({});
  assert.equal(args[0], "add");
  assert.equal(args[2], "--skill");
  assert.equal(args[3], "am-i-nerfed");
  for (const flag of ["--yes", "--global", "--agent", "--copy", "--json"])
    assert.equal(args.includes(flag), false);
  const explicit = installerArguments({
    "--yes": true,
    "--project": true,
    "--agent": ["codex", "claude-code"],
    "--copy": true,
  });
  assert.deepEqual(explicit.slice(4), [
    "--agent",
    "codex",
    "claude-code",
    "--copy",
    "--yes",
    "--json",
  ]);
  assert.equal(
    installerArguments({ "--global": true }).includes("--global"),
    true,
  );
  assert.throws(
    () => installerArguments({ "--project": true }),
    /choose Project/,
  );
  assert.throws(
    () => installerArguments({ "--project": true, "--global": true }),
    /either/,
  );
});
test("headless skill installation without explicit yes leaves new and existing baselines unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-headless-"));
  try {
    const project = path.join(root, "project"),
      state = path.join(root, "state");
    fs.mkdirSync(project);
    const env = { ...process.env, AM_I_NERFED_HOME: state };
    const call = (...args) =>
      spawnSync(process.execPath, [executable, "skill", "install", ...args], {
        cwd: project,
        env,
        encoding: "utf8",
      });
    let result = call();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires a terminal/);
    assert.equal(fs.existsSync(state), false);
    fs.mkdirSync(state);
    const pointer = path.join(state, "current.json"),
      original = '{"baselineId":"preserve"}';
    fs.writeFileSync(pointer, original);
    result = call("--reset");
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(pointer, "utf8"), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("terminal adapter preserves upstream output and emits positive, cancelled and failed receipts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-receipt-"));
  async function run(body) {
    const stub = path.join(root, "upstream.mjs");
    fs.writeFileSync(stub, body);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [adapter, stub], {
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      });
      let out = "",
        receipt = "";
      child.stdout.on("data", (d) => (out += d));
      child.stdio[3].on("data", (d) => (receipt += d));
      child.on("error", reject);
      child.on("close", (code) =>
        resolve({ code, out, receipt: JSON.parse(receipt) }),
      );
    });
  }
  try {
    const success = await run(
      'process.stdout.write("Native prompt\\n");process.stdout.write("\\u001b[32mInstalled 1 skill\\u001b[0m\\n");',
    );
    assert.equal(
      success.out,
      "Native prompt\n\u001b[32mInstalled 1 skill\u001b[0m\n",
    );
    assert.deepEqual(success.receipt, {
      installed: true,
      cancelled: false,
      failed: false,
    });
    const cancelled = await run(
      'console.log("Installation cancelled");process.exit(0);',
    );
    assert.equal(cancelled.code, 0);
    assert.deepEqual(cancelled.receipt, {
      installed: false,
      cancelled: true,
      failed: false,
    });
    const partial = await run(
      'console.log("Installed 1 skill");console.error("Failed to install 1");',
    );
    assert.equal(partial.receipt.failed, true);
    const inconclusive = await run('console.log("Done!");');
    assert.equal(inconclusive.receipt.installed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
