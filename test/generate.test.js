import test from "node:test";
import assert from "node:assert/strict";
import { randomSource } from "../src/random.js";
import { generateReports } from "../src/reports.js";
import { generate, variantSeed } from "../src/generate.js";
import { grade } from "../src/grading.js";
test("secret deterministically produces new, unambiguous report data", () => {
  const a = generateReports(randomSource("synthetic-seed-one"));
  assert.deepEqual(a, generateReports(randomSource("synthetic-seed-one")));
  const b = generateReports(randomSource("synthetic-seed-two"));
  assert.notDeepEqual(a.reports, b.reports);
  assert.notEqual(a.archives, b.archives);
  for (const value of Object.values(a.checks))
    assert.ok(Number.isInteger(value) && value >= 0 && value < 8);
});
test("full private case has all stages and a self-consistent deterministic baseline", () => {
  const a = generate("synthetic-full-case"),
    b = generate("synthetic-full-case");
  assert.deepEqual(a, b);
  assert.equal(grade(a.answer, a.answer).percent, 100);
  assert.equal(a.prompt.includes("@@"), false);
  assert.equal(a.prompt.includes("September orders:"), true);
  assert.equal(Object.keys(a.answer.knowledge).length, 10);
  assert.equal(Object.keys(a.answer.coordination).length, 10);
  assert.equal(Object.keys(a.answer.counterfactual).length, 8);
});

test("difficulty streams are domain-separated and compact baselines deterministic", () => {
  const seed = "synthetic-difficulty-seed";
  assert.equal(variantSeed(seed, "hard"), seed);
  assert.notEqual(variantSeed(seed, "easy"), variantSeed(seed, "normal"));
  assert.notEqual(variantSeed(seed, "normal"), seed);
  for (const level of ["easy", "normal"]) {
    const first = generate(seed, level),
      second = generate(seed, level);
    assert.deepEqual(first, second);
    assert.equal(first.difficulty, level);
    assert.equal(grade(first.answer, first.answer).percent, 100);
    assert.notEqual(
      first.promptHash,
      generate(seed + "-different", level).promptHash,
    );
  }
  assert.notEqual(
    generate(seed, "easy").promptHash,
    generate(seed, "normal").promptHash,
  );
  assert.throws(() => generate(seed, "unknown"), /Unknown difficulty/);
});
