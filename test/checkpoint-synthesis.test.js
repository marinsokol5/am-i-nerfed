import test from "node:test";
import assert from "node:assert/strict";
import { generate, generateShort, gradeTask, execute, shortestProgram } from "../src/checkpoint-synthesis.js";

const ALPHABET = "ABCDEF";
const INPUTS = Array.from({ length: 16 }, (_, i) => i);
const taskFor = (seed) => generate(seed).answer.checkpoint.task;

// Arithmetic/bit-array interpreter shares neither the search lookup tables nor
// the production interpreter's bitwise conditional implementation.
function independentExecute(program, input) {
  let value = input;
  for (const instruction of program) {
    const bits = [0, 1, 2, 3].map((bit) => Math.floor(value / 2 ** bit) % 2);
    if (instruction === "A") value = value === 15 ? 0 : value + 1;
    if (instruction === "B") {
      bits[0] = 1 - bits[0];
      bits[2] = 1 - bits[2];
      value = bits.reduce((sum, bit, i) => sum + bit * 2 ** i, 0);
    }
    if (instruction === "C") value = bits[3] + 2 * bits[0] + 4 * bits[1] + 8 * bits[2];
    if (instruction === "D" && bits[0] && bits[1]) value += bits[3] ? -8 : 8;
    if (instruction === "E" && bits[2] && bits[3]) value += bits[0] ? -1 : 1;
    if (instruction === "F") value = (value + 4 * value) % 16;
  }
  return value;
}
const independentTable = (program) => INPUTS.map((input) => independentExecute(program, input));
const key = (table) => table.map((x) => x.toString(16)).join("");

function independentBall(depth) {
  const found = new Map([[key(INPUTS), { table: INPUTS, word: "" }]]);
  let frontier = [...found.values()];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const { table, word } of frontier) {
      for (const instruction of ALPHABET) {
        const child = table.map((x) => independentExecute(instruction, x));
        const childKey = key(child);
        if (found.has(childKey)) continue;
        const entry = { table: child, word: word + instruction };
        found.set(childKey, entry);
        next.push(entry);
      }
    }
    frontier = next;
  }
  return found;
}

test("easy and medium synthesis have independently proven three/six-step targets and public-only schemas", () => {
  const ball = independentBall(6);
  for (const [level, length] of [[0, 3], [1, 6]]) {
    const targets = new Set();
    for (let seed = 0; seed < 24; seed++) {
      const generated = generateShort(`short-synthesis-${level}-${seed}`, level);
      const task = generated.answer.checkpoint.task;
      const outputs = generated.prompt.match(/^output: ([\d ]+)$/m)[1].trim().split(/\s+/).map(Number);
      const reference = ball.get(key(outputs));
      assert.ok(reference, "The complete public table must have an independently found solution");
      assert.equal(reference.word.length, length);
      assert.deepEqual(task.metadata.target, outputs);
      assert.equal(task.metadata.optimalLength, length);
      assert.deepEqual(independentTable(task.solution.program), outputs);
      assert.equal(gradeTask(task, { program: reference.word }).percent, 100);
      assert.equal(gradeTask(task, { program: reference.word }).fullyCorrect, true);
      assert.deepEqual(generated.response, { program: "Program" });
      assert.equal(generated.prompt.includes(task.solution.program), false);
      assert.doesNotMatch(generated.prompt, /short-synthesis-|optimalLength|canonical|generationAttempts/);
      targets.add(key(outputs));
    }
    assert.ok(targets.size > 12, "Private seeds must change the transformation, not only its labels");
    const first = generateShort(`short-contract-${level}`, level);
    assert.deepEqual(generateShort(`short-contract-${level}`, level), first);
    assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
    const task = first.answer.checkpoint.task;
    assert.equal(gradeTask(JSON.parse(JSON.stringify(task)), task.solution).percent, 100);
  }
  assert.throws(() => generateShort("invalid-level", 2), /easy or medium/);
});

test("short synthesis verifies partial programs, accepts equivalent optima and rejects unsupported answers", () => {
  for (const level of [0, 1]) {
    const task = generateShort(`short-grading-${level}`, level).answer.checkpoint.task;
    const longer = gradeTask(task, { program: task.solution.program + "BB" });
    assert.equal(longer.percent, 70);
    assert.equal(longer.fullyCorrect, false);
    for (const program of ["A", "BD", task.solution.program.slice(0, -1)]) {
      const matches = independentTable(program).filter((output, i) => output === task.metadata.target[i]).length;
      assert.equal(gradeTask(task, { program }).percent, 20 * Math.max(0, matches - 3) / 13);
    }
    for (const draft of [undefined, null, [], "ABC", {}, { program: "" }, { program: "ABC\n" },
      { program: "abc" }, { program: task.metadata.target }, { program: "A".repeat(257) },
      { length: task.metadata.optimalLength }, Object.create(task.solution)]) {
      assert.equal(gradeTask(task, draft).percent, 0);
      assert.equal(gradeTask(task, draft).fullyCorrect, false);
    }
  }
  const ball = independentBall(3);
  const target = independentTable("CDF"), reference = ball.get(key(target));
  assert.equal(reference.word.length, 3);
  const task = generateShort("short-equivalent-optima", 0).answer.checkpoint.task;
  task.metadata.target = target;
  task.solution.program = reference.word;
  assert.deepEqual(independentTable("CFD"), target);
  for (const program of ["CDF", "CFD"]) {
    assert.equal(gradeTask(task, { program }).percent, 100);
    assert.equal(gradeTask(task, { program }).fullyCorrect, true);
  }
});

