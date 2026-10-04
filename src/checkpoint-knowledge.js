import { createHmac } from "node:crypto";
import { randomSource } from "./random.js";
import { isObject, sameSet } from "./values.js";

const AGENTS = "ABCD";
const AGENT_IDS = [0, 1, 2, 3];
const WORLD_COUNT = 64;
const EVIDENCE_CELL_CAP = 12;
const MAX_GENERATION_ATTEMPTS = 16_384;
const bitCount = (mask) => { let count = 0; for (; mask; mask &= mask - 1n) count++; return count; };
const variantDescriptions = {
  main: "the factual protocol",
  public_event: "e is announced to everyone at the physical stage instead of only to B",
  public_reports: "all three replies are heard by everyone",
  forget_A: "A never observes a0; A still observes a after the event",
  no_swap: "only e=0 is possible, commonly known from the start; the actual event is also e=0",
};
const FINAL_STAGE = 3;
const stageNames = ["physical", "after reply 1", "after reply 2", "final"];
const rowOf = (bits) => bits.reduce((row, bit) => row * 2 + bit, 0);
const historyId = (world) => `${world.initial.join("")}:${world.event}`;
const has = (mask, index) => Boolean(mask & (1n << BigInt(index)));
const render = (p) => p[0] === "F" ? "F" : p[0] === "bit" ? `${"abcd"[p[1]]}=1`
  : p[0] === "not" ? `NOT(${render(p[1])})` : `${p[0]}_${AGENTS[p[1]]}(${render(p[2])})`;
const atom = (p) => p[0] === "K" || p[0] === "W" ? atom(p[2]) : p[0] === "not" ? atom(p[1]) : p;
const signedAtom = (p) => p[0] === "K" || p[0] === "W" ? signedAtom(p[2]) : p;
const formulaKeys = new WeakMap();
const formulaKey = (p) => {
  let key = formulaKeys.get(p);
  if (key === undefined) { key = JSON.stringify(p); formulaKeys.set(p, key); }
  return key;
};

/** All histories are retained. A private answer refines only its observers'
 * equivalence relations; it never filters the global universe. */
function protocol(factRows, replies, variant = "main", ignored = false) {
  const worlds = Array.from({ length: 16 }, (_, row) => row).flatMap((row) =>
    (variant === "no_swap" ? [0] : AGENT_IDS).map((event) => {
      const initial = AGENT_IDS.map((agent) => (row >> (3 - agent)) & 1), current = [...initial];
      if (event) [current[0], current[event]] = [current[event], current[0]];
      return { initial, current, event };
    }));
  const all = (1n << BigInt(worlds.length)) - 1n;
  const valuesMask = (predicate) => worlds.reduce((mask, world, i) =>
    predicate(world) ? mask | (1n << BigInt(i)) : mask, 0n);
  const facts = valuesMask((world) => factRows.includes(rowOf(world.current)));
  const bits = AGENT_IDS.map((a) => valuesMask((world) => world.current[a]));
  const views = AGENT_IDS.map((a) => worlds.map((world) => [
    ...(a === 0 && variant === "forget_A" ? [] : [`own=${world.initial[a]}`]),
    ...(a === 1 || variant === "public_event" ? [`e=${world.event}`] : []),
    ...(a === 0 ? [`now=${world.current[0]}`] : []),
  ].join("|")));
  const stages = [], uniqueStages = [], caches = [], reports = [];
  const appendStage = () => {
    stages.push(views.map((agentViews) => {
      const groups = new Map();
      agentViews.forEach((key, i) => groups.set(key, (groups.get(key) ?? 0n) | (1n << BigInt(i))));
      return agentViews.map((key) => groups.get(key));
    }));
    uniqueStages.push(stages.at(-1).map((cells) => [...new Set(cells)]));
    caches.push(new Map());
  };
  const truth = (p, stage) => {
    if (p[0] === "F") return facts;
    if (p[0] === "bit") return bits[p[1]];
    const key = formulaKey(p), cache = caches[stage];
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let value = 0n;
    if (p[0] === "not") value = all ^ truth(p[1], stage);
    else {
      const inner = truth(p[2], stage);
      if (inner === all) value = all;
      else if (inner === 0n) value = p[0] === "W" ? all : 0n;
      else for (const cell of uniqueStages[stage][p[1]]) {
        if ((cell & inner) === cell || (p[0] === "W" && (cell & inner) === 0n)) value |= cell;
      }
    }
    cache.set(key, value);
    return value;
  };
  appendStage();
  replies.forEach(({ speaker, listener, formula }, step) => {
    const value = truth(formula, step);
    reports.push(value);
    if (!ignored) for (const a of variant === "public_reports" ? AGENT_IDS : [speaker, listener])
      worlds.forEach((_, i) => { views[a][i] += `|r${step}=${Number(has(value, i))}`; });
    appendStage();
  });
  const actualIndex = (actual) => worlds.findIndex((world) => rowOf(world.initial) === rowOf(actual.initial)
    && world.event === (variant === "no_swap" ? 0 : actual.event));
  const ids = (mask) => worlds.flatMap((world, i) => has(mask, i) ? [historyId(world)] : []);
  return { worlds, all, stages, reports, truth, actualIndex, ids };
}

