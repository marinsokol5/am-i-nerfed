import assert from "node:assert/strict";

// An independent finite Kripke model. Public prompt text is its only input.
// The production implementation groups observation keys; this oracle instead
// retains a binary accessibility matrix and deletes edges after observations.
const agents = "ABCD";
const bitNames = "abcd";

export function parseFormula(text) {
  text = text.trim();
  if (text.startsWith("NOT ")) return ["not", parseFormula(text.slice(4))];
  if (text.startsWith("NOT(") && text.endsWith(")")) return ["not", parseFormula(text.slice(4, -1))];
  const modal = /^([KW])_([ABCD])\((.*)\)$/.exec(text);
  if (modal) return [modal[1], agents.indexOf(modal[2]), parseFormula(modal[3])];
  if (text === "F") return ["F"];
  const bit = /^([abcd])\s*=\s*([01])$/.exec(text);
  assert.ok(bit, `Unknown public formula: ${text}`);
  const atom = ["bit", bitNames.indexOf(bit[1])];
  return bit[2] === "1" ? atom : ["not", atom];
}

export function publicProtocol(prompt) {
  const table = /one of: ([01]{3,4}(?:, [01]{3,4})*)\./.exec(prompt);
  assert.ok(table, "Public F truth table is missing");
  const actual = /Actual initial bits \(([a-d]0(?:,[a-d]0){2,3})\): \(([01](?:,\s*[01]){2,3})\); actual event e=([0-3])/.exec(prompt);
  assert.ok(actual, "Public actual history is missing");
  const actualBits = actual[2].split(",").map(Number), agentCount = actualBits.length;
  assert.ok(agentCount === 3 || agentCount === 4);
  assert.equal(actual[1], [...bitNames.slice(0, agentCount)].map((bit) => `${bit}0`).join(","));
  const factRows = new Set(table[1].split(", "));
  assert.ok([...factRows].every((row) => row.length === agentCount), "Every public fact row must match the agent count");
  assert.ok(Number(actual[3]) < agentCount, "Actual event must name a legal swap");
  const replyLines = [...prompt.matchAll(/^(\d+)\. ([ABCD]) answers the Boolean question (.+); only ([ABCD]) hears/gm)];
  assert.ok(replyLines.length === 2 || replyLines.length === 3, "Public protocol must declare two or three replies");
  assert.deepEqual(replyLines.map((line) => Number(line[1])), Array.from({ length: replyLines.length }, (_, i) => i + 1),
    "Public replies must be consecutively numbered in order");
  const declared = /\b(two|three) mandatory Boolean replies\b/i.exec(prompt);
  if (declared) assert.equal(replyLines.length, { two: 2, three: 3 }[declared[1].toLowerCase()]);
  const replies = replyLines.map(([, , speaker, formula, listener]) => ({
      speaker: agents.indexOf(speaker), listener: agents.indexOf(listener), formula: parseFormula(formula),
    }));
  assert.ok(replies.every(({ speaker, listener }) => speaker < agentCount && listener < agentCount));
  return { factRows, actualBits, agentCount, actualEvent: Number(actual[3]), replies };
}

export function publicCheckpoints(prompt) {
  const final = publicProtocol(prompt).replies.length;
  const stageNumber = (stage) => {
    const index = stage === "physical" ? 0 : stage === "final" ? final : Number(stage.match(/\d+$/)[0]);
    assert.ok(Number.isInteger(index) && index >= 0 && index <= final, `Invalid public stage: ${stage}`);
    return index;
  };
  const questions = [...prompt.matchAll(/^- (q\d+): variant ([a-zA-Z_]+); stage (physical|after reply \d+|final); (.+)\.$/gm)]
    .map(([, id, variant, stage, formula]) => ({ id, variant, stage: stageNumber(stage), formula: parseFormula(formula) }));
  const cells = [...prompt.matchAll(/^- (cell\d+): variant ([a-zA-Z_]+); stage (physical|after reply \d+|final); agent ([ABCD])\.$/gm)]
    .map(([, id, variant, stage, agent]) => ({ id, variant, stage: stageNumber(stage), agent: agents.indexOf(agent) }));
  assert.equal(questions.length, 6, "Public question descriptions must list all six truth/evidence pairs");
  assert.equal(cells.length, 2, "Public question must describe both complete cells");
  for (const variant of new Set([...questions, ...cells].map((entry) => entry.variant))) {
    assert.ok(["main", "public_event", "public_reports", "forget_A", "no_swap"].includes(variant));
    if (variant !== "main") assert.ok(prompt.includes(`Variant ${variant}:`), `No public definition for ${variant}`);
  }
  return { questions, cells };
}

