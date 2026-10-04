import test from "node:test";
import assert from "node:assert/strict";
import { generate, gradeTask } from "../src/checkpoint-diagnosis.js";

const SEEDS = ["diagnosis-independent-a", "diagnosis-independent-b", "diagnosis-independent-c", "diagnosis-independent-d"];
const generated = SEEDS.map((seed) => generate(seed));
const privateTask = (item) => item.answer.checkpoint.task;

/** Read everything from the public statement. The verification algorithm
 * reconstructs hypotheses from each complete history and exhausts a bounded
 * decision tree; it does not use the production Clean/Spent transitions. */
function historyOracle(item) {
  const rows = [...item.prompt.matchAll(/^H\d+: ([01 ]+)$/gm)].map((m) => m[1].split(" ").map(Number));
  const costs = [...item.prompt.matchAll(/T\d+=(\d+)/g)].slice(0, 11).map((m) => Number(m[1]));
  const requirements = Array.from({ length: costs.length }, () => []);
  for (const [, next, prior] of item.prompt.matchAll(/T(\d+) after T(\d+)/g)) {
    requirements[Number(next) - 1].push(Number(prior) - 1);
  }
  const memo = new Map();
  const candidates = (readings) => rows.map((row, index) => ({
    name: `H${index + 1}`,
    distance: row.reduce((n, bit, j) => n + Number(readings[j] !== null && bit !== readings[j]), 0),
  })).filter(({ distance }) => distance <= 1);
  const legal = (readings) => costs.map((_, j) => j).filter((j) => readings[j] === null
    && requirements[j].every((prior) => readings[prior] !== null));
  const branch = (readings, j, bit) => readings.map((value, index) => index === j ? bit : value);
  const possible = (readings, budget) => {
    if (candidates(readings).length <= 1) return budget >= 0;
    if (budget < 1) return false;
    const key = JSON.stringify([readings, budget]);
    if (memo.has(key)) return memo.get(key);
    const result = legal(readings).some((j) => costs[j] <= budget && [0, 1]
      .every((bit) => possible(branch(readings, j, bit), budget - costs[j])));
    memo.set(key, result);
    return result;
  };
  const check = (prefix, expected, label) => {
    const readings = costs.map(() => null);
    for (const [test, bit] of prefix) {
      assert.ok(legal(readings).includes(test - 1), `${label} prefix is legal`);
      assert.ok(bit === 0 || bit === 1);
      readings[test - 1] = bit;
    }
    const remaining = candidates(readings);
    assert.ok(remaining.length > 1, `${label} remains nonterminal`);
    assert.deepEqual(expected.Clean, remaining.filter(({ distance }) => distance === 0).map(({ name }) => name));
    assert.deepEqual(expected.Spent, remaining.filter(({ distance }) => distance === 1).map(({ name }) => name));
    assert.deepEqual(expected.Legal, legal(readings).map((j) => `T${j + 1}`));
    assert.equal(possible(readings, expected.Cost), true, `${label} cost is feasible`);
    assert.equal(possible(readings, expected.Cost - 1), false, `${label} smaller cost is infeasible`);
    const first = legal(readings).filter((j) => costs[j] <= expected.Cost && [0, 1]
      .every((bit) => possible(branch(readings, j, bit), expected.Cost - costs[j])))
      .map((j) => `T${j + 1}`);
    assert.deepEqual(expected.FirstTests, first, `${label} every optimal first test`);
  };
  const simulate = (optimum) => {
    let maximumPaid = 0;
    for (let h = 0; h < rows.length; h++) for (let flipAt = -1; flipAt < costs.length; flipAt++) {
      let readings = costs.map(() => null), paid = 0, step = 0;
      while (candidates(readings).length > 1) {
        const j = legal(readings).find((index) => costs[index] <= optimum - paid && [0, 1]
          .every((bit) => possible(branch(readings, index, bit), optimum - paid - costs[index])));
        assert.ok(j !== undefined, "verified strategy always has an action within budget");
        readings = branch(readings, j, rows[h][j] ^ Number(step === flipAt));
        paid += costs[j];
        step++;
      }
      assert.deepEqual(candidates(readings).map(({ name }) => name), [`H${h + 1}`]);
      assert.ok(paid <= optimum);
      maximumPaid = Math.max(maximumPaid, paid);
    }
    assert.equal(maximumPaid, optimum, "an adversarial path attains the declared worst-case cost");
  };
  return { rows, costs, requirements, check, simulate, legal };
}