// Exhaustive syntax pool keeps selection bounded and reproducible. Adjacent
// modal operators never use the same agent, removing introspection identities.
const atoms = [["F"], ...AGENT_IDS.map((a) => ["bit", a])];
const bases = atoms.flatMap((p) => [p, ["not", p]]);
const firstOrder = bases.flatMap((p) => AGENT_IDS.flatMap((a) => [["K", a, p], ["W", a, p]]));
const extend = (pool) => pool.flatMap((p) => AGENT_IDS.filter((a) => a !== p[1])
  .flatMap((a) => [["K", a, p], ["W", a, p]]));
const secondOrder = extend(firstOrder);
const queryPool = [...secondOrder, ...extend(secondOrder)];
const replyPool = [...firstOrder, ...secondOrder];
const varies = (mask, all) => mask !== 0n && mask !== all;

function candidateQueries(run) {
  if (run.queryCandidates) return run.queryCandidates;
  const candidates = [], seen = new Set();
  // The finite exclusion family is every atom or one K/W over a signed atom,
  // including outer negations, plus speaking-time replies and complements.
  // Arbitrary Boolean combinations are outside this filter's scope.
  const shallowSignatures = new Set(), replySignatures = new Set();
  for (const formula of [...bases, ...firstOrder]) {
    const value = run.truth(formula, FINAL_STAGE);
    shallowSignatures.add(value); shallowSignatures.add(run.all ^ value);
  }
  for (const value of run.reports) {
    replySignatures.add(value); replySignatures.add(run.all ^ value);
  }
  const counts = { syntaxCandidatesExamined: queryPool.length, constantCandidates: 0,
    completeShallowAliases: 0, speakingReplyAliases: 0, aliasCandidatesRejected: 0,
    otherProjectionRejections: 0, duplicateSignatures: 0, acceptedCandidates: 0 };
  for (const formula of queryPool) {
    const values = run.truth(formula, FINAL_STAGE);
    if (!varies(values, run.all)) { counts.constantCandidates++; continue; }
    const shallowAlias = shallowSignatures.has(values), replyAlias = replySignatures.has(values);
    if (shallowAlias) counts.completeShallowAliases++;
    if (replyAlias) counts.speakingReplyAliases++;
    if (shallowAlias || replyAlias) { counts.aliasCandidatesRejected++; continue; }
    const physical = run.truth(formula, 0);
    const beforeFinal = run.truth(formula, FINAL_STAGE - 1);
    const shallow = run.truth([formula[0], formula[1], atom(formula)], FINAL_STAGE);
    const shallowSigned = run.truth([formula[0], formula[1], signedAtom(formula)], FINAL_STAGE);
    const child = run.truth(formula[2], FINAL_STAGE);
    const atomic = run.truth(atom(formula), FINAL_STAGE);
    if (values === physical || values === beforeFinal || values === shallow || values === shallowSigned || values === child
      || values === atomic || values === (run.all ^ atomic)) { counts.otherProjectionRejections++; continue; }
    // Retain one shortest representative per semantic question and outer
    // operator. Distinct syntax must not inflate the apparent question count.
    const key = `${formula[0]}:${formula[1]}:${values}`;
    if (seen.has(key)) { counts.duplicateSignatures++; continue; }
    seen.add(key);
    candidates.push({ formula, values, physical, beforeFinal, shallow, shallowSigned, child, atomic });
  }
  counts.acceptedCandidates = candidates.length;
  run.filterCounts = counts;
  run.queryCandidates = candidates;
  return candidates;
}

