import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  flatten,
  generateTaskBank,
  TASK_BANK_VERSION,
} from "../src/task-bank.js";
import {
  startAssessment,
  assessmentAction,
  assessmentPath,
  listHistory,
  annotateAssessment,
  destroyHistory,
} from "../src/assessment.js";
import { optimalProtocols } from "./protocol-oracle.js";
const bank = generateTaskBank("synthetic-assessment");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-test-"));
  const state = {
    base: path.join(root, "baselines", randomUUID()),
    current: {},
    dataset: { seed: "synthetic-assessment" },
  };
  state.current.baselineId = path.basename(state.base);
  fs.mkdirSync(state.base, { recursive: true });
  fs.writeFileSync(
    path.join(state.base, "task-bank.json"),
    JSON.stringify(bank),
  );
  fs.writeFileSync(
    path.join(state.base, "dataset.json"),
    JSON.stringify(state.dataset),
  );
  fs.writeFileSync(
    path.join(root, "current.json"),
    JSON.stringify(state.current),
  );
  return {
    root,
    state,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
test("five-task run preserves partial work, grades equally and permanently closes on early finish", () => {
  const f = fixture(),
    now = Date.now();
  try {
    const start = startAssessment(
      f.state,
      { invocation: "skill", model: "known-model", effort: "high" },
      now,
    );
    assert.equal(start.tasks.length, 5);
    assert.equal(start.difficulty, "medium");
    assert.equal(start.clock.remainingSeconds, 120);
    assert.equal(start.clockEnforcement, "answer-deadline");
    assert.equal(start.result, undefined);
    const runId = start.runId,
      taskId = start.tasks[0].id;
    assessmentAction(
      f.state,
      "answer",
      { runId, taskId, patch: { a: true, b: true } },
      () => now + 1,
    );
    assessmentAction(
      f.state,
      "answer",
      {
        runId,
        taskId,
        patch: JSON.parse(
          '{"b":null,"__proto__":{"polluted":true}}',
        ),
      },
      () => now + 2,
    );
    const question = assessmentAction(
      f.state,
      "question",
      { runId, taskId },
      () => now + 3,
    );
    assert.equal(question.submitted.a, true);
    assert.equal(question.submitted.b, null);
    assert.equal({}.polluted, undefined);
    assert.equal(question.result, undefined);
    assessmentAction(
      f.state,
      "answer",
      { runId, taskId, patch: null },
      () => now + 4,
    );
    assessmentAction(
      f.state,
      "answer",
      { runId, taskId, patch: flatten(bank.tasks.find((t) => t.id === taskId).answer) },
      () => now + 5,
    );
    const receipt = assessmentAction(
      f.state,
      "finish",
      { runId },
      () => now + 30000,
    );
    assert.equal(receipt.result.percent, 20);
    assert.equal(receipt.clock.elapsedSeconds, 30);
    assert.equal(receipt.status, "finished");
    const refused = assessmentAction(
      f.state,
      "answer",
      { runId, taskId, patch: null },
      () => now + 31000,
    );
    assert.equal(refused.accepted, false);
    assert.equal(refused.result.percent, 20);
    assert.deepEqual(
      assessmentAction(f.state, "finish", { runId }, () => now + 40000),
      receipt,
    );
  } finally {
    f.cleanup();
  }
});
test("coordination drafts merge protocol by protocol and score by the value they achieve", () => {
  const f = fixture(),
    now = Date.now();
  try {
    const { runId } = startAssessment(f.state, {}, now);
    const task = bank.tasks.find((t) => t.id === "medium-5"),
      { protocols } = optimalProtocols(task.answer.coordination.table);
    const answer = (patch, tick) =>
      assessmentAction(
        f.state,
        "answer",
        { runId, taskId: task.id, patch },
        () => now + tick,
      );
    // Nested patches merge: B's broadcast rules arrive after the rest.
    const { B, ...broadcast } = protocols.broadcast;
    answer({ ...protocols, broadcast }, 1);
    answer({ broadcast: { B } }, 2);
    const receipt = assessmentAction(f.state, "finish", { runId }, () => now + 3);
    const scored = receipt.result.tasks.find((t) => t.id === task.id);
    assert.equal(scored.percent, 100);
    assert.equal(scored.submissionStatus, "scored_json");
    assert.deepEqual(scored.stages.coordination, {
      correct: 6,
      total: 6,
      percent: 100,
    });
    assert.equal(receipt.result.percent, 20);
  } finally {
    f.cleanup();
  }
});
test("exact deadline and processing that crosses it reject new work, freezing the old answer", () => {
  const f = fixture(),
    now = Date.now();
  try {
    const start = startAssessment(f.state, {}, now),
      runId = start.runId,
      taskId = start.tasks[0].id;
    let ticks = [now + 119999, now + 120000];
    const result = assessmentAction(
      f.state,
      "answer",
      { runId, taskId, patch: flatten(bank.tasks.find((t) => t.id === taskId).answer) },
      () => ticks.shift(),
    );
    assert.equal(result.accepted, false);
    assert.equal(result.status, "expired");
    assert.equal(result.result.percent, 0);
    assert.equal(result.clock.elapsedSeconds, 120);
    const record = JSON.parse(fs.readFileSync(assessmentPath(f.state, runId)));
    assert.deepEqual(record.drafts, {});
  } finally {
    f.cleanup();
  }
});
test("history separates invocation, difficulty, package and task versions, and suppresses failed scores", () => {
  const f = fixture(),
    now = Date.now();
  try {
    const a = startAssessment(
      f.state,
      {
        invocation: "cli",
        agent: "codex",
        provider: "openai",
        model: "m1",
        effort: "medium",
        difficulty: "hard",
        seconds: 300,
      },
      now,
    );
    assessmentAction(f.state, "finish", { runId: a.runId }, () => now + 10);
    const b = startAssessment(
      f.state,
      {
        invocation: "skill",
        agent: "other",
        provider: "other",
        model: "m1",
        effort: "high",
      },
      now + 20,
    );
    assessmentAction(f.state, "finish", { runId: b.runId }, () => now + 30);
    annotateAssessment(f.state, a.runId, { failure: "Transport failed" });
    const all = listHistory(f.root).runs;
    assert.equal(all.length, 2);
    assert.equal(all.find((x) => x.runId === a.runId).percent, null);
    const filtered = listHistory(f.root, {
      invocation: "skill",
      effort: "high",
      model: "m1",
      taskBankVersion: String(TASK_BANK_VERSION),
      appVersion: b.appVersion,
    }).runs;
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].runId, b.runId);
    assert.ok(!JSON.stringify(all).includes("drafts"));
    assert.ok(!JSON.stringify(all).includes("synthetic-assessment"));
    // Current pointer changes do not erase history from prior banks.
    fs.writeFileSync(
      path.join(f.root, "current.json"),
      JSON.stringify({ baselineId: randomUUID() }),
    );
    assert.equal(listHistory(f.root).runs.length, 2);
  } finally {
    f.cleanup();
  }
});
test("frozen bank integrity is checked and invalid levels cannot create an assessment", () => {
  const f = fixture();
  try {
    assert.throws(
      () => startAssessment(f.state, { difficulty: "normal" }),
      /difficulty/,
    );
    for (const seconds of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      assert.throws(
        () => startAssessment(f.state, { seconds }),
        /positive whole number/,
      );
    assert.equal(fs.existsSync(path.join(f.state.base, "assessments")), false);
    const start = startAssessment(f.state);
    const changed = structuredClone(bank);
    changed.tasks[0].answer = { knowledge: { wrong: true } };
    fs.writeFileSync(
      path.join(f.state.base, "task-bank.json"),
      JSON.stringify(changed),
    );
    assert.throws(
      () => assessmentAction(f.state, "finish", { runId: start.runId }),
      /bank changed/,
    );
  } finally {
    f.cleanup();
  }
});
test("public CLI supports stdin answers and filterable history without installing a skill", () => {
  const f = fixture(),
    bin = fileURLToPath(new URL("../bin/am-i-nerfed.js", import.meta.url));
  const run = (args, input) =>
    spawnSync(process.execPath, [bin, ...args], {
      env: { ...process.env, AM_I_NERFED_HOME: f.root },
      input,
      encoding: "utf8",
    });
  try {
    const started = run([
      "start",
      "--invocation",
      "skill",
      "--model",
      "test-model",
      "--effort",
      "high",
    ]);
    assert.equal(started.status, 0, started.stderr);
    const start = JSON.parse(started.stdout);
    const args = ["answer", "--run", start.runId, "--task", start.tasks[0]];
    const invalid = run([...args, "--json", "{"]);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    assert.equal(run(args, '{"knowledge":{"partial":true}}').status, 0);
    assert.equal(run(["finish", "--run", start.runId]).status, 0);
    const listed = run([
      "history",
      "list",
      "--json",
      "--model",
      "test-model",
      "--effort",
      "high",
      "--invocation",
      "skill",
    ]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).runs.length, 1);
    assert.equal(run(["start", "--invocation", "cli"]).status, 1);
  } finally {
    f.cleanup();
  }
});

