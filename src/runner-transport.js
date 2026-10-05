import fs from "node:fs";
import path from "node:path";
import { withLock, active, stateRoot, writeJSON, readJSON } from "./storage.js";
import { startAssessment, assessmentAction, assessmentTimer } from "./assessment.js";
import {
  formatRun,
  formatQuestion,
  formatQuestions,
  formatStart,
  formatAnswer,
} from "./output.js";

export function transport(configPath, args = process.argv.slice(2)) {
  const config = readJSON(configPath),
    [action, ...rest] = args;
  if (!["start", "question", "questions", "answer", "status", "budget", "timer", "finish"].includes(action))
    throw Error("Use start, question, questions, answer, status, budget or finish");
  // Every invocation is counted, including budget checks, which leave the
  // assessment untouched.
  if (config.calls)
    fs.appendFileSync(config.calls, JSON.stringify({ action, time: Date.now() }) + "\n", { mode: 0o600 });
  // With a token budget every response shows the output tokens used so far.
  const outputTokens = config.budget && {
    used: fs.existsSync(config.budget.file) ? readJSON(config.budget.file).used : 0,
    limit: config.budget.limit,
  };
  const withBudget = (output) => (outputTokens ? { ...output, outputTokens } : output);
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--verbose" && action === "status" && !opts.verbose) {
      opts.verbose = true;
      continue;
    }
    if (
      !["--task", "--json"].includes(rest[i]) ||
      rest[i + 1] === undefined ||
      Object.hasOwn(opts, rest[i])
    )
      throw Error("Invalid transport arguments");
    opts[rest[i]] = rest[i + 1];
    i++;
  }
  if (action === "start" && rest.length)
    throw Error("Start takes no arguments");
  if (["question", "answer"].includes(action) !== Boolean(opts["--task"]))
    throw Error("Only question and answer require --task");
  if ((action === "answer") !== Object.hasOwn(opts, "--json"))
    throw Error("Only answer requires --json");
  if (Buffer.byteLength(opts["--json"] ?? "") > 1048576)
    throw Error("Answer exceeds 1 MiB");
  const patch = action === "answer" ? JSON.parse(opts["--json"]) : undefined;
  process.env.AM_I_NERFED_HOME = config.state;
  if (action === "budget" || action === "timer") {
    const run = readJSON(path.join(path.dirname(configPath), "run.json"));
    process.stdout.write(JSON.stringify(withBudget(assessmentTimer(active(stateRoot()), run.runId))) + "\n");
    return;
  }
  // A spent token budget closes answering, as the deadline does.
  if (action === "answer" && outputTokens && outputTokens.used >= outputTokens.limit) {
    const run = readJSON(path.join(path.dirname(configPath), "run.json"));
    const clock = assessmentTimer(active(stateRoot()), run.runId);
    fs.appendFileSync(config.events, JSON.stringify({ action, time: Date.now(), runId: run.runId,
      status: "active", clock, accepted: false }) + "\n", { mode: 0o600 });
    process.stdout.write(JSON.stringify({ accepted: false, taskId: opts["--task"],
      reason: "Output token budget spent; answer unchanged.", outputTokens }) + "\n");
    process.exitCode = 1;
    return;
  }
  // The CLI operation is short and atomic. A cooperative termination finishes
  // its lock cleanup; the runner never extends the answer deadline.
  process.on("SIGTERM", () => {});
  const result = withLock((root) => {
    const state = active(root),
      runFile = path.join(path.dirname(configPath), "run.json");
    if (action === "start") {
      if (fs.existsSync(runFile))
        throw Error("This invocation has already started");
      const response = startAssessment(
        state,
        { ...config.options, invocation: "cli" },
        config.startedAt,
      );
      writeJSON(runFile, response, { exclusive: true });
      return response;
    }
    const run = readJSON(runFile);
    return assessmentAction(state, action, {
      runId: run.runId,
      taskId: opts["--task"],
      patch,
    });
  });
  fs.appendFileSync(
    config.events,
    JSON.stringify({
      action,
      time: Date.now(),
      runId: result.runId,
      status: result.status,
      clock: result.clock,
      accepted: result.accepted,
    }) + "\n",
    { mode: 0o600 },
  );
  const output =
    action === "start"
      ? formatStart(result)
      : action === "question"
        ? formatQuestion(result, opts["--task"])
        : action === "questions"
          ? formatQuestions(result)
          : action === "answer"
          ? formatAnswer(result)
          : formatRun(result, { verbose: opts.verbose });
  process.stdout.write(JSON.stringify(withBudget(output)) + "\n");
  if (result.accepted === false) process.exitCode = 1;
}
