import assert from "node:assert/strict";
import test from "node:test";
import {
  CASES,
  mixedOptimum,
  payoffFrontier,
  solveScores,
} from "../src/coordination.js";

/** Deliberately different oracle: enumerate every complete local Boolean rule,
 * including dead signal branches, rather than constructing successful events.
 */
function exhaustive(
  contexts,
  targets,
  caseName = "base",
  forcedContext,
  weights = Array(contexts[0].length).fill(1),
) {
  const encode = JSON.stringify;
  const cells = contexts.map((own) => [...new Set(own.map(encode))]);
  const order = caseName.startsWith("priority_")
    ? [...caseName.slice(9)].map((letter) => "ABC".indexOf(letter))
    : null;
  const definitions = new Map();
  const addRule = (name, own, signalCount) => {
    for (const context of own) {
      for (let signals = 0; signals < 2 ** signalCount; signals += 1) {
        definitions.set(
          JSON.stringify([name, context, signalCount ? signals : null]),
          definitions.size,
        );
      }
    }
  };
  if (caseName === "broadcast" || caseName === "relay")
    addRule("first", cells[0], 0);
  if (caseName === "relay") addRule("second", cells[1], 1);
  for (let actor = 0; actor < 3; actor += 1) {
    const signalCount = order
      ? order.indexOf(actor)
      : Number(
          caseName === "broadcast" ||
            (["binding", "relay"].includes(caseName) && actor > 0),
        );
    addRule(`action${actor}`, cells[actor], signalCount);
  }
  assert.ok(
    definitions.size <= 20,
    "Keep the complete-policy test oracle small",
  );
  const points = new Set();
  for (let policy = 0; policy < 2 ** definitions.size; policy += 1) {
    const rule = (name, context, signals = null) =>
      (policy >>
        definitions.get(JSON.stringify([name, encode(context), signals]))) &
      1;
    if (
      caseName.startsWith("forced_") &&
      rule("action0", forcedContext) !== Number(caseName === "forced_dispatch")
    )
      continue;
    const score = [0, 0];
    for (let history = 0; history < contexts[0].length; history += 1) {
      const own = contexts.map((person) => person[history]);
      let actions;
      if (caseName === "broadcast") {
        const first = rule("first", own[0]);
        actions = own.map((context, actor) =>
          rule(`action${actor}`, context, first),
        );
      } else if (caseName === "relay") {
        const first = rule("first", own[0]);
        const second = rule("second", own[1], first);
        actions = [
          rule("action0", own[0]),
          rule("action1", own[1], first),
          rule("action2", own[2], second),
        ];
      } else if (caseName === "binding") {
        const first = rule("action0", own[0]);
        actions = [
          first,
          rule("action1", own[1], first),
          rule("action2", own[2], first),
        ];
      } else if (order) {
        actions = [0, 0, 0];
        let past = 0;
        order.forEach((actor, position) => {
          actions[actor] = rule(
            `action${actor}`,
            own[actor],
            position ? past : null,
          );
          past = past * 2 + actions[actor];
        });
      } else
        actions = own.map((context, actor) => rule(`action${actor}`, context));
      if (actions.reduce((sum, value) => sum + value, 0) !== 1) continue;
      const actor = actions.indexOf(1);
      targets.forEach((mode, index) => {
        const target = mode[history];
        if ((Number.isInteger(target) ? [target] : [...target]).includes(actor))
          score[index] += weights[history];
      });
    }
    points.add(JSON.stringify(score));
  }
  const parsed = [...points].map(JSON.parse);
  return parsed
    .filter(
      (point) =>
        !parsed.some(
          (other) =>
            other !== point && other[0] >= point[0] && other[1] >= point[1],
        ),
    )
    .sort((left, right) => right[0] - left[0] || right[1] - left[1]);
}

test("all action and message architectures match complete-policy enumeration", () => {
  const contexts = [
    [["old", 0], "changed"],
    [7, 7],
    [
      [0, "N"],
      [0, "N"],
    ],
  ];
  for (const [targets, weights] of [
    [
      [
        [1, 2],
        [0, 2],
      ],
      [1, 1],
    ],
    [
      [
        [[0, 1], [2]],
        [[1], []],
      ],
      [2, 3],
    ],
  ]) {
    for (const caseName of [
      "base",
      "forced_wait",
      "forced_dispatch",
      "binding",
      "broadcast",
      "relay",
      "priority_ABC",
      "priority_CBA",
    ]) {
      const options = { caseName, forcedContext: ["old", 0], weights };
      assert.deepEqual(
        payoffFrontier(contexts, targets, options),
        exhaustive(contexts, targets, caseName, options.forcedContext, weights),
        caseName,
      );
    }
  }
});

test("forced actions apply to one entire private context", () => {
  const contexts = [
    [
      ["same-code", "Y"],
      ["same-code", "N"],
    ],
    [0, 0],
    [0, 1],
  ];
  const targets = [
    [0, 2],
    [0, 2],
  ];
  assert.deepEqual(
    payoffFrontier(contexts, targets, {
      caseName: "forced_wait",
      forcedContext: ["same-code", "N"],
    }),
    [[2, 2]],
  );
  assert.deepEqual(
    payoffFrontier(contexts, targets, {
      caseName: "forced_dispatch",
      forcedContext: ["same-code", "Y"],
    }),
    [[2, 2]],
  );
});

