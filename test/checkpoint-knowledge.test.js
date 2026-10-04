import test from "node:test";
import assert from "node:assert/strict";
import { generate as generatePair, generateSingle as generate, gradeTask } from "../src/checkpoint-knowledge.js";
import { relationOracle, evidenceOracle, publicCheckpoints, publicScenarios } from "./knowledge-oracle.js";

const privateTask = (generated) => generated.answer.checkpoint.task;
// Seed 13 is the first whose questions use the rare forget_A intervention,
// which the oracle test requires to occur.
const SINGLE_SEEDS = [0, 1, 2, 13], PAIRED_SAMPLES = 4, WITNESS_SAMPLES = 4;
const SINGLE_SAMPLES = SINGLE_SEEDS.length;
const modalAgents = (formula) => formula[0] === "not" ? modalAgents(formula[1])
  : ["K", "W"].includes(formula[0]) ? [formula[1], ...modalAgents(formula[2])] : [];
const shallowPools = new Map();
// This finite grammar includes signed F/current-bit atoms and one K/W over
// each signed atom, plus outer negations. It excludes arbitrary Boolean
// combinations; passing it does not establish irreducibility to every formula.
function finiteShallowFormulas(agentCount) {
  if (shallowPools.has(agentCount)) return shallowPools.get(agentCount);
  const agents = Array.from({ length: agentCount }, (_, index) => index);
  const atoms = [["F"], ...agents.map((index) => ["bit", index])];
  const signed = atoms.flatMap((formula) => [formula, ["not", formula]]);
  const formulas = [...signed, ...agents.flatMap((agent) => signed.flatMap((inner) =>
    ["K", "W"].flatMap((operator) => {
      const formula = [operator, agent, inner];
      return [formula, ["not", formula]];
    })))];
  shallowPools.set(agentCount, formulas);
  return formulas;
}
function assertNoFiniteAlias(model, question, label) {
  const signature = (formula) => model.worlds.map((_, index) => Number(model.formulaAt(formula, question.stage, index))).join("");
  const target = signature(question.formula), formulas = finiteShallowFormulas(model.agentCount);
  assert.equal(formulas.length, 170);
  for (const formula of formulas) assert.notEqual(signature(formula), target,
    `${label}: globally equivalent signed depth-zero/one formula ${JSON.stringify(formula)}`);
  for (const [index, reply] of model.reportValues.entries()) {
    assert.notEqual(reply.map(Number).join(""), target, `${label}: equals reply ${index + 1} at speaking time`);
    assert.notEqual(reply.map((value) => Number(!value)).join(""), target, `${label}: equals negated reply ${index + 1} at speaking time`);
  }
}
const checkpoint = (result, id) => {
  const field = result.checkpoints.find((entry) => entry.id === id);
  assert.ok(field, `No grader checkpoint named ${id}`);
  return field;
};
const points = (task, id, value) => checkpoint(gradeTask(task, { [id]: value }), id).earned;
const publicSpec = (generated) => publicCheckpoints(generated.prompt);

function reference(generated) {
  const spec = publicSpec(generated), models = new Map();
  const model = (variant) => {
    if (!models.has(variant)) models.set(variant, relationOracle(generated.prompt, variant));
    return models.get(variant);
  };
  const questions = spec.questions.map((question) => ({ ...question,
    ...evidenceOracle(model(question.variant), question) }));
  const solution = {};
  for (const question of questions) {
    solution[question.id] = question.truth;
    solution[`${question.id}Evidence`] = question.canonical;
  }
  for (const cell of spec.cells) solution[cell.id] = model(cell.variant).possible(cell.agent, cell.stage);
  return { spec, model, questions, solution };
}

