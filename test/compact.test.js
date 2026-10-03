import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateCompact } from "../src/compact.js";

// Independent oracle: binary accessibility relations updated by edge deletion.
// Parse only the public question; do not import its generator's epistemic engine.
const atom = (i) => ["bit", i];
const k = (a, p) => ["K", a, p];
const not = (p) => ["!", p];
const or = (p, q) => ["|", p, q];
const w = (a, p) => or(k(a, p), k(a, not(p)));
const f = ["F"];
const triples = Array.from({ length: 8 }, (_, i) => [
  i >> 2,
  (i >> 1) & 1,
  i & 1,
]);
const tuple = (prompt, pattern) => {
  const match = prompt.match(pattern);
  assert.ok(match, `Missing public parameters: ${pattern}`);
  return match[1].split(",").map(Number);
};

function oracle(prompt, difficulty, variant = "main") {
  const simple = difficulty === "easy";
  const gates = tuple(
    prompt,
    simple
      ? /Target bits: \(([01],[01],[01])\)/
      : /Gates \(x,y,z\): \(([01],[01],[01])\)/,
  );
  const actualBits = tuple(
    prompt,
    simple
      ? /Actual initial bits \(a,b,c\): \(([01],[01],[01])\)/
      : /Actual initial bits \(a0,b0,c0\): \(([01],[01],[01])\)/,
  );
  const actualEvent =
    simple || variant === "no_swap"
      ? 0
      : Number(prompt.match(/actual event e=([012])/)[1]);
  const worlds = triples.flatMap((initial) =>
    (simple || variant === "no_swap" ? [0] : [0, 1, 2]).map((event) => {
      const permutation = [0, 1, 2];
      if (event)
        [permutation[0], permutation[event]] = [
          permutation[event],
          permutation[0],
        ];
      const bits = permutation.map((i) => initial[i]);
      const fact = simple
        ? (bits[0] === gates[0] && bits[1] === gates[1]) || bits[2] === gates[2]
        : bits[0] !== gates[0] &&
          Boolean(bits[1] ^ gates[1] ^ (Number(event === 2) & gates[2]));
      return { initial, event, bits, fact };
    }),
  );
  const actual = worlds.findIndex(
    (world) =>
      world.event === actualEvent &&
      world.initial.every((bit, i) => bit === actualBits[i]),
  );
  let relation = [0, 1, 2].map((a) =>
    worlds.map((x) =>
      worlds.map(
        (y) =>
          (a === 0 && variant === "forget_A") || x.initial[a] === y.initial[a],
      ),
    ),
  );
  function evaluate(formula, index, relations) {
    const [op, a, p] = formula;
    if (op === "F") return worlds[index].fact;
    if (op === "bit") return Boolean(worlds[index].bits[a]);
    if (op === "!") return !evaluate(a, index, relations);
    if (op === "|")
      return evaluate(a, index, relations) || evaluate(p, index, relations);
    if (op === "K")
      return worlds.every(
        (_, j) => !relations[a][index][j] || evaluate(p, j, relations),
      );
    throw Error("Bad reference formula");
  }
  if (!simple)
    relation = relation.map((rows, a) =>
      rows.map((row, i) =>
        row.map(
          (edge, j) =>
            edge &&
            (a !== 0 || worlds[i].bits[0] === worlds[j].bits[0]) &&
            ((a !== 1 && variant !== "public_event") ||
              worlds[i].event === worlds[j].event),
        ),
      ),
    );
  const stages = [structuredClone(relation)];
  const replies = [];
  const reports = simple
    ? [
        [2, 0, w(2, f)],
        [0, 1, w(0, f)],
      ]
    : [
        [1, 2, k(1, not(w(0, f)))],
        [0, 2, w(0, f)],
      ];
  for (const [speaker, listener, formula] of reports) {
    const values = worlds.map((_, i) => evaluate(formula, i, relation));
    for (let i = 0; i < worlds.length; i++)
      for (let j = 0; j < worlds.length; j++)
        if (relation[speaker][i][j])
          assert.equal(
            values[i],
            values[j],
            "Speaker cannot distinguish their own reply",
          );
    replies.push(values[actual]);
    relation = relation.map((rows, a) =>
      rows.map((row, i) =>
        row.map(
          (edge, j) =>
            edge &&
            ((variant !== "public_reports" &&
              a !== speaker &&
              a !== listener) ||
              values[i] === values[j]),
        ),
      ),
    );
    stages.push(structuredClone(relation));
  }
  const at = (stage, formula) => evaluate(formula, actual, stages[stage]);
  const knowledge = simple
    ? {
        report_C: replies[0],
        report_A: replies[1],
        after_C_A_knows_F: at(1, k(0, f)),
        final_B_knows_F: at(2, k(1, f)),
        final_B_decides_F: at(2, w(1, f)),
        final_C_knows_A_decides_F: at(2, k(2, w(0, f))),
        final_A_knows_NOT_F: at(2, k(0, not(f))),
        final_B_knows_a_is_1: at(2, k(1, atom(0))),
      }
    : {
        report_B: replies[0],
        report_A: replies[1],
        physical_A_knows_F: at(0, k(0, f)),
        physical_B_knows_current_B: at(0, w(1, atom(1))),
        after_B_A_decides_C_decides_B_knows_current_B: at(
          1,
          w(0, w(2, k(1, atom(1)))),
        ),
        after_B_C_knows_whether_A_decides_F: at(1, w(2, w(0, f))),
        after_B_C_knows_A_ignorant: at(1, k(2, not(w(0, f)))),
        final_C_knows_whether_F: at(2, w(2, f)),
        final_C_knows_whether_B_decides_F: at(2, w(2, w(1, f))),
        after_B_B_knows_A_decides_C_knows_current_C: at(
          1,
          k(1, w(0, k(2, atom(2)))),
        ),
      };
  return { knowledge, replies, at, worldCount: worlds.length };
}

