import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { generateExamBank } from "../src/exam-bank.js";
import { generateCompact } from "../src/compact.js";
import { grade } from "../src/grading.js";

// Independent oracle enumerates every reachable action table, rather than
// using the production conflict graph or any production rational optimizer.
function reference(prompt) {
  const rows = [
    ...prompt.matchAll(/^([012]{3}) \| ([123]) \| ([ABC]) \| ([ABC])$/gm),
  ].map(([, bits, weight, first, second]) => ({
    bits: [...bits].map(Number),
    weight: Number(weight),
    qualified: ["ABC".indexOf(first), "ABC".indexOf(second)],
  }));
  assert.equal(rows.length, 18);
  assert.equal(new Set(rows.map((row) => row.bits.join(""))).size, 18);
  for (const actor of [0, 1, 2])
    assert.equal(new Set(rows.map((row) => row.bits[actor])).size, 3);
  function score(actions) {
    const counts = [0, 0];
    for (const row of rows) {
      const dispatches = actions(row.bits);
      if (dispatches.reduce((s, v) => s + v, 0) !== 1) continue;
      const actor = dispatches.indexOf(1);
      for (let mode = 0; mode < 2; mode++)
        if (actor === row.qualified[mode]) counts[mode] += row.weight;
    }
    return counts;
  }
  const policies = [];
  for (let a = 0; a < 8; a++)
    for (let b = 0; b < 8; b++)
      for (let c = 0; c < 8; c++)
        policies.push(
          score(([x, y, z]) => [(a >> x) & 1, (b >> y) & 1, (c >> z) & 1]),
        );
  const robust = (pairs) =>
    pairs.reduce((best, [x, y]) => Math.max(best, Math.min(x, y)), 0);
  const base = robust(policies);
  let numerator = base,
    denominator = 1;
  // A two-dimensional convex hull meets the equal-payoff line on an edge;
  // enumerate all edges between actual complete policies, including endpoints.
  for (const [x1, y1] of policies)
    for (const [x2, y2] of policies) {
      let d = x1 - y1 - (x2 - y2),
        p = y2 - x2;
      if (d < 0) [d, p] = [-d, -p];
      if (!d || p < 0 || p > d) continue;
      const n = x2 * d + p * (x1 - x2);
      if (n * denominator > numerator * d) [numerator, denominator] = [n, d];
    }
  let x = numerator,
    y = denominator;
  while (y) [x, y] = [y, x % y];
  const mixed = `${numerator / x}/${denominator / x}`;
  const sequential = [];
  for (let a = 0; a < 8; a++)
    for (let b = 0; b < 64; b++)
      for (let c = 0; c < 64; c++)
        sequential.push(
          score(([x, y, z]) => {
            const first = (a >> x) & 1;
            return [
              first,
              (b >> (2 * y + first)) & 1,
              (c >> (2 * z + first)) & 1,
            ];
          }),
        );
  const communicated = [];
  for (let message = 0; message < 8; message++)
    for (let a = 0; a < 8; a++)
      for (let b = 0; b < 64; b++)
        for (let c = 0; c < 64; c++)
          communicated.push(
            score(([x, y, z]) => {
              const signal = (message >> x) & 1;
              return [
                (a >> x) & 1,
                (b >> (2 * y + signal)) & 1,
                (c >> (2 * z + signal)) & 1,
              ];
            }),
          );
  return {
    coordination: {
      base: `${base}/1`,
      mixed,
      mode_1: `${Math.max(...policies.map(([first]) => first))}/1`,
      mode_2: `${Math.max(...policies.map(([, second]) => second))}/1`,
      binding: `${robust(sequential)}/1`,
      broadcast: `${robust(communicated)}/1`,
    },
  };
}