test(`hard knowledge: independent accessibility oracle determines every answer across ${SINGLE_SAMPLES} fresh seeds`, () => {
  const protocols = new Set(), answerKeys = new Set(), variants = new Set(), forms = new Set();
  let changed = 0, unchanged = 0, replySensitive = 0, totalFactual = 0;
  for (const seed of SINGLE_SEEDS) {
    const generated = generate(`independent-hard-knowledge-${seed}`), task = privateTask(generated);
    const expected = reference(generated);
    assert.deepEqual(expected.spec.questions, task.metadata.public.questions);
    assert.deepEqual(expected.spec.cells, task.metadata.public.cells);
    assert.deepEqual([...expected.model("main").factRows].map((bits) => parseInt(bits, 2)), task.metadata.public.factRows);
    assert.deepEqual(expected.model("main").replies, task.metadata.public.replies);
    assert.deepEqual({ initial: expected.model("main").actualBits, event: expected.model("main").actualEvent },
      task.metadata.public.actual);
    assert.equal(expected.model("main").worlds.length, 64);
    assert.equal(expected.model("main").agentCount, 4);
    assert.equal(expected.model("main").replies.length, 3);
    assert.equal(task.family, "private-knowledge");
    assert.equal(expected.questions.length, 6);
    assert.equal(expected.spec.cells.length, 2);
    assert.equal(expected.questions.filter((question) => question.truth).length, 3);
    assert.equal(gradeTask(task, expected.solution).percent, 100, `independent solution seed ${seed}`);
    assert.equal(gradeTask(task, task.solution).percent, 100, `saved solution seed ${seed}`);
    assert.equal(gradeTask(task, task.solution).fullyCorrect, true);
    const weights = gradeTask(task, {}).checkpoints;
    assert.equal(weights.length, 14);
    assert.equal(weights.reduce((sum, field) => sum + field.max, 0), 100);
    const main = expected.model("main");
    assert.equal(main.finalStage, 3);
    assert.equal(new Set(main.replies.map((reply) => reply.speaker)).size, 3);
    assert.equal(new Set([...main.replies.map((reply) => reply.speaker), main.replies[2].listener]).size, 4);
    for (let step = 0; step < 2; step++) assert.equal(main.replies[step].listener, main.replies[step + 1].speaker);
    for (let step = 1; step < 3; step++) {
      const unreplied = relationOracle(generated.prompt, "main", { skipReplies: [step] });
      assert.notEqual(main.reports[step], unreplied.reports[step], `Reply ${step + 1} must depend on its predecessor at the actual history`);
      assert.ok(main.reportValues[step].filter((value, i) => value !== unreplied.reportValues[step][i]).length >= 4,
        "Reply dependency must affect more than an isolated history");
    }
    const outcomesByVariant = new Map(), factualChanges = [], finalReplyChanges = [];
    const shortcuts = { atomic: 0, shallow: 0, shallowSigned: 0, child: 0, ignoreUpdates: 0, ignoreFinalReply: 0 };
    let requiresAlternativeCounterexample = false, fourthBitCausal = false, modalD = false;
    for (const question of expected.questions) {
      assert.equal(question.stage, 3);
      assert.equal(task.solution[question.id], question.truth);
      assert.ok(question.validEvidence(task.solution[`${question.id}Evidence`]), `canonical proof ${question.id}`);
      assert.ok(question.canonical.length <= 12);
      if (modalAgents(question.formula).includes(3)) modalD = true;
      const certificate = task.metadata.certificates[question.id];
      assert.equal(certificate.value, question.truth);
      assert.deepEqual(certificate.possible, question.cell);
      assert.deepEqual(certificate.trueHistories, question.cell.filter((history) => question.innerTruth[history]));
      assert.deepEqual(certificate.falseHistories, question.cell.filter((history) => !question.innerTruth[history]));
      forms.add(`${question.formula[0]}:${question.truth}`);
      const model = expected.model(question.variant);
      assert.equal(model.worlds.length, question.variant === "no_swap" ? 16 : 64);
      assertNoFiniteAlias(model, question, `Single seed ${seed} ${question.id}`);
      const vector = (formula, stage) => model.worlds.map((_, index) => model.formulaAt(formula, stage, index));
      const values = vector(question.formula, question.stage);
      assert.ok(values.some(Boolean) && values.some((value) => !value), "Queries must vary over histories");
      assert.notDeepEqual(values, vector(question.formula, 0), "Queries must globally depend on replies");
      assert.notDeepEqual(values, vector(question.formula, 2), "Queries must globally depend on the third reply");
      let innerAtom = question.formula;
      while (["K", "W", "not"].includes(innerAtom[0])) innerAtom = innerAtom[innerAtom[0] === "not" ? 1 : 2];
      let signedAtom = question.formula;
      while (["K", "W"].includes(signedAtom[0])) signedAtom = signedAtom[2];
      assert.notDeepEqual(values, vector([question.formula[0], question.formula[1], innerAtom], question.stage),
        "Nested question must not equal its one-level modal shortcut");
      assert.notDeepEqual(values, vector([question.formula[0], question.formula[1], signedAtom], question.stage),
        "Negated atoms must not hide equivalence to a one-level modal shortcut");
      assert.notDeepEqual(values, vector(innerAtom, question.stage), "Nested question must not equal the atomic fact");
      assert.notDeepEqual(values, vector(["not", innerAtom], question.stage), "Nested question must not equal the opposite atomic fact");
      assert.notDeepEqual(values, vector(question.formula[2], question.stage),
        "Outer modal must not be semantically redundant");
      shortcuts.atomic += Number(question.truth === model.formulaAt(innerAtom, question.stage));
      shortcuts.shallow += Number(question.truth === model.formulaAt(
        [question.formula[0], question.formula[1], innerAtom], question.stage));
      shortcuts.shallowSigned += Number(question.truth === model.formulaAt(
        [question.formula[0], question.formula[1], signedAtom], question.stage));
      shortcuts.child += Number(question.truth === model.formulaAt(question.formula[2], question.stage));
      shortcuts.ignoreUpdates += Number(question.truth === model.formulaAt(question.formula, 0));
      shortcuts.ignoreFinalReply += Number(question.truth === model.formulaAt(question.formula, 2));
      if (!question.truth && question.formula[0] === "K" && model.formulaAt(question.formula[2], question.stage))
        requiresAlternativeCounterexample = true;
      if (question.variant === "main") {
        const flipped = [...main.actualBits]; flipped[3] = 1 - flipped[3];
        if (main.formulaAt(question.formula, question.stage, `${flipped.join("")}:${main.actualEvent}`) !== question.truth)
          fourthBitCausal = true;
        totalFactual++;
        const differs = question.truth !== relationOracle(generated.prompt, "main", { ignoreReplies: true })
          .formulaAt(question.formula, question.stage);
        factualChanges.push(differs);
        finalReplyChanges.push(question.truth !== model.formulaAt(question.formula, 2));
        if (differs) replySensitive++;
      } else {
        variants.add(question.variant);
        const factual = expected.model("main").formulaAt(question.formula, question.stage);
        if (factual === question.truth) unchanged++; else changed++;
        const outcomes = outcomesByVariant.get(question.variant) ?? [];
        outcomes.push(factual !== question.truth);
        outcomesByVariant.set(question.variant, outcomes);
      }
    }
    assert.equal(requiresAlternativeCounterexample, true,
      "At least one false K claim requires a counterexample different from the actual history");
    assert.ok(fourthBitCausal, "At least one factual claim must depend on D's initial bit at the actual history");
    assert.ok(modalD, "The fourth agent's knowledge must appear in a scored question");
    assert.equal(outcomesByVariant.size, 2);
    assert.deepEqual([...factualChanges].sort(), [false, true],
      "Main answers balance changed/unchanged cases so copying and inversion each earn 50%");
    assert.deepEqual([...finalReplyChanges].sort(), [false, true],
      "Main answers balance the last reply's effects so copying and inversion each earn 50%");
    assert.deepEqual([...outcomesByVariant.values()].flat().sort(), [false, false, true, true]);
    for (const [name, matches] of Object.entries(shortcuts)) assert.ok(matches >= 2 && matches <= 4,
      `${name} copying/inversion can match at most four of six truth answers, got ${matches}`);
    for (const cell of expected.spec.cells) {
      assert.deepEqual([...task.solution[cell.id]].sort(), [...expected.solution[cell.id]].sort());
      assert.ok(expected.solution[cell.id].length >= 2);
      assert.ok(expected.solution[cell.id].length <= 12);
      assert.notDeepEqual(expected.solution[cell.id], expected.model(cell.variant).possible(cell.agent, 0),
        "Scored information cells must require processing replies");
      if (cell.variant !== "main") assert.notDeepEqual(expected.solution[cell.id], expected.model("main").possible(cell.agent, cell.stage),
        "Counterfactual cell must differ from the same factual cell");
    }
    protocols.add(JSON.stringify({ rows: [...expected.model("main").factRows], replies: expected.model("main").replies }));
    answerKeys.add(JSON.stringify(expected.solution));
  }
  assert.ok(protocols.size >= Math.ceil(SINGLE_SAMPLES * 0.8), `Only ${protocols.size} distinct protocols`);
  assert.ok(answerKeys.size >= Math.ceil(SINGLE_SAMPLES * 0.95), `Only ${answerKeys.size} distinct answer sets`);
  assert.equal(changed, SINGLE_SAMPLES * 2, "Factual-copy baseline must be exactly 50% on counterfactual questions");
  assert.equal(unchanged, SINGLE_SAMPLES * 2, "Inverting every factual answer must also be exactly 50%");
  assert.equal(replySensitive, totalFactual / 2, "Ignoring replies and inverting that shortcut must both be limited");
  assert.equal(forms.size, 4, "Both K/W and true/false evidence types must occur");
  for (const variant of ["public_event", "public_reports", "forget_A"])
    assert.ok(variants.has(variant), `Observation intervention ${variant} must occur across seeds`);
  // No minimum no_swap frequency is asserted: it must pass the same strict
  // semantic filters, and each public task promises only its selected variants.
  // The parser/oracle and archived-key grading still support that intervention.
});

