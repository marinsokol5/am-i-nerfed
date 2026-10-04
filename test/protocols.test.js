import test from "node:test";
import assert from "node:assert/strict";
import { randomSource } from "../src/random.js";
import { solveScores } from "../src/coordination.js";
import {
  hasRoom,
  protocolBaselines,
  protocolTask,
  protocolValue,
} from "../src/protocols.js";
import { grade } from "../src/grading.js";
import { optimalProtocols } from "./protocol-oracle.js";

const CASES = ["base", "mixed", "mode_1", "mode_2", "binding", "broadcast"];
// Small enough to value every protocol below by hand.
const table = {
  symbols: 2,
  rows: ["000", "011", "101", "110"],
  weights: [1, 2, 3, 1],
  qualified: [
    ["A", "B", "C", "A"],
    ["B", "B", "A", "C"],
  ],
};
const aOnOne = { A: "01", B: "00", C: "00" }, // s1 = 1, s2 = 3
  bOnOne = { A: "00", B: "01", C: "00" }; // s1 = 2, s2 = 2

test("protocol values replay hand-made protocols exactly", () => {
  assert.deepEqual(protocolValue(table, "base", aOnOne), [1n, 1n]);
  assert.deepEqual(protocolValue(table, "mode_1", aOnOne), [1n, 1n]);
  assert.deepEqual(protocolValue(table, "mode_2", aOnOne), [3n, 1n]);
  assert.deepEqual(protocolValue(table, "base", bOnOne), [2n, 1n]);
  // E[s1] = 1/3 + 4/3 = 5/3, E[s2] = 3/3 + 4/3 = 7/3.
  assert.deepEqual(
    protocolValue(table, "mixed", { p: [1n, 3n], first: aOnOne, second: bOnOne }),
    [5n, 3n],
  );
  assert.deepEqual(
    protocolValue(table, "mixed", { p: [0n, 1n], first: aOnOne, second: bOnOne }),
    [2n, 1n],
  );
  // A dispatches on a = 1; B dispatches on b = 1 only after A waits:
  // 011 is B's (both modes), 101 and 110 are A's (mode 2, mode 1).
  assert.deepEqual(
    protocolValue(table, "binding", {
      A: "01",
      B: { if_A_waits: "01", if_A_dispatches: "00" },
      C: { if_A_waits: "00", if_A_dispatches: "00" },
    }),
    [3n, 1n],
  );
  // A announces a. Row 110 then has A and C both dispatching, so it fails.
  assert.deepEqual(
    protocolValue(table, "broadcast", {
      message: "01",
      A: { if_message_0: "00", if_message_1: "01" },
      B: { if_message_0: "01", if_message_1: "00" },
      C: { if_message_0: "00", if_message_1: "10" },
    }),
    [2n, 1n],
  );
  assert.throws(() => protocolValue(table, "relay", aOnOne), /Unknown/);
});

// The key production builds for the hand-made table.
function handKey() {
  const histories = table.rows.map((row) => [...row].map(Number)),
    targets = table.qualified.map((mode) =>
      mode.map((agent) => "ABC".indexOf(agent)),
    );
  return protocolTask(
    histories,
    table.weights,
    targets,
    solveScores(
      [0, 1, 2].map((actor) => histories.map((h) => h[actor])),
      targets,
      { cases: CASES, weights: table.weights },
    ),
  ).answer;
}
const cOnly = { A: "00", B: "00", C: "11" }, // trivial: s1 = 3, s2 = 1
  aAndB = { A: "01", B: "01", C: "00" }, // s1 = 2, s2 = 5
  fourZero = { A: "10", B: "00", C: "01" }; // s1 = 4, s2 = 0