function chooseQuestions(random, runs, actual) {
  const main = runs.main, mainIndex = main.actualIndex(actual);
  // Most rejected protocols cannot supply a valid factual pair. Defer the
  // four counterfactual syntax scans until the factual pair is feasible.
  const pools = { main: candidateQueries(main) };
  const fitsEvidence = (run, q, index) => !has(q.values, index)
    || bitCount(run.stages[FINAL_STAGE][q.formula[1]][index]) <= EVIDENCE_CELL_CAP;
  const factualChanged = pools.main.filter((q) => has(q.values ^ q.physical, mainIndex) && fitsEvidence(main, q, mainIndex));
  const factualUnchanged = pools.main.filter((q) => !has(q.values ^ q.physical, mainIndex) && fitsEvidence(main, q, mainIndex));
  if (!factualChanged.length || !factualUnchanged.length) return null;
  const flippedD = { initial: actual.initial.map((bit, agent) => agent === 3 ? 1 - bit : bit), event: actual.event };
  const flippedIndex = main.actualIndex(flippedD);
  const mainPairs = factualChanged.flatMap((first) => factualUnchanged.filter((second) =>
    [first, second].filter((q) => has(q.values ^ q.beforeFinal, mainIndex)).length === 1
      && [first, second].some((q) => has(q.values, flippedIndex) !== has(q.values, mainIndex)))
    .map((second) => [first, second]));
  if (!mainPairs.length) return null;
  const variants = random.shuffle(Object.keys(variantDescriptions).filter((v) => v !== "main"));
  const variantsWithPairs = variants.map((variant) => {
    const run = runs[variant], index = run.actualIndex(actual), changed = [], unchanged = [];
    for (const candidate of candidateQueries(run)) {
      if (!fitsEvidence(run, candidate, index)) continue;
      const factualValues = main.truth(candidate.formula, FINAL_STAGE);
      if (!varies(factualValues, main.all)) continue;
      const q = { ...candidate, variant, factualValues, value: has(candidate.values, index), index };
      (q.value !== has(factualValues, mainIndex) ? changed : unchanged).push(q);
    }
    return { variant, changed, unchanged };
  }).filter(({ changed, unchanged }) => changed.length && unchanged.length);
  if (variantsWithPairs.length < 2) return null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const pair = random.shuffle(variantsWithPairs).slice(0, 2);
    // Balance only the complete counterfactual batch. An intervention may
    // change zero, one, or both of its answers, and positions reveal nothing.
    const changes = random.shuffle([true, true, false, false]);
    const selected = pair.flatMap(({ changed, unchanged }, i) => [0, 1]
      .map((offset) => random.choose(changes[2 * i + offset] ? changed : unchanged)));
    const mains = random.choose(mainPairs).map((q) => ({ ...q, variant: "main",
      factualValues: q.values, value: has(q.values, mainIndex), index: mainIndex }));
    const questions = [...mains, ...random.shuffle(selected)];
    if (questions.some((q) => q.value && bitCount(runs[q.variant].stages[FINAL_STAGE][q.formula[1]][q.index]) > EVIDENCE_CELL_CAP)) continue;
    const mentionsD = (p) => p[0] === "K" || p[0] === "W" ? p[1] === 3 || mentionsD(p[2])
      : p[0] === "not" && mentionsD(p[1]);
    if (!questions.some((q) => mentionsD(q.formula))) continue;
    if (mains.filter((q) => has(q.beforeFinal, q.index) !== q.value).length !== 1) continue;
    if (questions.filter((q) => q.value).length !== 3) continue;
    if (!["K", "W"].every((operator) => questions.some((q) => !q.value && q.formula[0] === operator))) continue;
    if (new Set(questions.map((q) => JSON.stringify(q.formula))).size !== questions.length) continue;
    // Filter both a shortcut AND its inverse. Globally different formulas
    // alone do not prevent an accidental six-for-six actual-answer shortcut.
    if (["physical", "beforeFinal", "shallow", "shallowSigned", "atomic", "child"].some((baseline) => {
      const matches = questions.filter((q) => has(q[baseline], q.index) === q.value).length;
      return matches < 2 || matches > 4;
    })) continue;
    // Prevent every false certificate from being witnessed by the actual
    // history: at least one counterexample must be an alternative history.
    if (!questions.some((q) => !q.value && q.formula[0] === "K"
      && has(runs[q.variant].truth(q.formula[2], FINAL_STAGE), q.index))) continue;
    return random.shuffle(questions).map((q, i) => ({ ...q, id: `q${i + 1}`, stage: FINAL_STAGE }));
  }
  return null;
}

function evidenceFor(run, question, actual) {
  const index = run.actualIndex(actual), cell = run.stages[question.stage][question.formula[1]][index];
  const inner = run.truth(question.formula[2], question.stage), value = has(run.truth(question.formula, question.stage), index);
  const possible = run.ids(cell), trueHistories = run.ids(cell & inner), falseHistories = run.ids(cell & (run.all ^ inner));
  const evidence = value ? possible : question.formula[0] === "K" ? [falseHistories[0]] : [trueHistories[0], falseHistories[0]];
  return { value, possible, trueHistories, falseHistories, evidence };
}