test("hard knowledge: deterministic serializable questions and gold-free public surfaces", () => {
  const first = generate("knowledge-contract-private-seed-812"), task = privateTask(first);
  assert.deepEqual(first, generate("knowledge-contract-private-seed-812"));
  assert.notEqual(first.prompt, generate("knowledge-contract-private-seed-813").prompt);
  const reloaded = JSON.parse(JSON.stringify(first));
  assert.equal(gradeTask(privateTask(reloaded), privateTask(reloaded).solution).percent, 100);
  assert.equal(first.prompt.includes("knowledge-contract-private-seed-812"), false);
  assert.equal(first.prompt.includes('"solution"'), false);
  assert.equal(first.prompt.includes('"answer"'), false);
  assert.equal(first.prompt.includes("generationAttempts"), false);
  assert.equal(JSON.stringify({ prompt: first.prompt, types: first.types, response: first.response }).includes('"checkpoint"'), false);
  assert.deepEqual(Object.keys(first.response).sort(), Object.keys(task.solution).sort());
  for (const value of Object.values(first.response)) assert.equal(typeof value, "string");
  task.metadata.public.questions[0].formula[2][0] = "mutated-query";
  task.metadata.public.replies[0].formula[2][0] = "mutated-reply";
  assert.deepEqual(generate("knowledge-contract-private-seed-812"), reloaded,
    "Mutating a returned public formula must not mutate the generator's reusable syntax pool");
});