test("history materializes expired skill runs and reports their frozen scores", () => {
  const f = fixture();
  try {
    const start = startAssessment(
      f.state,
      { invocation: "skill" },
      Date.now() - 180000,
    );
    const row = listHistory(f.root).runs[0];
    assert.equal(row.runId, start.runId);
    assert.equal(row.status, "expired");
    assert.equal(row.percent, 0);
    assert.equal(row.elapsedSeconds, 120);
    assert.equal(row.clockEnforcement, "answer-deadline");
  } finally {
    f.cleanup();
  }
});

test("arbitrary whole-second budgets retain their exact deadline and history identity", () => {
  const f = fixture(),
    now = Date.now();
  try {
    for (const seconds of [1, 60, 200, 777, 3000000]) {
      const start = startAssessment(
        f.state,
        { seconds, invocation: "skill" },
        now,
      );
      assert.equal(start.clock.durationSeconds, seconds);
      assert.equal(Date.parse(start.clock.deadlineAt) - now, seconds * 1000);
      const runId = start.runId,
        taskId = start.tasks[0].id;
      const answer = flatten(bank.tasks.find((t) => t.id === taskId).answer);
      assert.equal(
        assessmentAction(
          f.state,
          "answer",
          { runId, taskId, patch: answer },
          () => now + seconds * 1000 - 1,
        ).accepted,
        true,
      );
      const late = assessmentAction(
        f.state,
        "answer",
        { runId, taskId, patch: null },
        () => now + seconds * 1000,
      );
      assert.equal(late.accepted, false);
      assert.equal(late.result.percent, 20);
      assert.equal(late.clock.elapsedSeconds, seconds);
      assert.equal(
        listHistory(f.root, { durationSeconds: seconds }).runs.length,
        1,
      );
    }
  } finally {
    f.cleanup();
  }
});

