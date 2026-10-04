import { randomSource } from './random.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const rat = (n, d = 1n) => { if (!d) throw new Error('Zero denominator'); if (d < 0n) [n, d] = [-n, -d]; const g = gcd(n, d); return [n / g, d / g]; };
const add = (a, b) => rat(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a, b) => rat(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a, b) => rat(a[0] * b[0], a[1] * b[1]);
const cmp = (a, b) => { const n = a[0] * b[1] - b[0] * a[1]; return n < 0n ? -1 : n > 0n ? 1 : 0; };
const str = (r) => r[1] === 1n ? String(r[0]) : `${r[0]}/${r[1]}`;
const min = (rs) => rs.reduce((a, b) => cmp(a, b) <= 0 ? a : b);
const max = (rs) => rs.reduce((a, b) => cmp(a, b) >= 0 ? a : b);
const ZERO = [0n, 1n], ONE = [1n, 1n];
const int = (n) => [BigInt(n), 1n];
function parseFraction(value) {
  if (typeof value !== 'string' || value.length > 90) return null;
  const m = /^([+-]?\d{1,40})(?:\s*\/\s*([+-]?\d{1,40}))?$/.exec(value.trim());
  if (!m || BigInt(m[2] ?? '1') === 0n) return null;
  return rat(BigInt(m[1]), BigInt(m[2] ?? '1'));
}
const policyValid = (p) => typeof p === 'string' && /^[01]{9}$/.test(p);
const responsive = (p) => ![0, 3, 6].every((i) => p[i] === p[i + 1] && p[i] === p[i + 2]);
function parseRows(prompt) {
  return prompt.split('\n').flatMap((line) => {
    const m = /^([012])([012])([012]) \| (\d+) \| ([ABC]) ([ABC]) ([ABC])$/.exec(line);
    return m ? [{ observations: m.slice(1, 4).map(Number), weight: Number(m[4]), qualified: m.slice(5).map((s) => 'ABC'.indexOf(s)) }] : [];
  });
}
function scorePolicy(rows, policy) {
  if (!policyValid(policy)) return null;
  const scores = [0, 0, 0];
  for (const { observations, weight, qualified } of rows) {
    const dispatchers = observations.flatMap((observation, agent) => policy[agent * 3 + observation] === '1' ? [agent] : []);
    if (dispatchers.length === 1) for (let mode = 0; mode < 3; mode++) if (qualified[mode] === dispatchers[0]) scores[mode] += weight;
  }
  return scores;
}
const dot = (weights, point) => point.reduce((sum, value, i) => add(sum, mul(weights[i], int(value))), ZERO);

const POLICIES = Array.from({ length: 512 }, (_, i) => i.toString(2).padStart(9, '0'));
const POLICY_BITS = POLICIES.map((policy) => [...policy].map(Number));
const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
  - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
  + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);

// Integer Cramer's rule. Generated tables have total weight at most 54,
// so every determinant and subsequent product is an exact safe JS integer.
// Bounds are enforced before solving rather than relying on floating tolerance.
function linear3(matrix, rhs) {
  let denominator = det(matrix);
  if (!denominator) return null;
  let numerators = [0, 1, 2].map((column) => det(matrix.map((row, i) => row.map((n, j) => j === column ? rhs[i] : n))));
  if (denominator < 0) {
    denominator = -denominator;
    numerators = numerators.map((n) => -n);
  }
  if (![denominator, ...numerators].every(Number.isSafeInteger)) throw new Error('Unsafe coordination determinant');
  return { numerators, denominator };
}

function frontierOf(points) {
  const unique = [...new Map(points.map((point) => [point.scores.join(','), point])).values()];
  return unique.filter((p) => !unique.some((q) => q !== p && q.scores.every((v, i) => v >= p.scores[i])));
}

