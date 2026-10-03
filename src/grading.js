// Only aggregate stage counts leave the evaluator; no answers or field diagnostics.
const STAGES = ["reports", "knowledge", "coordination", "counterfactual"];
function rational(value) {
  if (!["string", "number"].includes(typeof value)) return null;
  const s = String(value).trim();
  if (s.length > 200) return null;
  const fraction = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(s);
  if (fraction) {
    const n = BigInt(fraction[1]),
      d = BigInt(fraction[2]);
    return d === 0n ? null : [n, d];
  }
  const decimal = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!decimal) return null;
  const exponent = Number(decimal[4] || 0) - (decimal[3]?.length || 0);
  if (Math.abs(exponent) > 1000) return null;
  let n = BigInt((decimal[1] || "") + decimal[2] + (decimal[3] || "")),
    d = 1n;
  if (exponent >= 0) n *= 10n ** BigInt(exponent);
  else d = 10n ** BigInt(-exponent);
  return [n, d];
}
export function grade(answer, submission) {
  if (!answer || typeof answer !== "object" || Array.isArray(answer))
    throw Error("A graded case must have an answer object");
  const stages = Object.fromEntries(
    STAGES.map((s) => [s, { correct: 0, total: 0, percent: 0 }]),
  );
  let malformed = false,
    missing = 0;
  function visit(expected, actual, path) {
    if (expected !== null && typeof expected === "object") {
      const valid =
        actual !== null &&
        typeof actual === "object" &&
        Array.isArray(actual) === Array.isArray(expected);
      // Extra keys are ignored: they cannot earn credit, so they are harmless.
      if (actual !== null && actual !== undefined && !valid) malformed = true;
      for (const [k, v] of Object.entries(expected))
        visit(v, valid && Object.hasOwn(actual, k) ? actual[k] : undefined, [
          ...path,
          k,
        ]);
      return;
    }
    const stage = path[0] === "checks" ? "reports" : path[0];
    if (!stages[stage]) throw Error("Unknown answer stage");
    stages[stage].total++;
    if (actual === null || actual === undefined) {
      missing++;
      return;
    }
    const rationalField =
      path[0] === "coordination" ||
      (path[0] === "counterfactual" && path.at(-1).endsWith("_base"));
    let correct = false;
    if (rationalField) {
      const a = rational(actual),
        b = rational(expected);
      correct = !!a && a[0] * b[1] === b[0] * a[1];
      if (!a) malformed = true;
    } else {
      correct = typeof expected === typeof actual && expected === actual;
      if (typeof expected !== typeof actual) malformed = true;
    }
    if (correct) stages[stage].correct++;
  }
  visit(answer, submission, []);
  for (const name of Object.keys(stages)) {
    if (stages[name].total === 0) delete stages[name];
    else
      stages[name].percent = (100 * stages[name].correct) / stages[name].total;
  }
  const count = Object.keys(stages).length;
  if (!count)
    throw Error("A graded case must contain at least one answer scalar");
  const percent =
    Object.values(stages).reduce((s, v) => s + v.percent, 0) / count;
  return {
    percent,
    stages,
    submissionStatus: malformed
      ? "schema_invalid_submission"
      : missing
        ? "partial_submission"
        : "scored_json",
    allRequiredFieldsCorrect: Object.values(stages).every(
      (s) => s.correct === s.total,
    ),
    stageWeightPercent: 100 / count,
  };
}