test("starting a run upgrades an older bank only when its answers regenerate identically", () => {
  const legacy = structuredClone(bank);
  legacy.taskBankVersion = 1;
  for (const task of legacy.tasks) {
    delete task.types;
    delete task.response;
    task.prompt = `Am I nerfed: ${task.difficulty}\n\n${task.prompt}`;
  }
  const f = fixture(),
    file = path.join(f.state.base, "task-bank.json");
  try {
    fs.writeFileSync(file, JSON.stringify(legacy));
    const start = startAssessment(f.state, { difficulty: "easy" });
    assert.equal(start.taskBankVersion, TASK_BANK_VERSION);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), bank);
    legacy.tasks[0].answer.knowledge.hats.A = "not-a-color";
    fs.writeFileSync(file, JSON.stringify(legacy));
    assert.throws(() => startAssessment(f.state, {}), /reset/);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).taskBankVersion, 1);
  } finally {
    f.cleanup();
  }
});

test("history destroy deletes every run, keeps the bank, and requires --yes on the CLI", () => {
  const f = fixture(),
    bin = fileURLToPath(new URL("../bin/am-i-nerfed.js", import.meta.url));
  const cli = (...args) =>
    spawnSync(process.execPath, [bin, ...args], {
      env: { ...process.env, AM_I_NERFED_HOME: f.root },
      encoding: "utf8",
    });
  try {
    startAssessment(f.state, {});
    startAssessment(f.state, { difficulty: "easy" });
    assert.equal(listHistory(f.root).runs.length, 2);
    const refused = cli("history", "destroy");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--yes/);
    assert.equal(listHistory(f.root).runs.length, 2);
    const destroyed = cli("history", "destroy", "--yes");
    assert.equal(destroyed.status, 0, destroyed.stderr);
    assert.deepEqual(JSON.parse(destroyed.stdout), { deleted: 2 });
    assert.equal(listHistory(f.root).runs.length, 0);
    assert.ok(fs.existsSync(path.join(f.state.base, "task-bank.json")));
    assert.equal(startAssessment(f.state, {}).tasks.length, 5);
    assert.deepEqual(destroyHistory(path.join(f.root, "missing")), { deleted: 0 });
  } finally {
    f.cleanup();
  }
});