// Generation solves the primal directly. A vertex of this three-mode game
// needs at most three policies: pairs equalize two modes; triples equalize all.
function primalOptimum(points) {
  const frontier = frontierOf(points);
  let best = { value: int(0), mixture: [[points[0].policy, '1']] };
  const consider = (support, numerators, denominator) => {
    if (denominator <= 0 || numerators.some((n) => n < 0) || numerators.reduce((sum, n) => sum + n, 0) !== denominator) return;
    const totals = [0, 1, 2].map((mode) => support.reduce((sum, p, i) => sum + numerators[i] * p.scores[mode], 0));
    if (!totals.every(Number.isSafeInteger)) throw new Error('Unsafe coordination primal total');
    const value = rat(BigInt(Math.min(...totals)), BigInt(denominator));
    if (cmp(value, best.value) > 0) best = { value, mixture: support.flatMap((p, i) => numerators[i] ? [[p.policy, str(rat(BigInt(numerators[i]), BigInt(denominator)))]] : []) };
  };
  for (const point of frontier) consider([point], [1], 1);
  for (let i = 0; i < frontier.length; i++) for (let j = i + 1; j < frontier.length; j++) {
    const support = [frontier[i], frontier[j]], [p, q] = support.map((v) => v.scores);
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      let denominator = p[a] - q[a] - p[b] + q[b], numerator = q[b] - q[a];
      if (denominator < 0) { denominator = -denominator; numerator = -numerator; }
      consider(support, [numerator, denominator - numerator], denominator);
    }
  }
  const bestPair = best.value;
  for (let i = 0; i < frontier.length; i++) for (let j = i + 1; j < frontier.length; j++) for (let k = j + 1; k < frontier.length; k++) {
    const support = [frontier[i], frontier[j], frontier[k]];
    const solution = linear3([[1, 1, 1], support.map((p) => p.scores[0] - p.scores[1]), support.map((p) => p.scores[0] - p.scores[2])], [1, 0, 0]);
    if (solution) consider(support, solution.numerators, solution.denominator);
  }
  return { ...best, bestPair, frontier };
}

// Grading independently solves the dual: minimize t with w >= 0, sum(w)=1,
// and dot(w,scores(policy)) <= t for every policy. Enumerating all vertices
// uses neither the generator's primal witness nor its stored optimum.
function dualOptimum(points) {
  const frontier = frontierOf(points);
  const constraints = frontier.map(({ scores: p }) => [[p[0] - p[2], p[1] - p[2], -1], -p[2]])
    .concat([[[-1, 0, 0], 0], [[0, -1, 0], 0], [[1, 1, 0], 1]]);
  let best = null;
  for (let i = 0; i < constraints.length; i++) for (let j = i + 1; j < constraints.length; j++) for (let k = j + 1; k < constraints.length; k++) {
    const active = [constraints[i], constraints[j], constraints[k]], candidate = linear3(active.map(([row]) => row), active.map(([, rhs]) => rhs));
    if (!candidate) continue;
    const { numerators: n, denominator: d } = candidate;
    if (!constraints.every(([row, rhs]) => {
      const left = row.reduce((sum, v, c) => sum + v * n[c], 0), right = rhs * d;
      if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error('Unsafe coordination dual constraint');
      return left <= right;
    })) continue;
    const value = rat(BigInt(n[2]), BigInt(d));
    if (!best || cmp(value, best.value) < 0) best = { value, dual: [n[0], n[1], d - n[0] - n[1]].map((v) => str(rat(BigInt(v), BigInt(d)))) };
  }
  if (!best) throw new Error('No feasible coordination dual vertex');
  return best;
}

// Independently structured row/bit evaluation for generator references.
function allPolicyPoints(rows) {
  const values = Array.from({ length: 512 }, () => [0, 0, 0]);
  for (const row of rows) {
    const offsets = row.observations.map((value, agent) => 3 * agent + value);
    for (let i = 0; i < POLICY_BITS.length; i++) {
      const actions = offsets.map((offset) => POLICY_BITS[i][offset]);
      if (actions[0] + actions[1] + actions[2] !== 1) continue;
      const actor = actions.indexOf(1);
      for (let mode = 0; mode < 3; mode++) if (actor === row.qualified[mode]) values[i][mode] += row.weight;
    }
  }
  return values.map((scores, i) => ({ scores, policy: POLICIES[i] }));
}

function validateRows(rows) {
  if (rows.length !== 18 || new Set(rows.map((r) => r.observations.join(''))).size !== 18
    || rows.some((r) => !Number.isSafeInteger(r.weight) || r.weight < 1 || r.weight > 3)) throw new Error('Invalid coordination table');
}

