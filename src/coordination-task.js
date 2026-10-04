import { randomSource } from "./random.js";
import { solveScores } from "./coordination.js";
import { hasRoom, protocolTask } from "./protocols.js";

// Weighted coordination tables, ported from lab/hardhunt coordXL; every level
// differs only in symbols per agent, rows and the cases asked. The prompt
// spells the ladder's numbers.
const WORDS = {
  2: "two",
  3: "three",
  4: "four",
  6: "six",
  18: "eighteen",
  26: "twenty-six",
};
// Cases valued from the base frontier alone; binding and broadcast cost more.
const FRONTIER = ["base", "mixed", "mode_1", "mode_2"];
// Table preferences, each counted only when the level asks every case named.
const PREFERENCES = [
  [8, ["mixed"], (v) => v.mixed > v.base],
  [4, ["binding", "broadcast"], (v) => v.broadcast > v.binding],
  [2, ["mixed"], (v) => !Number.isInteger(v.mixed)],
  [1, [], (v, targets) => targets.every((mode) => new Set(mode).size === 3)],
];
const numeric = (fraction) => {
  const [n, d] = fraction.split("/").map(Number);
  return n / d;
};
const RULES = {
  base: "- base: largest robust score with simultaneous actions, no messages or randomization.",
  mixed:
    "- mixed: choose an arbitrary distribution over complete base protocols. One shared random draw, independent of symbols and mode, tells all three which protocol to use. Maximize min(E[s1],E[s2]); the expectation is taken BEFORE the minimum. The mode cannot depend on the random draw. No messages.",
  mode_1:
    "- mode_1: greatest s1 for a base protocol optimized only for mode 1; ignore s2.",
  mode_2:
    "- mode_2: greatest s2 for a base protocol optimized only for mode 2; ignore s1.",
  binding:
    "- binding: deterministic robust optimum when A acts first. B and C both observe A's actual action, then act simultaneously using their own symbol and that action. A cannot change its action. All three actions count toward success.",
  broadcast:
    "- broadcast: deterministic robust optimum when A first announces one freely chosen BINARY bit based only on a. Then all three act simultaneously using their own symbol and the announced bit. The message is not an action and does not constrain A's later action.",
};
const FORMATS = {
  mixed:
    " mixed gives p, an exact fraction, and two complete base protocols: first is used with probability p and second otherwise; two protocols always suffice.",
  binding:
    " binding gives A's rule and, for B and C, one rule for when A waits and one for when A dispatches.",
  broadcast:
    " broadcast gives message, the bit A announces for each value of a, and for each agent one rule after message 0 and one after message 1.",
};

/** A coordination task on a weighted table: each agent observes one of
 * `symbols` symbols, the table lists every constant row plus random others,
 * `rows` in all, with weights 1-3, and the task asks `cases`. */
