import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateTaskBank } from "../src/task-bank.js";
import {
  startAssessment, assessmentAction, assessmentTimer,
  assessmentPath, annotateAssessment,
} from "../src/assessment.js";

const bank = generateTaskBank("synthetic-timer");
const cli = fileURLToPath(new URL("../bin/am-i-nerfed.js", import.meta.url));
const transportModule = new URL("../src/runner-transport.js", import.meta.url).href;
const keys = ["durationSeconds", "elapsedSeconds", "remainingSeconds"];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-timer-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "state"), cwd = path.join(root, "project");
  const baselineId = randomUUID(), base = path.join(home, "baselines", baselineId);
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(cwd);
  const state = { base, current: { baselineId }, dataset: { seed: "synthetic-timer" } };
  for (const [file, data] of [
    [path.join(home, "current.json"), state.current],
    [path.join(base, "dataset.json"), state.dataset],
    [path.join(base, "task-bank.json"), bank],
  ]) fs.writeFileSync(file, JSON.stringify(data));
  return { root, home, cwd, state };
}

function snapshot(root) {
  const entries = {};
  const walk = current => {
    const stat = fs.lstatSync(current), relative = path.relative(root, current);
    entries[relative] = { mode: stat.mode, mtimeMs: stat.mtimeMs };
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name));
    } else entries[relative].hash = createHash("sha256").update(fs.readFileSync(current)).digest("hex");
  };
  walk(root);
  return entries;
}

test("timer returns only the three clock fields, without grading or altering the deadline", t => {
  const f = fixture(t), began = 1000;
  const run = startAssessment(f.state, { seconds: 500 }, began);
  const before = snapshot(f.home);
  assert.deepEqual(assessmentTimer(f.state, run.runId, () => began + 73000), {
    durationSeconds: 500, elapsedSeconds: 73, remainingSeconds: 427,
  });
  assert.deepEqual(assessmentTimer(f.state, run.runId, () => began + 499999), {
    durationSeconds: 500, elapsedSeconds: 499, remainingSeconds: 1,
  });
  for (const now of [began + 500000, began + 900000]) {
    assert.deepEqual(assessmentTimer(f.state, run.runId, () => now), {
      durationSeconds: 500, elapsedSeconds: 500, remainingSeconds: 0,
    });
  }
  assert.deepEqual(snapshot(f.home), before);
  const record = JSON.parse(fs.readFileSync(assessmentPath(f.state, run.runId)));
  assert.equal(record.status, "active");
  assert.equal(record.receipt, undefined);
  assert.equal(record.deadlineAt, run.clock.deadlineAt);
  const late = assessmentAction(f.state, "answer", {
    runId: run.runId, taskId: run.tasks[0].id, patch: {},
  }, () => began + 500000);
  assert.equal(late.accepted, false);
});

test("timer reports zero remaining for ended runs and rejects unknown or mismatched IDs", t => {
  const f = fixture(t), began = Date.now();
  const run = startAssessment(f.state, { seconds: 500 }, began);
  assessmentAction(f.state, "finish", { runId: run.runId }, () => began + 73000);
  assert.deepEqual(assessmentTimer(f.state, run.runId, () => began + 90000), {
    durationSeconds: 500, elapsedSeconds: 73, remainingSeconds: 0,
  });
  annotateAssessment(f.state, run.runId, { failure: "Synthetic failure" });
  assert.equal(assessmentTimer(f.state, run.runId).remainingSeconds, 0);
  assert.throws(() => assessmentTimer(f.state, randomUUID()), /not found/);
  assert.throws(() => assessmentTimer(f.state, "invalid"), /valid --run ID/);
  assert.throws(() => assessmentTimer({ ...f.state, current: { baselineId: randomUUID() } }, run.runId), /does not belong/);
});

test("public timer CLI returns only clock JSON and does not mutate expired state", t => {
  const f = fixture(t);
  const run = startAssessment(f.state, { seconds: 120 }, Date.now() - 121000);
  const before = snapshot(f.home);
  const result = spawnSync(process.execPath, [cli, "timer", "--run", run.runId], {
    cwd: f.cwd, env: { ...process.env, AM_I_NERFED_HOME: f.home }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    durationSeconds: 120, elapsedSeconds: 120, remainingSeconds: 0,
  });
  assert.deepEqual(snapshot(f.home), before);
  const unknown = spawnSync(process.execPath, [cli, "timer", "--run", randomUUID()], {
    cwd: f.cwd, env: { ...process.env, AM_I_NERFED_HOME: f.home }, encoding: "utf8",
  });
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, "");
});