const referenceCache = new WeakMap();
function reference(task) {
  const cached = referenceCache.get(task);
  if (cached && cached.prompt === task.task) return cached.value;
  const rows = parseRows(task.task);
  validateRows(rows);
  const points = POLICIES.map((policy) => ({ policy, scores: scorePolicy(rows, policy) }));
  const scores = points.map((p) => p.scores);
  const pure = Math.max(...scores.map((s) => Math.min(...s)));
  const mixed = dualOptimum(points).value;
  const baseline = dualOptimum(points.filter((p) => !responsive(p.policy))).value;
  const trivialUpper = min([[ONE, ZERO, ZERO], [ZERO, ONE, ZERO], [ZERO, ZERO, ONE], [rat(1n, 3n), rat(1n, 3n), rat(1n, 3n)]]
    .map((weights) => max(scores.map((p) => dot(weights, p)))));
  const value = { rows, policies: POLICIES, scores, pure, mixed, baseline, trivialUpper };
  referenceCache.set(task, { prompt: task.task, value });
  return value;
}

const checkpointText = `Checkpoint response (fields may be omitted until available): policy is a deterministic witness encoded A0,A1,A2,B0,B1,B2,C0,C1,C2 as one nine-character binary string; scores is its three mode totals. pure is your claimed pure global optimum, supported by policy. mixture lists [policy, probability] pairs; probabilities must be nonnegative exact rational strings summing to one. dual lists three nonnegative rational mode weights summing to one; these certify the upper bound max_policy sum_m dual[m]*s_m. mixed is your claimed mixed global optimum. The grader computes all policy scores and both certificate bounds itself; unsupported numerical claims earn no checkpoint credit.

Checkpoint weights: 10 points for a correct score vector of a responsive policy with positive worst-mode score; up to 10 for that policy's worst-mode score relative to the pure optimum and another 10 for an exact pure claim attained by it; up to 30 for a valid mixture's improvement beyond the best mixture of constant-action policies; up to 20 for a valid dual's improvement beyond the best uniform/single-mode upper bound; 20 for an exact mixed claim with matching primal and dual certificates. Improvement credit is linear between the stated baseline and optimum, clipped to [0,1]. A responsive policy has at least one agent whose action varies with its observed symbol. Full success requires all checkpoints, including the exact pure and mixed claims with witnesses.`;

function promptFor(rows) {
  const table = rows.map((row) => `${row.observations.join('')} | ${row.weight} | ${row.qualified.map((actor) => 'ABC'[actor]).join(' ')}`).join('\n');
  return `Three agents A, B, C each privately observe a symbol a,b,c in {0,1,2}. The table gives ALL possible observations in each of THREE hidden modes. Each agent sees only its own symbol; nobody sees the mode, weight or other symbols. The table and these rules are common knowledge.

abc | weight | qualified agent in modes 1 2 3
${table}

Each simultaneously chooses dispatch (1) or wait (0), with no communication. A deterministic policy assigns an action to each of the three symbols for each agent (9 binary choices). A row succeeds in a mode exactly when precisely one agent dispatches and it is that mode's qualified agent. Let s_m be the SUM OF WEIGHTS of successful rows in mode m. The same policy must cover all rows and modes.

Find (i) pure = max_policy min(s_1,s_2,s_3); (ii) mixed = max_distribution min(E[s_1],E[s_2],E[s_3]). In (ii), one shared random draw selects a complete deterministic policy, independently of observations and mode. The adversary chooses the mode without seeing that draw; expectation precedes minimum. An arbitrary distribution is allowed, including support on more than two policies. No messages, private randomness or extra observations are allowed.

${checkpointText}`;
}

const types = {
  Policy: 'nine binary characters in A0A1A2B0B1B2C0C1C2 order',
  Fraction: 'exact rational string, e.g. "1/3" or "2"; equivalent fractions accepted, at most 40 digits per numerator/denominator',
  '[Policy,Fraction][]': 'array of 1 to 512 [Policy, probability] pairs; duplicates permitted; probabilities nonnegative and sum exactly to one',
  'integer[3]': 'three integer mode scores in modes 1,2,3 order',
  'Fraction[3]': 'three nonnegative rational mode weights, summing exactly to one',
};
const response = { policy: 'Policy', scores: 'integer[3]', pure: 'integer', mixture: '[Policy,Fraction][]', dual: 'Fraction[3]', mixed: 'Fraction' };

