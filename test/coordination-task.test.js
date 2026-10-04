import test from "node:test";
import assert from "node:assert/strict";
import { coordination } from "../src/task-bank.js";
import { grade } from "../src/grading.js";
import { optimalProtocols } from "./protocol-oracle.js";

const ALL = ["base", "mixed", "mode_1", "mode_2", "binding", "broadcast"];
const LADDER = [
  { symbols: 2, rows: 6, cases: ["base", "mode_1", "mode_2"], words: ["two", "six"] },
  { symbols: 3, rows: 18, cases: ALL, words: ["three", "eighteen"] },
  { symbols: 4, rows: 26, cases: ALL, words: ["four", "twenty-six"] },
];

// The table as the prompt states it. The oracle enumerates every rule rather
// than using the production conflict graph, rational optimizer or valuation.
function publicTable(prompt, symbols, count) {
  const rows = [
    ...prompt.matchAll(
      RegExp(`^([0-${symbols - 1}]{3}) \\| ([123]) \\| ([ABC]) \\| ([ABC])$`, "gm"),
    ),
  ];
  assert.equal(rows.length, count);
  assert.equal(new Set(rows.map((row) => row[1])).size, count);
  for (let symbol = 0; symbol < symbols; symbol++)
    assert.ok(rows.some((row) => row[1] === String(symbol).repeat(3)));
  return {
    symbols,
    rows: rows.map((row) => row[1]),
    weights: rows.map((row) => Number(row[2])),
    qualified: [rows.map((row) => row[3]), rows.map((row) => row[4])],
  };
}

test("each level states its table, which independent enumeration solves to the stored key", () => {
  LADDER.forEach(({ symbols, rows, cases, words }, level) => {
    for (const seed of ["synthetic-ladder-a", "synthetic-ladder-b"]) {
      const task = coordination(seed, level);
      const table = publicTable(task.prompt, symbols, rows);
      const {
        table: stored,
        baselines,
        ...optima
      } = task.answer.coordination;
      assert.deepEqual(stored, table);
      assert.deepEqual(Object.keys(optima), cases);
      assert.deepEqual(Object.keys(task.response), cases);
      const reference = optimalProtocols(table);
      for (const name of cases) {
        assert.equal(optima[name], reference.values[name], name);
        assert.equal(baselines[name], reference.baselines[name], name);
      }
      const result = grade(task.answer, { coordination: reference.protocols });
      assert.equal(result.percent, 100);
      assert.equal(result.submissionStatus, "scored_json");
      // Levels differ only in their numbers and the cases they ask.
      const values = [...Array(symbols).keys()];
      assert.match(task.types.Rule, RegExp(`^string of ${symbols} digits`));
      assert.equal("Probability" in task.types, cases.includes("mixed"));
      for (const text of [
        `from {${values.join(",")}}. The ${words[1]} rows below`,
        `must handle all ${words[1]} rows`,
        `A rule is a string of ${words[0]} digits, one per value ${values.join(", ")} of`,
      ])
        assert.ok(task.prompt.includes(text), text);
      for (const name of ALL)
        assert.equal(
          task.prompt.includes(`\n- ${name}: `),
          cases.includes(name),
          name,
        );
      assert.equal(
        task.prompt.includes(`even though a has ${words[0]}.`),
        cases.includes("broadcast"),
      );
      assert.equal(
        task.prompt.includes("(for mixed, the best value of any mixture of them)"),
        cases.includes("mixed"),
      );
      assert.match(task.prompt, /A case earns \(v - baseline\) \/ \(optimum - baseline\)/);
    }
  });
});
