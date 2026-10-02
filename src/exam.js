import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateExamBank } from "./exam-bank.js";
import { grade } from "./grading.js";
import { payloadHash } from "./submission.js";
import { privateDirectory, readJSON, writeJSON } from "./storage.js";

export const EXAM_DURATION_MS = 300_000;
const MAX_DRAFT_BYTES = 1_048_576;
const QUESTION_IDS = ["q1", "q2", "q3", "q4"];
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function mergeDraft(previous, patch) {
  if (!isObject(patch)) return patch;
  const old = isObject(previous) ? previous : {};
  // fromEntries defines own properties, including __proto__, without setters.
  const keys = new Set([...Object.keys(old), ...Object.keys(patch)]);
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      Object.hasOwn(patch, key)
        ? mergeDraft(Object.hasOwn(old, key) ? old[key] : undefined, patch[key])
        : old[key],
    ]),
  );
}
function filledFields(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object")
    return Object.values(value).reduce(
      (sum, item) => sum + filledFields(item),
      0,
    );
  return 1;
}
function bankFor(state, create = false) {
  const filename = path.join(state.base, "exam-bank.json");
  if (!fs.existsSync(filename)) {
    if (!create) throw Error("This exam's frozen question bank is missing.");
    if (typeof state.dataset.seed !== "string" || !state.dataset.seed)
      throw Error("Private baseline is missing its generation secret.");
    writeJSON(filename, generateExamBank(state.dataset.seed), {
      exclusive: true,
    });
  }
  const bank = readJSON(filename);
  if (
    !Array.isArray(bank.questions) ||
    bank.questions.length !== 4 ||
    bank.questions.some((q, i) => q.id !== QUESTION_IDS[i])
  )
    throw Error("Invalid private exam bank");
  return bank;
}
function examPath(state, id) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
    throw Error("A valid --exam ID is required");
  return path.join(state.base, "exams", id + ".json");
}
function clockView(exam, now) {
  const durationSeconds = exam.durationSeconds ?? EXAM_DURATION_MS / 1000;
  const elapsed = Math.max(
    0,
    Math.min(durationSeconds * 1000, now - Date.parse(exam.startedAt)),
  );
  return {
    durationSeconds,
    startedAt: exam.startedAt,
    deadlineAt: exam.deadlineAt,
    elapsedSeconds: Math.floor(elapsed / 1000),
    remainingSeconds:
      exam.status === "active"
        ? Math.max(0, Math.ceil((Date.parse(exam.deadlineAt) - now) / 1000))
        : 0,
  };
}
function publicView(exam, bank, now) {
  return {
    examId: exam.id,
    baselineId: exam.baselineId,
    mode: "exam",
    examBankHash: payloadHash({
      generatorVersion: bank.generatorVersion,
      questions: bank.questions.map((q) => ({
        id: q.id,
        difficulty: q.difficulty,
        promptHash: q.promptHash,
      })),
    }),
    status: exam.status,
    clock: clockView(exam, now),
    questions: bank.questions.map((q) => ({
      id: q.id,
      difficulty: q.difficulty,
      promptHash: q.promptHash,
      saved: Object.hasOwn(exam.drafts, q.id),
      filledFields: filledFields(exam.drafts[q.id]),
    })),
  };
}
function finalize(state, exam, bank, now, expired) {
  if (exam.receipt) return exam.receipt;
  const endedAt = expired ? Date.parse(exam.deadlineAt) : now;
  const questions = bank.questions.map((q) => ({
    id: q.id,
    difficulty: q.difficulty,
    ...grade(q.answer, exam.drafts[q.id] ?? null),
  }));
  exam.status = expired ? "expired" : "finished";
  exam.finishedAt = new Date(endedAt).toISOString();
  exam.receipt = {
    ...publicView(exam, bank, endedAt),
    finishedAt: exam.finishedAt,
    result: {
      percent:
        questions.reduce((sum, q) => sum + q.percent, 0) / questions.length,
      questionWeightPercent: 25,
      questions,
      note: "Four fixed questions on this private exam bank, each worth 25%; compare only the same baseline, exam mode and time limit.",
    },
  };
  writeJSON(examPath(state, exam.id), exam);
  return exam.receipt;
}