for (const difficulty of ["easy", "normal"]) {
  test(`${difficulty}: public question independently determines every scored answer`, () => {
    const answerVectors = new Set();
    for (let i = 0; i < 32; i++) {
      const generated = generateCompact(
        `synthetic-relational-${i}`,
        difficulty,
      );
      const reference = oracle(generated.prompt, difficulty);
      assert.equal(reference.worldCount, difficulty === "easy" ? 8 : 24);
      const expected = { knowledge: reference.knowledge };
      if (difficulty === "normal") {
        expected.counterfactual = {
          public_event_C_knows_current_C: oracle(
            generated.prompt,
            difficulty,
            "public_event",
          ).at(2, w(2, atom(2))),
          public_reports_C_decides_B_decides_F: oracle(
            generated.prompt,
            difficulty,
            "public_reports",
          ).at(2, w(2, w(1, f))),
          forget_A_report_A: oracle(generated.prompt, difficulty, "forget_A")
            .replies[1],
          no_swap_report_B: oracle(generated.prompt, difficulty, "no_swap")
            .replies[0],
        };
      }
      assert.deepEqual(generated.answer, expected);
      const values = Object.values(generated.answer).flatMap(Object.values);
      assert.ok(values.every((value) => typeof value === "boolean"));
      assert.ok(values.some(Boolean) && values.some((value) => !value));
      answerVectors.add(JSON.stringify(generated.answer));
    }
    assert.ok(
      answerVectors.size >= 3,
      "Seed variation must not collapse to one answer key",
    );
  });

  test(`${difficulty}: deterministic, compact, without an embedded answer schema`, () => {
    const first = generateCompact(
      `synthetic-contract-${difficulty}`,
      difficulty,
    );
    assert.deepEqual(
      first,
      generateCompact(`synthetic-contract-${difficulty}`, difficulty),
    );
    assert.notEqual(
      first.promptHash,
      generateCompact(`synthetic-other-${difficulty}`, difficulty).promptHash,
    );
    assert.equal(first.generatorVersion, 1);
    assert.equal(first.difficulty, difficulty);
    assert.equal(
      first.promptHash,
      createHash("sha256").update(first.prompt).digest("hex"),
    );
    assert.ok(
      first.prompt.trim().split(/\s+/).length <
        (difficulty === "easy" ? 500 : 1000),
    );
    assert.equal(first.prompt.includes("synthetic-contract"), false);
    // The response shape is presented separately from the task text.
    assert.equal(first.prompt.includes("{"), false);
    assert.equal(first.prompt.includes("null"), false);
    assert.deepEqual(
      Object.keys(first.answer),
      difficulty === "easy" ? ["knowledge"] : ["knowledge", "counterfactual"],
    );
    assert.equal(
      Object.keys(first.answer.knowledge).length,
      difficulty === "easy" ? 8 : 10,
    );
    if (difficulty === "normal")
      assert.equal(Object.keys(first.answer.counterfactual).length, 4);
  });
}

test("compact generator rejects unsupported difficulties instead of silently changing the test", () => {
  for (const difficulty of [undefined, "hard", "Easy", "medium", ""])
    assert.throws(
      () => generateCompact("synthetic-invalid", difficulty),
      /difficulty/,
    );
});