function solveCandidate(rows) {
  validateRows(rows);
  const points = allPolicyPoints(rows);
  const purePoint = points.reduce((best, p) => Math.min(...p.scores) > Math.min(...best.scores) ? p : best);
  const pure = Math.min(...purePoint.scores);
  const constants = points.filter((p) => !responsive(p.policy));
  if (pure <= Math.max(...constants.map((p) => Math.min(...p.scores)))) return null;
  const primal = primalOptimum(points), constant = primalOptimum(constants);
  if (cmp(primal.value, int(pure)) <= 0 || cmp(primal.value, constant.value) <= 0) return null;
  const trivialUpper = min([0, 1, 2].map((m) => int(Math.max(...points.map((p) => p.scores[m]))))
    .concat([rat(BigInt(Math.max(...points.map((p) => p.scores.reduce((a, b) => a + b, 0)))), 3n)]));
  if (cmp(trivialUpper, primal.value) <= 0) return null;
  return { rows, points, purePoint, pure, primal, constant, threeRequired: cmp(primal.value, primal.bestPair) > 0 };
}

export function generate(seed) {
  const random = randomSource(seed), histories = Array.from({ length: 27 }, (_, i) => [Math.floor(i / 9), Math.floor(i / 3) % 3, i % 3]);
  let chosen = null, attempts = 0;
  // Strong three-policy cases are preferred; any retained case still requires
  // responsive pure policies and strict improvement over constant mixtures.
  for (; attempts < 256; attempts++) {
    const rows = random.shuffle(histories).slice(0, 18).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      .map((observations) => ({ observations, weight: 1 + random.integer(3), qualified: [random.integer(3), random.integer(3), random.integer(3)] }));
    const candidate = solveCandidate(rows);
    if (!candidate) continue;
    chosen ??= candidate;
    if (candidate.threeRequired) { chosen = candidate; attempts++; break; }
  }
  if (!chosen) throw new Error('Coordination generation found no nondegenerate fresh table in 256 bounded attempts');
  const dual = dualOptimum(chosen.points);
  if (cmp(dual.value, chosen.primal.value) !== 0) throw new Error('Independent coordination primal/dual disagreement');
  const prompt = promptFor(chosen.rows);
  const solution = {
    policy: chosen.purePoint.policy, scores: chosen.purePoint.scores, pure: chosen.pure,
    mixture: chosen.primal.mixture, dual: dual.dual, mixed: str(chosen.primal.value),
  };
  const task = {
    id: 'coordination-three-mode', family: 'coordination-three-mode', task: prompt,
    response: { ...response }, types: { ...types }, answer: { pure: solution.pure, mixed: solution.mixed }, solution,
    metadata: { checkpointVersion: 1, generatorVersion: 1, seed, rows: chosen.rows, attempts,
      scoreWeights: [10, 20, 30, 20, 20], threePoliciesRequired: chosen.threeRequired,
      bestTwoPolicyMixture: str(chosen.primal.bestPair), constantPolicyMixture: str(chosen.constant.value),
      distinctScoreVectors: new Set(chosen.points.map((p) => p.scores.join(','))).size,
      paretoPoints: chosen.primal.frontier.length },
  };
  return { prompt, types: { ...types }, response: { ...response }, answer: { checkpoint: { version: 1, family: 'coordination-three-mode', task } } };
}

function distribution(candidate, rows) {
  if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > 512) return { valid: false };
  let mass = ZERO;
  const expectations = [ZERO, ZERO, ZERO];
  for (const entry of candidate) {
    if (!Array.isArray(entry) || entry.length !== 2 || !policyValid(entry[0])) return { valid: false };
    const weight = parseFraction(entry[1]);
    if (!weight || cmp(weight, ZERO) < 0) return { valid: false };
    mass = add(mass, weight);
    const scores = scorePolicy(rows, entry[0]);
    for (let m = 0; m < 3; m++) expectations[m] = add(expectations[m], mul(weight, int(scores[m])));
  }
  if (cmp(mass, ONE) !== 0) return { valid: false };
  return { valid: true, expectations, bound: min(expectations) };
}
function modeDistribution(candidate, scores) {
  if (!Array.isArray(candidate) || candidate.length !== 3) return { valid: false };
  const weights = candidate.map(parseFraction);
  if (weights.some((w) => !w || cmp(w, ZERO) < 0) || cmp(weights.reduce(add, ZERO), ONE) !== 0) return { valid: false };
  return { valid: true, bound: max(scores.map((p) => dot(weights, p))) };
}
function proportion(numerator, denominator) {
  if (cmp(numerator, ZERO) <= 0) return 0;
  if (cmp(numerator, denominator) >= 0) return 1;
  // Rational comparison and clipping happen before the presentation-only float conversion.
  return Number(numerator[0] * denominator[1] * 1000000000n / (numerator[1] * denominator[0])) / 1000000000;
}

