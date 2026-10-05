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
  hash,
  TASK_BANK_VERSION,
} from "../src/task-bank.js";
import {
  startAssessment,
  assessmentAction,
  assessmentPath,
  listHistory,
  annotateAssessment,
  destroyHistory,
  initializationStatus,
} from "../src/assessment.js";
import { optimalProtocols } from "./protocol-oracle.js";
import { generateCompact } from "../src/compact.js";
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
test("six-task run preserves partial work, grades equally and permanently closes on early finish", () => {
  const f = fixture(),
    now = Date.now();
  try {
    const start = startAssessment(
      f.state,
      { invocation: "skill", model: "known-model", effort: "high" },
      now,
    );
    assert.equal(start.tasks.length, 6);
    assert.equal(start.difficulty, "medium");
    assert.equal(start.clock.remainingSeconds, 180);
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
    assert.equal(receipt.result.percent, 100 / 6);
    assert.equal(receipt.clock.elapsedSeconds, 30);
    assert.equal(receipt.status, "finished");
    const refused = assessmentAction(
      f.state,
      "answer",
      { runId, taskId, patch: null },
      () => now + 31000,
    );
    assert.equal(refused.accepted, false);
    assert.equal(refused.result.percent, 100 / 6);
    assert.deepEqual(
      assessmentAction(f.state, "finish", { runId }, () => now + 40000),
      receipt,
    );
  } finally {
    f.cleanup();
  }
});
test("six hard tasks share equal weight and the sixth task supports the full lifecycle", () => {
  const f = fixture(), now = Date.now();
  try {
    const start = startAssessment(f.state, { difficulty: "hard", seconds: 300 }, now);
    assert.deepEqual(start.tasks.map(({ id }) => id),
      ["hard-1", "hard-2", "hard-3", "hard-4", "hard-5", "hard-6"]);
    const runId = start.runId;
    const all = assessmentAction(f.state, "questions", { runId }, () => now + 1);
    assert.equal(all.questions.length, 6);
    const sixth = assessmentAction(f.state, "question", { runId, taskId: "hard-6" }, () => now + 2);
    assert.equal(typeof sixth.task, "string");
    assert.deepEqual(sixth.submitted, {});
    const saved = assessmentAction(f.state, "answer", {
      runId, taskId: "hard-6", patch: null,
    }, () => now + 3);
    assert.equal(saved.accepted, true);
    assert.equal(saved.result, undefined);
    assessmentAction(f.state, "answer", {
      runId, taskId: "hard-1", patch: flatten(bank.tasks.find(t => t.id === "hard-1").answer),
    }, () => now + 4);
    const receipt = assessmentAction(f.state, "finish", { runId }, () => now + 5);
    assert.equal(receipt.result.tasks.length, 6);
    assert.equal(receipt.result.taskWeightPercent, 100 / 6);
    assert.equal(receipt.result.tasks[0].percent, 100);
    assert.equal(receipt.result.tasks[5].percent, 0);
    assert.equal(receipt.result.percent, 100 / 6);
    assert.equal(assessmentAction(f.state, "answer", {
      runId, taskId: "hard-6", patch: {},
    }, () => now + 6).accepted, false);
  } finally {
    f.cleanup();
  }
});
test("easy and medium sixth tasks support partial credit, revision, and equal task weighting", () => {
  for (const difficulty of ["easy", "medium"]) {
    const f = fixture(), now = Date.now();
    try {
      const { runId, tasks } = startAssessment(f.state, { difficulty }, now);
      const taskId = `${difficulty}-6`, task = bank.tasks.find(t => t.id === taskId);
      assert.equal(tasks.length, 6);
      assert.equal(task.family, "reversible-synthesis");
      const question = assessmentAction(f.state, "question", { runId, taskId }, () => now + 1);
      assert.deepEqual(question.response, { program: "Program" });
      assert.deepEqual(question.submitted, {});
      const solution = flatten(task.answer);
      const saved = assessmentAction(f.state, "answer", {
        runId, taskId, patch: { program: solution.program + "BB" },
      }, () => now + 2);
      assert.equal(saved.accepted, true);
      assert.equal(saved.result, undefined);
      const receipt = assessmentAction(f.state, "finish", { runId }, () => now + 3);
      assert.equal(receipt.result.tasks[5].percent, 70);
      assert.equal(receipt.result.percent, 70 / 6);
      assert.equal(receipt.result.taskWeightPercent, 100 / 6);
      assert.equal(receipt.result.tasks[5].originalGoalComplete, false);

      const revised = startAssessment(f.state, { difficulty }, now);
      assessmentAction(f.state, "answer", { runId: revised.runId, taskId, patch: { program: "A" } }, () => now + 1);
      assessmentAction(f.state, "answer", { runId: revised.runId, taskId, patch: solution }, () => now + 2);
      const full = assessmentAction(f.state, "finish", { runId: revised.runId }, () => now + 3);
      assert.equal(full.result.tasks[5].percent, 100);
      assert.equal(full.result.tasks[5].originalGoalComplete, true);
      assert.equal(full.result.percent, 100 / 6);
    } finally { f.cleanup(); }
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
    assert.equal(receipt.result.percent, 100 / 6);
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
    let ticks = [now + 179999, now + 180000];
    const result = assessmentAction(
      f.state,
      "answer",
      { runId, taskId, patch: flatten(bank.tasks.find((t) => t.id === taskId).answer) },
      () => ticks.shift(),
    );
    assert.equal(result.accepted, false);
    assert.equal(result.status, "expired");
    assert.equal(result.result.percent, 0);
    assert.equal(result.clock.elapsedSeconds, 180);
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
      Date.now() - 240000,
    );
    const row = listHistory(f.root).runs[0];
    assert.equal(row.runId, start.runId);
    assert.equal(row.status, "expired");
    assert.equal(row.percent, 0);
    assert.equal(row.elapsedSeconds, 180);
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
      assert.equal(late.result.percent, 100 / 6);
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

for (const version of [8, 12]) test(`version ${version} banks retain their five-task easy/medium assessments without a silent expansion`, () => {
  const legacy = structuredClone(bank);
  legacy.taskBankVersion = version;
  legacy.tasks = legacy.tasks.filter(t => !["easy-6", "medium-6", ...(version < 9 ? ["hard-6"] : [])].includes(t.id));
  const f = fixture(),
    file = path.join(f.state.base, "task-bank.json"), now = Date.now();
  try {
    // Model a run created before its easy/medium tier was expanded.
    const start = startAssessment(f.state, { difficulty: "medium" }, now);
    const runFile = assessmentPath(f.state, start.runId);
    const record = JSON.parse(fs.readFileSync(runFile));
    record.taskBankVersion = version;
    record.privateBankHash = hash(legacy);
    record.publicBankHash = hash({ version, tasks: legacy.tasks.map(({ id, promptHash, difficulty, family }) =>
      ({ id, promptHash, difficulty, family })) });
    record.tasks = legacy.tasks.filter(t => t.difficulty === "medium").map(({ id, family, promptHash }) => ({ id, family, promptHash }));
    fs.writeFileSync(runFile, JSON.stringify(record));
    fs.writeFileSync(file, JSON.stringify(legacy));
    const before = fs.readFileSync(file, "utf8"), runBefore = fs.readFileSync(runFile, "utf8");
    assert.deepEqual(initializationStatus(f.root), {
      initialized: true, baselineId: f.state.current.baselineId,
      taskBankVersion: version, tasks: version < 9 ? 15 : 16,
    });
    assert.throws(() => startAssessment(f.state, {}), /changed its puzzles.*reset.*history is kept/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(fs.readFileSync(runFile, "utf8"), runBefore);
    const taskId = start.tasks[0].id;
    assessmentAction(f.state, "answer", {
      runId: start.runId, taskId,
      patch: flatten(legacy.tasks.find(t => t.id === taskId).answer),
    }, () => now + 1);
    const receipt = assessmentAction(f.state, "finish", { runId: start.runId }, () => now + 2);
    assert.equal(receipt.taskBankVersion, version);
    assert.equal(receipt.result.tasks.length, 5);
    assert.equal(receipt.result.taskWeightPercent, 20);
    assert.equal(receipt.result.percent, 20);
    assert.equal(listHistory(f.root).runs[0].percent, 20);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  } finally {
    f.cleanup();
  }
});

test("frozen bank task counts must match the bank version and difficulty", () => {
  const f = fixture(), file = path.join(f.state.base, "task-bank.json");
  try {
    const variants = [
      { ...bank, tasks: bank.tasks.filter(t => t.id !== "hard-6") },
      { ...bank, taskBankVersion: 8 },
      { ...bank, taskBankVersion: 12 },
      { ...bank, tasks: bank.tasks.filter(t => t.id !== "easy-6") },
      { ...bank, tasks: bank.tasks.filter(t => t.id !== "medium-6") },
      { ...bank, tasks: bank.tasks.map(t => t.id === "hard-6" ? { ...t, difficulty: "medium" } : t) },
    ];
    for (const invalid of variants) {
      fs.writeFileSync(file, JSON.stringify(invalid));
      assert.throws(() => startAssessment(f.state, {}), /Invalid frozen task bank/);
      assert.equal(initializationStatus(f.root).initialized, false);
    }
  } finally {
    f.cleanup();
  }
});

test("version 9 hard knowledge remains scoreable and its frozen bank is not silently replaced", () => {
  const legacy=structuredClone(bank);
  legacy.taskBankVersion=9;
  legacy.tasks=legacy.tasks.filter(t=>!["easy-6","medium-6"].includes(t.id));
  const knowledge=legacy.tasks.find(t=>t.difficulty==="hard"&&t.family==="knowledge");
  const scenarios=["A","B"].map(name=>generateCompact(`synthetic-v9-knowledge-${name}`,"deep"));
  knowledge.answer={knowledge:{scenarioA:flatten(scenarios[0].answer),scenarioB:flatten(scenarios[1].answer)}};
  knowledge.prompt=`SCENARIO A\n${scenarios[0].prompt}\nSCENARIO B\n${scenarios[1].prompt}`;
  knowledge.types={};
  knowledge.response=Object.fromEntries(Object.entries(knowledge.answer.knowledge).map(([name,fields])=>[name,Object.fromEntries(Object.keys(fields).map(key=>[key,"boolean"]))]));
  knowledge.promptHash=hash({prompt:knowledge.prompt,types:knowledge.types,response:knowledge.response});
  const f=fixture(),now=Date.now(),file=path.join(f.state.base,"task-bank.json");
  try {
    const start=startAssessment(f.state,{difficulty:"hard",seconds:300},now);
    const runFile=assessmentPath(f.state,start.runId),record=JSON.parse(fs.readFileSync(runFile));
    record.taskBankVersion=9;
    record.privateBankHash=hash(legacy);
    record.publicBankHash=hash({version:9,tasks:legacy.tasks.map(({id,promptHash,difficulty,family})=>({id,promptHash,difficulty,family}))});
    record.tasks=legacy.tasks.filter(t=>t.difficulty==="hard").map(({id,family,promptHash})=>({id,family,promptHash}));
    fs.writeFileSync(runFile,JSON.stringify(record));
    fs.writeFileSync(file,JSON.stringify(legacy));
    const before=fs.readFileSync(file,"utf8");
    assert.equal(initializationStatus(f.root).taskBankVersion,9);
    assert.equal(initializationStatus(f.root).tasks,16);
    assert.throws(()=>startAssessment(f.state,{difficulty:"hard"}),/changed its puzzles.*reset.*history is kept/);
    assert.equal(fs.readFileSync(file,"utf8"),before);
    assessmentAction(f.state,"answer",{runId:start.runId,taskId:knowledge.id,patch:flatten(knowledge.answer)},()=>now+1);
    const receipt=assessmentAction(f.state,"finish",{runId:start.runId},()=>now+2);
    assert.equal(receipt.taskBankVersion,9);
    assert.equal(receipt.result.tasks.length,6);
    assert.equal(receipt.result.tasks.find(t=>t.id===knowledge.id).percent,100);
    assert.equal(receipt.result.percent,100/6);
    assert.equal(fs.readFileSync(file,"utf8"),before);
  } finally {f.cleanup();}
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
    assert.equal(startAssessment(f.state, {}).tasks.length, 6);
    assert.deepEqual(destroyHistory(path.join(f.root, "missing")), { deleted: 0 });
  } finally {
    f.cleanup();
  }
});
