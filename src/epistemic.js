// Finite perfect-recall partition model. No histories are deleted by private reports.
export const K = (actor, child) => ["knows", actor, child];
export const Not = (child) => ["not", child];
export const Kw = (actor, child) => [
  "or",
  K(actor, child),
  K(actor, Not(child)),
];
export const F = ["fact", "F"];
export const current = (actor) => ["current", actor];
export const QUERIES = [
  ["physical_A_knows_F", 1, K(0, F)],
  ["physical_B_knows_current_B", 1, Kw(1, current(1))],
  [
    "after_B_A_decides_C_decides_B_knows_current_B",
    2,
    Kw(0, Kw(2, K(1, current(1)))),
  ],
  ["after_B_C_knows_whether_A_decides_F", 2, Kw(2, Kw(0, F))],
  ["after_B_C_knows_A_ignorant", 2, K(2, Not(Kw(0, F)))],
  ["final_C_knows_whether_F", 3, Kw(2, F)],
  ["final_C_knows_whether_B_decides_F", 3, Kw(2, Kw(1, F))],
  [
    "after_B_B_knows_A_decides_C_knows_current_C",
    2,
    K(1, Kw(0, K(2, current(2)))),
  ],
];
function snapshot(histories, facts, views, after) {
  const cells = [],
    contexts = [];
  for (const own of views) {
    const labels = new Map(),
      partitions = [],
      codes = [];
    own.forEach((view, i) => {
      const key = JSON.stringify(view);
      if (!labels.has(key)) {
        labels.set(key, partitions.length);
        partitions.push([]);
      }
      const code = labels.get(key);
      codes.push(code);
      partitions[code].push(i);
    });
    cells.push(partitions);
    contexts.push(codes);
  }
  function truth(formula) {
    const [op, a, b] = formula;
    if (op === "fact") return facts;
    if (op === "current")
      return histories.map((h) => Boolean((after ? h.current : h.initial)[a]));
    if (op === "not") return truth(a).map((v) => !v);
    if (op === "or") {
      const left = truth(a),
        right = truth(b);
      return left.map((v, i) => v || right[i]);
    }
    if (op === "knows") {
      const values = truth(b);
      return contexts[a].map((c) => cells[a][c].every((i) => values[i]));
    }
    throw Error("Unknown formula");
  }
  return { contexts, cells, truth };
}
export function makeRun(checks, parameters, variant = "main") {
  const digits = ["R0", "D5", "R14", "D7"].map((k) => checks[k]);
  const gates = digits.map((v, i) => (v + parameters.offsets[i]) % 2);
  const histories = [],
    facts = [],
    targets = [[], []];
  for (let bits = 0; bits < 8; bits++)
    for (const event of variant === "no_swap" ? [0] : [0, 1, 2]) {
      const initial = [bits >> 2, (bits >> 1) & 1, bits & 1],
        current = [...initial];
      if (event) [current[0], current[event]] = [current[event], current[0]];
      const [a, b, c] = current;
      const flag = Boolean(
        a ^ gates[0] &&
        b ^ gates[1] ^ ((event === 2 ? 1 : 0) & gates[2]) ^ gates[3],
      );
      const parity =
        c ^
        initial[0] ^
        (event % 2) ^
        (digits[0] % 2) ^
        ((digits[1] >> 1) % 2) ^
        ((digits[2] >> 2) % 2) ^
        (digits[3] % 2) ^
        parameters.parity_offset;
      histories.push({ initial, event, current });
      facts.push(flag);
      targets[0].push(flag ? 0 : 1 + parity);
      targets[1].push(
        (a +
          2 * b +
          c +
          event +
          digits[0] +
          2 * digits[1] +
          digits[2] +
          2 * digits[3] +
          parameters.mode_offset) %
          3,
      );
    }
  const views = [0, 1, 2].map((a) =>
    histories.map((h) =>
      a === 0 && variant === "forget_A" ? [] : [["before", a, h.initial[a]]],
    ),
  );
  const stages = [snapshot(histories, facts, views, false)];
  for (let a = 0; a < 3; a++)
    histories.forEach((h, i) => {
      if (a === 1 || variant === "public_event")
        views[a][i].push(["event", h.event]);
      if (a === 0) views[a][i].push(["after", 0, h.current[0]]);
    });
  stages.push(snapshot(histories, facts, views, true));
  const answers = [];
  for (const [step, speaker, formula] of [
    [0, 1, K(1, Not(Kw(0, F)))],
    [1, 0, Kw(0, F)],
  ]) {
    const values = stages.at(-1).truth(formula);
    answers.push(values);
    for (const cell of stages.at(-1).cells[speaker])
      if (new Set(cell.map((i) => values[i])).size !== 1)
        throw Error("Undetermined report");
    for (const a of variant === "public_reports" ? [0, 1, 2] : [speaker, 2])
      values.forEach((v, i) => views[a][i].push(["report", step, v]));
    stages.push(snapshot(histories, facts, views, true));
  }
  return {
    histories,
    targets,
    stages,
    answers,
    contexts: stages.at(-1).contexts,
  };
}
export function knowledgeAnswers(run, actual) {
  return Object.fromEntries([
    ["report_B", run.answers[0][actual]],
    ["report_A", run.answers[1][actual]],
    ...QUERIES.map(([name, stage, f]) => [
      name,
      run.stages[stage].truth(f)[actual],
    ]),
  ]);
}
export function forcedContext(run) {
  const matches = new Set(
    run.histories.flatMap((h, i) =>
      h.initial[0] === 0 && h.current[0] === 1 ? [run.contexts[0][i]] : [],
    ),
  );
  if (matches.size !== 1) throw Error("Forced context is not unique");
  return [...matches][0];
}