test("baselines are the best trivial protocol per case, and the best trivial mixture", () => {
  // Trivial A, B and C score (2,3), (2,3) and (3,1); mixing C with A
  // equalizes at 7/3.
  assert.deepEqual(protocolBaselines(table, CASES), {
    base: "2/1",
    mixed: "7/3",
    mode_1: "3/1",
    mode_2: "3/1",
    binding: "2/1",
    broadcast: "2/1",
  });
  assert.deepEqual(handKey().coordination, {
    base: "2/1",
    mixed: "20/7",
    mode_1: "4/1",
    mode_2: "5/1",
    binding: "3/1",
    broadcast: "4/1",
    table,
    baselines: protocolBaselines(table, CASES),
  });
  // A trivial protocol already reaches the base optimum; every other case
  // has room.
  assert.equal(hasRoom(handKey()), false);
  const { base, ...others } = handKey().coordination;
  assert.equal(base, others.baselines.base);
  assert.equal(hasRoom({ coordination: others }), true);
});

test("room can require a minimum gap in weight points, fractions included", () => {
  const key = (optimum, baseline) => ({
    coordination: { base: optimum, baselines: { base: baseline }, table: {} },
  });
  assert.equal(hasRoom(key("5/1", "2/1"), 3), true);
  assert.equal(hasRoom(key("5/1", "2/1"), 4), false);
  assert.equal(hasRoom(key("13/4", "1/4"), 3), true);
  assert.equal(hasRoom(key("13/4", "1/3"), 3), false);
  // A zero gap still needs some room.
  assert.equal(hasRoom(key("2/1", "2/1"), 0), false);
});

test("each case earns the share of the gap from its baseline to its optimum", () => {
  const answer = handKey();
  const result = grade(answer, {
    coordination: {
      mixed: { p: "3/5", first: cOnly, second: aAndB }, // E = (13/5, 13/5)
      mode_1: aOnOne, // 1, below the baseline 3
      mode_2: aAndB, // 5, the optimum
      // A announces a; B takes 011 after 0 and C takes 101 and 110 after 1.
      broadcast: {
        message: "01",
        A: { if_message_0: "00", if_message_1: "00" },
        B: { if_message_0: "01", if_message_1: "00" },
        C: { if_message_0: "00", if_message_1: "11" },
      },
    },
  });
  // (13/5 - 7/3) / (20/7 - 7/3) = 28/55, 0, 1 and (3 - 2) / (4 - 2), with
  // base and binding missing.
  const credit = 28 / 55 + 0 + 1 + 1 / 2;
  assert.ok(Math.abs(result.stages.coordination.correct - credit) < 1e-12);
  assert.ok(Math.abs(result.percent - (100 * credit) / 6) < 1e-9);
  assert.equal(result.stages.coordination.total, 6);
  assert.equal(result.submissionStatus, "partial_submission");
  assert.equal(result.allRequiredFieldsCorrect, false);

  const mixed = (p, first, second) =>
    grade(answer, { coordination: { mixed: { p, first, second } } }).stages
      .coordination.correct;
  // Decimal and unreduced probabilities are exact.
  for (const p of ["3/5", "0.6", 0.6, "6/10", " 3 / 5 ", "-3/-5"])
    assert.ok(Math.abs(mixed(p, cOnly, aAndB) - 28 / 55) < 1e-15, String(p));
  // (4,0) and (2,5) mixed at 3/7 reach the optimum 20/7; a near miss is
  // floored, never rounded up to full credit.
  assert.equal(mixed("3/7", fourZero, aAndB), 1);
  const near = mixed("0.4285714285714285714", fourZero, aAndB);
  assert.ok(near < 1 && near > 1 - 1e-15);
  // The best trivial mixture sits exactly at its baseline and earns nothing.
  assert.equal(mixed("1/3", cOnly, { A: "11", B: "00", C: "00" }), 0);
  // Base has no room on this table, which generation never allows; reaching
  // the optimum there still earns full credit.
  const base = (protocol) =>
    grade(answer, { coordination: { base: protocol } }).stages.coordination
      .correct;
  assert.equal(base(bOnOne), 1);
  assert.equal(base(aOnOne), 0);
});

