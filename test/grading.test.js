import test from "node:test";
import assert from "node:assert/strict";
import { grade } from "../src/grading.js";
const answer = {
  reports: {
    R0: {
      row_count: 1,
      rows: [
        {
          customer: "Example",
          orders: 1,
          revenue_cents: 900,
          late: 0,
          top: "widgets",
        },
      ],
    },
  },
  checks: { R0: 3 },
  knowledge: { knows: true },
  coordination: { base: "2/3" },
  counterfactual: { no_swap_base: "4/1", flag: false },
};
test("equal stage weighting and full/partial/null correctness", () => {
  assert.equal(grade(answer, answer).percent, 100);
  assert.equal(grade(answer, null).percent, 0);
  assert.equal(grade(answer, { knowledge: { knows: true } }).percent, 25);
  assert.equal(grade(answer, { ...answer, coordination: null }).percent, 75);
  const equivalent = structuredClone(answer);
  equivalent.coordination.base = "4/6";
  equivalent.counterfactual.no_swap_base = 4;
  assert.equal(grade(answer, equivalent).percent, 100);
  equivalent.knowledge.knows = 1;
  assert.equal(grade(answer, equivalent).percent, 75);
});
test("wrong schemas do not prevent correct siblings, outputs contain no field answers", () => {
  const result = grade(answer, {
    reports: [],
    knowledge: { knows: true },
    coordination: { base: "0/0" },
    extra: true,
  });
  assert.equal(result.percent, 25);
  assert.equal(result.submissionStatus, "schema_invalid_submission");
  assert.equal(JSON.stringify(result).includes("Example"), false);
  assert.equal(JSON.stringify(result).includes("incorrect_fields"), false);
});
test("extra keys are ignored without marking the submission invalid", () => {
  const easy = { knowledge: { first: true } };
  const result = grade(easy, { knowledge: { first: true, marin: 5 }, extra: 1 });
  assert.equal(result.percent, 100);
  assert.equal(result.submissionStatus, "scored_json");
});
test("rational score fields use exact equality without tolerance", () => {
  assert.equal(
    grade(answer, { coordination: { base: 0.6666666666666666 } }).stages
      .coordination.correct,
    0,
  );
  assert.equal(
    grade(answer, { coordination: { base: "2e100000" } }).stages.coordination
      .correct,
    0,
  );
  assert.equal(
    grade(answer, { coordination: { base: true } }).stages.coordination.correct,
    0,
  );
});

test("compact cases weight only their nonempty stages and reject empty answer keys", () => {
  const easy = { knowledge: { first: true, second: false } };
  assert.deepEqual(Object.keys(grade(easy, easy).stages), ["knowledge"]);
  assert.equal(grade(easy, { knowledge: { first: true } }).percent, 50);
  assert.equal(grade(easy, null).percent, 0);
  assert.equal(grade(easy, easy).stageWeightPercent, 100);
  const normal = {
    knowledge: { one: true, two: false, three: true },
    counterfactual: { one: false },
  };
  assert.equal(grade(normal, { knowledge: normal.knowledge }).percent, 50);
  assert.equal(
    grade(normal, { counterfactual: normal.counterfactual }).percent,
    50,
  );
  assert.equal(grade(normal, normal).stageWeightPercent, 50);
  assert.equal(grade({ ...normal, reports: {} }, normal).percent, 100);
  assert.throws(() => grade({}, {}), /at least one/);
  assert.throws(() => grade({ knowledge: {} }, {}), /at least one/);
  assert.throws(() => grade(null, null), /answer object/);
});
