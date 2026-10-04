import { randomSource } from "./random.js";
import { isObject, sameSet } from "./values.js";

const HYPOTHESES = 10;
const TESTS = 11;
const SUFFIXES = ["Clean", "Spent", "Legal", "Cost", "FirstTests"];
const popcount = (bits) => {
  let count = 0;
  for (; bits; bits &= bits - 1) count++;
  return count;
};
const names = (bits, prefix, count) => Array.from({ length: count }, (_, index) => index)
  .filter((index) => bits & (1 << index)).map((index) => `${prefix}${index + 1}`);

/** A finite shuffled codebook avoids probabilistic rejection loops. Each
 * selected 11-bit word excludes at most 67 words within distance two, so ten
 * words are always available among the 2,048 candidates. */
function instanceFrom(random) {
  const codes = [];
  for (const code of random.shuffle(Array.from({ length: 1 << TESTS }, (_, i) => i))) {
    if (codes.every((other) => popcount(code ^ other) >= 3)) codes.push(code);
    if (codes.length === HYPOTHESES) break;
  }
  if (codes.length !== HYPOTHESES) throw Error("Diagnosis codebook construction failed");
  const rows = codes.map((code) => Array.from({ length: TESTS }, (_, j) => (code >> j) & 1));
  const costs = Array.from({ length: TESTS }, () => 1 + random.integer(5));
  const order = random.shuffle(Array.from({ length: TESTS }, (_, i) => i));
  const prerequisites = Array(TESTS).fill(0);
  order.forEach((test, index) => {
    if (index >= 3) prerequisites[test] = 1 << order[random.integer(index)];
  });
  return { rows, costs, prerequisites };
}

/** Exact minimax recursion. Clean and Spent are disjoint hypothesis sets with
 * respectively zero and one disagreements with the complete observed prefix. */
function makeOracle({ rows, costs, prerequisites }) {
  const all = (1 << rows.length) - 1;
  const ones = costs.map((_, j) => rows.reduce((mask, row, i) => mask | (row[j] << i), 0));
  const memo = new Map();
  const legalMemo = new Map();
  const keyOf = ([clean, spent, used]) => clean + spent * 1024 + used * 1048576;
  const legal = (used) => {
    if (!legalMemo.has(used)) legalMemo.set(used, costs.map((_, j) => j)
      .filter((j) => !(used & (1 << j)) && !(prerequisites[j] & ~used)));
    return legalMemo.get(used);
  };
  const child = (clean, spent, used, j, observed) => {
    const matching = observed ? ones[j] : all ^ ones[j];
    return [clean & matching, (spent & matching) | (clean & (all ^ matching)), used | (1 << j)];
  };
  const actionCost = (state, j) => {
    let worst = 0;
    for (const observed of [0, 1]) {
      const next = child(...state, j, observed);
      if (next[0] | next[1]) worst = Math.max(worst, solve(next));
    }
    return costs[j] + worst;
  };
  const solve = (state) => {
    if (popcount(state[0] | state[1]) <= 1) return 0;
    const key = keyOf(state);
    if (memo.has(key)) return memo.get(key);
    let value = Infinity;
    for (const j of legal(state[2])) value = Math.min(value, actionCost(state, j));
    memo.set(key, value);
    return value;
  };
  const describeState = (state) => {
    const [clean, spent, used] = state;
    if (!(clean | spent)) throw Error("Impossible diagnosis prefix");
    const cost = solve(state);
    return {
      Clean: names(clean, "H", rows.length),
      Spent: names(spent, "H", rows.length),
      Legal: legal(used).map((j) => `T${j + 1}`),
      Cost: cost,
      FirstTests: popcount(clean | spent) <= 1 ? [] : legal(used)
        .filter((j) => actionCost(state, j) === cost).map((j) => `T${j + 1}`),
    };
  };
  const root = [all, 0, 0];
  const describe = (history) => {
    let state = root;
    for (const [test, observed] of history) {
      const j = test - 1;
      if (!legal(state[2]).includes(j) || ![0, 1].includes(observed)) throw Error("Invalid diagnosis prefix");
      state = child(...state, j, observed);
    }
    return describeState(state);
  };
  // Store one canonical legal history per belief state. This finite traversal
  // supplies actual observation prefixes, rather than invented candidate sets.
  const continuations = () => {
    const seen = new Set();
    const states = [];
    const visit = (state, history) => {
      if (popcount(state[0] | state[1]) <= 1) return;
      const key = keyOf(state);
      if (seen.has(key)) return;
      seen.add(key);
      states.push({ state, history, cost: solve(state),
        clean: popcount(state[0]), spent: popcount(state[1]) });
      for (const j of legal(state[2])) for (const observed of [0, 1]) {
        visit(child(...state, j, observed), [...history, [j + 1, observed]]);
      }
    };
    visit(root, []);
    return states;
  };
  return { describe, continuations, memo };
}