function selectCells(random, runs, actual, questions) {
  const candidates = [];
  const mainIndex = runs.main.actualIndex(actual);
  const trueEvidence = questions.filter((question) => question.value).map((question) => ({
    variant: question.variant, values: evidenceFor(runs[question.variant], question, actual).possible,
  }));
  for (const variant of new Set(questions.map((q) => q.variant))) {
    const run = runs[variant], index = run.actualIndex(actual);
    for (const agent of AGENT_IDS) for (const stage of [1, 2, 3]) {
      const cell = run.stages[stage][agent][index], physical = run.stages[0][agent][index];
      if (bitCount(cell) < 2 || bitCount(cell) > EVIDENCE_CELL_CAP || cell === physical) continue;
      const values = run.ids(cell);
      const factual = runs.main.ids(runs.main.stages[stage][agent][mainIndex]);
      if (variant !== "main" && JSON.stringify(values) === JSON.stringify(factual)) continue;
      const duplicatesTrueEvidence = trueEvidence.some((evidence) => evidence.variant === variant
        && JSON.stringify(evidence.values) === JSON.stringify(values));
      candidates.push({ variant, stage, agent, values, physical: run.ids(physical), factual, duplicatesTrueEvidence });
    }
  }
  const shuffled = random.shuffle(candidates);
  const pairs = shuffled.filter((cell) => cell.variant === "main").flatMap((first) =>
    shuffled.filter((cell) => cell.variant !== "main" && JSON.stringify(cell.values) !== JSON.stringify(first.values))
      .map((second) => [first, second]));
  pairs.sort((a, b) => a.filter((cell) => cell.duplicatesTrueEvidence).length
    - b.filter((cell) => cell.duplicatesTrueEvidence).length);
  return pairs.length ? pairs[0].map((cell, i) => ({ ...cell, id: `cell${i + 1}` })) : null;
}

