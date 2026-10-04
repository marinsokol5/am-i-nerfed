import { PROTOCOLS, protocolValue } from "./protocols.js";
import { gradeCheckpoint } from "./checkpoint-grading.js";
import { isObject } from "./values.js";

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
// A submitted protocol mirrors its case's shape: a null leaf leaves it
// partial, a wrong type or rule length makes it malformed.
function protocol(shape, value, symbols, flags) {
  if (value === null || value === undefined) {
    flags.missing = true;
    return null;
  }
  if (shape === "Rule") {
    if (
      typeof value === "string" &&
      new RegExp(`^[01]{${symbols}}$`).test(value)
    )
      return value;
  } else if (shape === "Probability") {
    let [n, d] = rational(value) ?? [-1n, 1n];
    if (d < 0n) [n, d] = [-n, -d];
    if (n >= 0n && n <= d) return [n, d];
  } else if (typeof value === "object" && !Array.isArray(value))
    return Object.fromEntries(
      Object.entries(shape).map(([key, inner]) => [
        key,
        protocol(
          inner,
          Object.hasOwn(value, key) ? value[key] : undefined,
          symbols,
          flags,
        ),
      ]),
    );
  flags.malformed = true;
  return null;
}
// The share of the gap from the trivial baseline to the optimum that a
// protocol closes, clamped to [0,1] and floored to 52 bits so a near miss
// never rounds up to full credit. Reaching the optimum always earns 1.
function credit([n, d], baseline, optimum) {
  const [b, bd] = rational(baseline),
    [o, od] = rational(optimum);
  // (n/d - b/bd) / (o/od - b/bd), with every denominator positive.
  const gained = (n * bd - b * d) * od,
    room = (o * bd - b * od) * d;
  if (gained >= room) return 1;
  if (gained <= 0n) return 0;
  return Number((gained << 52n) / room) / 2 ** 52;
}
export function grade(answer, submission) {
  if (!isObject(answer))
    throw Error("A graded case must have an answer object");
  if (Object.hasOwn(answer, "checkpoint"))
    return gradeCheckpoint(answer.checkpoint, isObject(submission) ? submission.checkpoint : submission);
  const stages = Object.fromEntries(
    STAGES.map((s) => [s, { correct: 0, total: 0, percent: 0 }]),
  );
  let malformed = false,
    missing = 0;
  function visit(expected, actual, path) {
    // A key that stores its table takes protocols as coordination answers:
    // each case earns the share of the gap from its trivial baseline to its
    // optimum that the protocol's value closes. Older keys hold only the
    // optima, which must be answered exactly.
    if (path.length === 1 && path[0] === "coordination" && expected?.table) {
      const { table, baselines, ...optima } = expected;
      const valid = isObject(actual);
      if (actual !== null && actual !== undefined && !valid) malformed = true;
      for (const [name, optimum] of Object.entries(optima)) {
        if (!Object.hasOwn(PROTOCOLS, name))
          throw Error("Unknown coordination case");
        stages.coordination.total++;
        const flags = {},
          submitted = protocol(
            PROTOCOLS[name],
            valid && Object.hasOwn(actual, name) ? actual[name] : undefined,
            table.symbols,
            flags,
          );
        if (flags.malformed) malformed = true;
        if (flags.missing) missing++;
        if (!flags.malformed && !flags.missing)
          stages.coordination.correct += credit(
            protocolValue(table, name, submitted),
            baselines[name],
            optimum,
          );
      }
      return;
    }
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