test("seeded diagnosis is reproducible, JSON portable, and changes its actual problem", () => {
  generated.forEach((item, index) => {
    assert.deepEqual(generate(SEEDS[index]), item);
    const copy = JSON.parse(JSON.stringify(item));
    assert.deepEqual(copy, item);
    assert.equal(gradeTask(privateTask(copy), privateTask(copy).solution).percent, 100);
  });
  for (let i = 1; i < generated.length; i++) {
    const before = privateTask(generated[i - 1]).metadata;
    const after = privateTask(generated[i]).metadata;
    for (const key of ["rows", "costs", "prerequisites"]) {
      assert.notDeepEqual(before.instance[key], after.instance[key], key);
    }
    assert.notDeepEqual(before.cases, after.cases);
    assert.notEqual(generated[i - 1].prompt, generated[i].prompt);
  }
});

test("fresh diagnosis tables have ten correctable codewords and acyclic test prerequisites", () => {
  for (let index = 0; index < 30; index++) {
    const item = generate(`diagnosis-structure-${index}`);
    const task = privateTask(item);
    const oracle = historyOracle(item);
    assert.equal(oracle.rows.length, 10);
    assert.equal(oracle.costs.length, 11);
    assert.ok(oracle.rows.every((row) => row.length === 11 && row.every((bit) => bit === 0 || bit === 1)));
    assert.ok(oracle.costs.every((cost) => Number.isSafeInteger(cost) && cost >= 1 && cost <= 5));
    let minimumDistance = Infinity;
    oracle.rows.forEach((row, i) => oracle.rows.slice(i + 1).forEach((other) => {
      minimumDistance = Math.min(minimumDistance, row.reduce((sum, bit, j) => sum + Number(bit !== other[j]), 0));
    }));
    assert.ok(minimumDistance >= 3);
    assert.equal(task.metadata.minimumPairwiseDistance, minimumDistance);
    const readings = oracle.costs.map(() => null);
    assert.equal(oracle.legal(readings).length, 3);
    for (let count = 0; count < 11; count++) {
      const legal = oracle.legal(readings);
      assert.ok(legal.length > 0, "every DAG prefix has an available next test");
      readings[legal[0]] = 0;
    }
    assert.ok(task.metadata.generationAttempts >= 1 && task.metadata.generationAttempts <= 32);
    assert.ok(task.metadata.bellmanStates > 0);
    assert.ok(task.answer.cost <= oracle.costs.reduce((a, b) => a + b));
  }
});

test("full-history budget search certifies every continuation, root optimum and all optimal first tests", () => {
  for (const [index, item] of generated.entries()) {
    const task = privateTask(item);
    const oracle = historyOracle(item);
    for (const { id, history } of task.metadata.cases) {
      oracle.check(history, Object.fromEntries(["Clean", "Spent", "Legal", "Cost", "FirstTests"]
        .map((suffix) => [suffix, task.answer[id + suffix]])), `${index}/${id}`);
    }
    oracle.check([], {
      Clean: oracle.rows.map((_, i) => `H${i + 1}`), Spent: [],
      Legal: oracle.legal(oracle.costs.map(() => null)).map((j) => `T${j + 1}`),
      Cost: task.answer.cost, FirstTests: task.answer.firstTests,
    }, `${index}/root`);
    oracle.simulate(task.answer.cost);
  }
});

test("continuations expose progressively harder, attainable states with one shared flip allowance", () => {
  for (const item of generated) {
    const task = privateTask(item);
    assert.equal(task.answer.aClean.length, 0);
    assert.ok(task.answer.aSpent.length >= 2 && task.answer.aSpent.length <= 4);
    assert.ok(task.answer.bClean.length > 0 && task.answer.bSpent.length > 0);
    assert.ok(task.answer.bClean.length + task.answer.bSpent.length >= 3);
    assert.ok(task.answer.aCost >= 2 && task.answer.aCost < task.answer.bCost);
    assert.ok(task.answer.bCost < task.answer.cCost);
    assert.ok(task.answer.cClean.length > 0 && task.answer.cSpent.length > 0);
    assert.equal(task.metadata.cases[2].history.length, 1);
    assert.ok(item.prompt.includes("Prefix costs are sunk"));
    assert.ok(item.prompt.includes("not a fresh flip allowance"));
    for (const { id, history } of task.metadata.cases) {
      const literal = `Case ${id}: ${history.map(([j, bit]) => `T${j}=${bit}`).join(", ")}.`;
      assert.ok(item.prompt.includes(literal));
    }
  }
});

