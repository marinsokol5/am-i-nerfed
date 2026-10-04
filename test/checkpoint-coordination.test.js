import test from "node:test";
import assert from "node:assert/strict";
import { generate, gradeTask } from "../src/checkpoint-coordination.js";

const SEEDS = [
  "coordination-unseen-alpha",
  "coordination-unseen-beta",
  "coordination-unseen-gamma",
];
const generated = new Map();
const specimen = (seed = SEEDS[0]) => {
  if (!generated.has(seed)) generated.set(seed, generate(seed));
  return generated.get(seed);
};
const taskOf = (value) => value.answer.checkpoint.task;
const fraction = (value) => {
  if (typeof value === "number") return value;
  const [numerator, denominator = "1"] = value.split("/");
  return Number(numerator) / Number(denominator);
};
const checkpoint = (result, id) => result.checkpoints.find((item) => item.id === id);
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} !== ${expected}`);

// Read exactly what a participant sees; no production scoring or generator
// metadata is used in the independent reference below.
function publicRows(prompt) {
  return [...prompt.matchAll(/^([012]{3}) \| (\d+) \| ([ABC]) ([ABC]) ([ABC])$/gm)]
    .map((match) => ({
      observations: [...match[1]].map(Number),
      weight: Number(match[2]),
      qualified: match.slice(3).map((agent) => "ABC".indexOf(agent)),
    }));
}

function evaluate(rows, policy) {
  const totals = [0, 0, 0];
  for (const row of rows) {
    const decisions = row.observations.map((symbol, agent) =>
      Number(policy[3 * agent + symbol]),
    );
    if (decisions.reduce((sum, value) => sum + value, 0) !== 1) continue;
    const dispatcher = decisions.indexOf(1);
    for (let mode = 0; mode < 3; mode++)
      if (dispatcher === row.qualified[mode]) totals[mode] += row.weight;
  }
  return totals;
}

function exhaustiveScores(rows) {
  return Array.from({ length: 512 }, (_, number) => {
    const policy = number.toString(2).padStart(9, "0");
    return { policy, point: evaluate(rows, policy) };
  });
}

// Independent floating point primal LP oracle: enumerate supports of size
// one, two and three. A two-policy optimum occurs at an endpoint or where
// two mode expectations cross; a genuinely three-policy optimum equalizes
// all three expectations. Production solves an exact rational dual LP.
function primalOptima(points) {
  const unique = [...new Map(points.map((point) => [point.join(","), point])).values()];
  const frontier = unique.filter((point) => !unique.some((other) =>
    other !== point && other.every((value, index) => value >= point[index]),
  ));
  let pair = Math.max(...frontier.map((point) => Math.min(...point)));
  for (let i = 0; i < frontier.length; i++) {
    for (let j = i + 1; j < frontier.length; j++) {
      const a = frontier[i], b = frontier[j];
      for (let left = 0; left < 3; left++) for (let right = left + 1; right < 3; right++) {
        const divisor = a[left] - b[left] - a[right] + b[right];
        if (!divisor) continue;
        const probability = (b[right] - b[left]) / divisor;
        if (probability < 0 || probability > 1) continue;
        pair = Math.max(pair, Math.min(...a.map((value, mode) =>
          probability * value + (1 - probability) * b[mode],
        )));
      }
    }
  }
  let mixed = pair;
  for (let i = 0; i < frontier.length; i++) {
    for (let j = i + 1; j < frontier.length; j++) {
      for (let k = j + 1; k < frontier.length; k++) {
        const [a, b, c] = [frontier[i], frontier[j], frontier[k]];
        const matrix = [0, 1].map((mode) => [
          a[mode] - a[2] - c[mode] + c[2],
          b[mode] - b[2] - c[mode] + c[2],
        ]);
        const rhs = [c[2] - c[0], c[2] - c[1]];
        const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
        if (!determinant) continue;
        const x = (rhs[0] * matrix[1][1] - matrix[0][1] * rhs[1]) / determinant;
        const y = (matrix[0][0] * rhs[1] - rhs[0] * matrix[1][0]) / determinant;
        const z = 1 - x - y;
        if (Math.min(x, y, z) < -1e-10) continue;
        mixed = Math.max(mixed, Math.min(...a.map((value, mode) =>
          x * value + y * b[mode] + z * c[mode],
        )));
      }
    }
  }
  return { pair, mixed };
}

test("seeded three-mode generation is reproducible and changes the actual table", () => {
  const first = specimen();
  assert.deepEqual(generate(SEEDS[0]), first);
  assert.equal(first.answer.checkpoint.version, 1);
  assert.equal(first.answer.checkpoint.family, "coordination-three-mode");
  const tables = SEEDS.map((seed) => {
    const result = specimen(seed), task = taskOf(result);
    assert.equal(result.prompt, task.task);
    const rows = publicRows(result.prompt);
    assert.equal(rows.length, 18);
    assert.equal(new Set(rows.map((row) => row.observations.join(""))).size, 18);
    assert.ok(rows.every((row) => Number.isSafeInteger(row.weight) && row.weight > 0));
    return JSON.stringify(rows);
  });
  assert.equal(new Set(tables).size, SEEDS.length);
});

test("independent public-table enumeration verifies seeded pure and mixed optima", () => {
  for (const seed of SEEDS) {
    const task = taskOf(specimen(seed)), rows = publicRows(task.task);
    const enumerated = exhaustiveScores(rows), points = enumerated.map(({ point }) => point);
    assert.equal(task.answer.pure, Math.max(...points.map((point) => Math.min(...point))), seed);
    const reference = primalOptima(points);
    close(fraction(task.answer.mixed), reference.mixed, seed);
    assert.ok(reference.mixed > task.answer.pure, "Randomization must improve the pure optimum");
    assert.equal(task.metadata.threePoliciesRequired, reference.mixed > reference.pair + 1e-8);
    close(fraction(task.metadata.bestTwoPolicyMixture), reference.pair, "best two-policy value");
    const constant = enumerated.filter(({ policy }) => [0, 3, 6].every((offset) =>
      policy[offset] === policy[offset + 1] && policy[offset] === policy[offset + 2],
    ));
    assert.ok(reference.mixed > primalOptima(constant.map(({ point }) => point)).mixed + 1e-8);
  }
});

test("saved full-credit witnesses have matching independently evaluated certificates", () => {
  for (const seed of SEEDS) {
    const task = taskOf(specimen(seed)), solution = task.solution;
    const rows = publicRows(task.task), all = exhaustiveScores(rows);
    assert.deepEqual(evaluate(rows, solution.policy), solution.scores);
    assert.equal(Math.min(...solution.scores), task.answer.pure);
    const expectations = [0, 0, 0];
    let mass = 0;
    for (const [policy, probability] of solution.mixture) {
      const weight = fraction(probability);
      assert.ok(weight >= 0);
      mass += weight;
      evaluate(rows, policy).forEach((value, mode) => { expectations[mode] += weight * value; });
    }
    close(mass, 1, "primal probability mass");
    close(Math.min(...expectations), fraction(task.answer.mixed), "primal value");
    const dual = solution.dual.map(fraction);
    assert.ok(dual.every((weight) => weight >= 0));
    close(dual.reduce((sum, weight) => sum + weight, 0), 1, "dual probability mass");
    const upper = Math.max(...all.map(({ point }) => point.reduce((sum, value, mode) => sum + value * dual[mode], 0)));
    close(upper, fraction(task.answer.mixed), "dual value");
    const result = gradeTask(task, solution);
    assert.equal(result.percent, 100);
    assert.equal(result.fullyCorrect, true);
    assert.equal(result.checkpoints.reduce((sum, item) => sum + item.max, 0), 100);
    const reloaded = JSON.parse(JSON.stringify(task));
    assert.equal(gradeTask(reloaded, reloaded.solution).percent, 100);
  }
});

test("twenty fresh seeds retain strict nontrivial scoring gaps and certified solutions", { timeout: 10000 }, () => {
  for (let index = 0; index < 20; index++) {
    const task = taskOf(generate(`coordination-batch-${index}`));
    assert.ok(task.metadata.attempts >= 1 && task.metadata.attempts <= 256);
    const all = exhaustiveScores(publicRows(task.task));
    const constants = all.filter(({ policy }) => [0, 3, 6].every((offset) =>
      new Set(policy.slice(offset, offset + 3)).size === 1,
    ));
    assert.ok(task.answer.pure > Math.max(...constants.map(({ point }) => Math.min(...point))));
    const mixed = fraction(task.answer.mixed);
    assert.ok(mixed > task.answer.pure);
    assert.ok(mixed > primalOptima(constants.map(({ point }) => point)).mixed + 1e-8);
    const uniformUpper = Math.max(...all.map(({ point }) => point.reduce((sum, value) => sum + value, 0) / 3));
    const trivialUpper = Math.min(uniformUpper, ...[0, 1, 2].map((mode) =>
      Math.max(...all.map(({ point }) => point[mode])),
    ));
    assert.ok(trivialUpper > mixed + 1e-8);
    assert.equal(gradeTask(task, task.solution).percent, 100);
  }
});

test("grading recomputes the public table independently of private saved answers", () => {
  const task = JSON.parse(JSON.stringify(taskOf(specimen())));
  const solution = structuredClone(task.solution);
  task.answer = { pure: -100, mixed: "-100" };
  task.solution = { policy: "000000000" };
  task.metadata = { rows: [], seed: "deliberately-wrong" };
  assert.equal(gradeTask(task, solution).percent, 100);
  // Reusing the same object after its table changes must also invalidate any
  // reference cache. Keep weights within the generator's supported range.
  const oldRows = publicRows(task.task), first = oldRows[0];
  const bits = Array(9).fill("0");
  bits[3 * first.qualified[0] + first.observations[first.qualified[0]]] = "1";
  const policy = bits.join("");
  task.task = task.task.replace(/^([012]{3} \| )(\d+)( \| [ABC] [ABC] [ABC])$/m,
    (_, prefix, weight, suffix) => `${prefix}${1 + Number(weight) % 3}${suffix}`);
  const rows = publicRows(task.task), expected = evaluate(rows, policy);
  assert.notDeepEqual(expected, evaluate(oldRows, policy));
  const changed = gradeTask(task, { policy, scores: expected });
  assert.deepEqual(changed.diagnostics.actualPolicyScores, expected);
  const points = exhaustiveScores(rows).map(({ point }) => point);
  assert.equal(changed.diagnostics.pureOptimum, Math.max(...points.map((point) => Math.min(...point))));
  close(fraction(changed.diagnostics.mixedOptimum), primalOptima(points).mixed, "changed table optimum");
});

test("all 512 policies are graded from their actual mode scores", () => {
  const task = taskOf(specimen()), rows = publicRows(task.task);
  for (const { policy, point } of exhaustiveScores(rows)) {
    const result = gradeTask(task, { policy, scores: point });
    assert.deepEqual(result.diagnostics.actualPolicyScores, point, policy);
    const responsive = [0, 3, 6].some((offset) => new Set(policy.slice(offset, offset + 3)).size > 1);
    const robust = Math.min(...point);
    const expected = responsive && robust > 0 ? 10 + 10 * robust / task.answer.pure : 0;
    close(result.percent, expected, policy);
    assert.equal(result.fullyCorrect, false);
  }
});

test("equivalent fractions and repeated mixture support retain full credit", () => {
  const task = taskOf(specimen()), draft = structuredClone(task.solution);
  const twice = (value) => {
    const [numerator, denominator = "1"] = value.split("/");
    return `${2n * BigInt(numerator)}/${2n * BigInt(denominator)}`;
  };
  const [policy, probability] = draft.mixture.shift();
  const [numerator, denominator = "1"] = probability.split("/");
  const half = `${numerator}/${2n * BigInt(denominator)}`;
  draft.mixture.push([policy, half], [policy, half]);
  draft.mixture = draft.mixture.map(([entry, weight]) => [entry, twice(weight)]);
  draft.dual = draft.dual.map(twice);
  draft.mixed = twice(draft.mixed);
  assert.equal(gradeTask(task, draft).percent, 100);
});

test("missing answers and unsupported numerical claims earn no checkpoint credit", () => {
  const task = taskOf(specimen());
  for (const draft of [undefined, null, [], {}, { pure: task.answer.pure, mixed: task.answer.mixed }]) {
    const result = gradeTask(task, draft);
    assert.equal(result.percent, 0);
    assert.equal(result.fullyCorrect, Boolean(draft?.pure === task.answer.pure && draft?.mixed === task.answer.mixed));
    assert.equal(result.checkpointsComplete, false);
  }
  assert.equal(gradeTask(task, undefined).submitted, false);
});

test("extra notes are ignored and inherited fields cannot supply answers", () => {
  const task = taskOf(specimen());
  const result = gradeTask(task, { ...task.solution, progress: "Work in progress", unrecognized: 1, metadata: { solution: null } });
  assert.equal(result.percent, 100);
  assert.equal(result.fullyCorrect, true);
  assert.equal(result.checkpointsComplete, true);
  assert.deepEqual(result.diagnostics.ignoredKeys, ["progress", "unrecognized", "metadata"]);
  const inherited = gradeTask(task, Object.create(task.solution));
  assert.equal(inherited.percent, 0);
  assert.equal(inherited.fullyCorrect, false);
  assert.equal(inherited.checkpointsComplete, false);
});

test("malformed distributions cannot manufacture primal or dual certificate credit", () => {
  const task = taskOf(specimen()), policy = task.solution.mixture[0][0];
  const invalidMixtures = [
    [], [[policy, "-1"], [policy, "2"]], [[policy, "1/2"]], [[policy, "1/0"]],
    [[policy, "0"]], [[policy.slice(1), "1"]], [[policy, 1]], [[policy, "NaN"]],
    [[policy, "1", "extra"]], [[policy, "9".repeat(100)]],
  ];
  for (const mixture of invalidMixtures) {
    const result = gradeTask(task, { mixture, mixed: task.answer.mixed });
    assert.equal(result.percent, 0);
    assert.equal(result.diagnostics.mixtureValid, false);
  }
  for (const dual of [[], ["-1", "1", "1"], ["1/3", "1/3", "1/4"], ["1", "0"], [1, 0, 0], ["1/0", "0", "0"]]) {
    const result = gradeTask(task, { dual, mixed: task.answer.mixed });
    assert.equal(result.percent, 0);
    assert.equal(result.diagnostics.upperBound, null);
  }
});

test("valid intermediate policies, mixtures and duals earn continuous verified progress", () => {
  const task = taskOf(specimen()), rows = publicRows(task.task), solution = task.solution;
  const pureOnly = gradeTask(task, { policy: solution.policy, scores: solution.scores });
  assert.equal(pureOnly.percent, 20);
  const wrongScores = gradeTask(task, { policy: solution.policy, scores: solution.scores.map((value) => value + 1) });
  assert.equal(checkpoint(wrongScores, "policy-scores").earned, 0);
  assert.equal(wrongScores.percent, 10);
  // Mix the certified optimum with a zero-payoff protocol by a tiny amount;
  // this produces valid, near-optimal work without submitting an exact answer.
  const near = solution.mixture.map(([policy, value]) => {
    const [numerator, denominator = "1"] = value.split("/");
    return [policy, `${999999n * BigInt(numerator)}/${1000000n * BigInt(denominator)}`];
  });
  near.push(["000000000", "1/1000000"]);
  const progress = gradeTask(task, { mixture: near });
  assert.equal(progress.diagnostics.mixtureValid, true);
  assert.ok(progress.percent > 29 && progress.percent < 30);
  assert.equal(checkpoint(progress, "matching-certificates").earned, 0);
  close(fraction(progress.diagnostics.lowerBound), fraction(task.answer.mixed) * 0.999999, "near-optimal bound");
  assert.deepEqual(evaluate(rows, "000000000"), [0, 0, 0]);
});
