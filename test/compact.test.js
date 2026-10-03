import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateCompact } from "../src/compact.js";

// Independent oracle: binary accessibility relations updated by edge deletion.
// Parse only the public question; do not import its generator's model.
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
function parse(text) {
  text = text.trim();
  if (text.startsWith("NOT ")) return not(parse(text.slice(4)));
  const op = /^([KW])_([ABC])\((.*)\)$/.exec(text);
  if (op) {
    const agent = "ABC".indexOf(op[2]),
      child = parse(op[3]);
    return op[1] === "K" ? k(agent, child) : w(agent, child);
  }
  if (text === "F") return f;
  const bit = /^([abc]) = ([01])$/.exec(text);
  assert.ok(bit, `Unparseable formula: ${text}`);
  const b = atom("abc".indexOf(bit[1]));
  return bit[2] === "1" ? b : not(b);
}

function oracle(prompt, difficulty, variant = "main") {
  const simple = difficulty === "easy";
  const truthRows = new Set(
    /one of: ([01]{3}(?:, [01]{3})*)\./.exec(prompt)[1].split(", "),
  );
  const actualBits = tuple(
    prompt,
    simple
      ? /Actual bits \(a,b,c\): \(([01],[01],[01])\)/
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
      return { initial, event, bits, fact: truthRows.has(bits.join("")) };
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
  const reports = [
    ...prompt.matchAll(
      /^\d\. ([ABC]) answers the Boolean question (.+); only ([ABC]) hears/gm,
    ),
  ].map(([, s, p, l]) => ["ABC".indexOf(s), "ABC".indexOf(l), parse(p)]);
  assert.equal(reports.length, 2);
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
  const stageIndex = { physical: 0, "after reply 1": 1, final: 2 };
  const knowledge = { report1: replies[0], report2: replies[1] };
  for (const [, name, stage, formula] of prompt.matchAll(
    /^- (q\d+): (physical|after reply 1|final): (.+)\.$/gm,
  ))
    knowledge[name] = at(stageIndex[stage], parse(formula));
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
        expected.counterfactual = {};
        for (const [, variant, question] of generated.prompt.matchAll(
          /^- (public_event|public_reports|forget_A|no_swap): .*; answer (.+)\.$/gm,
        )) {
          const alt = oracle(generated.prompt, difficulty, variant),
            reply = /^reply ([12])$/.exec(question);
          expected.counterfactual[variant] = reply
            ? alt.replies[reply[1] - 1]
            : alt.at(2, parse(question.replace(/^final /, "")));
        }
      }
      assert.deepEqual(generated.answer, expected);
      const values = Object.values(generated.answer).flatMap(Object.values);
      assert.ok(values.every((value) => typeof value === "boolean"));
      assert.ok(values.some(Boolean) && values.some((value) => !value));
      answerVectors.add(JSON.stringify(generated.answer));
    }
    // Structure varies per seed, so answer keys rarely repeat.
    assert.ok(
      answerVectors.size >= 24,
      `Only ${answerVectors.size} distinct answer keys across 32 seeds`,
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
    assert.equal(first.generatorVersion, 2);
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