test("public prompt/schema expose problems and scoring, while field answers and diagnostics stay private", () => {
  const item = generated[0], task = privateTask(item);
  const { answer, ...publicTask } = item;
  assert.deepEqual(Object.keys(publicTask), ["prompt", "types", "response"]);
  assert.deepEqual(Object.keys(answer), ["checkpoint"]);
  assert.equal(answer.checkpoint.version, 1);
  assert.equal(answer.checkpoint.family, "adversarial-diagnosis");
  assert.deepEqual(Object.keys(item.response), Object.keys(task.answer));
  assert.deepEqual(task.solution, task.answer);
  assert.equal(Object.keys(task.answer).length, 17);
  for (const term of ["\"solution\"", "\"metadata\"", "bellmanStates", "minimumPairwiseDistance", "diagnostics"]) {
    assert.ok(!JSON.stringify(publicTask).includes(term), term);
  }
  assert.ok(Object.values(item.response).every((value) => ["integer", "Test[]", "Hypothesis[]"].includes(value)));
});

test("diagnosis checkpoint weights preserve 18 foundations, 36 continuations and 46 final points", () => {
  for (const item of generated) {
    const task = privateTask(item);
    assert.equal(Object.values(task.metadata.weights).reduce((a, b) => a + b), 100);
    const correct = gradeTask(task, task.solution);
    assert.equal(correct.percent, 100);
    assert.equal(correct.fullyCorrect, true);
    assert.equal(correct.diagnostics.foundationPoints, 18);
    assert.equal(correct.diagnostics.continuationPoints, 36);
    assert.equal(correct.diagnostics.finalPoints, 46);
    assert.equal(correct.diagnostics.originalExactFieldsCorrect, 2);
    const { cost, firstTests, ...intermediate } = task.answer;
    assert.equal(gradeTask(task, intermediate).percent, 54);
    assert.equal(gradeTask(task, intermediate).fullyCorrect, false);
    assert.equal(gradeTask(task, { cost, firstTests }).percent, 46);
    assert.equal(gradeTask(task, { cost, firstTests }).fullyCorrect, true);
    assert.equal(gradeTask(task, { cost, firstTests }).diagnostics.allCheckpointsCorrect, false);
  }
});

test("sets accept any ordering but reject malformed, duplicate, sparse and extra entries", () => {
  const task = privateTask(generated[0]);
  for (const draft of [undefined, null, [], 23, "23", {}, { irrelevant: "yes" }, Object.create(task.answer)]) {
    assert.equal(gradeTask(task, draft).percent, 0);
    assert.equal(gradeTask(task, draft).submitted, false);
  }
  for (const value of [String(task.answer.cost), NaN, Infinity, true, task.answer.cost + 0.1]) {
    assert.equal(gradeTask(task, { cost: value }).percent, 0);
  }
  assert.equal(gradeTask(task, { cost: task.answer.cost, unknown: 100 }).percent, 26);
  for (const [field, expected] of Object.entries(task.answer).filter(([, value]) => Array.isArray(value))) {
    const weight = task.metadata.weights[field];
    assert.equal(gradeTask(task, { [field]: [...expected].reverse() }).percent, weight);
    const malformed = [[...expected, expected[0] ?? "H1"], [...expected, "T99"], "[]", null, 0, {}];
    if (expected.length) malformed.push(Array(expected.length), expected.slice(1));
    for (const value of malformed) {
      assert.equal(gradeTask(task, { [field]: value }).percent, 0, `${field} rejects ${JSON.stringify(value)}`);
    }
  }
});

test("independent checkpoint grading does not propagate a mistaken hypothesis set", () => {
  const task = privateTask(generated[0]);
  const result = gradeTask(task, { aClean: ["H1"], aCost: task.answer.aCost,
    firstTests: [...task.answer.firstTests].reverse() });
  assert.equal(result.percent, 26);
  assert.equal(result.diagnostics.fields.aClean, false);
  assert.equal(result.diagnostics.fields.aCost, true);
  assert.equal(result.diagnostics.fields.firstTests, true);
  assert.equal(result.fullyCorrect, false);
});