test("hard knowledge: every checkpoint is independently scored with no credit for missing or inherited fields", () => {
  const generated = generate("knowledge-grader-isolation"), task = privateTask(generated);
  const expected = reference(generated);
  for (const [id, value] of Object.entries(expected.solution)) {
    const result = gradeTask(task, { [id]: value });
    assert.equal(result.percent, checkpoint(result, id).max, `isolated ${id}`);
    assert.equal(result.checkpoints.filter((field) => field.earned > 0).length, 1);
  }
  for (const draft of [undefined, null, {}, [], "solution", 1, true, Object.create(task.solution)])
    assert.equal(gradeTask(task, draft).percent, 0);
  for (const question of expected.questions) {
    for (const fake of [0, 1, "true", "false", [], {}, null]) assert.equal(points(task, question.id, fake), 0);
    assert.equal(points(task, question.id, !question.truth), 0);
    // Evidence describes the selected claim independently of an optional truth answer.
    assert.equal(checkpoint(gradeTask(task, { [question.id]: !question.truth,
      [`${question.id}Evidence`]: question.canonical }), `${question.id}Evidence`).earned, 9);
  }
  const all = gradeTask(task, { ...task.solution, extra: 42, __unused: "ignored" });
  assert.equal(all.percent, 100);
});

test("hard knowledge: arbitrary valid witnesses pass and inaccessible or wrong-truth histories fail", () => {
  const coverage = new Set();
  let alternateWitnesses = 0, wrongStages = 0, wrongVariants = 0;
  for (let seed = 0; seed < WITNESS_SAMPLES; seed++) {
    const generated = generate(`knowledge-witness-${seed}`), task = privateTask(generated), expected = reference(generated);
    for (const question of expected.questions) {
      const id = `${question.id}Evidence`, model = expected.model(question.variant), op = question.formula[0];
      coverage.add(`${op}:${question.truth}`);
      assert.equal(points(task, id, [...question.canonical].reverse()), 9);
      if (!question.truth) {
        const candidates = expected.model("main").worlds.map((world) => world.id);
        for (const first of candidates) {
          const witnesses = op === "K" ? [[first]] : candidates.map((second) => [first, second]);
          for (const witness of witnesses) {
            const valid = question.validEvidence(witness);
            assert.equal(points(task, id, witness) > 0, valid,
              `${seed} ${question.id} ${JSON.stringify(witness)}`);
            if (valid && JSON.stringify(witness) !== JSON.stringify(question.canonical)) alternateWitnesses++;
          }
        }
      } else {
        assert.equal(points(task, id, [...question.cell, question.cell[0]]), 0);
        assert.equal(points(task, id, question.cell.slice(1)), 0);
      }
      for (const stage of [0, 1, 2, 3]) {
        const misplaced = model.possible(question.formula[1], stage);
        if (!question.validEvidence(misplaced)) {
          assert.equal(points(task, id, misplaced), 0); wrongStages++;
        }
      }
      for (const variant of ["main", "public_event", "public_reports", "forget_A", "no_swap"]) {
        const misplaced = expected.model(variant).possible(question.formula[1], question.stage);
        if (!question.validEvidence(misplaced)) {
          assert.equal(points(task, id, misplaced), 0); wrongVariants++;
        }
      }
    }
    for (const cell of expected.spec.cells) {
      const correct = expected.solution[cell.id];
      assert.equal(points(task, cell.id, [...correct].reverse()), 11);
      assert.equal(points(task, cell.id, correct.slice(1)), 0);
      assert.equal(points(task, cell.id, [...correct, correct[0]]), 0);
    }
  }
  assert.equal(coverage.size, 4);
  assert.ok(alternateWitnesses > WITNESS_SAMPLES, "Need to exercise arbitrary alternative witnesses");
  assert.ok(wrongStages > WITNESS_SAMPLES, "Need to exercise rejection of evidence from a wrong stage");
  assert.ok(wrongVariants > WITNESS_SAMPLES, "Need to exercise rejection of evidence from a wrong intervention");
});