test("malformed or missing protocols score zero without throwing", () => {
  const key = handKey();
  // Credits 1, 28/55, 1, 1, 1 and 1/2.
  const valid = {
    base: bOnOne,
    mixed: { p: "3/5", first: cOnly, second: aAndB },
    mode_1: fourZero,
    mode_2: aAndB,
    binding: {
      A: "01",
      B: { if_A_waits: "01", if_A_dispatches: "00" },
      C: { if_A_waits: "00", if_A_dispatches: "00" },
    },
    broadcast: {
      message: "01",
      A: { if_message_0: "00", if_message_1: "00" },
      B: { if_message_0: "01", if_message_1: "00" },
      C: { if_message_0: "00", if_message_1: "11" },
    },
  };
  const full = grade(key, { coordination: valid });
  assert.equal(full.submissionStatus, "scored_json");
  assert.ok(
    Math.abs(full.stages.coordination.correct - (5 + 28 / 55 - 1 / 2)) < 1e-12,
  );
  const invalid = [
    ["base", "01"],
    ["base", ["01", "01", "01"]],
    ["base", { A: "012", B: "01", C: "01" }],
    ["base", { A: "0", B: "01", C: "01" }],
    ["base", { A: 1, B: "01", C: "01" }],
    ["base", { A: "0x", B: "01", C: "01" }],
    ["mixed", { ...valid.mixed, p: "3/2" }],
    ["mixed", { ...valid.mixed, p: "-1/2" }],
    ["mixed", { ...valid.mixed, p: "1/-2" }],
    ["mixed", { ...valid.mixed, p: "1/0" }],
    ["mixed", { ...valid.mixed, p: "1e99999" }],
    ["mixed", { ...valid.mixed, p: true }],
    ["mixed", { ...valid.mixed, first: "01" }],
    ["binding", { ...valid.binding, B: "01" }],
    ["binding", { ...valid.binding, C: { if_A_waits: "00", if_A_dispatches: [] } }],
    ["broadcast", { ...valid.broadcast, message: "2" }],
    ["broadcast", { ...valid.broadcast, A: { if_message_0: { x: 1 }, if_message_1: "00" } }],
  ];
  for (const [name, value] of invalid) {
    const result = grade(key, { coordination: { ...valid, [name]: value } });
    assert.equal(result.submissionStatus, "schema_invalid_submission", name);
    // The other cases keep their credit; this one loses its own.
    const others = grade(key, { coordination: { ...valid, [name]: null } });
    assert.equal(result.percent, others.percent, `${name} ${JSON.stringify(value)}`);
    assert.ok(result.percent < full.percent, name);
  }
  for (const [name, value] of [
    ["base", { A: "01", B: null, C: "01" }],
    ["base", {}],
    ["mixed", { first: aOnOne, second: bOnOne }],
    ["broadcast", { ...valid.broadcast, C: { if_message_0: "00" } }],
  ]) {
    const result = grade(key, { coordination: { ...valid, [name]: value } });
    assert.equal(result.submissionStatus, "partial_submission", name);
  }
  for (const submission of [
    null,
    "nope",
    [],
    { coordination: "nope" },
    { coordination: [] },
    { coordination: JSON.parse('{"__proto__":{"base":1},"constructor":{}}') },
  ]) {
    const result = grade(key, submission);
    assert.equal(result.percent, 0);
    assert.deepEqual(result.stages.coordination, {
      correct: 0,
      total: 6,
      percent: 0,
    });
  }
  // Keys without a table keep exact optimum answers for older banks.
  assert.equal(
    grade({ coordination: { base: "2/1" } }, { coordination: { base: "4/2" } })
      .percent,
    100,
  );
});

// Every protocol the answer format allows, valued by production code.
function everyProtocol(caseName, symbols = 2) {
  const rules = Array.from({ length: 2 ** symbols }, (_, x) =>
    x.toString(2).padStart(symbols, "0"),
  );
  const pairs = (keys) =>
    rules.flatMap((x) => rules.map((y) => ({ [keys[0]]: x, [keys[1]]: y })));
  if (["base", "mode_1", "mode_2"].includes(caseName))
    return rules.flatMap((A) =>
      rules.flatMap((B) => rules.map((C) => ({ A, B, C }))),
    );
  if (caseName === "binding") {
    const heard = pairs(["if_A_waits", "if_A_dispatches"]);
    return rules.flatMap((A) =>
      heard.flatMap((B) => heard.map((C) => ({ A, B, C }))),
    );
  }
  const heard = pairs(["if_message_0", "if_message_1"]);
  return rules.flatMap((message) =>
    heard.flatMap((A) =>
      heard.flatMap((B) => heard.map((C) => ({ message, A, B, C }))),
    ),
  );
}
const exceeds = ([n, d], [m, e]) => n * e > m * d;
const fraction = ([n, d]) => `${n}/${d}`;