export function gradeTask(task, draft) {
  const ref = reference(task), submitted = draft !== undefined;
  const ignoredKeys = object(draft) ? Object.keys(draft).filter((key) => !Object.hasOwn(response, key)) : [];
  // Extra notes are unscored. Only supported own properties can supply answers;
  // inherited fields and metadata must never become checkpoint evidence.
  const d = object(draft) ? Object.fromEntries(Object.keys(response)
    .filter((key) => Object.hasOwn(draft, key)).map((key) => [key, draft[key]])) : {};
  const scores = scorePolicy(ref.rows, d.policy), robust = scores ? Math.min(...scores) : 0;
  const useful = Boolean(scores && responsive(d.policy) && robust > 0);
  const vectorCorrect = useful && Array.isArray(d.scores) && d.scores.length === 3 && d.scores.every((v, i) => Number.isSafeInteger(v) && v === scores[i]);
  const pureExact = Number.isSafeInteger(d.pure) && d.pure === ref.pure;
  const mixedClaim = parseFraction(d.mixed), mixedExact = Boolean(mixedClaim && cmp(mixedClaim, ref.mixed) === 0);
  const primal = distribution(d.mixture, ref.rows), dual = modeDistribution(d.dual, ref.scores);
  const pureSupported = useful && pureExact && robust === ref.pure;
  const closed = mixedExact && primal.valid && dual.valid && cmp(primal.bound, ref.mixed) === 0 && cmp(dual.bound, ref.mixed) === 0;
  const checkpoints = [
    { id: 'policy-scores', earned: vectorCorrect ? 10 : 0, max: 10, detail: vectorCorrect ? 'Responsive policy score vector checked exactly.' : 'Requires a responsive policy with positive robust score and its correct score vector.' },
    { id: 'pure-witness', earned: (useful ? 10 * robust / ref.pure : 0) + (pureSupported ? 10 : 0), max: 20, detail: { verifiedWorstMode: scores ? robust : null, optimumClaimSupported: pureSupported } },
    { id: 'mixed-lower-bound', earned: primal.valid ? 30 * proportion(sub(primal.bound, ref.baseline), sub(ref.mixed, ref.baseline)) : 0, max: 30, detail: { valid: primal.valid, lowerBound: primal.valid ? str(primal.bound) : null, baseline: str(ref.baseline) } },
    { id: 'mixed-upper-bound', earned: dual.valid ? 20 * proportion(sub(ref.trivialUpper, dual.bound), sub(ref.trivialUpper, ref.mixed)) : 0, max: 20, detail: { valid: dual.valid, upperBound: dual.valid ? str(dual.bound) : null, baseline: str(ref.trivialUpper) } },
    { id: 'matching-certificates', earned: closed ? 20 : 0, max: 20, detail: closed ? 'Exact claimed mixed optimum has matching independently evaluated lower and upper bounds.' : 'Requires an exact mixed claim and primal/dual certificates that meet at it.' },
  ];
  return {
    taskId: task.id, family: task.family, submitted,
    percent: checkpoints.reduce((sum, c) => sum + c.earned, 0), fullyCorrect: pureExact && mixedExact,
    checkpointsComplete: vectorCorrect && pureSupported && closed,
    checkpoints, correct: Number(pureExact) + Number(mixedExact), total: 2, fields: { pure: pureExact, mixed: mixedExact },
    diagnostics: {
      ignoredKeys,
      actualPolicyScores: scores, pureWitnessSupported: pureSupported, mixtureValid: primal.valid,
      expectedModeScores: primal.valid ? primal.expectations.map(str) : null,
      lowerBound: primal.valid ? str(primal.bound) : null, upperBound: dual.valid ? str(dual.bound) : null,
      absoluteMixedGap: primal.valid ? str(sub(ref.mixed, primal.bound)) : null,
      certificateGap: primal.valid && dual.valid ? str(sub(dual.bound, primal.bound)) : null,
      optimumCertified: closed, pureOptimum: ref.pure, mixedOptimum: str(ref.mixed),
    },
  };
}