test("exam bank freezes four deterministic, domain-separated questions", () => {
  const seed = "synthetic-exam-contract";
  const first = generateExamBank(seed);
  assert.deepEqual(first, generateExamBank(seed));
  assert.equal(first.generatorVersion, 2);
  // Synthetic public-question hashes captured before the v2 q4 change.
  assert.deepEqual(
    first.questions.slice(0, 3).map((q) => q.promptHash),
    [
      "9b7061c1c39f83a588fcb6b2764e63b4bbbfe2bb625cdefb513476916f02a3c1",
      "d772b7e23760971e0cdec6c727e9cf1725c91c74ec03622417860ed497c8e1c7",
      "a5be56b62f6a9768ebcea276be4b31bcedbb52ad3d915f243f8c56fec708c1d2",
    ],
  );
  assert.deepEqual(
    first.questions.map((q) => q.id),
    ["q1", "q2", "q3", "q4"],
  );
  assert.deepEqual(
    first.questions.map((q) => q.difficulty),
    ["easy", "normal", "normal", "hard"],
  );
  assert.notEqual(first.questions[1].promptHash, first.questions[2].promptHash);
  const derive = (label) =>
    createHmac("sha256", seed)
      .update(`am-i-nerfed/exam-bank/v1/${label}`)
      .digest("hex");
  for (const [index, label, difficulty] of [
    [0, "q1", "easy"],
    [1, "q2", "normal"],
  ]) {
    const independentlyGenerated = generateCompact(derive(label), difficulty);
    assert.ok(
      first.questions[index].prompt.startsWith(
        independentlyGenerated.prompt.trimEnd(),
      ),
    );
    assert.deepEqual(
      first.questions[index].answer,
      independentlyGenerated.answer,
    );
  }
  const fresh = generateExamBank("synthetic-exam-new-baseline");
  assert.notDeepEqual(
    first.questions.map((q) => q.promptHash),
    fresh.questions.map((q) => q.promptHash),
  );
  for (const q of first.questions) {
    assert.equal(
      q.promptHash,
      createHash("sha256").update(q.prompt).digest("hex"),
    );
    assert.equal(q.prompt.includes(seed), false);
    assert.ok(q.prompt.includes("Exam transport rule:"));
    assert.ok(q.prompt.includes("not exam retrieval or saves"));
    assert.equal(grade(q.answer, q.answer).percent, 100);
  }
});

test("compact hard maxima match complete policy enumeration for independent synthetic banks", () => {
  const distinct = new Set();
  for (let i = 0; i < 6; i++) {
    const q = generateExamBank(`synthetic-exam-oracle-${i}`).questions[3];
    assert.ok(q.prompt.trim().split(/\s+/).length < 700);
    assert.deepEqual(q.answer, reference(q.prompt));
    assert.equal(Object.keys(q.answer.coordination).length, 6);
    assert.ok(
      Object.values(q.answer.coordination).every((v) =>
        /^\d+\/[1-9]\d*$/.test(v),
      ),
    );
    const questionOnly = q.prompt.split("\n\nExam transport rule:")[0];
    const schema = JSON.parse(
      questionOnly.slice(questionOnly.lastIndexOf("\n{\n")),
    );
    assert.deepEqual(
      Object.keys(schema.coordination),
      Object.keys(q.answer.coordination),
    );
    assert.ok(Object.values(schema.coordination).every((v) => v === null));
    distinct.add(q.promptHash);
  }
  assert.equal(distinct.size, 6);
});

test("distinct normal questions remain distinct across seed samples, with separate mutable objects", () => {
  for (let i = 0; i < 24; i++) {
    const bank = generateExamBank(`synthetic-exam-distinct-${i}`);
    assert.notEqual(bank.questions[1].prompt, bank.questions[2].prompt);
    assert.notEqual(bank.questions[1].answer, bank.questions[2].answer);
  }
  const first = generateExamBank("synthetic-exam-mutation");
  const original = first.questions[3].answer.coordination.base;
  first.questions[3].answer.coordination.base = "999/1";
  assert.equal(
    generateExamBank("synthetic-exam-mutation").questions[3].answer.coordination
      .base,
    original,
  );
});
