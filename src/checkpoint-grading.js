import { gradeTask as coordination } from "./checkpoint-coordination.js";
import { gradeTask as diagnosis } from "./checkpoint-diagnosis.js";
import { gradeTask as synthesis } from "./checkpoint-synthesis.js";
import { gradeTask as knowledge } from "./checkpoint-knowledge.js";
import { isObject } from "./values.js";

const GRADERS = {
  "coordination-three-mode": coordination,
  "adversarial-diagnosis": diagnosis,
  "reversible-synthesis": synthesis,
  "private-knowledge": knowledge,
};
function submissionShape(expected, actual, flags) {
  if (actual == null) { flags.missing = true; return; }
  if (Array.isArray(expected)) {
    // Witness and set arrays are atomic fields; any valid alternative is allowed.
    if (!Array.isArray(actual)) flags.malformed = true;
  } else if (isObject(expected)) {
    if (!isObject(actual)) { flags.malformed = true; return; }
    for (const [field, value] of Object.entries(expected))
      submissionShape(value, Object.hasOwn(actual, field) ? actual[field] : undefined, flags);
  } else if (typeof actual !== typeof expected || typeof expected === "number" && !Number.isSafeInteger(actual))
    flags.malformed = true;
}

/** Adapt private checkpoint keys to the normal assessment receipt contract.
 * Only earned points leave here; oracle values and witness diagnostics stay private.
 */
export function gradeCheckpoint(key, draft) {
  if (!isObject(key) || key.version !== 1 || !Object.hasOwn(GRADERS, key.family) || !isObject(key.task))
    throw Error("Unknown checkpoint answer format");
  const result = GRADERS[key.family](key.task, draft);
  const checkpoints = result.checkpoints.map(({ id, earned, max }) => ({ id, earned, max }));
  if (!checkpoints.length || checkpoints.some(({ earned, max }) =>
    !Number.isFinite(earned) || !Number.isFinite(max) || max <= 0 || earned < 0 || earned > max))
    throw Error("Invalid checkpoint score");
  const correct = checkpoints.reduce((sum, c) => sum + c.earned, 0);
  const total = checkpoints.reduce((sum, c) => sum + c.max, 0);
  const percent = 100 * correct / total;
  const completed = checkpoints.filter(c => c.earned === c.max).length;
  const flags = { malformed: false, missing: false };
  submissionShape(key.task.solution, draft, flags);
  return {
    percent,
    stages: { checkpoints: { correct, total, percent } },
    submissionStatus: flags.malformed ? "schema_invalid_submission" : flags.missing ? "partial_submission" : "scored_json",
    allRequiredFieldsCorrect: completed === checkpoints.length,
    stageWeightPercent: 100,
    checkpointProgress: { completed, total: checkpoints.length, checkpoints },
    originalGoalComplete: result.fullyCorrect === true,
  };
}
