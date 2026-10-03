import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/am-i-nerfed.js", import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-doctor-test-"));
  const cwd = path.join(root, "project"), state = path.join(root, "state"), bin = path.join(root, "bin");
  fs.mkdirSync(cwd); fs.mkdirSync(bin);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, AM_I_NERFED_HOME: state, PATH: bin };
  const command = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  return { root, cwd, state, env, command, json: (...args) => JSON.parse(command(...args)) };
}

function snapshot(root) {
  const found = {};
  const walk = current => {
    const stat = fs.lstatSync(current), relative = path.relative(root, current);
    found[relative] = { mode: stat.mode, mtimeMs: stat.mtimeMs };
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name));
    } else {
      found[relative].sha256 = createHash("sha256").update(fs.readFileSync(current)).digest("hex");
    }
  };
  walk(root);
  return found;
}

test("doctor and version work before initialization without creating state", t => {
  const f = fixture(t);
  assert.match(f.command("--version"), /^\d+\.\d+\.\d+\n$/);
  const before = snapshot(f.root), result = f.json("doctor");
  assert.equal(result.initialized, false);
  assert.match(result.initializationError, /init first/);
  assert.equal(f.command("doctor", "--init"), "false\n");
  assert.equal(fs.existsSync(f.state), false);
  assert.deepEqual(snapshot(f.root), before);
});

test("doctor reports a ready baseline without clients, private content, or writes", t => {
  const f = fixture(t), initialized = f.json("init");
  const before = snapshot(f.state), raw = f.command("doctor"), result = JSON.parse(raw);
  assert.equal(result.initialized, true);
  assert.equal(result.baselineId, initialized.baselineId);
  assert.equal(result.taskBankVersion, initialized.taskBankVersion);
  assert.equal(result.tasks, 15);
  assert.equal(f.command("doctor", "--init"), "true\n");
  assert.equal(result.clients.every(client => client.available === false), true);
  assert.doesNotMatch(raw, /"(?:seed|prompt|answer|drafts|receipt|runId)"/);
  assert.deepEqual(snapshot(f.state), before);
});

test("doctor does not regenerate a missing task bank", t => {
  const f = fixture(t), initialized = f.json("init");
  const bank = path.join(f.state, "baselines", initialized.baselineId, "task-bank.json");
  fs.unlinkSync(bank);
  const before = snapshot(f.state), result = f.json("doctor");
  assert.equal(result.initialized, false);
  assert.match(result.initializationError, /incomplete/);
  assert.equal(f.command("doctor", "--init"), "false\n");
  assert.equal(fs.existsSync(bank), false);
  assert.deepEqual(snapshot(f.state), before);
});

test("doctor reports corrupt state without echoing private file contents or repairing it", t => {
  const f = fixture(t);
  f.json("init");
  fs.writeFileSync(path.join(f.state, "current.json"), "private-sentinel-invalid-json");
  const before = snapshot(f.state), raw = f.command("doctor"), result = JSON.parse(raw);
  assert.equal(result.initialized, false);
  assert.doesNotMatch(raw, /private-sentinel/);
  assert.equal(f.command("doctor", "--init"), "false\n");
  assert.deepEqual(snapshot(f.state), before);
});

test("doctor reports an invalid configured state path without changing it", t => {
  const f = fixture(t);
  f.env.AM_I_NERFED_HOME = f.cwd;
  const before = snapshot(f.root), result = f.json("doctor");
  assert.equal(result.initialized, false);
  assert.match(result.initializationError, /directory/);
  assert.equal(f.command("doctor", "--init"), "false\n");
  assert.deepEqual(snapshot(f.root), before);
});

test("doctor --init does not invoke native model clients", t => {
  const f = fixture(t), marker = path.join(f.root, "client-invoked");
  for (const name of ["codex", "claude"]) {
    fs.writeFileSync(path.join(f.env.PATH, name),
      `#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'called');\n`,
      { mode: 0o700 });
  }
  const before = snapshot(f.root);
  assert.equal(f.command("doctor", "--init"), "false\n");
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(fs.existsSync(marker), false);
});
