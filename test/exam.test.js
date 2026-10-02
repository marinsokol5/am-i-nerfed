import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { examAction, mergeDraft, EXAM_DURATION_MS } from "../src/exam.js";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-exam-"));
  const baselineId = randomUUID(),
    root = path.join(directory, "state"),
    base = path.join(root, "baselines", baselineId),
    project = path.join(directory, "project");
  fs.mkdirSync(path.join(base, "runs"), { recursive: true });
  fs.mkdirSync(project);
  const dataset = {
    generatorVersion: 1,
    prompt: "Unchanged legacy hard case",
    answer: { knowledge: { legacy: true } },
    seed: "synthetic-exam-tests",
  };
  fs.writeFileSync(path.join(base, "dataset.json"), JSON.stringify(dataset));
  fs.writeFileSync(
    path.join(root, "current.json"),
    JSON.stringify({ baselineId, runId: null, runIds: {} }),
  );
  const state = { base, current: { baselineId }, dataset };
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const call = (action, options = {}) =>
    examAction(state, action, options, () => now);
  return {
    directory,
    root,
    base,
    project,
    state,
    call,
    setTime: (value) => (now = value),
    now: () => now,
    bank: () =>
      JSON.parse(fs.readFileSync(path.join(base, "exam-bank.json"), "utf8")),
    file: (id) => path.join(base, "exams", id + ".json"),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
function noGrade(response) {
  for (const key of [
    "answer",
    "result",
    "percent",
    "stages",
    "correct",
    "bankHash",
  ])
    assert.equal(Object.hasOwn(response, key), false, key);
}
test("exam starts independent sessions on one immutable bank with a fixed 300-second clock", () => {
  const f = fixture();
  try {
    const first = f.call("start"),
      bankBytes = fs.readFileSync(path.join(f.base, "exam-bank.json"), "utf8");
    f.setTime(f.now() + 12000);
    const second = f.call("start");
    assert.notEqual(first.examId, second.examId);
    assert.equal(first.examBankHash, second.examBankHash);
    assert.deepEqual(first.questions, second.questions);
    assert.deepEqual(
      first.questions.map((q) => q.difficulty),
      ["easy", "normal", "normal", "hard"],
    );
    assert.equal(first.clock.remainingSeconds, 300);
    assert.equal(second.clock.elapsedSeconds, 0);
    assert.equal(
      Date.parse(first.clock.deadlineAt) - Date.parse(first.clock.startedAt),
      EXAM_DURATION_MS,
    );
    assert.equal(
      fs.readFileSync(path.join(f.base, "exam-bank.json"), "utf8"),
      bankBytes,
    );
    noGrade(first);
    noGrade(second);
    const q = f.call("question", { examId: first.examId, questionId: "q1" });
    assert.equal(q.clock.elapsedSeconds, 12);
    assert.equal(q.clock.remainingSeconds, 288);
    assert.equal(q.draft, null);
    noGrade(q);
    f.call("save", {
      examId: first.examId,
      questionId: "q1",
      patch: { knowledge: { a: true } },
    });
    assert.equal(
      f.call("question", { examId: second.examId, questionId: "q1" }).draft,
      null,
    );
    assert.equal(fs.statSync(f.file(first.examId)).mode & 0o777, 0o600);
  } finally {
    f.cleanup();
  }
});
test("partial drafts merge safely, explicit null clears, arrays replace, and open feedback is ungraded", () => {
  const f = fixture();
  try {
    const { examId } = f.call("start");
    const first = f.call("save", {
      examId,
      questionId: "q1",
      patch: { knowledge: { a: true, b: false }, rows: [1, 2] },
    });
    noGrade(first);
    assert.equal(first.accepted, true);
    const patch = JSON.parse(
      '{"knowledge":{"b":null,"c":true},"rows":[3],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
    );
    const saved = f.call("save", { examId, questionId: "q1", patch });
    noGrade(saved);
    assert.equal({}.polluted, undefined);
    const q = f.call("question", { examId, questionId: "q1" });
    assert.deepEqual(q.draft.knowledge, { a: true, b: null, c: true });
    assert.deepEqual(q.draft.rows, [3]);
    assert.equal(Object.hasOwn(q.draft, "__proto__"), true);
    assert.equal({}.polluted, undefined);
    const status = f.call("status", { examId });
    noGrade(status);
    assert.equal(status.questions[0].saved, true);
    assert.ok(status.questions[0].filledFields > 0);
    f.call("save", { examId, questionId: "q1", patch: null });
    assert.equal(f.call("question", { examId, questionId: "q1" }).draft, null);
    assert.deepEqual(mergeDraft({ a: 1, b: 2 }, { a: 0 }), { a: 0, b: 2 });
  } finally {
    f.cleanup();
  }
});
test("finish awards equal question weights, freezes drafts and returns an immutable receipt", () => {
  const f = fixture();
  try {
    const { examId } = f.call("start"),
      bank = f.bank();
    f.call("save", {
      examId,
      questionId: "q1",
      patch: bank.questions[0].answer,
    });
    f.setTime(f.now() + 30000);
    const receipt = f.call("finish", { examId });
    assert.equal(receipt.result.percent, 25);
    assert.equal(receipt.result.questionWeightPercent, 25);
    assert.deepEqual(
      receipt.result.questions.map((q) => q.percent),
      [100, 0, 0, 0],
    );
    assert.equal(receipt.status, "finished");
    assert.equal(receipt.clock.elapsedSeconds, 30);
    assert.equal(receipt.clock.remainingSeconds, 0);
    const bytes = fs.readFileSync(f.file(examId), "utf8");
    f.setTime(f.now() + 600000);
    assert.deepEqual(f.call("finish", { examId }), receipt);
    assert.deepEqual(f.call("status", { examId }), receipt);
    const late = f.call("save", {
      examId,
      questionId: "q2",
      patch: bank.questions[1].answer,
    });
    assert.equal(late.accepted, false);
    assert.equal(fs.readFileSync(f.file(examId), "utf8"), bytes);
  } finally {
    f.cleanup();
  }
});
test("deadline is inclusive: exact-boundary saves cannot change the answers being graded", () => {
  const f = fixture();
  try {
    const start = f.call("start"),
      examId = start.examId,
      deadline = Date.parse(start.clock.deadlineAt),
      bank = f.bank();
    f.setTime(deadline - 1);
    const saved = f.call("save", {
      examId,
      questionId: "q1",
      patch: bank.questions[0].answer,
    });
    assert.equal(saved.accepted, true);
    assert.equal(saved.clock.remainingSeconds, 1);
    f.setTime(deadline);
    const rejected = f.call("save", {
      examId,
      questionId: "q2",
      patch: bank.questions[1].answer,
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.status, "expired");
    assert.equal(rejected.result.percent, 25);
    assert.equal(rejected.clock.elapsedSeconds, 300);
    assert.equal(rejected.clock.remainingSeconds, 0);
    const record = JSON.parse(fs.readFileSync(f.file(examId), "utf8"));
    assert.equal(Object.hasOwn(record.drafts, "q2"), false);
    assert.equal(rejected.finishedAt, start.clock.deadlineAt);
  } finally {
    f.cleanup();
  }
});
test("deadline is checked again after merging and expired reads finalize only previously saved work", () => {
  const f = fixture();
  try {
    const start = f.call("start"),
      examId = start.examId,
      deadline = Date.parse(start.clock.deadlineAt);
    let ticks = [deadline - 1, deadline];
    const response = examAction(
      f.state,
      "save",
      { examId, questionId: "q1", patch: f.bank().questions[0].answer },
      () => ticks.shift(),
    );
    assert.equal(response.accepted, false);
    assert.equal(response.result.percent, 0);
    const second = f.call("start");
    f.setTime(Date.parse(second.clock.deadlineAt) + 10000);
    const expired = f.call("question", {
      examId: second.examId,
      questionId: "q1",
    });
    assert.equal(expired.status, "expired");
    assert.equal(expired.result.percent, 0);
    assert.equal(Object.hasOwn(expired, "prompt"), false);
  } finally {
    f.cleanup();
  }
});
test("exam CLI preserves JSON errors, emits time feedback, and rejects expired saves with a final receipt", () => {
  const f = fixture();
  try {
    const bin = fileURLToPath(
      new URL("../bin/am-i-nerfed.js", import.meta.url),
    );
    const run = (args, input) =>
      spawnSync(process.execPath, [bin, "exam", ...args], {
        cwd: f.project,
        env: { ...process.env, AM_I_NERFED_HOME: f.root },
        input,
        encoding: "utf8",
      });
    const start = run(["start"]);
    assert.equal(start.status, 0, start.stderr);
    const examId = JSON.parse(start.stdout).examId;
    const invalid = run([
      "save",
      "--exam",
      examId,
      "--question",
      "q1",
      "--json",
      "{",
    ]);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, "");
    const saved = run(
      ["save", "--exam", examId, "--question", "q1"],
      '{"knowledge":{"a":true}}',
    );
    assert.equal(saved.status, 0, saved.stderr);
    assert.equal(JSON.parse(saved.stdout).accepted, true);
    assert.ok(JSON.parse(saved.stdout).clock.remainingSeconds <= 300);
    noGrade(JSON.parse(saved.stdout));
    const record = JSON.parse(fs.readFileSync(f.file(examId), "utf8"));
    record.deadlineAt = new Date(Date.now() - 1).toISOString();
    fs.writeFileSync(f.file(examId), JSON.stringify(record));
    const late = run([
      "save",
      "--exam",
      examId,
      "--question",
      "q1",
      "--json",
      "null",
    ]);
    assert.equal(late.status, 1);
    const result = JSON.parse(late.stdout);
    assert.equal(result.status, "expired");
    assert.equal(result.accepted, false);
    assert.ok(result.result);
    const done = run(["finish", "--exam", examId]);
    assert.equal(done.status, 0);
    assert.deepEqual(JSON.parse(done.stdout).result, result.result);
    assert.notEqual(run(["status", "--exam", randomUUID()]).status, 0);
  } finally {
    f.cleanup();
  }
});

test("two-minute sessions persist their own deadline and cannot extend it", () => {
  const f = fixture();
  try {
    const short = f.call("start", { durationSeconds: 120 }),
      long = f.call("start"),
      deadline = Date.parse(short.clock.deadlineAt);
    assert.equal(short.clock.durationSeconds, 120);
    assert.equal(short.clock.remainingSeconds, 120);
    assert.equal(long.clock.durationSeconds, 300);
    assert.equal(short.examBankHash, long.examBankHash);
    assert.equal(deadline - Date.parse(short.clock.startedAt), 120000);
    assert.equal(
      JSON.parse(fs.readFileSync(f.file(short.examId), "utf8")).durationSeconds,
      120,
    );
    f.setTime(deadline - 1);
    const accepted = f.call("save", {
      examId: short.examId,
      questionId: "q1",
      patch: f.bank().questions[0].answer,
    });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.clock.remainingSeconds, 1);
    assert.equal(accepted.clock.elapsedSeconds, 119);
    const bytes = fs.readFileSync(f.file(short.examId), "utf8");
    for (const action of ["question", "save", "status", "finish"])
      assert.throws(
        () =>
          f.call(action, {
            examId: short.examId,
            questionId: "q1",
            patch: null,
            durationSeconds: 300,
          }),
        /only be selected at start/,
      );
    assert.equal(fs.readFileSync(f.file(short.examId), "utf8"), bytes);
    f.setTime(deadline);
    const late = f.call("save", {
      examId: short.examId,
      questionId: "q2",
      patch: f.bank().questions[1].answer,
    });
    assert.equal(late.accepted, false);
    assert.equal(late.result.percent, 25);
    assert.equal(late.clock.durationSeconds, 120);
    assert.equal(late.clock.elapsedSeconds, 120);
    assert.equal(late.clock.remainingSeconds, 0);
    const ongoing = f.call("status", { examId: long.examId });
    assert.equal(ongoing.status, "active");
    assert.equal(ongoing.clock.remainingSeconds, 180);
    f.setTime(deadline + 500000);
    assert.deepEqual(
      f.call("finish", { examId: short.examId }),
      f.call("status", { examId: short.examId }),
    );
    assert.equal(
      f.call("status", { examId: short.examId }).clock.elapsedSeconds,
      120,
    );
  } finally {
    f.cleanup();
  }
});