/** Select three distinct, nonterminal stages. The small stage has exhausted
 * the flip allowance; the middle stage retains both kinds of hypothesis. */
function selectCases(oracle) {
  const states = oracle.continuations();
  const rank = (candidates, quality) => candidates.sort((a, b) => quality(b) - quality(a))[0];
  const near = rank(states.filter((s) => s.history.length === 1 && s.clean && s.spent),
    (s) => 100 * s.cost - Math.abs(s.clean - s.spent));
  if (!near) return null;
  const mixed = rank(states.filter((s) => s.history.length >= 2 && s.clean && s.spent
    && s.clean + s.spent >= 3 && s.clean + s.spent <= 7 && s.cost < near.cost && s.cost >= 3),
  (s) => -100 * Math.abs(s.cost - near.cost * 0.6) - 10 * Math.abs(s.clean + s.spent - 4)
    - Math.abs(s.history.length - 3));
  if (!mixed) return null;
  const small = rank(states.filter((s) => s.history.length >= 3 && s.clean === 0
    && s.spent >= 2 && s.spent <= 4 && s.cost < mixed.cost && s.cost >= 2),
  (s) => -100 * Math.abs(s.cost - mixed.cost * 0.5) - 10 * Math.abs(s.spent - 3)
    - Math.abs(s.history.length - 4));
  if (!small) return null;
  return [small, mixed, near].map((s, i) => ({ id: "abc"[i], history: s.history }));
}

