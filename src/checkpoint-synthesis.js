import { randomSource } from "./random.js";
import { isObject, sameSet } from "./values.js";

const ALPHABET = "ABCDEF";
const IDENTITY = Array.from({ length: 16 }, (_, i) => i);
const MAIN_LENGTH = 14;
const FORWARD_DEPTH = MAIN_LENGTH / 2;
const validProgram = (word) =>
  typeof word === "string" && word.length > 0 && word.length <= 256 && !/[^A-F]/.test(word);
const MACHINE = `A machine has one 4-bit unsigned register x (an integer 0..15). A program is a finite string over A,B,C,D,E,F, executed from left to right. Each instruction costs one step:

A: x := (x + 1) mod 16
B: x := x XOR 5
C: rotate the four bits of x left by one position (old bit 3 becomes bit 0)
D: if the two lowest bits of x are both 1, toggle bit 3; otherwise do nothing
E: if the two highest bits of x are both 1, toggle bit 0; otherwise do nothing
F: x := (5*x) mod 16

Bit 0 is the least significant bit; bit 3 is the most significant bit. XOR is bitwise exclusive OR. Conditions use x immediately before that instruction.`;

/** Scalar interpreter, separate from the packed search transitions. */
export function execute(program, input) {
  let x = input;
  for (const instruction of program) {
    switch (instruction) {
      case "A": x = (x + 1) % 16; break;
      case "B": x ^= 5; break;
      case "C": x = ((x << 1) & 15) | (x >>> 3); break;
      case "D": if ((x & 3) === 3) x ^= 8; break;
      case "E": if ((x & 12) === 12) x ^= 1; break;
      case "F": x = (5 * x) % 16; break;
      default: throw new Error(`Invalid instruction ${instruction}`);
    }
  }
  return x;
}

const programTable = (word) => IDENTITY.map((input) => execute(word, input));

// A permutation occupies exactly four UTF-16 code units: four 4-bit outputs
// per unit. Map keys therefore retain all 64 bits without BigInt arithmetic.
const pack = (table) => String.fromCharCode(...[0, 4, 8, 12].map((i) =>
  table[i] | (table[i + 1] << 4) | (table[i + 2] << 8) | (table[i + 3] << 12)));
const applyPacked = (state, transform) => String.fromCharCode(
  transform[state.charCodeAt(0)], transform[state.charCodeAt(1)],
  transform[state.charCodeAt(2)], transform[state.charCodeAt(3)],
);
const packedIdentity = pack(IDENTITY);
let cachedSearch;

function searchContext() {
  if (cachedSearch) return cachedSearch;
  // These formulas are intentionally separate from the scalar interpreter.
  const operations = [
    (x) => (x + 1) & 15,
    (x) => x ^ 5,
    (x) => (2 * x + Math.floor(x / 8)) & 15,
    (x) => x % 4 === 3 ? x ^ 8 : x,
    (x) => Math.floor(x / 4) === 3 ? x ^ 1 : x,
    (x) => 5 * x & 15,
  ].map((op) => IDENTITY.map(op));
  const inverses = operations.map((op) => {
    const inverse = [];
    op.forEach((value, input) => { inverse[value] = input; });
    return inverse;
  });
  const lookup = (op) => Uint16Array.from({ length: 65536 }, (_, value) =>
    op[value & 15] | (op[value >>> 4 & 15] << 4) |
    (op[value >>> 8 & 15] << 8) | (op[value >>> 12] << 12));
  const forwardOps = operations.map(lookup);
  const reverseOps = inverses.map(lookup);
  const forward = new Map([[packedIdentity, ""]]);
  const layers = [[""]];
  let frontier = new Map(forward);
  for (let depth = 1; depth <= FORWARD_DEPTH; depth++) {
    const next = new Map();
    // Parents and their children are visited in lexicographic word order.
    for (const [state, word] of frontier) {
      for (let op = 0; op < ALPHABET.length; op++) {
        const child = applyPacked(state, forwardOps[op]);
        if (forward.has(child)) continue;
        const childWord = word + ALPHABET[op];
        forward.set(child, childWord);
        next.set(child, childWord);
      }
    }
    frontier = next;
    layers.push([...next.values()]);
  }
  cachedSearch = { forward, layers, reverseOps };
  return cachedSearch;
}