test("hard knowledge: malformed history sets, sparse arrays and inherited histories earn no evidence credit", () => {
  const generated = generate("knowledge-malformed-evidence"), task = privateTask(generated), expected = reference(generated);
  for (const [id, correct] of Object.entries(expected.solution).filter(([, value]) => Array.isArray(value))) {
    const inherited = [...correct];
    delete inherited[0];
    Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: correct[0] }));
    const sparse = [...correct]; delete sparse[0];
    const malformed = [null, {}, correct.join(","), 4, true, [], new Array(correct.length), sparse, inherited,
      ["000:3"], ["000:00"], ["000/0"], ["000:0 "], ["0:0"], ["toString"], ["__proto__"],
      [undefined], [null], [0], [{ toString: () => correct[0] }]];
    for (const evidence of malformed) assert.equal(points(task, id, evidence), 0, `${id} ${String(evidence)}`);
  }
});

function frozenThreeAgentSingleKey() {
  // Materialized before the three-reply/two-scenario revision, using the
  // synthetic seed legacy-r3-compatibility-fixture. Grade from the frozen key;
  // regeneration must not reinterpret historical answers under newer rules.
  const solution = {
    q1: false, q1Evidence: ["001:1", "001:0"], q2: true, q2Evidence: ["001:0", "011:0"],
    q3: false, q3Evidence: ["001:1"], q4: false, q4Evidence: ["001:0"],
    q5: true, q5Evidence: ["000:0", "001:0", "100:0", "101:0"], q6: true, q6Evidence: ["001:0"],
    cell1: ["001:0", "001:1", "011:0"], cell2: ["001:0", "011:0"],
  };
  const certificate = (operator, value, possible, trueHistories, falseHistories) =>
    ({ operator, value, possible, trueHistories, falseHistories });
  const task = { family: "private-knowledge", answer: structuredClone(solution), solution,
    response: Object.fromEntries(Object.entries(solution).map(([id, value]) => [id, Array.isArray(value) ? "History[]" : "boolean"])),
    metadata: { scoringVersion: "private-knowledge-checkpoints-v1",
      weights: Object.fromEntries(Object.keys(solution).map((id) => [id, id.startsWith("cell") ? 11 : id.endsWith("Evidence") ? 9 : 4])),
      certificates: {
        q1: certificate("W", false, ["001:0", "001:1", "011:0"], ["001:1"], ["001:0", "011:0"]),
        q2: certificate("W", true, ["001:0", "011:0"], [], ["001:0", "011:0"]),
        q3: certificate("K", false, ["001:0", "001:1", "011:0", "101:1"], ["001:0", "011:0"], ["001:1", "101:1"]),
        q4: certificate("K", false, ["001:0", "001:1", "011:0"], [], ["001:0", "001:1", "011:0"]),
        q5: certificate("W", true, ["000:0", "001:0", "100:0", "101:0"], [], ["000:0", "001:0", "100:0", "101:0"]),
        q6: certificate("W", true, ["001:0"], ["001:0"], []),
      } },
  };
  return task;
}