test("legacy duration defaults to300 and short early-finish receipts stay immutable", () => {
  const f = fixture();
  try {
    const legacy = f.call("start");
    const record = JSON.parse(fs.readFileSync(f.file(legacy.examId), "utf8"));
    delete record.durationSeconds;
    fs.writeFileSync(f.file(legacy.examId), JSON.stringify(record));
    const short = f.call("start", { durationSeconds: 120 });
    f.setTime(f.now() + 15000);
    assert.equal(
      f.call("status", { examId: legacy.examId }).clock.durationSeconds,
      300,
    );
    const receipt = f.call("finish", { examId: short.examId });
    assert.equal(receipt.clock.elapsedSeconds, 15);
    assert.equal(receipt.clock.durationSeconds, 120);
    f.setTime(f.now() + 999000);
    assert.deepEqual(f.call("finish", { examId: short.examId }), receipt);
    assert.equal(
      f.call("status", { examId: legacy.examId }).clock.elapsedSeconds,
      300,
    );
  } finally {
    f.cleanup();
  }
});

test("exam CLI accepts only start-time120 or300 and rejects invalid durations before state changes", () => {
  const f = fixture();
  try {
    const bin = fileURLToPath(
      new URL("../bin/am-i-nerfed.js", import.meta.url),
    );
    const run = (args) =>
      spawnSync(process.execPath, [bin, "exam", ...args], {
        cwd: f.project,
        env: { ...process.env, AM_I_NERFED_HOME: f.root },
        encoding: "utf8",
      });
    for (const value of ["0", "60", "121", "120.0", "1e2", "-120", "NaN"]) {
      const invalid = run(["start", "--seconds", value]);
      assert.notEqual(invalid.status, 0);
      assert.equal(fs.existsSync(path.join(f.base, "exam-bank.json")), false);
    }
    const started = run(["start", "--seconds", "120"]);
    assert.equal(started.status, 0, started.stderr);
    const exam = JSON.parse(started.stdout);
    assert.equal(exam.clock.durationSeconds, 120);
    const before = fs.readFileSync(f.file(exam.examId), "utf8");
    for (const action of ["question", "save", "status", "finish"]) {
      const invalid = run([action, "--exam", exam.examId, "--seconds", "300"]);
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, /Unknown option/);
    }
    assert.equal(fs.readFileSync(f.file(exam.examId), "utf8"), before);
    const defaultExam = JSON.parse(run(["start"]).stdout);
    assert.equal(defaultExam.clock.durationSeconds, 300);
  } finally {
    f.cleanup();
  }
});
