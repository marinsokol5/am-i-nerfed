import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  answerLeaves,
  generateTaskBank,
  hash,
  LEVELS,
  nest,
  TASK_BANK_VERSION,
  TASK_COUNTS,
} from "./task-bank.js";
import { active, privateDirectory, readJSON, writeJSON } from "./storage.js";
import { grade } from "./grading.js";
import { durationSeconds as validateDuration } from "./duration.js";
import { renameRunFields } from "./output.js";

export const PROTOCOL_VERSION = 1;
export const appVersion = () =>
  readJSON(new URL("../package.json", import.meta.url)).version;
export function prepareBank(state) {
  const file = path.join(state.base, "task-bank.json");
  if (!fs.existsSync(file))
    writeJSON(file, generateTaskBank(state.dataset.seed), { exclusive: true });
  else upgradeBank(state, file);
  return readBank(state);
}
// Older banks are rewritten in the current version only when the same seed
// regenerates identical answers, so baselines keep their puzzles.
function upgradeBank(state, file) {
  const bank = readBank(state);
  if (bank.taskBankVersion >= TASK_BANK_VERSION) return;
  const expectedCount = Object.values(TASK_COUNTS).reduce((sum, count) => sum + count, 0);
  const next = bank.tasks.length === expectedCount ? generateTaskBank(state.dataset.seed) : null;
  const same =
    next !== null && bank.tasks.length === next.tasks.length &&
    bank.tasks.every((task, i) => {
      const t = next.tasks[i];
      return (
        t.id === task.id &&
        t.family === task.family &&
        t.difficulty === task.difficulty &&
        JSON.stringify(answerLeaves(t.answer)) ===
          JSON.stringify(answerLeaves(task.answer))
      );
    });
  if (!same)
    throw Error(
      "This task bank cannot be upgraded because the current version changed its puzzles. Run am-i-nerfed reset to generate a new bank; history is kept.",
    );
  writeJSON(file, next);
}
function readBank(state) {
  const bank = readJSON(path.join(state.base, "task-bank.json"));
  // Versions 9 and 13 expanded the hard and easy/medium tiers respectively.
  // Frozen banks and unfinished assessments retain their original task counts.
  const counts =
    bank.taskBankVersion < 9
      ? { easy: 5, medium: 5, hard: 5 }
      : bank.taskBankVersion < 13
        ? { easy: 5, medium: 5, hard: 6 }
        : TASK_COUNTS;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (
    !Number.isInteger(bank.taskBankVersion) ||
    bank.taskBankVersion < 1 ||
    !Array.isArray(bank.tasks) ||
    bank.tasks.length !== total ||
    new Set(bank.tasks.map((t) => t?.id)).size !== total ||
    LEVELS.some(
      (level) =>
        bank.tasks.filter((t) => t?.difficulty === level).length !== counts[level],
    )
  )
    throw Error("Invalid frozen task bank");
  return bank;
}
// Readiness diagnostics must never generate a bank, create a run, or acquire
// a filesystem lock. Only public metadata leaves this function.
export function initializationStatus(root) {
  if (!fs.existsSync(path.join(root, "current.json")))
    return {
      initialized: false,
      initializationError: "Not initialized. Run am-i-nerfed init first.",
    };
  try {
    const state = active(root),
      bank = readBank(state);
    return {
      initialized: true,
      baselineId: state.current.baselineId,
      taskBankVersion: bank.taskBankVersion,
      tasks: bank.tasks.length,
    };
  } catch {
    // Do not expose JSON parser errors: they can contain private file content.
    return {
      initialized: false,
      initializationError: "Local state is incomplete, unreadable, or invalid.",
    };
  }
}
export function assessmentPath(state, id) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id))
    throw Error("A valid --run ID is required");
  return path.join(state.base, "assessments", id + ".json");
}
export function isAssessment(state, id) {
  return fs.existsSync(assessmentPath(state, id));
}
const publicBankHash = (bank) =>
  hash({
    version: bank.taskBankVersion,
    tasks: bank.tasks.map(({ id, promptHash, difficulty, family }) => ({
      id,
      promptHash,
      difficulty,
      family,
    })),
  });