test("binding actions cannot substitute for free messages", () => {
  const contexts = [
    [0, 1],
    [0, 0],
    [0, 0],
  ];
  const targets = [
    [1, 2],
    [1, 2],
  ];
  for (const [caseName, score] of [
    ["base", 1],
    ["binding", 1],
    ["broadcast", 2],
    ["relay", 2],
  ]) {
    assert.deepEqual(payoffFrontier(contexts, targets, { caseName }), [
      [score, score],
    ]);
  }
});

test("relay gives C only the second private message", () => {
  const rows = [
    [0, 0, 0],
    [0, 0, 1],
    [1, 1, 0],
    [0, 1, 0],
    [2, 1, 1],
    [1, 0, 1],
    [3, 0, 0],
  ];
  const contexts = [0, 1, 2].map((actor) => rows.map((row) => row[actor]));
  const targets = [
    Array.from([1, 1, 1, 2, 0, 2, 0]),
    Array.from([1, 1, 1, 2, 0, 2, 0]),
  ];
  assert.deepEqual(payoffFrontier(contexts, targets, { caseName: "relay" }), [
    [6, 6],
  ]);
});

test("shared mixtures maximize the minimum of expectations using exact fractions", () => {
  assert.equal(
    mixedOptimum(payoffFrontier([[0], [0], [0]], [[0], [1]])),
    "1/2",
  );
  assert.equal(
    mixedOptimum([
      [9, 0],
      [0, 10],
    ]),
    "90/19",
  );
  assert.equal(
    mixedOptimum([
      [0, 0],
      [4, 4],
      [10, 0],
    ]),
    "4/1",
  );
  assert.equal(mixedOptimum([[0, 0]]), "0/1");
  // The intermediate cross product exceeds the safe Number integer range.
  assert.equal(
    mixedOptimum([
      [1_000_000_007, 0],
      [0, 1_000_000_009],
    ]),
    "1000000016000000063/2000000016",
  );
});

test("integer weights equal explicitly duplicated histories", () => {
  const contexts = [
    [0, 1],
    [0, 1],
    [0, 0],
  ];
  const targets = [
    [0, 1],
    [1, 2],
  ];
  const expandedContexts = contexts.map((own) =>
    [0, 0, 1, 1, 1].map((history) => own[history]),
  );
  const expandedTargets = targets.map((mode) =>
    [0, 0, 1, 1, 1].map((history) => mode[history]),
  );
  for (const caseName of [
    "base",
    "binding",
    "broadcast",
    "relay",
    "priority_CBA",
  ]) {
    assert.deepEqual(
      payoffFrontier(contexts, targets, { caseName, weights: [2, 3] }),
      payoffFrontier(expandedContexts, expandedTargets, { caseName }),
    );
  }
});

test("conflict masks preserve successful events beyond 64 bits", () => {
  const contexts = Array.from({ length: 3 }, () =>
    Array.from({ length: 70 }, (_, history) => history),
  );
  const targets = Array.from({ length: 2 }, () => Array(70).fill(0));
  assert.deepEqual(payoffFrontier(contexts, targets), [[70, 70]]);
});

test("all ten scores are reduced strings and callers cannot corrupt graph caches", () => {
  const contexts = [
    [0, 1],
    [0, 0],
    [0, 0],
  ];
  const targets = [
    [0, 2],
    [1, 2],
  ];
  const answers = solveScores(contexts, targets, { forcedContext: 0 });
  assert.deepEqual(Object.keys(answers), [...CASES]);
  for (const answer of Object.values(answers))
    assert.match(answer, /^\d+\/[1-9]\d*$/);
  const first = payoffFrontier(contexts, targets);
  const expected = structuredClone(first);
  first[0][0] = -99;
  assert.deepEqual(payoffFrontier(contexts, targets), expected);
});

test("empty qualification and invalid dimensions or actions are handled explicitly", () => {
  assert.deepEqual(payoffFrontier([[0], [0], [0]], [[[]], [[]]]), [[0, 0]]);
  for (const [contexts, targets, weights] of [
    [[[0], [0]], [[0], [1]], undefined],
    [[[0], [0, 1], [0]], [[0], [1]], undefined],
    [[[0], [0], [0]], [[3], [1]], undefined],
    [[[0], [0], [0]], [[true], [1]], undefined],
    [[[0], [0], [0]], [[0], [1]], [0]],
    [[[0], [0], [0]], [[0], [1]], [Number.MAX_SAFE_INTEGER + 1]],
  ])
    assert.throws(() => payoffFrontier(contexts, targets, { weights }));
  assert.throws(() =>
    payoffFrontier([[0], [0], [0]], [[0], [1]], {
      caseName: "forced_wait",
      forcedContext: 9,
    }),
  );
  assert.throws(() =>
    payoffFrontier([[0], [0], [0]], [[0], [1]], { caseName: "priority_AAC" }),
  );
});