test("hard knowledge: saved two-reply single-scenario keys retain their original grading", () => {
  const task = frozenThreeAgentSingleKey(), solution = task.solution;
  assert.equal(gradeTask(task, solution).percent, 100);
  assert.equal(gradeTask(task, solution).fullyCorrect, true);
  assert.equal(gradeTask(task, { q1: false, q3Evidence: ["101:1"] }).percent, 13);
  assert.equal(gradeTask(task, { q1Evidence: ["011:0", "001:1"] }).percent, 9);
  assert.equal(gradeTask(task, {}).percent, 0);
  assert.equal(gradeTask(task, Object.create(solution)).percent, 0);
  assert.equal(gradeTask(JSON.parse(JSON.stringify(task)), JSON.parse(JSON.stringify(solution))).percent, 100);
});

test("hard knowledge: frozen v10 three-agent paired-key shape retains grading after the four-agent revision", () => {
  // Use frozen three-bit certificates in the v10 paired envelope. No current
  // generation is involved: archived keys must remain their own source of truth.
  const scenarios = { scenarioA: frozenThreeAgentSingleKey(), scenarioB: frozenThreeAgentSingleKey() };
  const solution = Object.fromEntries(Object.entries(scenarios).map(([id, scenario]) => [id, structuredClone(scenario.solution)]));
  const task = { family: "private-knowledge", scenarios, solution, answer: structuredClone(solution),
    response: Object.fromEntries(Object.entries(scenarios).map(([id, scenario]) => [id, structuredClone(scenario.response)])),
    metadata: { scoringVersion: "private-knowledge-paired-three-replies-v1",
      weights: Object.fromEntries(Object.entries(scenarios).flatMap(([scenarioId, scenario]) =>
        Object.entries(scenario.metadata.weights).map(([id, weight]) => [`${scenarioId}.${id}`, weight / 2]))) } };
  const complete = gradeTask(task, solution);
  assert.equal(complete.percent, 100);
  assert.equal(complete.fullyCorrect, true);
  assert.equal(complete.checkpoints.length, 28);
  assert.equal(complete.checkpoints.reduce((sum, field) => sum + field.max, 0), 100);
  assert.equal(gradeTask(task, { scenarioA: solution.scenarioA }).percent, 50);
  assert.equal(gradeTask(task, { scenarioB: solution.scenarioB }).percent, 50);
  assert.equal(gradeTask(task, { scenarioA: { q1Evidence: ["011:0", "001:1"] }, scenarioB: { q3Evidence: ["101:1"] } }).percent, 9);
  assert.equal(gradeTask(task, { scenarioA: Object.create(solution.scenarioA) }).percent, 0);
  assert.equal(gradeTask(task, Object.create(solution)).percent, 0);
  assert.equal(gradeTask(JSON.parse(JSON.stringify(task)), JSON.parse(JSON.stringify(solution))).percent, 100);
  // Length-valid four-bit IDs still cannot satisfy a frozen three-bit certificate.
  assert.equal(gradeTask(task, { scenarioA: { q3Evidence: ["0001:1"] } }).percent, 0);
});