function clock(record, now) {
  const end = record.finishedAt
    ? Date.parse(record.finishedAt)
    : Math.min(now, Date.parse(record.deadlineAt));
  return {
    startedAt: record.startedAt,
    deadlineAt: record.deadlineAt,
    durationSeconds: record.durationSeconds,
    elapsedSeconds: Math.max(
      0,
      Math.floor((end - Date.parse(record.startedAt)) / 1000),
    ),
    remainingSeconds:
      record.status === "active"
        ? Math.max(0, Math.ceil((Date.parse(record.deadlineAt) - now) / 1000))
        : 0,
  };
}
function filled(value) {
  return value == null
    ? 0
    : typeof value === "object"
      ? Object.values(value).reduce((n, v) => n + filled(v), 0)
      : 1;
}
function view(record, now) {
  return {
    runId: record.id,
    baselineId: record.baselineId,
    appVersion: record.appVersion,
    taskBankVersion: record.taskBankVersion,
    protocolVersion: record.protocolVersion,
    taskBankHash: record.publicBankHash,
    difficulty: record.difficulty,
    invocation: record.invocation,
    agent: record.agent,
    provider: record.provider,
    model: record.model,
    effort: record.effort,
    systemPrompt: record.systemPrompt ?? null,
    metadataSource: record.metadataSource,
    clockEnforcement: record.clockEnforcement,
    status: record.status,
    clock: clock(record, now),
    tasks: record.tasks.map((t) => ({
      ...t,
      submitted: Object.hasOwn(record.drafts, t.id),
      filledFields: filled(record.drafts[t.id]),
    })),
  };
}
export function startAssessment(state, opts = {}, now) {
  const difficulty = opts.difficulty ?? "medium",
    durationSeconds = validateDuration(opts.seconds, now);
  if (!LEVELS.includes(difficulty))
    throw Error("Choose difficulty easy, medium, or hard");
  if (!["cli", "skill", "manual"].includes(opts.invocation ?? "manual"))
    throw Error("Invalid invocation method");
  const bank = prepareBank(state);
  now ??= Date.now();
  const tasks = bank.tasks.filter((t) => t.difficulty === difficulty);
  const record = {
    id: randomUUID(),
    baselineId: state.current.baselineId,
    appVersion: appVersion(),
    taskBankVersion: bank.taskBankVersion,
    protocolVersion: PROTOCOL_VERSION,
    privateBankHash: hash(bank),
    publicBankHash: publicBankHash(bank),
    difficulty,
    durationSeconds,
    invocation: opts.invocation ?? "manual",
    agent: opts.agent ?? null,
    provider: opts.provider ?? null,
    model: opts.model ?? null,
    effort: opts.effort ?? null,
    // Only supervised runs control the client's system prompt.
    systemPrompt:
      opts.invocation === "cli" ? (opts.systemPrompt ?? "native") : null,
    metadataSource: opts.invocation === "cli" ? "configured" : "self-reported",
    clockEnforcement:
      opts.invocation === "cli" ? "process-watchdog" : "answer-deadline",
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + durationSeconds * 1000).toISOString(),
    status: "active",
    drafts: {},
    tasks: tasks.map(({ id, family, promptHash }) => ({
      id,
      family,
      promptHash,
    })),
  };
  privateDirectory(path.join(state.base, "assessments"));
  writeJSON(assessmentPath(state, record.id), record, { exclusive: true });
  return view(record, now);
}
export function assessmentAction(state, action, opts, time = Date.now) {
  if (!["question", "questions", "answer", "status", "finish"].includes(action))
    throw Error("Unknown assessment action");
  const { file, record } = readAssessment(state, opts.runId);
  const closed = (receipt) =>
    action === "answer"
      ? {
          ...receipt,
          accepted: false,
          reason: "Run is closed; answer unchanged.",
        }
      : receipt;
  if (record.receipt) return closed(renameRunFields(record.receipt));
  const bank = readBank(state);
  if (hash(bank) !== record.privateBankHash)
    throw Error("Frozen task bank changed; this run cannot be scored");
  const task = bank.tasks.find(
    (t) => t.id === opts.taskId && record.tasks.some((x) => x.id === t.id),
  );
  if (["question", "answer"].includes(action) && !task)
    throw Error("Choose a task ID from this run");
  if (action === "answer" && opts.patch === undefined)
    throw Error("An answer needs JSON");
  const close = (now, expired) => {
    record.status = expired ? "expired" : "finished";
    record.finishedAt = expired
      ? record.deadlineAt
      : new Date(now).toISOString();
    const tasks = record.tasks.map((t) => {
      const answer = bank.tasks.find((q) => q.id === t.id).answer;
      return {
        id: t.id,
        family: t.family,
        ...grade(answer, nest(answer, record.drafts[t.id] ?? null)),
      };
    });
    record.receipt = {
      ...view(record, now),
      finishedAt: record.finishedAt,
      result: {
        percent: tasks.reduce((sum, t) => sum + t.percent, 0) / tasks.length,
        taskWeightPercent: 100 / tasks.length,
        tasks,
      },
    };
    writeJSON(file, record);
    return record.receipt;
  };
  let now = time();
  if (now >= Date.parse(record.deadlineAt)) return closed(close(now, true));
  if (action === "finish") return close(now, false);
  if (action === "status") return view(record, now);
  if (action === "question")
    return {
      ...view(record, now),
      taskId: task.id,
      task: task.prompt,
      types: task.types,
      response: task.response,
      submitted: record.drafts[task.id] ?? {},
    };
  if (action === "questions")
    return {
      ...view(record, now),
      questions: record.tasks.map(({ id }) => {
        const t = bank.tasks.find((q) => q.id === id);
        return {
          taskId: id,
          task: t.prompt,
          types: t.types,
          response: t.response,
          submitted: record.drafts[id] ?? {},
        };
      }),
    };
  const drafts = {
    ...record.drafts,
    [task.id]: mergeDraft(record.drafts[task.id], opts.patch),
  };
  if (Buffer.byteLength(JSON.stringify(drafts)) > 1048576)
    throw Error("Answers exceed 1 MiB");
  now = time();
  if (now >= Date.parse(record.deadlineAt)) return closed(close(now, true));
  record.drafts = drafts;
  record.revision = (record.revision ?? 0) + 1;
  writeJSON(file, record);
  return {
    ...view(record, now),
    accepted: true,
    taskId: task.id,
    revision: record.revision,
  };
}
export function assessmentTimer(state, runId, time = Date.now) {
  const { record } = readAssessment(state, runId);
  const { durationSeconds, elapsedSeconds, remainingSeconds } = clock(record, time());
  return { durationSeconds, elapsedSeconds, remainingSeconds };
}
function readAssessment(state, runId) {
  const file = assessmentPath(state, runId);
  let record;
  try {
    record = readJSON(file);
  } catch (e) {
    if (e.code === "ENOENT")
      throw Error(
        "Run ID not found on the current baseline; retain the original ID and do not reset.",
      );
    throw e;
  }
  if (
    record.id !== runId ||
    record.baselineId !== state.current.baselineId
  )
    throw Error("Run does not belong to this baseline");
  return { file, record };
}
// Runner metadata is outside solver-controlled answers. Failure removes the
// score from history instead of masquerading as a reasoning failure.
export function annotateAssessment(state, id, metadata) {
  const file = assessmentPath(state, id),
    record = readJSON(file);
  record.execution = metadata;
  if (metadata.failure) {
    record.status = "failed";
    record.finishedAt ??= new Date().toISOString();
    record.receipt = { ...view(record, Date.now()), failure: metadata.failure };
  }
  writeJSON(file, record);
  return { ...renameRunFields(record.receipt), execution: metadata };
}
export function listHistory(root, filters = {}) {
  const directory = path.join(root, "baselines"),
    runs = [];
  if (!fs.existsSync(directory)) return { runs };
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const base = path.join(directory, entry.name),
      dir = path.join(base, "assessments");
    if (!fs.existsSync(dir)) continue;
    for (const name of fs
      .readdirSync(dir)
      .filter((n) => /^[0-9a-f-]{36}\.json$/.test(n))) {
      let record = readJSON(path.join(dir, name));
      if (
        record.status === "active" &&
        Date.now() >= Date.parse(record.deadlineAt)
      ) {
        assessmentAction(
          { base, current: { baselineId: entry.name } },
          "status",
          { runId: record.id },
        );
        record = readJSON(path.join(dir, name));
      }
      const row = {
        runId: record.id,
        baselineId: record.baselineId,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt ?? null,
        appVersion: record.appVersion,
        taskBankVersion: record.taskBankVersion,
        protocolVersion: record.protocolVersion,
        taskBankHash: record.publicBankHash,
        invocation: record.invocation,
        agent: record.agent,
        provider: record.provider,
        model: record.model,
        effort: record.effort,
        systemPrompt:
          record.systemPrompt ?? (record.invocation === "cli" ? "native" : null),
        metadataSource: record.metadataSource,
        clockEnforcement: record.clockEnforcement,
        difficulty: record.difficulty,
        durationSeconds: record.durationSeconds,
        status: record.status,
        percent: record.receipt?.result?.percent ?? null,
        elapsedSeconds: clock(record, Date.now()).elapsedSeconds,
        execution: record.execution ?? null,
      };
      if (
        Object.entries(filters).every(
          ([key, value]) => value == null || String(row[key]) === String(value),
        )
      )
        runs.push(row);
    }
  }
  runs.sort(
    (a, b) =>
      b.startedAt.localeCompare(a.startedAt) || a.runId.localeCompare(b.runId),
  );
  return {
    runs,
    note: "Compare the same bank, difficulty, duration, invocation method, protocol, model and effort. CLI and skill runs retain separate context.",
  };
}

// Deletes every recorded run in every baseline. Banks, the current baseline
// and settings stay, so new runs continue on the same tasks.
export function destroyHistory(root) {
  const directory = path.join(root, "baselines");
  let deleted = 0;
  if (!fs.existsSync(directory)) return { deleted };
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const dir = path.join(directory, entry.name, "assessments");
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir))
      if (/^[0-9a-f-]{36}\.json$/.test(name)) {
        fs.unlinkSync(path.join(dir, name));
        deleted++;
      }
  }
  return { deleted };
}

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