/** Exact shortest/lexicographic search through length 14, not a heuristic. */
export function shortestProgram(target) {
  if (!Array.isArray(target) || target.length !== 16 ||
      new Set(target).size !== 16 || target.some((x) => !Number.isInteger(x) || x < 0 || x > 15)) {
    throw new Error("Synthesis target must be a permutation of 0..15");
  }
  const { forward, reverseOps } = searchContext();
  const packedTarget = pack(target);
  if (forward.has(packedTarget)) return forward.get(packedTarget);
  const seen = new Set([packedTarget]);
  let frontier = new Map([[packedTarget, ""]]);
  for (let depth = 1; depth <= FORWARD_DEPTH; depth++) {
    const next = new Map();
    for (const [state, suffix] of frontier) {
      for (let op = 0; op < ALPHABET.length; op++) {
        const child = applyPacked(state, reverseOps[op]);
        if (seen.has(child)) continue;
        const childSuffix = ALPHABET[op] + suffix;
        const previous = next.get(child);
        if (previous === undefined || childSuffix < previous) next.set(child, childSuffix);
      }
    }
    let best;
    for (const [state, suffix] of next) {
      seen.add(state);
      const prefix = forward.get(state);
      if (prefix === undefined) continue;
      const word = prefix + suffix;
      if (best === undefined || word.length < best.length ||
          (word.length === best.length && word < best)) best = word;
    }
    // The first intersection proves minimality; all its midpoints were
    // compared, with canonical shortest words on both sides of the split.
    if (best !== undefined) return best;
    frontier = next;
  }
  return null;
}

function permutationParity(table) {
  let inversions = 0;
  for (let i = 0; i < table.length; i++) {
    for (let j = i + 1; j < table.length; j++) if (table[i] > table[j]) inversions++;
  }
  return inversions % 2 ? "odd" : "even";
}

/** Easy/medium targets are sampled from proven shortest BFS layers, so a
 * reducible random program can never silently produce an easier target. */
export function generateShort(seed, level) {
  if (level !== 0 && level !== 1) throw Error("Short synthesis requires easy or medium difficulty");
  const optimalLength = [3, 6][level];
  const canonical = randomSource(seed).choose(searchContext().layers[optimalLength]);
  const target = programTable(canonical);
  const types = { Program: "a string of 1..256 uppercase instruction letters A..F" };
  const response = { program: "Program" };
  const prompt = `${MACHINE}

Find a shortest program realizing this COMPLETE input/output table:
input:  ${IDENTITY.join(" ")}
output: ${target.join(" ")}

Submit it in program. Any shortest solution is accepted; there is no lexicographic tie-break. The program must work for every one of the 16 inputs, not just one example.

Scoring: a program earns 20*max(0,m-3)/13 points, where m is the number of inputs with the correct output; it earns 50 additional points for matching all 16 outputs and 30 more for minimum length. A valid longer program therefore earns 70 points. Complete-task success requires a shortest valid program. All program strings must contain 1..256 uppercase letters from A..F. Copied tables and unsupported claims about length earn no credit. You may submit and revise a candidate program; omitted work earns zero.`;
  const task = { family: "reversible-synthesis", solution: { program: canonical },
    metadata: { target, optimalLength, scoringVersion: "short-v1" } };
  return { prompt, types, response, answer: { checkpoint: { version: 1, family: task.family, task } } };
}

