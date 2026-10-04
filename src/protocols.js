import { mixedOptimum } from "./coordination.js";

// Coordination answers are protocols, scored by the value each achieves on
// its task's own table. A rule is one 0/1 digit per symbol in increasing
// symbol order: 1 dispatches (or, as a message rule, announces 1).
const AGENTS = ["A", "B", "C"];
const rules = (keys) => Object.fromEntries(keys.map((key) => [key, "Rule"]));
const simultaneous = rules(AGENTS);
// Shapes name each leaf's type; they are both the response and the parser.
export const PROTOCOLS = {
  base: simultaneous,
  mixed: { p: "Probability", first: simultaneous, second: simultaneous },
  mode_1: simultaneous,
  mode_2: simultaneous,
  binding: {
    A: "Rule",
    B: rules(["if_A_waits", "if_A_dispatches"]),
    C: rules(["if_A_waits", "if_A_dispatches"]),
  },
  broadcast: {
    message: "Rule",
    ...Object.fromEntries(
      AGENTS.map((agent) => [agent, rules(["if_message_0", "if_message_1"])]),
    ),
  },
};

// A trivial protocol: `agent` dispatches on every symbol, whatever it hears,
// and the other two never dispatch. Message rules announce 0.
const trivial = (shape, agent, symbols, owner) =>
  typeof shape === "string"
    ? (owner === agent ? "1" : "0").repeat(symbols)
    : Object.fromEntries(
        Object.entries(shape).map(([key, inner]) => [
          key,
          trivial(inner, agent, symbols, AGENTS.includes(key) ? key : owner),
        ]),
      );

/** Per case, the best value of a trivial protocol under that case's own
 * value rule; for mixed, the best mixture of the three trivial protocols.
 * Credit is earned only above it. */
export function protocolBaselines(table, cases) {
  const value = (name, agent) =>
    Number(
      protocolValue(
        table,
        name,
        trivial(PROTOCOLS[name], agent, table.symbols),
      )[0],
    );
  return Object.fromEntries(
    cases.map((name) => [
      name,
      name === "mixed"
        ? mixedOptimum(
            AGENTS.map((agent) => [
              value("mode_1", agent),
              value("mode_2", agent),
            ]),
          )
        : `${Math.max(...AGENTS.map((agent) => value(name, agent)))}/1`,
    ]),
  );
}

const ratio = (value) => value.split("/").map(BigInt);
/** Whether every case's optimum exceeds its baseline by at least `gap`
 * weight points (and by something at gap 0), so credit can vary. */
export function hasRoom({ coordination: { table, baselines, ...optima } }, gap = 0) {
  return Object.entries(optima).every(([name, optimum]) => {
    const [o, od] = ratio(optimum),
      [b, bd] = ratio(baselines[name]);
    const room = o * bd - b * od;
    return room > 0n && room >= BigInt(gap) * od * bd;
  });
}

/** A coordination task's key, types and response: the solver's optimum and
 * the trivial baseline per case, stored beside the table that values
 * submitted protocols. */
export function protocolTask(histories, weights, targets, optima) {
  const symbols = 1 + Math.max(...histories.flat()),
    cases = Object.keys(optima);
  const table = {
    symbols,
    rows: histories.map((row) => row.join("")),
    weights,
    qualified: targets.map((mode) => mode.map((agent) => AGENTS[agent])),
  };
  return {
    answer: {
      coordination: {
        ...optima,
        table,
        baselines: protocolBaselines(table, cases),
      },
    },
    types: {
      Rule: `string of ${symbols} digits 0/1, one per value ${[...Array(symbols).keys()].join(", ")} of the agent's own symbol in that order; 1 = dispatch, 0 = wait${cases.includes("broadcast") ? " (for message: the bit A announces)" : ""}`,
      ...(cases.includes("mixed")
        ? { Probability: 'exact fraction in [0,1], e.g. "1/3"' }
        : {}),
    },
    // Copies, so a stored response never aliases the grader's shapes.
    response: Object.fromEntries(
      cases.map((name) => [name, structuredClone(PROTOCOLS[name])]),
    ),
  };
}

// Weighted successes [s1, s2]: a row succeeds in a mode when exactly one
// agent dispatches and it is that mode's qualified agent.
function payoffs(table, act) {
  const scores = [0, 0];
  table.rows.forEach((row, i) => {
    const actions = act([...row].map(Number));
    if (actions.reduce((sum, action) => sum + action, 0) !== 1) return;
    const actor = AGENTS[actions.indexOf(1)];
    table.qualified.forEach((mode, m) => {
      if (mode[i] === actor) scores[m] += table.weights[i];
    });
  });
  return scores;
}
const action = (rule, symbol) => Number(rule[symbol]);
const simultaneousScores = (table, protocol) =>
  payoffs(table, (symbols) =>
    AGENTS.map((agent, i) => action(protocol[agent], symbols[i])),
  );

/** Exact value [numerator, denominator] of a complete, valid protocol; mixed
 * takes p as a [numerator, denominator] pair with 0 <= p <= 1. */
export function protocolValue(table, caseName, protocol) {
  if (caseName === "mixed") {
    const [n, d] = protocol.p,
      first = simultaneousScores(table, protocol.first),
      second = simultaneousScores(table, protocol.second);
    const expected = [0, 1].map(
      (m) => n * BigInt(first[m]) + (d - n) * BigInt(second[m]),
    );
    return [expected[0] < expected[1] ? expected[0] : expected[1], d];
  }
  let scores;
  if (caseName === "binding")
    scores = payoffs(table, ([a, b, c]) => {
      const first = action(protocol.A, a),
        heard = first ? "if_A_dispatches" : "if_A_waits";
      return [
        first,
        action(protocol.B[heard], b),
        action(protocol.C[heard], c),
      ];
    });
  else if (caseName === "broadcast")
    scores = payoffs(table, (symbols) => {
      const heard = `if_message_${protocol.message[symbols[0]]}`;
      return AGENTS.map((agent, i) =>
        action(protocol[agent][heard], symbols[i]),
      );
    });
  else if (["base", "mode_1", "mode_2"].includes(caseName))
    scores = simultaneousScores(table, protocol);
  else throw Error(`Unknown coordination case ${caseName}`);
  const value =
    caseName === "mode_1"
      ? scores[0]
      : caseName === "mode_2"
        ? scores[1]
        : Math.min(...scores);
  return [BigInt(value), 1n];
}