export function generateSingle(seed) {
  const random = randomSource(seed);
  const generationMetrics = { syntaxCandidatesExamined: 0, constantCandidates: 0,
    completeShallowAliases: 0, speakingReplyAliases: 0, aliasCandidatesRejected: 0,
    otherProjectionRejections: 0, duplicateSignatures: 0, acceptedCandidates: 0,
    protocolModelsExamined: 0, actualHistoriesConsidered: 0, actualHistoriesWithoutQuestionBatch: 0,
    actualHistoriesWithoutCellPair: 0 };
  let selected;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS && !selected; attempt++) {
    const factRows = random.shuffle([...Array(16).keys()]).slice(0, 5 + random.integer(7)).sort((a, b) => a - b);
    const speaker = random.integer(2), listener = random.choose(AGENT_IDS.filter((a) => a !== speaker));
    const physical = protocol(factRows, []);
    const firstReplies = replyPool.filter((p) => p[1] === speaker && varies(physical.truth(p, 0), physical.all));
    if (!firstReplies.length) continue;
    const first = { speaker, listener, formula: random.choose(firstReplies) };
    const partial = protocol(factRows, [first]);
    const secondReplies = replyPool.filter((p) => p[1] === listener && varies(partial.truth(p, 1), partial.all)
      && bitCount(partial.truth(p, 1) ^ partial.truth(p, 0)) >= 4);
    if (!secondReplies.length) continue;
    const thirdSpeaker = random.choose(AGENT_IDS.filter((a) => a !== speaker && a !== listener));
    const finalListener = AGENT_IDS.find((a) => a !== speaker && a !== listener && a !== thirdSpeaker);
    const second = { speaker: listener, listener: thirdSpeaker, formula: random.choose(secondReplies) };
    const twice = protocol(factRows, [first, second]);
    const secondCausalWorlds = twice.reports[1] ^ twice.truth(second.formula, 0);
    const thirdReplies = replyPool.filter((p) => p[1] === thirdSpeaker && varies(twice.truth(p, 2), twice.all)
      && bitCount(twice.truth(p, 2) ^ twice.truth(p, 1)) >= 4
      && (secondCausalWorlds & (twice.truth(p, 2) ^ twice.truth(p, 1))));
    if (!thirdReplies.length) continue;
    const replies = [first, second,
      { speaker: thirdSpeaker, listener: finalListener, formula: random.choose(thirdReplies) }];
    const main = protocol(factRows, replies);
    if (!main.reports.every((value) => varies(value, main.all))) continue;
    const report2WithoutReply1 = main.truth(replies[1].formula, 0);
    const causalWorlds2 = main.reports[1] ^ report2WithoutReply1;
    const causalWorlds3 = main.reports[2] ^ main.truth(replies[2].formula, 1);
    const causalWorlds = causalWorlds2 & causalWorlds3;
    if (bitCount(causalWorlds2) < 4 || bitCount(causalWorlds3) < 4 || !causalWorlds) continue;
    const runs = { main, ...Object.fromEntries(Object.keys(variantDescriptions).filter((v) => v !== "main")
      .map((variant) => [variant, protocol(factRows, replies, variant)])) };
    for (const actualIndex of random.shuffle([...Array(WORLD_COUNT).keys()]).filter((i) => has(causalWorlds, i))) {
      generationMetrics.actualHistoriesConsidered++;
      const actual = { initial: main.worlds[actualIndex].initial, event: main.worlds[actualIndex].event };
      const questions = chooseQuestions(random, runs, actual);
      if (!questions) { generationMetrics.actualHistoriesWithoutQuestionBatch++; continue; }
      const cells = selectCells(random, runs, actual, questions);
      if (cells) { selected = { factRows, replies, actual, questions, cells, runs, attempt, causalWorlds,
        causalWorlds2, causalWorlds3 }; break; }
      generationMetrics.actualHistoriesWithoutCellPair++;
    }
    for (const run of Object.values(runs)) if (run.filterCounts) {
      generationMetrics.protocolModelsExamined++;
      for (const [name, value] of Object.entries(run.filterCounts)) generationMetrics[name] += value;
    }
  }
  if (!selected) throw Error(`Could not generate causally filtered private knowledge task in ${MAX_GENERATION_ATTEMPTS} attempts`);
  const { factRows, replies, actual, questions, cells, runs, attempt, causalWorlds,
    causalWorlds2, causalWorlds3 } = selected;
  const answer = {}, response = {}, weights = {}, certificates = {}, baselines = {};
  for (const name of ["constantFalse", "constantTrue", "ignoreUpdates", "ignoreFinalReply", "factualCopy", "inverseFactual", "shallow", "shallowSigned", "atomic", "child", "physicalEvidence"])
    baselines[name] = {};
  for (const question of questions) {
    const { id, variant, formula } = question, run = runs[variant], index = run.actualIndex(actual);
    const certificate = evidenceFor(run, question, actual);
    certificates[id] = { operator: formula[0], ...certificate };
    answer[id] = certificate.value; answer[`${id}Evidence`] = certificate.evidence;
    response[id] = "boolean"; response[`${id}Evidence`] = "History[]";
    weights[id] = 4; weights[`${id}Evidence`] = 9;
    baselines.constantFalse[id] = false; baselines.constantTrue[id] = true;
    baselines.ignoreUpdates[id] = has(question.physical, index);
    baselines.ignoreFinalReply[id] = has(question.beforeFinal, index);
    baselines.factualCopy[id] = has(question.factualValues, runs.main.actualIndex(actual));
    baselines.inverseFactual[id] = !baselines.factualCopy[id];
    baselines.shallow[id] = has(question.shallow, index);
    baselines.shallowSigned[id] = has(question.shallowSigned, index);
    baselines.atomic[id] = has(question.atomic, index);
    baselines.child[id] = has(question.child, index);
    baselines.physicalEvidence[`${id}Evidence`] = run.ids(run.stages[0][formula[1]][index]);
  }
  for (const cell of cells) {
    answer[cell.id] = cell.values; response[cell.id] = "History[]"; weights[cell.id] = 11;
    baselines.physicalEvidence[cell.id] = cell.physical;
  }
  const publicData = { factRows, replies, actual,
    questions: questions.map(({ id, variant, stage, formula }) => ({ id, variant, stage, formula })),
    cells: cells.map(({ id, variant, stage, agent }) => ({ id, variant, stage, agent })) };
  const variants = [...new Set(questions.map((q) => q.variant).filter((v) => v !== "main"))];
  const prompt = `Four agents A, B, C, D initially have bits (a0,b0,c0,d0). All sixteen bit tuples and all four events are possible independently: e=0 does nothing; e=1 swaps A's and B's bits; e=2 swaps A's and C's bits; e=3 swaps A's and D's bits. There are 64 possible initial-tuple/event histories. The post-event bits are (a,b,c,d). Each agent initially sees only their own bit. After the event only A privately sees their current bit and only B privately learns e. C and D get no new observations. There are no other observations.

F is true exactly when the post-event bits (a,b,c,d), written abcd, are one of: ${factRows.map((row) => row.toString(2).padStart(4, "0")).join(", ")}.

K_X(P) means P is true in every history consistent with X's observations at that stage. W_X(P) means K_X(P) OR K_X(NOT(P)): X knows whether P, not necessarily that P is true. Agents reason perfectly, remember every observation and commonly know the protocol. The actual history below is given to you only; it provides no extra observation to the agents. Every nested operator is evaluated at the specified stage, not at an earlier stage. a, b, c, d always mean current post-event bits.

After the physical observations, three mandatory Boolean replies occur:
${replies.map(({ speaker, listener, formula }, i) => `${i + 1}. ${AGENTS[speaker]} answers the Boolean question ${render(formula)}; only ${AGENTS[listener]} hears ${AGENTS[speaker]}'s reply.`).join("\n")}
Speakers remember their own replies. Everyone knows who hears each reply and that all three replies happen. Nobody else hears the value. An unheard reply is not a public announcement: nonlisteners retain histories with either reply value. Evaluate each reply using knowledge immediately before it, then update only the speaker and listener's observations.

Actual initial bits (a0,b0,c0,d0): (${actual.initial.join(",")}); actual event e=${actual.event}.