export function publicScenarios(prompt) {
  const sections = [...prompt.matchAll(/^SCENARIO ([AB])\n/gm)];
  assert.deepEqual(sections.map((section) => section[1]), ["A", "B"], "Public paired task must contain scenarios A and B exactly once");
  return Object.fromEntries(sections.map((section, index) => [`scenario${section[1]}`,
    prompt.slice(section.index + section[0].length, sections[index + 1]?.index ?? prompt.length).trim()]));
}

export function relationOracle(prompt, variant = "main", options = {}) {
  const protocol = publicProtocol(prompt);
  const agentIndices = Array.from({ length: protocol.agentCount }, (_, index) => index);
  const worldBits = Array.from({ length: 2 ** protocol.agentCount }, (_, row) =>
    agentIndices.map((index) => row >> (protocol.agentCount - index - 1) & 1));
  const worlds = worldBits.flatMap((initial) => (variant === "no_swap" ? [0] : agentIndices).map((event) => {
    const source = [...agentIndices];
    if (event) [source[0], source[event]] = [source[event], source[0]];
    const bits = source.map((i) => initial[i]);
    return { initial, event, bits, id: `${initial.join("")}:${event}`,
      fact: protocol.factRows.has(bits.join("")) };
  }));
  const actual = worlds.findIndex(({ initial, event }) =>
    initial.every((value, i) => value === protocol.actualBits[i]) &&
    event === (variant === "no_swap" ? 0 : protocol.actualEvent));
  assert.notEqual(actual, -1);

  let edges = agentIndices.map((agent) => worlds.map((first) => worlds.map((second) => {
    const sameInitial = agent === 0 && variant === "forget_A" || first.initial[agent] === second.initial[agent];
    const sameCurrent = agent !== 0 || first.bits[0] === second.bits[0];
    const sameEvent = agent !== 1 && variant !== "public_event" || first.event === second.event;
    return sameInitial && sameCurrent && sameEvent;
  })));

  // Cache complete Boolean truth vectors by immutable accessibility relation.
  // This still uses explicit matrix quantification, never production bitmasks.
  const truthCache = new WeakMap();
  function valuesOf(formula, relation) {
    let cache = truthCache.get(relation);
    if (!cache) { cache = new Map(); truthCache.set(relation, cache); }
    const key = JSON.stringify(formula);
    if (cache.has(key)) return cache.get(key);
    const [op, arg, inner] = formula;
    let values;
    if (op === "F") values = worlds.map((world) => world.fact);
    else if (op === "bit") {
      assert.ok(Number.isInteger(arg) && arg >= 0 && arg < protocol.agentCount);
      values = worlds.map((world) => world.bits[arg] === 1);
    } else if (op === "not") values = valuesOf(arg, relation).map((value) => !value);
    else if (op === "K" || op === "W") {
      assert.ok(Number.isInteger(arg) && arg >= 0 && arg < protocol.agentCount);
      const innerValues = valuesOf(inner, relation);
      values = relation[arg].map((row) => {
        const allTrue = row.every((edge, target) => !edge || innerValues[target]);
        return allTrue || op === "W" && row.every((edge, target) => !edge || !innerValues[target]);
      });
    } else throw Error(`Unknown operator ${op}`);
    cache.set(key, values);
    return values;
  }
  const evaluate = (formula, world, relation) => valuesOf(formula, relation)[world];

  const stages = [structuredClone(edges)], reportValues = [];
  for (const [step, { speaker, listener, formula }] of protocol.replies.entries()) {
    const values = worlds.map((_, world) => evaluate(formula, world, edges));
    // A mandatory Boolean reply must be determined by the speaker's own view.
    for (const [world, row] of edges[speaker].entries())
      for (const [target, edge] of row.entries())
        if (edge) assert.equal(values[world], values[target], "Speaker cannot compute own reply");
    reportValues.push(values);
    if (!options.ignoreReplies && !options.skipReplies?.includes(step + 1))
      edges = edges.map((rows, agent) => rows.map((row, world) => row.map((edge, target) => edge &&
        (variant !== "public_reports" && agent !== speaker && agent !== listener ||
          values[world] === values[target]))));
    stages.push(structuredClone(edges));
  }

  const resolve = (world) => typeof world === "number" ? world : worlds.findIndex(({ id }) => id === world);
  const finalStage = protocol.replies.length;
  const formulaAt = (formula, stage = finalStage, world = actual) => {
    const index = resolve(world);
    assert.ok(index >= 0 && index < worlds.length, `Unknown history: ${world}`);
    assert.ok(Number.isInteger(stage) && stage >= 0 && stage <= finalStage, `Unknown stage: ${stage}`);
    return evaluate(typeof formula === "string" ? parseFormula(formula) : formula, index, stages[stage]);
  };
  const possible = (agent, stage = finalStage, world = actual) => {
    const index = resolve(world), a = typeof agent === "string" ? agents.indexOf(agent) : agent;
    assert.ok(index >= 0 && a >= 0 && a < protocol.agentCount);
    assert.ok(Number.isInteger(stage) && stage >= 0 && stage <= finalStage, `Unknown stage: ${stage}`);
    return worlds.flatMap(({ id }, target) => stages[stage][a][index][target] ? [id] : []);
  };
  const counterexamples = (agent, formula, stage = finalStage, world = actual) =>
    possible(agent, stage, world).filter((id) => !formulaAt(formula, stage, id));
  const uncertainty = (agent, formula, stage = finalStage, world = actual) => {
    const possibilities = possible(agent, stage, world);
    return { true: possibilities.filter((id) => formulaAt(formula, stage, id)),
      false: possibilities.filter((id) => !formulaAt(formula, stage, id)) };
  };
  return { ...protocol, worlds, actual, finalStage, stages, reportValues, formulaAt, possible, counterexamples, uncertainty,
    reports: reportValues.map((values) => values[actual]) };
}

export function evidenceOracle(model, question) {
  const { formula, stage } = question;
  const [op, agent, inner] = formula;
  assert.ok(op === "K" || op === "W", "Evidence questions require an outer modal operator");
  const truth = model.formulaAt(formula, stage), cell = model.possible(agent, stage);
  const innerTruth = Object.fromEntries(cell.map((history) => [history, model.formulaAt(inner, stage, history)]));
  function validEvidence(evidence) {
    if (!Array.isArray(evidence) || evidence.length !== new Set(evidence).size ||
      !Array.from(evidence).every((history, index) => Object.hasOwn(evidence, index) &&
        typeof history === "string" && cell.includes(history))) return false;
    if (truth) return evidence.length === cell.length;
    if (op === "K") return evidence.length === 1 && !innerTruth[evidence[0]];
    return evidence.length === 2 && innerTruth[evidence[0]] !== innerTruth[evidence[1]];
  }
  const canonical = truth ? cell : op === "K" ? [cell.find((history) => !innerTruth[history])]
    : [cell.find((history) => innerTruth[history]), cell.find((history) => !innerTruth[history])];
  assert.ok(validEvidence(canonical));
  return { truth, cell, innerTruth, canonical, validEvidence };
}