/** Fresh targets, sampled from shortest spheres and independently solved. */
export function generate(seed) {
  const random = randomSource(seed);
  const { layers } = searchContext();
  const warmups = Object.fromEntries([2, 4, 6].map((length) => {
    const canonical = random.choose(layers[length]);
    return [`warmup${length}`, { target: programTable(canonical), optimalLength: length, canonical }];
  }));
  let canonical, target, attempts;
  for (attempts = 1; attempts <= 128; attempts++) {
    // Each half is itself irreducible. Concatenations are accepted only after
    // an exhaustive search proves the complete target needs all 14 steps.
    const generatingWord = random.choose(layers[FORWARD_DEPTH]) + random.choose(layers[FORWARD_DEPTH]);
    target = programTable(generatingWord);
    canonical = shortestProgram(target);
    if (canonical?.length === MAIN_LENGTH) break;
  }
  if (canonical?.length !== MAIN_LENGTH) throw new Error("Could not generate a verified length-14 synthesis target");
  if (programTable(canonical).some((output, i) => output !== target[i])) {
    throw new Error("Packed synthesis search and scalar interpreter disagree");
  }
  const oddOperations = [...ALPHABET].filter((letter) => permutationParity(programTable(letter)) === "odd");
  if (oddOperations.join("") !== "A") throw new Error("A must be the sole odd instruction");
  const solution = {
    ...Object.fromEntries(Object.entries(warmups).map(([field, warmup]) => [field, warmup.canonical])),
    oddOperations,
    requiredAParity: permutationParity(target),
    program: canonical,
  };
  const tableText = (outputs) => `input:  ${IDENTITY.join(" ")}\noutput: ${outputs.join(" ")}`;
  const warmupText = Object.entries(warmups).map(([field, w]) => `${field}:\n${tableText(w.target)}`).join("\n\n");
  const prompt = `${MACHINE}

Find a program realizing this COMPLETE original input/output table:
${tableText(target)}

For this original target, find a shortest program and break ties lexicographically using A<B<C<D<E<F; put it in program.

Additional independently graded checkpoints use exactly the same machine:

Scaffolding (30 points): these are three separate, easier targets, NOT prefixes, suffixes, or decompositions of the original target. For each, submit a program realizing its entire table. Any shortest solution is accepted; there is no lexicographic requirement for these three.
${warmupText}

Invariant (10 points): classify the six instruction permutations of 0..15. An odd permutation has an odd number of inversions. In oddOperations, list every instruction that is an odd permutation, without duplicates. In requiredAParity, state whether every program realizing the ORIGINAL target must contain an even or odd number of A instructions. Both fields must be correct for these points.

Scoring: warmup2 earns 3 points for realizing its entire table and 3 more for minimum length; warmup4 earns 5+5; warmup6 earns 7+7. Original-target program earns 10*max(0,m-3)/13 points, where m is the number of its 16 inputs with the correct output, plus 25 points for all 16, plus 15 points for minimum length, plus 10 points for the lexicographically first minimum-length program. Thus scaffolding is 30%, the invariant is 10%, and the original target is 60%. Strict task completion means solving the original shortest-program goal with its lexicographic tie-break. All program strings must contain 1..256 uppercase letters from A..F. Unsupported length or correctness claims and copied output tables earn no program points. Omitted fields earn zero. Respond with the fields below; each is optional until you have a candidate.`;
  const response = { warmup2: "Program", warmup4: "Program", warmup6: "Program", oddOperations: "Operation[]", requiredAParity: "Parity", program: "Program" };
  const types = { Program: "a string of 1..256 uppercase instruction letters A..F", "Operation[]": "an array of distinct letters from A,B,C,D,E,F; order does not matter", Parity: 'the string "even" or "odd"' };
  const task = {
    family: "reversible-synthesis", solution,
    metadata: { target, optimalLength: MAIN_LENGTH, warmups, scoringVersion: 1, scaffoldingWeight: 30, invariantWeight: 10, originalGoalWeight: 60, generationAttempts: attempts, exhaustiveForwardDepth: FORWARD_DEPTH, exhaustiveReverseDepth: FORWARD_DEPTH },
  };
  return { prompt, types, response, answer: { checkpoint: { version: 1, family: task.family, task } } };
}