test(`hard knowledge: ${PAIRED_SAMPLES} public paired tasks have independent protocols, balanced shortcuts and exact 100-point grading`, () => {
  const pairs = new Set();
  for (let seed = 0; seed < PAIRED_SAMPLES; seed++) {
    const generated = generatePair(`paired-knowledge-oracle-${seed}`), task = privateTask(generated);
    const publicSections = publicScenarios(generated.prompt);
    assert.deepEqual(Object.keys(publicSections), ["scenarioA", "scenarioB"]);
    assert.deepEqual(Object.keys(generated.response), ["scenarioA", "scenarioB"]);
    const references = Object.fromEntries(Object.entries(publicSections).map(([id, prompt]) => [id, reference({ prompt })]));
    const solution = Object.fromEntries(Object.entries(references).map(([id, expected]) => [id, expected.solution]));
    const a = references.scenarioA.model("main"), b = references.scenarioB.model("main");
    assert.notDeepEqual([...a.factRows], [...b.factRows], "Independent scenarios must have distinct fact tables");
    assert.notDeepEqual(a.replies, b.replies, "Independent scenarios must have distinct reply protocols");
    const drafts = Object.fromEntries(["constantFalse", "constantTrue", "ignoreUpdates", "ignoreFinalReply",
      "atomic", "shallow", "shallowSigned", "child", "factualCopy", "inverseFactual"]
      .map((name) => [name, { scenarioA: {}, scenarioB: {} }]));
    for (const [id, expected] of Object.entries(references)) {
      const scenario = task.scenarios[id], changes = { main: [], counterfactual: [], last: [] };
      assert.equal(expected.model("main").replies.length, 3);
      assert.equal(expected.model("main").worlds.length, 64);
      assert.deepEqual(expected.spec.questions, scenario.metadata.public.questions);
      assert.deepEqual(expected.spec.cells, scenario.metadata.public.cells);
      assert.deepEqual(task.metadata.public.scenarios[id], scenario.metadata.public);
      assert.deepEqual(generated.response[id], scenario.response);
      assert.equal(gradeTask(scenario, expected.solution).percent, 100);
      assert.equal(expected.questions.filter((question) => question.truth).length, 3);
      for (const cell of expected.spec.cells) if (cell.variant !== "main")
        assert.notDeepEqual(expected.solution[cell.id], expected.model("main").possible(cell.agent, cell.stage));
      for (const question of expected.questions) {
        const model = expected.model(question.variant), certificate = scenario.metadata.certificates[question.id];
        assertNoFiniteAlias(model, question, `Paired seed ${seed} ${id}.${question.id}`);
        assert.equal(scenario.solution[question.id], question.truth);
        assert.deepEqual(certificate.possible, question.cell);
        assert.deepEqual(certificate.trueHistories, question.cell.filter((history) => question.innerTruth[history]));
        assert.deepEqual(certificate.falseHistories, question.cell.filter((history) => !question.innerTruth[history]));
        let atom = question.formula, signed = question.formula;
        while (["K", "W", "not"].includes(atom[0])) atom = atom[atom[0] === "not" ? 1 : 2];
        while (["K", "W"].includes(signed[0])) signed = signed[2];
        const physical = model.formulaAt(question.formula, 0), prior = model.formulaAt(question.formula, 2);
        const factual = expected.model("main").formulaAt(question.formula, question.stage);
        const values = { constantFalse: false, constantTrue: true, ignoreUpdates: physical, ignoreFinalReply: prior,
          atomic: model.formulaAt(atom), shallow: model.formulaAt([question.formula[0], question.formula[1], atom]),
          shallowSigned: model.formulaAt([question.formula[0], question.formula[1], signed]),
          child: model.formulaAt(question.formula[2]), factualCopy: factual, inverseFactual: !factual };
        for (const [name, value] of Object.entries(values)) drafts[name][id][question.id] = value;
        if (question.variant === "main") {
          changes.main.push(question.truth !== physical); changes.last.push(question.truth !== prior);
        } else changes.counterfactual.push(question.truth !== factual);
      }
      assert.deepEqual(changes.main.sort(), [false, true]);
      assert.deepEqual(changes.last.sort(), [false, true]);
      assert.deepEqual(changes.counterfactual.sort(), [false, false, true, true]);
    }
    const correct = gradeTask(task, solution);
    assert.equal(correct.percent, 100);
    assert.equal(correct.fullyCorrect, true);
    assert.equal(gradeTask(task, task.solution).percent, 100);
    assert.equal(correct.checkpoints.length, 28);
    assert.equal(correct.checkpoints.reduce((sum, field) => sum + field.max, 0), 100);
    assert.equal(new Set(correct.checkpoints.map((field) => field.id)).size, 28);
    assert.ok(correct.checkpoints.every((field) => /^scenario[AB]\.(q\d+(?:Evidence)?|cell\d+)$/.test(field.id)));
    assert.deepEqual(Object.fromEntries(correct.checkpoints.map(({ id, max }) => [id, max])), task.metadata.weights);
    assert.equal(gradeTask(task, drafts.constantFalse).percent, 12);
    assert.equal(gradeTask(task, drafts.constantTrue).percent, 12);
    assert.equal(gradeTask(task, drafts.factualCopy).percent, 16);
    assert.equal(gradeTask(task, drafts.inverseFactual).percent, 8);
    for (const name of ["ignoreUpdates", "ignoreFinalReply", "atomic", "shallow", "shallowSigned", "child"]) {
      const value = gradeTask(task, drafts[name]).percent;
      assert.ok(value >= 8 && value <= 16, `${name} shortcut or inverse exceeds 2/3 Boolean accuracy: ${value}`);
    }
    pairs.add(generated.prompt);
  }
  assert.equal(pairs.size, PAIRED_SAMPLES);
});

