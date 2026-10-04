import test from "node:test";
import assert from "node:assert/strict";
import { generate as coordination } from "../src/checkpoint-coordination.js";
import { generate as diagnosis } from "../src/checkpoint-diagnosis.js";
import { generate as synthesis } from "../src/checkpoint-synthesis.js";
import { generate as knowledge } from "../src/checkpoint-knowledge.js";
import { flatten, nest } from "../src/task-bank.js";
import { grade } from "../src/grading.js";

for (const [family, generate] of Object.entries({ coordination, diagnosis, synthesis, knowledge })) {
  test(`${family} checkpoint keys round-trip through normal grading without exposing oracle data`, () => {
    const task=JSON.parse(JSON.stringify(generate(`synthetic-integrated-${family}`)));
    const solution=flatten(task.answer);
    assert.deepEqual(Object.keys(solution).sort(),Object.keys(task.response).sort());
    const result=grade(task.answer,nest(task.answer,solution));
    assert.equal(result.percent,100);
    assert.equal(result.allRequiredFieldsCorrect,true);
    assert.equal(result.originalGoalComplete,true);
    assert.equal(result.stages.checkpoints.total,100);
    assert.ok(result.checkpointProgress.completed>0);
    assert.ok(result.checkpointProgress.checkpoints.every(c=>Object.keys(c).sort().join(',')==='earned,id,max'));
    assert.doesNotMatch(JSON.stringify(result),/"(?:solution|metadata|lowerBound|upperBound|pureOptimum|mixedOptimum|answer)"/);
    assert.equal(grade(task.answer,null).percent,0);
    assert.equal(grade(task.answer,nest(task.answer,Object.create(solution))).percent,0);
    const wrongTypes=Object.fromEntries(Object.keys(solution).map(field=>[field,typeof solution[field]==="boolean"?"not-a-boolean":false]));
    const invalid=grade(task.answer,nest(task.answer,wrongTypes));
    assert.equal(invalid.percent,0);
    assert.equal(invalid.submissionStatus,"schema_invalid_submission");
    for(const bad of [[],false,42,"invalid"]) {
      const scored=grade(task.answer,nest(task.answer,bad));
      assert.equal(scored.percent,0);
      assert.equal(scored.submissionStatus,"schema_invalid_submission");
    }
  });
}

test("missing checkpoint fields earn partial credit and extras cannot earn points",()=>{
  const t=diagnosis("synthetic-checkpoint-partial"), full=flatten(t.answer);
  const field=Object.keys(full)[0];
  const actual=grade(t.answer,nest(t.answer,{[field]:full[field],extra:"ignored"}));
  assert.ok(actual.percent>0&&actual.percent<100);
  assert.equal(actual.submissionStatus,"partial_submission");
  assert.equal(actual.allRequiredFieldsCorrect,false);
  assert.equal(grade(t.answer,nest(t.answer,{extra:full})).percent,0);
});

test("nested knowledge answers retain partial status and independently scored evidence",()=>{
  const task=knowledge("synthetic-nested-knowledge-shape"),solution=flatten(task.answer);
  const partial={scenarioA:{q1:solution.scenarioA.q1},scenarioB:{}};
  const result=grade(task.answer,nest(task.answer,partial));
  assert.equal(result.percent,2);
  assert.equal(result.submissionStatus,"partial_submission");
  assert.equal(result.checkpointProgress.total,28);
  const malformed={scenarioA:{q1:"true"},scenarioB:solution.scenarioB};
  const graded=grade(task.answer,nest(task.answer,malformed));
  assert.equal(graded.percent,50);
  assert.equal(graded.submissionStatus,"schema_invalid_submission");
});