export function coordinationTask(seed, { symbols, rows, cases, gap = 0 }) {
  const random = randomSource(seed),
    values = [...Array(symbols).keys()];
  const triples = Array.from({ length: symbols ** 3 }, (_, i) => [
    Math.floor(i / symbols ** 2),
    Math.floor(i / symbols) % symbols,
    i % symbols,
  ]).filter(([a, b, c]) => a !== b || b !== c);
  const preferences = PREFERENCES.filter(([, needs]) =>
    needs.every((name) => cases.includes(name)),
  );
  const best = preferences.reduce((sum, [weight]) => sum + weight, 0);
  const quick = cases.filter((name) => FRONTIER.includes(name));
  let selected;
  // Each attempt draws a whole table, so no row set can stall the search.
  // Every case needs room above its trivial baseline; among such tables,
  // prefer ones that expose the level's kinds of communication. The search
  // runs past 128 attempts only until one table qualifies.
  for (let attempt = 0; attempt < 128 || !selected; attempt++) {
    if (attempt === 100000)
      throw Error("Could not generate a coordination table with room.");
    const histories = [
      ...values.map((symbol) => [symbol, symbol, symbol]),
      ...random.shuffle(triples).slice(0, rows - symbols),
    ].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const contexts = [0, 1, 2].map((actor) =>
      histories.map((row) => row[actor]),
    );
    const weights = histories.map(() => 1 + random.integer(3));
    const targets = [0, 1].map(() => histories.map(() => random.integer(3)));
    const solve = (names) =>
      protocolTask(
        histories,
        weights,
        targets,
        solveScores(contexts, targets, { cases: names, weights }),
      );
    // Most tables already lack room in a case of the base frontier, so the
    // costlier binding and broadcast cases are solved only for the rest.
    if (quick.length < cases.length && !hasRoom(solve(quick).answer, gap))
      continue;
    const task = solve(cases);
    if (!hasRoom(task.answer, gap)) continue;
    const optima = Object.fromEntries(
      cases.map((name) => [name, numeric(task.answer.coordination[name])]),
    );
    const quality = preferences.reduce(
      (sum, [weight, , holds]) => sum + (holds(optima, targets) ? weight : 0),
      0,
    );
    if (!selected || quality > selected.quality)
      selected = { histories, weights, targets, task, quality };
    if (quality === best) break;
  }
  const { histories, weights, targets, task } = selected;
  const table = histories
    .map(
      (row, i) =>
        `${row.join("")} | ${weights[i]} | ${"ABC"[targets[0][i]]} | ${"ABC"[targets[1][i]]}`,
    )
    .join("\n");
  const example = values.map((v) => Number(v === 1 || v === 2)).join("");
  // With two symbols a binary message needs no reminder.
  const rule = (name) =>
    name === "broadcast" && symbols > 2
      ? `${RULES[name]} It has only two possible values even though a has ${WORDS[symbols]}.`
      : RULES[name];
  const prompt = `A, B, C must coordinate dispatches. Each privately observes one symbol a, b, c from {${values.join(",")}}. The ${WORDS[rows]} rows below are ALL possible histories in EACH of two hidden modes; unlisted triples are impossible. Each agent sees only their own symbol. The mode, row number, other symbols, weight and qualified agent are never separately observed. Everyone commonly knows this table and every rule; agents may infer facts from their own symbol and the table.

abc | weight | qualified in mode 1 | qualified in mode 2
${table}

Each agent either dispatches (1) or waits (0). A row succeeds in a mode exactly when ONE agent dispatches and that agent is the table's qualified agent for that row and mode. Zero or multiple dispatches fail. A deterministic protocol specifies an action for every local observation; identical observations require identical actions. The SAME protocol must handle all ${WORDS[rows]} rows and both modes. For a protocol, s1 and s2 SUM THE WEIGHTS of successful rows in modes 1 and 2; its robust score is min(s1,s2). Successful sets can differ between modes. Scores are weighted counts out of ${weights.reduce((sum, weight) => sum + weight, 0)}, not proportions. A weight of 3 means three identical scoring copies of that row in each mode; copies are indistinguishable. A row's weight affects scoring only; it adds no observation.

Give one protocol per case, each optimized independently; action rules can differ between cases:
${cases.map(rule).join("\n")}

No additional observations, signals, retries or private randomness are allowed. Answer every case with a protocol, not a value. A rule is a string of ${WORDS[symbols]} digits, one per value ${values.join(", ")} of the agent's own symbol in that order: 1 dispatches, 0 waits (so "${example}" dispatches exactly on ${symbols > 2 ? "symbols 1 and 2" : "symbol 1"}). base, mode_1 and mode_2 give a rule for each of A, B and C.${cases.map((name) => FORMATS[name] ?? "").join("")}

Scoring: a trivial protocol has one agent dispatch in every situation and the other two never dispatch. A case's baseline is the best value any of the three trivial protocols achieves under that case's objective${cases.includes("mixed") ? " (for mixed, the best value of any mixture of them)" : ""}; its optimum is the best value possible. A case earns (v - baseline) / (optimum - baseline), clamped to [0,1], where v is the value its protocol achieves on this table, so trivial protocols earn 0 and optimal ones 1. A missing or malformed case earns 0.`;
  return { prompt, ...task };
}