Stages: physical = after bit/event observations, before replies; after reply 1 = immediately after reply 1; after reply 2 = immediately after reply 2; final = after all three replies.
Variant main uses the factual protocol. Each other variant independently restarts the entire protocol with the same actual initial bits and event, except where changed below. All agents commonly know the changed rule from the start. Recompute all three replies and every knowledge claim; do not reuse factual reply values.
${variants.map((variant) => `Variant ${variant}: ${variantDescriptions[variant]}.`).join("\n")}

Answer each Boolean claim and its evidence checkpoint:
${questions.map(({ id, variant, stage, formula }) => `- ${id}: variant ${variant}; stage ${stageNames[stage]}; ${render(formula)}.`).join("\n")}

For every qN, qNEvidence is an array of history IDs. A history ID is the INITIAL bits, a colon, and the event: for example "0110:2". Never encode post-event bits in an ID. Evidence always uses the question's variant and stage and the OUTERMOST agent's information cell at the actual history. In no_swap, only IDs ending in :0 exist.
- For a TRUE K or W claim, give ALL histories in that information cell.
- For a FALSE K_X(P) claim, give ANY ONE history in that cell where P is false.
- For a FALSE W_X(P) claim, give ANY TWO histories in that cell where P has opposite truth values. Either order is accepted.
The inner P, including its nested knowledge, is evaluated separately at each witness history in the question's model and stage. Empty evidence is never valid. Evidence is checked against the true claim value, independently of your submitted Boolean; a wrong or omitted Boolean does not invalidate otherwise correct evidence.

Also give these exact information cells, including every history the named agent considers possible at the actual history:
${cells.map(({ id, variant, stage, agent }) => `- ${id}: variant ${variant}; stage ${stageNames[stage]}; agent ${AGENTS[agent]}.`).join("\n")}

