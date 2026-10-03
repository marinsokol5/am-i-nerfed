import { createHash } from "node:crypto";
import { randomSource } from "./random.js";
import { solveScores } from "./coordination.js";

const CASES = ["base", "mixed", "mode_1", "mode_2", "binding", "broadcast"];
const HISTORIES = Array.from({ length: 27 }, (_, i) => [
  Math.floor(i / 9),
  Math.floor(i / 3) % 3,
  i % 3,
]);
const numeric = (fraction) => {
  const [n, d] = fraction.split("/").map(Number);
  return n / d;
};

export function hardCoordination(seed) {
  const random = randomSource(seed);
  const histories = [
    ...[0, 1, 2].map((symbol) => [symbol, symbol, symbol]),
    ...random
      .shuffle(HISTORIES.filter(([a, b, c]) => a !== b || b !== c))
      .slice(0, 15),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const contexts = [0, 1, 2].map((actor) =>
    histories.map((symbols) => symbols[actor]),
  );
  const weights = histories.map(() => 1 + random.integer(3));
  let selected;
  // Bounded generation; prefer cases that expose both kinds of communication.
  // The fallback is still a fully solved valid case, never an unfinished key.
  for (let attempt = 0; attempt < 128; attempt++) {
    const targets = [0, 1].map(() => histories.map(() => random.integer(3)));
    const coordination = solveScores(contexts, targets, {
      cases: CASES,
      weights,
    });
    const values = Object.fromEntries(
      Object.entries(coordination).map(([key, value]) => [key, numeric(value)]),
    );
    const quality =
      Number(values.mixed > values.base) * 8 +
      Number(values.broadcast > values.binding) * 4 +
      Number(!Number.isInteger(values.mixed)) * 2 +
      Number(targets.every((mode) => new Set(mode).size === 3));
    if (!selected || quality > selected.quality)
      selected = { targets, coordination, quality };
    if (quality === 15) break;
  }
  const { targets, coordination } = selected;
  const table = histories
    .map(
      (symbols, i) =>
        `${symbols.join("")} | ${weights[i]} | ${"ABC"[targets[0][i]]} | ${"ABC"[targets[1][i]]}`,
    )
    .join("\n");
  const prompt = `A, B, C must coordinate dispatches. Each privately observes one symbol a, b, c from {0,1,2}. The eighteen rows below are ALL possible histories in EACH of two hidden modes; unlisted triples are impossible. Each agent sees only their own symbol. The mode, row number, other symbols, weight and qualified agent are never separately observed. Everyone commonly knows this table and every rule; agents may infer facts from their own symbol and the table.

abc | weight | qualified in mode 1 | qualified in mode 2
${table}

Each agent either dispatches (1) or waits (0). A row succeeds in a mode exactly when ONE agent dispatches and that agent is the table's qualified agent for that row and mode. Zero or multiple dispatches fail. A deterministic protocol specifies an action for every local observation; identical observations require identical actions. The SAME protocol must handle all eighteen rows and both modes. For a protocol, s1 and s2 SUM THE WEIGHTS of successful rows in modes 1 and 2; its robust score is min(s1,s2). Successful sets can differ between modes. Scores are weighted counts out of ${weights.reduce((sum, weight) => sum + weight, 0)}, not proportions. A weight of 3 means three identical scoring copies of that row in each mode; copies are indistinguishable. A row's weight affects scoring only; it adds no observation.

Optimize each requested value independently; action rules can differ between cases:
- base: largest robust score with simultaneous actions, no messages or randomization.
- mixed: choose an arbitrary distribution over complete base protocols. One shared random draw, independent of symbols and mode, tells all three which protocol to use. Maximize min(E[s1],E[s2]); the expectation is taken BEFORE the minimum. The mode cannot depend on the random draw. No messages.
- mode_1: greatest s1 for a base protocol optimized only for mode 1; ignore s2.
- mode_2: greatest s2 for a base protocol optimized only for mode 2; ignore s1.
- binding: deterministic robust optimum when A acts first. B and C both observe A's actual action, then act simultaneously using their own symbol and that action. A cannot change its action. All three actions count toward success.
- broadcast: deterministic robust optimum when A first announces one freely chosen BINARY bit based only on a. Then all three act simultaneously using their own symbol and the announced bit. The message is not an action and does not constrain A's later action. It has only two possible values even though a has three.

No additional observations, signals, retries or private randomness are allowed. Answer all six exact maxima, not one example protocol.`;
  return {
    difficulty: "hard",
    prompt,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
    answer: { coordination },
  };
}
