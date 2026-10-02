import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const executable = fileURLToPath(
  new URL("../bin/am-i-nerfed.js", import.meta.url),
);
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-test-")),
    state = path.join(directory, "state"),
    project = path.join(directory, "project"),
    baselineId = randomUUID();
  const base = path.join(state, "baselines", baselineId);
  fs.mkdirSync(path.join(base, "runs"), { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(state, "current.json"),
    JSON.stringify({ baselineId, runId: null }),
  );
  const answer = {
    reports: { row: 1 },
    checks: { digit: 2 },
    knowledge: { known: true },
    coordination: { base: "1/2" },
    counterfactual: { no_swap_base: "2/1" },
  };
  fs.writeFileSync(
    path.join(base, "dataset.json"),
    JSON.stringify({
      generatorVersion: 1,
      prompt: "Synthetic test question",
      answer,
      seed: "synthetic-only",
    }),
  );
  const env = { ...process.env, AM_I_NERFED_HOME: state };
  const call = (args, input) =>
    spawnSync(process.execPath, [executable, ...args], {
      env,
      cwd: project,
      input,
      encoding: "utf8",
    });
  return { directory, state, base, baselineId, answer, env, project, call };
}
test("question repeatability, input errors, partial grading, replay and claim recovery", () => {
  const f = fixture();
  try {
    const q = JSON.parse(f.call(["question", "--difficulty", "hard"]).stdout);
    assert.deepEqual(
      JSON.parse(f.call(["question", "--run", q.runId]).stdout),
      q,
    );
    assert.notEqual(f.call(["eval", "--run", q.runId], "{").status, 0);
    assert.equal(
      JSON.parse(f.call(["status", "--difficulty", "hard"]).stdout).currentRun
        .status,
      "pending",
    );
    const result = f.call(
      ["eval", "--run", q.runId],
      JSON.stringify({ knowledge: { known: true } }),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).percent, 25);
    assert.notEqual(f.call(["eval", "--run", q.runId], "{}").status, 0);
    const next = JSON.parse(
      f.call(["question", "--new", "--difficulty", "hard"]).stdout,
    );
    assert.notEqual(next.runId, q.runId);
    assert.equal(next.prompt, q.prompt);
    fs.writeFileSync(
      path.join(f.base, "runs", next.runId + ".json.claim"),
      "{}",
    );
    assert.equal(
      JSON.parse(f.call(["status", "--difficulty", "hard"]).stdout).currentRun
        .status,
      "consumed",
    );
    assert.equal(
      JSON.parse(f.call(["history"]).stdout).runs.at(-1).status,
      "consumed_without_result",
    );
    assert.notEqual(f.call(["eval", "--run", next.runId], "null").status, 0);
    assert.equal(
      f.call(["question", "--new", "--difficulty", "hard"]).status,
      0,
    );
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
test("concurrent identical deliveries share one immutable receipt", async () => {
  const f = fixture();
  try {
    for (const level of ["easy", "normal", "hard"]) {
      const q = JSON.parse(f.call(["question", "--difficulty", level]).stdout);
      const invoke = () =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [executable, "eval", "--run", q.runId],
            { cwd: f.project, env: f.env },
          );
          let out = "";
          child.stdout.on("data", (chunk) => (out += chunk));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, out }));
          child.stdin.end("null");
        });
      const results = await Promise.all(Array.from({ length: 8 }, invoke));
      assert.ok(results.filter((r) => r.code === 0).length >= 1);
      for (const result of results.filter((r) => r.code === 0))
        assert.equal(result.out, results.find((r) => r.code === 0).out);
      assert.equal(
        JSON.parse(results.find((r) => r.code === 0).out).percent,
        0,
      );
    }
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
test("private state rejects project-local or unrelated directories", () => {
  const f = fixture();
  try {
    const rejected = spawnSync(process.execPath, [executable, "status"], {
      cwd: f.project,
      env: { ...f.env, AM_I_NERFED_HOME: path.join(f.project, "secret") },
      encoding: "utf8",
    });
    assert.notEqual(rejected.status, 0);
    assert.equal(fs.existsSync(path.join(f.project, "secret")), false);
    fs.writeFileSync(path.join(f.state, "unrelated.txt"), "preserve");
    assert.notEqual(f.call(["status", "--difficulty", "hard"]).status, 0);
    assert.equal(
      fs.readFileSync(path.join(f.state, "unrelated.txt"), "utf8"),
      "preserve",
    );
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("legacy pending hard survives independent easy and default-normal runs without rewriting its dataset", () => {
  const f = fixture();
  try {
    const legacyId = randomUUID(),
      pointer = path.join(f.state, "current.json"),
      datasetPath = path.join(f.base, "dataset.json");
    const originalDataset = fs.readFileSync(datasetPath, "utf8");
    fs.writeFileSync(
      pointer,
      JSON.stringify({ baselineId: f.baselineId, runId: legacyId }),
    );
    fs.writeFileSync(
      path.join(f.base, "runs", legacyId + ".json"),
      JSON.stringify({
        id: legacyId,
        baselineId: f.baselineId,
        createdAt: new Date().toISOString(),
        status: "pending",
      }),
    );
    const normal = JSON.parse(f.call(["question"]).stdout),
      easy = JSON.parse(f.call(["question", "--difficulty", "easy"]).stdout),
      hard = JSON.parse(f.call(["question", "--run", legacyId]).stdout);
    assert.equal(normal.difficulty, "normal");
    assert.equal(easy.difficulty, "easy");
    assert.equal(hard.difficulty, "hard");
    assert.equal(hard.runId, legacyId);
    assert.equal(hard.prompt, "Synthetic test question");
    assert.notEqual(normal.prompt, hard.prompt);
    assert.notEqual(easy.prompt, normal.prompt);
    const current = JSON.parse(fs.readFileSync(pointer, "utf8"));
    assert.equal(current.runId, legacyId);
    assert.deepEqual(current.runIds, {
      hard: legacyId,
      normal: normal.runId,
      easy: easy.runId,
    });
    for (const q of [normal, easy, hard])
      assert.deepEqual(
        JSON.parse(f.call(["question", "--run", q.runId]).stdout),
        q,
      );
    const score = f.call(["eval", "--run", legacyId], JSON.stringify(f.answer));
    assert.equal(score.status, 0, score.stderr);
    assert.equal(JSON.parse(score.stdout).percent, 100);
    assert.equal(JSON.parse(score.stdout).difficulty, "hard");
    assert.ok(JSON.parse(score.stdout).elapsedMs >= 0);
    const status = JSON.parse(f.call(["status"]).stdout);
    assert.equal(status.difficulty, "normal");
    assert.equal(status.currentRun.id, normal.runId);
    assert.equal(status.currentRuns.easy.status, "pending");
    assert.equal(status.currentRuns.hard.status, "consumed");
    const history = JSON.parse(f.call(["history"]).stdout);
    assert.deepEqual(
      new Set(history.runs.map((r) => r.difficulty)),
      new Set(["hard", "normal", "easy"]),
    );
    assert.equal(
      JSON.stringify(history).includes("Synthetic test question"),
      false,
    );
    assert.equal(fs.readFileSync(datasetPath, "utf8"), originalDataset);
    assert.notEqual(f.call(["eval", "--run", legacyId], "null").status, 0);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("each difficulty grades its own frozen answer and consumes only its run", () => {
  const f = fixture();
  try {
    const questions = Object.fromEntries(
      ["easy", "normal", "hard"].map((level) => [
        level,
        JSON.parse(f.call(["question", "--difficulty", level]).stdout),
      ]),
    );
    for (const level of ["easy", "hard", "normal"]) {
      const file =
        level === "hard"
          ? path.join(f.base, "dataset.json")
          : path.join(f.base, "variants", level + ".json");
      const dataset = JSON.parse(fs.readFileSync(file, "utf8"));
      const result = f.call(
        ["eval", "--run", questions[level].runId],
        JSON.stringify(dataset.answer),
      );
      assert.equal(result.status, 0, result.stderr);
      const score = JSON.parse(result.stdout);
      assert.equal(score.difficulty, level);
      assert.equal(score.percent, 100);
      assert.equal(
        Object.keys(score.stages).length,
        level === "hard" ? 4 : level === "normal" ? 2 : 1,
      );
      assert.notEqual(
        f.call(["eval", "--run", questions[level].runId], "null").status,
        0,
      );
      const next = JSON.parse(
        f.call(["question", "--new", "--difficulty", level]).stdout,
      );
      assert.notEqual(next.runId, questions[level].runId);
      assert.equal(next.prompt, questions[level].prompt);
      const only = JSON.parse(
        f.call(["history", "--difficulty", level]).stdout,
      );
      assert.equal(only.runs.length, 2);
      assert.ok(only.runs.every((r) => r.difficulty === level));
    }
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("unknown difficulty never initializes state or changes existing run pointers", () => {
  const f = fixture();
  try {
    const pointer = path.join(f.state, "current.json"),
      before = fs.readFileSync(pointer, "utf8");
    for (const command of ["question", "status", "history"]) {
      const result = f.call([command, "--difficulty", "extreme"]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unknown difficulty/);
      assert.equal(fs.readFileSync(pointer, "utf8"), before);
    }
    assert.equal(fs.existsSync(path.join(f.base, "variants")), false);
    const missing = path.join(f.directory, "missing-state");
    const result = spawnSync(
      process.execPath,
      [executable, "question", "--difficulty", ""],
      {
        cwd: f.project,
        env: { ...f.env, AM_I_NERFED_HOME: missing },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(missing), false);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("same-difficulty chats own independent runs and can grade in reverse order", async () => {
  const f = fixture();
  try {
    const first = JSON.parse(
      f.call(["question", "--difficulty", "hard"]).stdout,
    );
    const second = JSON.parse(
      f.call(["question", "--difficulty", "hard"]).stdout,
    );
    const third = JSON.parse(
      f.call(["question", "--new", "--difficulty", "hard"]).stdout,
    );
    assert.equal(new Set([first.runId, second.runId, third.runId]).size, 3);
    assert.deepEqual(
      JSON.parse(f.call(["question", "--run", first.runId]).stdout),
      first,
    );
    const mismatch = f.call([
      "question",
      "--run",
      first.runId,
      "--difficulty",
      "easy",
    ]);
    assert.notEqual(mismatch.status, 0);
    for (const run of [third, second, first]) {
      const result = f.call(
        ["eval", "--run", run.runId],
        JSON.stringify(f.answer),
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).percent, 100);
      assert.equal(JSON.parse(result.stdout).runId, run.runId);
    }
    const history = JSON.parse(f.call(["history"]).stdout);
    assert.equal(history.runs.length, 3);
    assert.ok(history.runs.every((r) => r.status === "submitted"));
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("delivery retries normalize object order and return the stored receipt without regrading", () => {
  const f = fixture();
  try {
    const q = JSON.parse(f.call(["question", "--difficulty", "hard"]).stdout);
    const first = f.call(
      ["eval", "--run", q.runId, "--label", "first"],
      '{"knowledge":{"known":true},"checks":{"digit":2}}',
    );
    assert.equal(first.status, 0, first.stderr);
    const filename = path.join(f.base, "runs", q.runId + ".json"),
      saved = fs.readFileSync(filename, "utf8");
    const keyPath = path.join(f.base, "dataset.json"),
      key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    key.answer.knowledge.known = false;
    fs.writeFileSync(keyPath, JSON.stringify(key));
    const retry = f.call(
      ["eval", "--run", q.runId, "--label", "changed metadata"],
      '{ "checks" : { "digit":2 }, "knowledge" : { "known":true } }',
    );
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(retry.stdout, first.stdout);
    assert.equal(fs.readFileSync(filename, "utf8"), saved);
    const changed = f.call(
      ["eval", "--run", q.runId],
      '{"checks":{"digit":2},"knowledge":{"known":false}}',
    );
    assert.notEqual(changed.status, 0);
    assert.equal(changed.stdout, "");
    assert.match(changed.stderr, /different answer/);
    const claim = JSON.parse(fs.readFileSync(filename + ".claim", "utf8"));
    assert.match(claim.payloadHash, /^[a-f0-9]{64}$/);
    assert.equal(claim.submission, undefined);
    const history = f.call(["history"]).stdout;
    assert.equal(history.includes("payloadHash"), false);
    assert.equal(history.includes("datasetHash"), false);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("parallel grades for separate IDs remain independent and busy deliveries are retryable", async () => {
  const f = fixture();
  try {
    const ids = Array.from(
      { length: 4 },
      () =>
        JSON.parse(f.call(["question", "--difficulty", "hard"]).stdout).runId,
    );
    const deliveries = await Promise.all(
      ids.map(
        (id) =>
          new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [executable, "eval", "--run", id],
              { cwd: f.project, env: f.env },
            );
            let out = "",
              err = "";
            child.stdout.on("data", (c) => (out += c));
            child.stderr.on("data", (c) => (err += c));
            child.on("error", reject);
            child.on("close", (code) => resolve({ id, code, out, err }));
            child.stdin.end(JSON.stringify(f.answer));
          }),
      ),
    );
    for (const delivery of deliveries) {
      const result =
        delivery.code === 0
          ? { status: 0, stdout: delivery.out }
          : f.call(["eval", "--run", delivery.id], JSON.stringify(f.answer));
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).runId, delivery.id);
      assert.equal(JSON.parse(result.stdout).percent, 100);
    }
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("reset baseline and unknown IDs fail without silently replacing the requested run", () => {
  const f = fixture();
  try {
    const q = JSON.parse(f.call(["question", "--difficulty", "hard"]).stdout);
    const replacement = randomUUID(),
      newBase = path.join(f.state, "baselines", replacement);
    fs.mkdirSync(path.join(newBase, "runs"), { recursive: true });
    fs.copyFileSync(
      path.join(f.base, "dataset.json"),
      path.join(newBase, "dataset.json"),
    );
    fs.writeFileSync(
      path.join(f.state, "current.json"),
      JSON.stringify({ baselineId: replacement, runId: null, runIds: {} }),
    );
    const before = fs.readFileSync(path.join(f.state, "current.json"), "utf8");
    for (const args of [
      ["question", "--run", q.runId],
      ["eval", "--run", q.runId],
      ["question", "--run", randomUUID()],
    ]) {
      const result = f.call(args, "null");
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /not found on the current baseline/);
    }
    assert.equal(
      fs.readFileSync(path.join(f.state, "current.json"), "utf8"),
      before,
    );
    assert.equal(fs.readdirSync(path.join(newBase, "runs")).length, 0);
  } finally {
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
