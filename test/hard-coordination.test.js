import test from "node:test";
import assert from "node:assert/strict";
import { hardCoordination } from "../src/hard-coordination.js";
// Independent oracle enumerates every reachable action table, rather than
// using the production conflict graph or any production rational optimizer.
function reference(prompt) {
  const rows = [
    ...prompt.matchAll(/^([012]{3}) \| ([123]) \| ([ABC]) \| ([ABC])$/gm),
  ].map(([, bits, weight, first, second]) => ({
    bits: [...bits].map(Number),
    weight: Number(weight),
    qualified: ["ABC".indexOf(first), "ABC".indexOf(second)],
  }));
  assert.equal(rows.length, 18);
  assert.equal(new Set(rows.map((row) => row.bits.join(""))).size, 18);
  for (const actor of [0, 1, 2])
    assert.equal(new Set(rows.map((row) => row.bits[actor])).size, 3);
  function score(actions) {
    const counts = [0, 0];
    for (const row of rows) {
      const dispatches = actions(row.bits);
      if (dispatches.reduce((s, v) => s + v, 0) !== 1) continue;
      const actor = dispatches.indexOf(1);
      for (let mode = 0; mode < 2; mode++)
        if (actor === row.qualified[mode]) counts[mode] += row.weight;
    }
    return counts;
  }
  const policies = [];
  for (let a = 0; a < 8; a++)
    for (let b = 0; b < 8; b++)
      for (let c = 0; c < 8; c++)
        policies.push(
          score(([x, y, z]) => [(a >> x) & 1, (b >> y) & 1, (c >> z) & 1]),
        );
  const robust = (pairs) =>
    pairs.reduce((best, [x, y]) => Math.max(best, Math.min(x, y)), 0);
  const base = robust(policies);
  let numerator = base,
    denominator = 1;
  // A two-dimensional convex hull meets the equal-payoff line on an edge;
  // enumerate all edges between actual complete policies, including endpoints.
  for (const [x1, y1] of policies)
    for (const [x2, y2] of policies) {
      let d = x1 - y1 - (x2 - y2),
        p = y2 - x2;
      if (d < 0) [d, p] = [-d, -p];
      if (!d || p < 0 || p > d) continue;
      const n = x2 * d + p * (x1 - x2);
      if (n * denominator > numerator * d) [numerator, denominator] = [n, d];
    }
  let x = numerator,
    y = denominator;
  while (y) [x, y] = [y, x % y];
  const mixed = `${numerator / x}/${denominator / x}`;
  const sequential = [];
  for (let a = 0; a < 8; a++)
    for (let b = 0; b < 64; b++)
      for (let c = 0; c < 64; c++)
        sequential.push(
          score(([x, y, z]) => {
            const first = (a >> x) & 1;
            return [
              first,
              (b >> (2 * y + first)) & 1,
              (c >> (2 * z + first)) & 1,
            ];
          }),
        );
  const communicated = [];
  for (let message = 0; message < 8; message++)
    for (let a = 0; a < 8; a++)
      for (let b = 0; b < 64; b++)
        for (let c = 0; c < 64; c++)
          communicated.push(
            score(([x, y, z]) => {
              const signal = (message >> x) & 1;
              return [
                (a >> x) & 1,
                (b >> (2 * y + signal)) & 1,
                (c >> (2 * z + signal)) & 1,
              ];
            }),
          );
  return {
    coordination: {
      base: `${base}/1`,
      mixed,
      mode_1: `${Math.max(...policies.map(([first]) => first))}/1`,
      mode_2: `${Math.max(...policies.map(([, second]) => second))}/1`,
      binding: `${robust(sequential)}/1`,
      broadcast: `${robust(communicated)}/1`,
    },
  };
}

test("hard coordination keys match independent complete-policy enumeration", () => {
  for (const seed of ["synthetic-hard-a", "synthetic-hard-b"]) {
    const task = hardCoordination(seed);
    assert.deepEqual(task.answer, reference(task.prompt));
  }
});