All arrays must contain distinct valid history IDs; order does not matter. Scoring is additive: each qN Boolean earns 4 points, each qNEvidence earns 9 points, and each cell earns 11 points (100 total). A field earns its points only when exact or, for a false claim, when it is a valid witness as defined above; omitted fields earn zero. Complete-task success requires every checkpoint. Submit whichever fields you have solved; fields are graded independently.`;
  const types = { History: "a string abcd:e, with initial bits abcd in 0000..1111 and event e in 0..3, e.g. 0110:2",
    "History[]": "array of distinct History strings, in any order" };
  const task = { family: "private-knowledge", response, types, answer, solution: structuredClone(answer),
    metadata: { public: structuredClone(publicData), weights, certificates, baselines, generationAttempts: attempt,
      nAgents: 4, worldCount: 64, generationMetrics,
      acceptedProtocolFilterCounts: Object.fromEntries(Object.entries(runs).map(([variant, run]) => [variant, run.filterCounts])),
      quality: { histories: 64, agents: 4, replies: 3, reply2CausalWorlds: bitCount(causalWorlds2), reply2CausalAtActual: true,
        reply3CausalWorlds: bitCount(causalWorlds3), reply3CausalAtActual: true,
        fullChainCausalWorlds: bitCount(causalWorlds), fourAgentMessagePath: true,
        fourthInitialBitChangesActualMainAnswer: true, fourthAgentInQuery: true, evidenceCellCap: EVIDENCE_CELL_CAP,
        queries: questions.length, trueClaims: questions.filter((q) => q.value).length,
        counterfactualQuestions: 4, counterfactualChanged: 2, counterfactualUnchanged: 2,
        globallyUpdateDependent: 6, globallyFinalReplyDependent: 6,
        globallyShallowDistinct: 6, globallySignedShallowDistinct: 6,
        globallyAtomicAndNegatedAtomicDistinct: 6, nonconstant: 6,
        globallyDistinctFromEverySignedDepthZeroOrOneFormula: 6,
        globallyDistinctFromSpeakingRepliesAndNegations: 6,
        mainQuestionsUpdateDependentAtActual: 1, mainQuestionsUnchangedAtActual: 1,
        mainQuestionsFinalReplyDependentAtActual: 1, mainQuestionsFinalReplyUnchangedAtActual: 1,
        shortcutAndInverseMaximumBooleanMatches: 4, exactCellsDifferFromPhysical: 2,
        counterfactualCellDiffersFromFactual: true,
        exactCellsDuplicatingTrueEvidence: cells.filter((cell) => cell.duplicatesTrueEvidence).length },
      scoringVersion: "private-knowledge-no-shallow-alias-v1" } };
  return { prompt, types, response, answer: { checkpoint: { version: 1, family: task.family, task } } };
}

// Frozen three-agent keys remain scoreable. Shape validation admits both
// canonical encodings; each certificate's exact world membership then excludes
// histories of the wrong width, event range, variant, or information cell.
const historyArray = (actual) => Array.isArray(actual) && actual.length <= WORLD_COUNT
  && Array.from({ length: actual.length }, (_, i) => Object.hasOwn(actual, i)
    && typeof actual[i] === "string" && /^(?:[01]{3}:[012]|[01]{4}:[0123])$/.test(actual[i])).every(Boolean)
  && new Set(actual).size === actual.length;
const sameHistories = (actual, expected) => historyArray(actual) && sameSet(actual, expected);

export function gradeSingle(task, draft) {
  const supplied = isObject(draft) ? draft : {};
  const checkpoints = Object.entries(task.metadata.weights).map(([id, max]) => {
    let correct = false;
    const present = Object.hasOwn(supplied, id), actual = supplied[id];
    if (present && id.endsWith("Evidence")) {
      const certificate = task.metadata.certificates[id.slice(0, -8)];
      if (certificate.value) correct = sameHistories(actual, certificate.possible);
      else if (certificate.operator === "K") correct = historyArray(actual) && actual.length === 1
        && certificate.falseHistories.includes(actual[0]);
      else correct = historyArray(actual) && actual.length === 2
        && ((certificate.trueHistories.includes(actual[0]) && certificate.falseHistories.includes(actual[1]))
          || (certificate.falseHistories.includes(actual[0]) && certificate.trueHistories.includes(actual[1])));
    } else if (present) correct = Array.isArray(task.answer[id]) ? sameHistories(actual, task.answer[id])
      : typeof actual === "boolean" && actual === task.answer[id];
    return { id, earned: correct ? max : 0, max,
      detail: correct ? "valid" : present ? "incorrect" : "omitted" };
  });
  const points = (predicate) => checkpoints.filter(({ id }) => predicate(id)).reduce((sum, c) => sum + c.earned, 0);
  const percent = points(() => true);
  return { taskId: task.id, family: task.family,
    submitted: Object.keys(task.response).some((id) => Object.hasOwn(supplied, id)), percent,
    fullyCorrect: percent === 100, checkpoints,
    diagnostics: { fields: Object.fromEntries(checkpoints.map(({ id, earned }) => [id, earned > 0])),
      booleanPoints: points((id) => /^q\d+$/.test(id)), evidencePoints: points((id) => id.endsWith("Evidence")),
      informationCellPoints: points((id) => /^cell\d+$/.test(id)), allCheckpointsCorrect: percent === 100 } };
}

/** Two independently seeded protocols preserve the hard tier's two-scenario
 * workload. Rejection examines public structure only, never answer equality. */
export function generate(seed) {
  const scenarioSeed = (label, attempt = 0) => createHmac("sha256", seed)
    .update(`private-knowledge-four-agents-pair/v1/${label}/${attempt}`).digest("hex");
  const first = generateSingle(scenarioSeed("first"));
  const firstPublic = first.answer.checkpoint.task.metadata.public;
  let second, secondAttempts = 0;
  for (; secondAttempts < 32; secondAttempts++) {
    const candidate = generateSingle(scenarioSeed("second", secondAttempts));
    const candidatePublic = candidate.answer.checkpoint.task.metadata.public;
    if (JSON.stringify(firstPublic.factRows) === JSON.stringify(candidatePublic.factRows)
      || JSON.stringify(firstPublic.replies) === JSON.stringify(candidatePublic.replies)) continue;
    second = candidate;
    break;
  }
  if (!second) throw Error("Could not generate distinct independent knowledge scenarios in 32 attempts");
  const scenarios = { scenarioA: first.answer.checkpoint.task, scenarioB: second.answer.checkpoint.task };
  const response = Object.fromEntries(Object.entries(scenarios).map(([id, task]) => [id, task.response]));
  const answer = Object.fromEntries(Object.entries(scenarios).map(([id, task]) => [id, task.answer]));
  const weights = Object.fromEntries(Object.entries(scenarios).flatMap(([scenario, task]) =>
    Object.entries(task.metadata.weights).map(([id, points]) => [`${scenario}.${id}`, points / 2])));
  const baselines = Object.fromEntries(Object.keys(scenarios.scenarioA.metadata.baselines).map((name) => [name,
    Object.fromEntries(Object.entries(scenarios).map(([id, task]) => [id, task.metadata.baselines[name]]))]));
  const types = first.types;
  const prompt = `Solve TWO independent private-knowledge scenarios. The agents, histories, facts and replies reset completely between them. No observation or reply from one scenario informs the other.

Submit one JSON object with top-level keys scenarioA and scenarioB. Inside each key, use that scenario's q1..q6, q1Evidence..q6Evidence, cell1 and cell2 fields. For example, {"scenarioA":{"q1":true,"q1Evidence":["0110:2"]},"scenarioB":{"cell1":["0000:0","0001:0"]}} illustrates nesting only; the example is not a proposed answer. You may submit any subset of fields in either scenario.