export function generate(seed) {
  const random = randomSource(seed);
  let selected;
  // The bound is explicit; unsuitable instances are never silently reduced to
  // easy or terminal checkpoints. In practice the first draw usually qualifies.
  for (let attempt = 0; attempt < 32; attempt++) {
    const instance = instanceFrom(random);
    const oracle = makeOracle(instance);
    const cases = selectCases(oracle);
    if (cases) {
      selected = { instance, oracle, cases, attempt: attempt + 1 };
      break;
    }
  }
  if (!selected) throw Error("Could not generate diagnosis checkpoints in 32 attempts");
  const { instance, oracle, cases, attempt } = selected;
  const root = oracle.describe([]);
  const answer = {}, response = {}, weights = {};
  for (const { id, history } of cases) {
    const state = oracle.describe(history);
    for (const suffix of SUFFIXES) {
      const field = id + suffix;
      answer[field] = state[suffix];
      response[field] = suffix === "Cost" ? "integer"
        : suffix === "Clean" || suffix === "Spent" ? "Hypothesis[]" : "Test[]";
      weights[field] = suffix === "Cost" || suffix === "FirstTests" ? 6 : 2;
    }
  }
  answer.cost = root.Cost;
  answer.firstTests = root.FirstTests;
  response.cost = "integer";
  response.firstTests = "Test[]";
  weights.cost = 26;
  weights.firstTests = 20;
  const types = {
    Test: "one of T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11",
    "Test[]": "array of distinct Test strings, in any order",
    Hypothesis: "one of H1, H2, H3, H4, H5, H6, H7, H8, H9, H10",
    "Hypothesis[]": "array of distinct Hypothesis strings, in any order",
  };
  const { rows, costs, prerequisites } = instance;
  const table = rows.map((row, i) => `H${i + 1}: ${row.join(" ")}`).join("\n");
  const requirements = prerequisites.flatMap((mask, j) => names(mask, "T", TESTS)
    .map((name) => `T${j + 1} after ${name}`)).join("; ");
  const prompt = `A hidden hypothesis is one of H1..H10. Its true binary test readings are in the table below.

     ${Array.from({ length: TESTS }, (_, j) => `T${j + 1}`).join(" ")}
${table}

You choose tests adaptively, observing each reading before choosing the next test. Each test may be used at most once. An adversary knows the hidden hypothesis and may flip at most ONE reading during the entire run; it may choose whether/when to flip after seeing your choices. Your strategy must identify the hidden hypothesis correctly for every hypothesis and every legal pattern of flips, including no flips.

Costs: ${costs.map((cost, j) => `T${j + 1}=${cost}`).join(", ")}.
Prerequisites: ${requirements}. "Ti after Tj" means Tj must already have been used before Ti may be chosen. All unlisted tests have no prerequisites.

Minimize the worst-case sum of costs of tests performed before identification. Report the minimum guaranteed cost as cost, and every test that can be the first test of an optimal strategy as firstTests.

Also solve three continuation cases from this same table. Each case starts AFTER the listed observations, in the listed order; these tests have already been used. The listed prefix is mandatory for that case, whether or not it belongs to an optimal strategy from the root. Prefix costs are sunk: report only the additional worst-case cost needed from that point. There is at most ONE flipped reading across the prefix AND the continuation together, not a fresh flip allowance.

${cases.map(({ id, history }) => `Case ${id}: ${history.map(([test, reading]) => `T${test}=${reading}`).join(", ")}.`).join("\n")}

For each case x, give xClean (all hypotheses matching every prefix reading, so a future flip remains possible), xSpent (all hypotheses differing from exactly one prefix reading, so no future flip remains), xLegal (every unused test whose prerequisites are already satisfied), xCost (the minimum guaranteed additional cost to identify the hidden hypothesis), and xFirstTests (every legal next test that can begin a continuation attaining xCost). Hypotheses differing on two or more readings are impossible. Include all qualifying hypotheses/tests in each set; order does not matter, duplicates are invalid. A test that provides no immediate information may still be legal or optimal because it unlocks later tests.

Scoring is predeclared and additive: each case's Clean, Spent, and Legal sets earn 2 points each; each case's Cost and FirstTests earn 6 points each; the final cost earns 26 points and final firstTests earns 20 points (100 total). Each field is checked independently and earns its listed points only when exact; omitted fields earn zero. Complete-task success means both final fields are correct. Sets use arrays, including [] for an empty set.`;
  const task = {
    family: "adversarial-diagnosis", response, types, answer,
    solution: structuredClone(answer),
    metadata: { instance, cases, weights, generationAttempts: attempt,
      minimumPairwiseDistance: Math.min(...rows.flatMap((row, i) => rows.slice(i + 1)
        .map((other) => row.reduce((sum, bit, j) => sum + Number(bit !== other[j]), 0)))),
      bellmanStates: oracle.memo.size, scoringVersion: "diagnosis-checkpoints-v1" },
  };
  return { prompt, types, response,
    answer: { checkpoint: { version: 1, family: task.family, task } } };
}

/** Offline only: no correctness diagnostics are returned to an active solver. */
export function gradeTask(task, draft) {
  const supplied = isObject(draft) ? draft : {};
  const checkpoints = Object.entries(task.metadata.weights).map(([id, max]) => {
    const expected = task.answer[id], actual = supplied[id];
    const correct = Object.hasOwn(supplied, id) && (Array.isArray(expected)
      ? sameSet(actual, expected) : Number.isSafeInteger(actual) && actual === expected);
    return { id, earned: correct ? max : 0, max,
      detail: correct ? "exact" : Object.hasOwn(supplied, id) ? "incorrect" : "omitted" };
  });
  const earnedFor = (predicate) => checkpoints.filter(({ id }) => predicate(id))
    .reduce((sum, { earned }) => sum + earned, 0);
  const percent = earnedFor(() => true);
  const fields = Object.fromEntries(checkpoints.map(({ id, earned }) => [id, earned > 0]));
  return {
    taskId: task.id, family: task.family,
    submitted: Object.keys(task.response).some((key) => Object.hasOwn(supplied, key)),
    percent, fullyCorrect: fields.cost && fields.firstTests, checkpoints,
    diagnostics: {
      fields,
      foundationPoints: earnedFor((id) => /(?:Clean|Spent|Legal)$/.test(id)),
      continuationPoints: earnedFor((id) => /^[abc](?:Cost|FirstTests)$/.test(id)),
      finalPoints: earnedFor((id) => ["cost", "firstTests"].includes(id)),
      originalExactFieldsCorrect: Number(fields.cost) + Number(fields.firstTests),
      allCheckpointsCorrect: percent === 100,
    },
  };
}