test("hard knowledge: paired submissions isolate scenarios, scale every checkpoint and reject inherited answers", () => {
  const generated = generatePair("paired-knowledge-grading-isolation"), task = privateTask(generated);
  assert.deepEqual(generated, generatePair("paired-knowledge-grading-isolation"));
  const reloaded = JSON.parse(JSON.stringify(task));
  assert.equal(gradeTask(reloaded, reloaded.solution).percent, 100);
  for (const id of ["scenarioA", "scenarioB"]) {
    const solo = gradeTask(task, { [id]: task.solution[id] });
    assert.equal(solo.percent, 50);
    assert.equal(solo.fullyCorrect, false);
    assert.equal(solo.checkpoints.filter((field) => field.earned === field.max).length, 14);
    for (const [field, value] of Object.entries(task.solution[id])) {
      const score = gradeTask(task, { [id]: { [field]: value } });
      assert.equal(score.percent, field.startsWith("cell") ? 5.5 : field.endsWith("Evidence") ? 4.5 : 2);
      assert.equal(score.checkpoints.filter((entry) => entry.earned > 0).length, 1);
    }
    for (const invalid of [undefined, null, [], false, "answer", Object.create(task.solution[id])])
      assert.equal(gradeTask(task, { [id]: invalid }).percent, 0);
  }
  for (const invalid of [undefined, null, [], false, "answer", {}, Object.create(task.solution)])
    assert.equal(gradeTask(task, invalid).percent, 0);
  assert.equal(gradeTask(task, { scenarioA: null, scenarioB: task.solution.scenarioB }).percent, 50);
  const crossed = gradeTask(task, { scenarioA: task.solution.scenarioB, scenarioB: task.solution.scenarioA });
  assert.equal(crossed.percent, (gradeTask(task.scenarios.scenarioA, task.solution.scenarioB).percent +
    gradeTask(task.scenarios.scenarioB, task.solution.scenarioA).percent) / 2);
  assert.equal(gradeTask(task, { ...task.solution, extra: "ignored" }).percent, 100);
  const saved = structuredClone(generated);
  task.scenarios.scenarioA.metadata.public.questions[0].formula[2][0] = "mutated";
  assert.deepEqual(generatePair("paired-knowledge-grading-isolation"), saved);
});