// Call while holding the normal private-state lock. The optional clock is only
// an in-process test seam; duration is chosen only when starting an exam.
export function examAction(state, action, options = {}, clock = Date.now) {
  if (!["start", "question", "save", "status", "finish"].includes(action))
    throw Error("Unknown exam command");
  if (
    ["question", "save"].includes(action) &&
    !QUESTION_IDS.includes(options.questionId)
  )
    throw Error("Choose --question q1, q2, q3, or q4");
  if (action === "save" && options.patch === undefined)
    throw Error("An exam save needs a JSON draft");
  if (action !== "start" && options.durationSeconds !== undefined)
    throw Error(
      "Exam duration can only be selected at start; an existing deadline cannot be changed",
    );
  if (action === "start") {
    const durationSeconds =
      options.durationSeconds === undefined
        ? EXAM_DURATION_MS / 1000
        : options.durationSeconds;
    if (![120, 300].includes(durationSeconds))
      throw Error("Choose an exam duration of 120 or 300 seconds");
    const bank = bankFor(state, true); // Generation is outside the timed window.
    privateDirectory(path.join(state.base, "exams"));
    const now = clock();
    const exam = {
      id: randomUUID(),
      baselineId: state.current.baselineId,
      bankHash: payloadHash(bank),
      generatorVersion: bank.generatorVersion,
      durationSeconds,
      startedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + durationSeconds * 1000).toISOString(),
      status: "active",
      drafts: {},
      revision: 0,
    };
    writeJSON(examPath(state, exam.id), exam, { exclusive: true });
    return publicView(exam, bank, now);
  }
  const filename = examPath(state, options.examId);
  let exam;
  try {
    exam = readJSON(filename);
  } catch (error) {
    if (error.code === "ENOENT")
      throw Error(
        "Exam ID was not found on the current baseline. Keep the original exam ID.",
      );
    throw error;
  }
  if (
    exam.id !== options.examId ||
    exam.baselineId !== state.current.baselineId
  )
    throw Error("Exam does not belong to the current baseline");
  const closedReply = (receipt) =>
    action === "save"
      ? {
          ...receipt,
          accepted: false,
          reason: "Exam is closed; no draft was changed.",
        }
      : receipt;
  if (exam.receipt) return closedReply(exam.receipt);
  if (exam.status !== "active")
    throw Error("Exam is closed but its receipt is unavailable");
  const bank = bankFor(state);
  if (payloadHash(bank) !== exam.bankHash)
    throw Error("The frozen question bank no longer matches this exam");
  let now = clock();
  if (now >= Date.parse(exam.deadlineAt))
    return closedReply(finalize(state, exam, bank, now, true));
  if (action === "finish") return finalize(state, exam, bank, now, false);
  if (action === "status") return publicView(exam, bank, now);
  const question = bank.questions.find((q) => q.id === options.questionId);
  if (action === "question")
    return {
      ...publicView(exam, bank, now),
      questionId: question.id,
      difficulty: question.difficulty,
      prompt: question.prompt,
      draft: Object.hasOwn(exam.drafts, question.id)
        ? exam.drafts[question.id]
        : null,
    };
  const merged = mergeDraft(exam.drafts[question.id], options.patch);
  const drafts = { ...exam.drafts, [question.id]: merged };
  if (Buffer.byteLength(JSON.stringify(drafts), "utf8") > MAX_DRAFT_BYTES)
    throw Error("Saved exam drafts exceed 1 MiB; no draft was changed");
  now = clock(); // Parsing/merging cannot turn a pre-deadline request into a late write.
  if (now >= Date.parse(exam.deadlineAt))
    return closedReply(finalize(state, exam, bank, now, true));
  exam.drafts = drafts;
  exam.revision += 1;
  exam.savedAt = new Date(now).toISOString();
  writeJSON(filename, exam);
  return {
    ...publicView(exam, bank, now),
    questionId: question.id,
    accepted: true,
    revision: exam.revision,
    savedAt: exam.savedAt,
  };
}