function inspectProgram(program, target, optimalLength, canonical) {
  const alphabetValid = validProgram(program);
  const outputs = alphabetValid ? programTable(program) : null;
  const outputsMatching = outputs ? outputs.filter((x, i) => x === target[i]).length : 0;
  const realizesTable = alphabetValid && outputsMatching === 16;
  return {
    alphabetValid,
    candidateLength: typeof program === "string" ? program.length : null,
    outputsMatching, totalOutputs: 16, realizesTable,
    minimal: realizesTable && program.length === optimalLength,
    canonical: realizesTable && program === canonical,
  };
}

export function gradeTask(task, draft) {
  const submitted = draft !== undefined;
  const values = isObject(draft)
    ? Object.fromEntries(Object.keys(task.solution).filter(field => Object.hasOwn(draft, field)).map(field => [field, draft[field]]))
    : {};
  if (task.metadata.scoringVersion === "short-v1") {
    const d = inspectProgram(values.program, task.metadata.target, task.metadata.optimalLength, task.solution.program);
    const checkpoints = [
      { id: "inputs", earned: d.alphabetValid ? 20 * Math.max(0, d.outputsMatching - 3) / 13 : 0, max: 20 },
      { id: "valid", earned: d.realizesTable ? 50 : 0, max: 50 },
      { id: "shortest", earned: d.minimal ? 30 : 0, max: 30 },
    ];
    return { taskId: task.id, family: task.family, submitted,
      percent: checkpoints.reduce((sum, c) => sum + c.earned, 0),
      fullyCorrect: d.minimal, checkpoints, diagnostics: d };
  }
  const checkpoints = [];
  const warmupDiagnostics = {};
  for (const [field, points] of [["warmup2", 3], ["warmup4", 5], ["warmup6", 7]]) {
    const w = task.metadata.warmups[field];
    const d = inspectProgram(values[field], w.target, w.optimalLength, w.canonical);
    warmupDiagnostics[field] = d;
    checkpoints.push({ id: `${field}-valid`, earned: d.realizesTable ? points : 0, max: points, detail: `${d.outputsMatching}/16 outputs match; scaffolding target` });
    checkpoints.push({ id: `${field}-shortest`, earned: d.minimal ? points : 0, max: points, detail: d.minimal ? "Shortest valid scaffolding program" : "Requires a valid minimum-length scaffolding program" });
  }
  const invariantCorrect = sameSet(values.oddOperations, task.solution.oddOperations) && values.requiredAParity === task.solution.requiredAParity;
  checkpoints.push({ id: "permutation-invariant", earned: invariantCorrect ? 10 : 0, max: 10, detail: invariantCorrect ? "Correct instruction parity classification and necessary A-count parity" : "Requires both the complete odd-operation set and the necessary A-count parity" });
  const d = inspectProgram(values.program, task.metadata.target, task.metadata.optimalLength, task.solution.program);
  checkpoints.push({ id: "original-inputs", earned: d.alphabetValid ? 10 * Math.max(0, d.outputsMatching - 3) / 13 : 0, max: 10, detail: `${d.outputsMatching}/16 outputs match; first three matches earn no credit` });
  checkpoints.push({ id: "original-valid", earned: d.realizesTable ? 25 : 0, max: 25, detail: d.realizesTable ? "All 16 original outputs verified" : "Requires all 16 original outputs" });
  checkpoints.push({ id: "original-shortest", earned: d.minimal ? 15 : 0, max: 15, detail: d.minimal ? "Valid program has the verified minimum length" : "Requires a valid minimum-length original program" });
  checkpoints.push({ id: "original-canonical", earned: d.canonical ? 10 : 0, max: 10, detail: d.canonical ? "Canonical shortest original program" : "Requires the lexicographically first shortest original program" });
  return {
    taskId: task.id, family: task.family, submitted,
    percent: checkpoints.reduce((sum, c) => sum + c.earned, 0),
    fullyCorrect: d.canonical, checkpoints,
    diagnostics: { ...d, invariantCorrect, warmups: warmupDiagnostics, scaffoldingPoints: checkpoints.slice(0, 6).reduce((sum, c) => sum + c.earned, 0), originalGoalPoints: checkpoints.slice(7).reduce((sum, c) => sum + c.earned, 0) },
  };
}