test("supervised timer transport uses its bound run without updating run or event files", t => {
  const f = fixture(t), run = startAssessment(f.state, { seconds: 500 });
  const config = path.join(f.cwd, "transport.json");
  fs.writeFileSync(config, JSON.stringify({ state: f.home, events: path.join(f.cwd, "events.jsonl") }));
  fs.writeFileSync(path.join(f.cwd, "run.json"), JSON.stringify({ runId: run.runId }));
  const before = snapshot(f.root);
  const source = `import {transport} from ${JSON.stringify(transportModule)};transport(${JSON.stringify(config)},['timer']);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: f.cwd, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const timer = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(timer), keys);
  assert.equal(timer.durationSeconds, 500);
  assert.ok(timer.remainingSeconds > 0 && timer.remainingSeconds <= 500);
  assert.deepEqual(snapshot(f.root), before);
});

test("supervised timer transport reports an output budget's usage", t => {
  const f = fixture(t), run = startAssessment(f.state, { seconds: 500 });
  const config = path.join(f.cwd, "transport.json"), budget = path.join(f.cwd, "budget.json");
  fs.writeFileSync(config, JSON.stringify({ state: f.home, events: path.join(f.cwd, "events.jsonl"),
    budget: { file: budget, limit: 5000 } }));
  fs.writeFileSync(path.join(f.cwd, "run.json"), JSON.stringify({ runId: run.runId }));
  const source = `import {transport} from ${JSON.stringify(transportModule)};transport(${JSON.stringify(config)},['timer']);`;
  const timer = () => JSON.parse(spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: f.cwd, encoding: "utf8" }).stdout);
  assert.deepEqual(timer().outputTokens, { used: 0, limit: 5000 });
  fs.writeFileSync(budget, JSON.stringify({ used: 1234, limit: 5000 }));
  assert.deepEqual(timer().outputTokens, { used: 1234, limit: 5000 });
});

test("a token budget shows its usage in every response, rejects answers once spent and counts each command", t => {
  const f = fixture(t), run = startAssessment(f.state, { seconds: 500 });
  const config = path.join(f.cwd, "transport.json"), budget = path.join(f.cwd, "budget.json"),
    calls = path.join(f.cwd, "calls.jsonl"), events = path.join(f.cwd, "events.jsonl");
  fs.writeFileSync(config, JSON.stringify({ state: f.home, events, calls, budget: { file: budget, limit: 5000 } }));
  fs.writeFileSync(path.join(f.cwd, "run.json"), JSON.stringify({ runId: run.runId }));
  const call = (...args) => {
    const source = `import {transport} from ${JSON.stringify(transportModule)};transport(${JSON.stringify(config)},${JSON.stringify(args)});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd: f.cwd, encoding: "utf8" });
    return { status: result.status, output: JSON.parse(result.stdout) };
  };
  fs.writeFileSync(budget, JSON.stringify({ used: 4000, limit: 5000 }));
  const saved = call("answer", "--task", "medium-1", "--json", "null");
  assert.equal(saved.output.accepted, true);
  assert.deepEqual(saved.output.outputTokens, { used: 4000, limit: 5000 });
  assert.deepEqual(call("budget").output.outputTokens, { used: 4000, limit: 5000 });
  fs.writeFileSync(budget, JSON.stringify({ used: 5100, limit: 5000 }));
  const late = call("answer", "--task", "medium-1", "--json", "true");
  assert.equal(late.status, 1);
  assert.equal(late.output.accepted, false);
  assert.match(late.output.reason, /budget spent/);
  assert.deepEqual(late.output.outputTokens, { used: 5100, limit: 5000 });
  assert.notEqual(call("question", "--task", "medium-1").output.submitted, true, "The rejected answer was not saved");
  assert.deepEqual(fs.readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line).action),
    ["answer", "budget", "answer", "question"]);
  const answers = fs.readFileSync(events, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    .filter((event) => event.action === "answer");
  assert.deepEqual(answers.map((event) => event.accepted), [true, false]);
});