test("brute force: every two-symbol optimum is reached in the answer format and scores 100%", () => {
  const random = randomSource("synthetic-protocol-brute-force");
  const rows = Array.from({ length: 8 }, (_, i) => [
    i >> 2,
    (i >> 1) & 1,
    i & 1,
  ]);
  // Half the random tables weight rows, as generated tables do. The last table
  // needs a free message: only A sees which row it is, and B must act.
  const instances = [
    ...Array.from({ length: 6 }, (_, instance) => ({
      histories: rows,
      weights: rows.map(() => (instance % 2 ? 1 + random.integer(3) : 1)),
      targets: [0, 1].map(() => rows.map(() => random.integer(3))),
    })),
    {
      histories: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      weights: [1, 1],
      targets: [
        [1, 2],
        [1, 2],
      ],
    },
  ];
  const covered = new Set();
  for (const [instance, { histories, weights, targets }] of instances.entries()) {
    const optima = solveScores(
      [0, 1, 2].map((actor) => histories.map((h) => h[actor])),
      targets,
      { cases: CASES, weights },
    );
    const { answer } = protocolTask(histories, weights, targets, optima);
    const { table, baselines } = answer.coordination;
    assert.deepEqual(baselines, optimalProtocols(table).baselines);
    const best = {};
    for (const name of ["base", "mode_1", "mode_2", "binding", "broadcast"])
      for (const protocol of everyProtocol(name)) {
        const value = protocolValue(table, name, protocol);
        if (!best[name] || exceeds(value, best[name].value))
          best[name] = { value, protocol };
      }
    // The best p for a pair is 0, 1 or where the two expectations cross.
    const scored = everyProtocol("base").map((protocol) => ({
      protocol,
      s: [1, 2].map((m) => Number(protocolValue(table, `mode_${m}`, protocol)[0])),
    }));
    for (const f of scored)
      for (const g of scored) {
        const slope = f.s[0] - f.s[1] + g.s[1] - g.s[0];
        const ps = [[0n, 1n], [1n, 1n]];
        if (slope > 0 && g.s[1] > g.s[0] && f.s[0] > f.s[1])
          ps.push([BigInt(g.s[1] - g.s[0]), BigInt(slope)]);
        for (const p of ps) {
          const protocol = { p, first: f.protocol, second: g.protocol };
          const value = protocolValue(table, "mixed", protocol);
          if (!best.mixed || exceeds(value, best.mixed.value))
            best.mixed = { value, protocol };
        }
      }
    const submission = {};
    for (const name of CASES) {
      const { value, protocol } = best[name];
      assert.equal(
        value[0] * BigInt(optima[name].split("/")[1]),
        BigInt(optima[name].split("/")[0]) * value[1],
        `instance ${instance} ${name}: ${fraction(value)} vs ${optima[name]}`,
      );
      submission[name] =
        name === "mixed" ? { ...protocol, p: fraction(protocol.p) } : protocol;
      const single = grade(
        { coordination: { [name]: optima[name], table, baselines } },
        { coordination: { [name]: submission[name] } },
      );
      assert.equal(single.percent, 100, `instance ${instance} ${name}`);
    }
    const result = grade(answer, { coordination: submission });
    assert.equal(result.percent, 100);
    assert.equal(result.allRequiredFieldsCorrect, true);
    const value = (name) => {
      const [n, d] = optima[name].split("/").map(Number);
      return n / d;
    };
    if (value("mixed") > value("base")) covered.add("mixture helps");
    if (!Number.isInteger(value("mixed"))) covered.add("fractional mixture");
    if (value("binding") > value("base")) covered.add("binding helps");
    if (value("broadcast") > value("binding")) covered.add("message helps");
  }
  assert.equal(covered.size, 4, [...covered].join(", "));
});