Each scenario below uses its own 100-point scale. The task score is their arithmetic mean, so each scenario contributes at most 50 task points. There are 28 independently scored checkpoints in total; complete-task success requires all of them. The Boolean/evidence/cell weighting remains 24/54/22 across the task.

SCENARIO A
${first.prompt}

SCENARIO B
${second.prompt}`;
  const task = { family: "private-knowledge", response, types, answer, solution: structuredClone(answer), scenarios,
    metadata: { public: { scenarios: Object.fromEntries(Object.entries(scenarios)
      .map(([id, scenario]) => [id, structuredClone(scenario.metadata.public)])) }, weights, baselines,
      generationAttempts: Object.values(scenarios).reduce((sum, scenario) => sum + scenario.metadata.generationAttempts, 0),
      scenarioGenerationAttempts: Object.fromEntries(Object.entries(scenarios)
        .map(([id, scenario]) => [id, scenario.metadata.generationAttempts])),
      secondScenarioDraws: secondAttempts + 1,
      nAgents: 4, worldCount: 64,
      scenarioGenerationMetrics: Object.fromEntries(Object.entries(scenarios).map(([id, scenario]) => [id, scenario.metadata.generationMetrics])),
      quality: { scenarios: 2, agentsPerScenario: 4, historiesPerScenario: 64, repliesPerScenario: 3, checkpoints: 28,
        fourthInitialBitChangesActualMainAnswerPerScenario: true, evidenceCellCap: EVIDENCE_CELL_CAP,
        distinctPublicFactTables: true, distinctPublicReplies: true, independentSeedDomains: true,
        queries: 12, trueClaims: 6, counterfactualQuestions: 8, counterfactualChanged: 4, counterfactualUnchanged: 4,
        globallyUpdateDependent: 12, globallyFinalReplyDependent: 12, globallyShallowDistinct: 12,
        globallySignedShallowDistinct: 12, globallyAtomicAndNegatedAtomicDistinct: 12, nonconstant: 12,
        globallyDistinctFromEverySignedDepthZeroOrOneFormula: 12,
        globallyDistinctFromSpeakingRepliesAndNegations: 12,
        mainQuestionsUpdateDependentAtActual: 2, mainQuestionsUnchangedAtActual: 2,
        mainQuestionsFinalReplyDependentAtActual: 2, mainQuestionsFinalReplyUnchangedAtActual: 2,
        shortcutAndInverseMaximumBooleanMatchesPerScenario: 4, exactCellsDifferFromPhysical: 4,
        counterfactualCellsDifferFromFactual: 2,
        exactCellsDuplicatingTrueEvidence: Object.values(scenarios)
          .reduce((sum, scenario) => sum + scenario.metadata.quality.exactCellsDuplicatingTrueEvidence, 0) },
      scoringVersion: "private-knowledge-paired-no-shallow-alias-v1" } };
  return { prompt, types, response, answer: { checkpoint: { version: 1, family: task.family, task } } };
}

/** Legacy single-scenario checkpoints remain scoreable without regenerating
 * their private state. Paired tasks normalize each independent scale to 50. */
export function gradeTask(task, draft) {
  if (!isObject(task.scenarios)) return gradeSingle(task, draft);
  const supplied = isObject(draft) ? draft : {};
  const results = Object.entries(task.scenarios).map(([id, scenario]) => ({ id,
    result: gradeSingle(scenario, Object.hasOwn(supplied, id) ? supplied[id] : undefined) }));
  const divisor = results.length;
  const checkpoints = results.flatMap(({ id, result }) => result.checkpoints.map((checkpoint) => ({
    ...checkpoint, id: `${id}.${checkpoint.id}`, earned: checkpoint.earned / divisor, max: checkpoint.max / divisor,
  })));
  const percent = results.reduce((sum, { result }) => sum + result.percent, 0) / divisor;
  return { taskId: task.id, family: task.family,
    submitted: results.some(({ result }) => result.submitted), percent,
    fullyCorrect: results.every(({ result }) => result.fullyCorrect), checkpoints,
    diagnostics: { fields: Object.fromEntries(checkpoints.map(({ id, earned }) => [id, earned > 0])),
      booleanPoints: results.reduce((sum, { result }) => sum + result.diagnostics.booleanPoints, 0) / divisor,
      evidencePoints: results.reduce((sum, { result }) => sum + result.diagnostics.evidencePoints, 0) / divisor,
      informationCellPoints: results.reduce((sum, { result }) => sum + result.diagnostics.informationCellPoints, 0) / divisor,
      scenarios: Object.fromEntries(results.map(({ id, result }) => [id, { percent: result.percent,
        fullyCorrect: result.fullyCorrect, submitted: result.submitted, ...result.diagnostics }])),
      allCheckpointsCorrect: percent === 100 } };
}