test("synthesis is deterministic, serializable, and reveals no private reference fields", () => {
  const first = generate("synthesis-determinism");
  assert.deepEqual(generate("synthesis-determinism"), first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  const task = first.answer.checkpoint.task;
  assert.equal(first.answer.checkpoint.version, 1);
  assert.equal(first.answer.checkpoint.family, "reversible-synthesis");
  assert.equal(task.metadata.optimalLength, 14);
  assert.equal(task.solution.program.length, 14);
  assert.equal(first.prompt.includes(task.solution.program), false);
  assert.equal(gradeTask(task, task.solution).percent, 100);
  assert.equal(gradeTask(task, task.solution).fullyCorrect, true);
});

test("packed search agrees with exhaustive independent short-target BFS including lexicographic ties", () => {
  const ball = independentBall(4);
  for (const { table, word } of ball.values()) {
    assert.equal(shortestProgram(table), word);
    for (const input of INPUTS) assert.equal(execute(word, input), independentExecute(word, input));
  }
  assert.throws(() => shortestProgram([]), /permutation/);
  assert.throws(() => shortestProgram(Array(16).fill(0)), /permutation/);
  assert.throws(() => shortestProgram([...INPUTS.slice(1), 16]), /permutation/);
});

test("all 2/4/6-step scaffold minimal lengths and canonical answers match independent BFS", () => {
  const ball = independentBall(6);
  for (let seed = 0; seed < 5; seed++) {
    const task = taskFor(`synthesis-scaffold-${seed}`);
    for (const length of [2, 4, 6]) {
      const warmup = task.metadata.warmups[`warmup${length}`];
      assert.equal(ball.get(key(warmup.target)).word, warmup.canonical);
      assert.equal(warmup.canonical.length, length);
    }
  }
});

test("100 fresh seeded synthesis targets have verified gold answers and structural variation", () => {
  const started = performance.now();
  const targetKeys = new Set();
  const parities = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const task = taskFor(`synthesis-gold-${seed}`);
    const { target, optimalLength, warmups, generationAttempts } = task.metadata;
    targetKeys.add(key(target));
    parities.add(task.solution.requiredAParity);
    assert.equal(optimalLength, 14);
    assert.ok(generationAttempts >= 1 && generationAttempts <= 128);
    assert.deepEqual(independentTable(task.solution.program), target);
    for (const [field, warmup] of Object.entries(warmups)) {
      assert.deepEqual(independentTable(task.solution[field]), warmup.target);
    }
    const result = gradeTask(JSON.parse(JSON.stringify(task)), JSON.parse(JSON.stringify(task.solution)));
    assert.equal(result.percent, 100);
    assert.equal(result.fullyCorrect, true);
    assert.equal(result.checkpoints.length, 11);
    assert.equal(result.checkpoints.reduce((sum, c) => sum + c.max, 0), 100);
  }
  assert.equal(targetKeys.size, 100);
  assert.equal(parities.size, 2);
  // A generous regression guard: the original uncached/string search made
  // normal bank generation impractical. This is normally about ten seconds.
  assert.ok(performance.now() - started < 120_000, "100 seeded targets should generate in under two minutes");
});

test("malformed programs, copied tables, claimed costs, and duplicate invariants earn no credit", () => {
  const task = taskFor("synthesis-malformed");
  for (const draft of [undefined, null, 0, "ABC", [], {}, { program: task.metadata.target }, { program: "" }, { program: "A".repeat(257) }, { program: "ABC\n" }, { program: "abcdef" }, { program: { length: 14 } }, { optimalLength: 14 }, { oddOperations: ["A", "A"], requiredAParity: task.solution.requiredAParity }]) {
    const result = gradeTask(task, draft);
    assert.equal(result.percent, 0, JSON.stringify(draft));
    assert.equal(result.fullyCorrect, false);
  }
  assert.equal(gradeTask(task, undefined).submitted, false);
  assert.equal(gradeTask(task, null).submitted, true);
});

test("checkpoint progress scores executable witnesses and preserves strict original-goal success", () => {
  const task = taskFor("synthesis-checkpoints");
  const solution = task.solution;
  const scaffolds = Object.fromEntries([2, 4, 6].map((length) => [`warmup${length}`, solution[`warmup${length}`]]));
  assert.equal(gradeTask(task, scaffolds).percent, 30);
  assert.equal(gradeTask(task, { ...scaffolds, oddOperations: ["A"], requiredAParity: solution.requiredAParity }).percent, 40);
  assert.equal(gradeTask(task, { oddOperations: ["A"], requiredAParity: solution.requiredAParity === "odd" ? "even" : "odd" }).percent, 0);
  const mainOnly = gradeTask(task, { program: solution.program });
  assert.equal(mainOnly.percent, 60);
  assert.equal(mainOnly.fullyCorrect, true);
  const lengthenedMain = gradeTask(task, { program: solution.program + "BB" });
  assert.equal(lengthenedMain.percent, 35);
  assert.equal(lengthenedMain.diagnostics.realizesTable, true);
  assert.equal(lengthenedMain.fullyCorrect, false);
  const lengthenedScaffolds = Object.fromEntries(Object.entries(scaffolds).map(([field, program]) => [field, program + "BB"]));
  assert.equal(gradeTask(task, lengthenedScaffolds).percent, 15);
  // Validate the partial-output score using a separately executed candidate.
  for (const program of ["A", "BD", solution.program.slice(0, -1)]) {
    const matches = independentTable(program).filter((output, i) => output === task.metadata.target[i]).length;
    const result = gradeTask(task, { program });
    assert.equal(result.percent, 10 * Math.max(0, matches - 3) / 13);
  }
});
