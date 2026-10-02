import fs from "node:fs";
import path from "node:path";
import { withLock, active, writeJSON, readJSON } from "./storage.js";
import { startAssessment, assessmentAction } from "./assessment.js";

export function transport(configPath, args = process.argv.slice(2)) {
  const config = readJSON(configPath),
    [action, ...rest] = args;
  if (!["start", "question", "answer", "status", "finish"].includes(action))
    throw Error("Use start, question, answer, status or finish");
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !["--task", "--json"].includes(rest[i]) ||
      rest[i + 1] === undefined ||
      Object.hasOwn(opts, rest[i])
    )
      throw Error("Invalid transport arguments");
    opts[rest[i]] = rest[i + 1];
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
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.accepted === false) process.exitCode = 1;
}
