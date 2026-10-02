import fs from "node:fs";
import { createHash } from "node:crypto";
import { grade } from "./grading.js";
import {
  datasetFor,
  readRun,
  readJSON,
  runPath,
  writeJSON,
} from "./storage.js";

// Type tags avoid collisions even for JSON numbers beyond JavaScript's finite
// range. Object key order and whitespace are immaterial; array order is not.
function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "string") return "string:" + JSON.stringify(value);
  if (typeof value === "boolean") return "boolean:" + value;
  if (typeof value === "number") return "number:" + String(value);
  if (Array.isArray(value))
    return "array:[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object")
    return (
      "object:{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  throw Error("Submission contains an unsupported value");
}
export function payloadHash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function datasetHash(dataset, difficulty) {
  return payloadHash({
    difficulty,
    generatorVersion: dataset.generatorVersion ?? null,
    prompt: dataset.prompt,
    answer: dataset.answer,
  });
}
export function evaluateRun(state, id, submission, label = null) {
  const run = readRun(state.base, id);
  if (run.id !== id || run.baselineId !== state.current.baselineId)
    throw Error(
      "Run does not belong to the current baseline. Keep the original run ID; do not switch to another chat's run.",
    );
  const filename = runPath(state.base, id),
    claimPath = filename + ".claim";
  const hash = payloadHash(submission);
  let claim = fs.existsSync(claimPath) ? readJSON(claimPath) : null;
  if (claim) {
    if (claim.hashVersion !== 1 || typeof claim.payloadHash !== "string")
      throw Error(
        "This legacy run is already consumed and cannot verify an identical retry. Check its history; do not move the answer to another run.",
      );
    if (claim.payloadHash !== hash)
      throw Error(
        "This run already accepted a different answer. Only an identical JSON payload can be retried; no new score was computed.",
      );
    if (run.status === "submitted") {
      if (!run.receipt)
        throw Error(
          "The saved receipt is unavailable. Check history; no new score was computed.",
        );
      return run.receipt;
    }
  } else if (run.status !== "pending") {
    throw Error(
      "This legacy run is already consumed and cannot verify an identical retry. Check its history; do not move the answer to another run.",
    );
  }
  // Never regenerate a missing frozen key while delivering an existing answer.
  const dataset = datasetFor(state, run.difficulty, { create: false });
  if (run.promptHash && run.promptHash !== dataset.promptHash)
    throw Error(
      "The frozen case no longer matches this run. No score was computed.",
    );
  const keyHash = datasetHash(dataset, run.difficulty);
  if (claim && claim.datasetHash !== keyHash)
    throw Error(
      "The frozen case changed after this answer was accepted. Retry cannot safely reproduce its grade.",
    );
  if (!claim) {
    claim = {
      hashVersion: 1,
      payloadHash: hash,
      datasetHash: keyHash,
      claimedAt: new Date().toISOString(),
      label,
    };
    writeJSON(claimPath, claim, { exclusive: true });
  }
  const result = grade(dataset.answer, submission);
  const elapsedMs = Math.max(
    0,
    Date.parse(claim.claimedAt) - Date.parse(run.createdAt),
  );
  const receipt = {
    runId: run.id,
    baselineId: run.baselineId,
    difficulty: run.difficulty,
    elapsedMs,
    submittedAt: claim.claimedAt,
    generatorVersion: dataset.generatorVersion,
    promptHash: dataset.promptHash ?? null,
    ...result,
    note: "Correctness on this private case, not a universal intelligence score. Compare only runs on the same baseline and difficulty; repeated exposure can improve scores.",
  };
  writeJSON(filename, {
    ...run,
    status: "submitted",
    submittedAt: claim.claimedAt,
    elapsedMs,
    label: claim.label ?? null,
    result,
    receipt,
  });
  return receipt;
}
