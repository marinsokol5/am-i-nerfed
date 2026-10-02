import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { payloadHash, datasetHash, evaluateRun } from "../src/submission.js";
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-delivery-")),
    id = randomUUID(),
    baselineId = randomUUID();
  fs.mkdirSync(path.join(base, "runs"));
  const dataset = {
    generatorVersion: 1,
    prompt: "Synthetic isolated delivery case",
    answer: { knowledge: { known: true } },
  };
  const run = {
    id,
    baselineId,
    difficulty: "hard",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
  };
  const file = path.join(base, "runs", id + ".json");
  fs.writeFileSync(file, JSON.stringify(run));
  return {
    base,
    id,
    file,
    run,
    state: {
      base,
      current: { baselineId, runIds: { hard: randomUUID() } },
      dataset,
    },
  };
}
test("canonical payload digest preserves JSON types and arrays while ignoring object order", () => {
  assert.equal(
    payloadHash({ b: [1, true, null], a: { y: "x", x: 2 } }),
    payloadHash({ a: { x: 2, y: "x" }, b: [1, true, null] }),
  );
  for (const [a, b] of [
    [true, 1],
    [null, Infinity],
    ["number:1", 1],
    [
      [1, 2],
      [2, 1],
    ],
    ["1/2", "2/4"],
    [{}, []],
  ])
    assert.notEqual(payloadHash(a), payloadHash(b));
});
test("interrupted hashed claim accepts only the same answer and preserves its original submission time", () => {
  const f = fixture();
  try {
    const submission = { knowledge: { known: true } },
      claimedAt = "2026-01-01T00:01:00.000Z";
    const claim = {
      hashVersion: 1,
      payloadHash: payloadHash(submission),
      datasetHash: datasetHash(f.state.dataset, "hard"),
      claimedAt,
      label: "original label",
    };
    fs.writeFileSync(f.file + ".claim", JSON.stringify(claim));
    assert.throws(
      () => evaluateRun(f.state, f.id, { knowledge: { known: false } }),
      /different answer/,
    );
    assert.equal(JSON.parse(fs.readFileSync(f.file, "utf8")).status, "pending");
    const receipt = evaluateRun(f.state, f.id, submission, "later label");
    assert.equal(receipt.percent, 100);
    assert.equal(receipt.submittedAt, claimedAt);
    assert.equal(receipt.elapsedMs, 60000);
    const completed = JSON.parse(fs.readFileSync(f.file, "utf8"));
    assert.equal(completed.label, "original label");
    assert.deepEqual(completed.receipt, receipt);
    f.state.dataset.answer = {};
    assert.deepEqual(evaluateRun(f.state, f.id, submission), receipt);
  } finally {
    fs.rmSync(f.base, { recursive: true, force: true });
  }
});
test("interrupted grade refuses a changed frozen key and legacy claims stay consumed", () => {
  const f = fixture();
  try {
    const submission = { knowledge: { known: true } };
    fs.writeFileSync(
      f.file + ".claim",
      JSON.stringify({
        hashVersion: 1,
        payloadHash: payloadHash(submission),
        datasetHash: datasetHash(f.state.dataset, "hard"),
        claimedAt: new Date().toISOString(),
      }),
    );
    f.state.dataset.answer.knowledge.known = false;
    assert.throws(
      () => evaluateRun(f.state, f.id, submission),
      /frozen case changed/,
    );
    fs.writeFileSync(f.file + ".claim", "{}");
    assert.throws(() => evaluateRun(f.state, f.id, submission), /legacy run/);
    fs.unlinkSync(f.file + ".claim");
    fs.writeFileSync(
      f.file,
      JSON.stringify({
        ...f.run,
        status: "submitted",
        result: { percent: 100 },
      }),
    );
    assert.throws(() => evaluateRun(f.state, f.id, submission), /legacy run/);
  } finally {
    fs.rmSync(f.base, { recursive: true, force: true });
  }
});
