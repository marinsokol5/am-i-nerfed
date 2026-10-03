// Normalize public field names without rewriting stored runs or answer drafts.
export function renameRunFields(run) {
  if (!run) return run;
  const { bankHash, tasks, ...rest } = run;
  if (run.taskBankHash !== undefined || bankHash !== undefined)
    rest.taskBankHash = run.taskBankHash ?? bankHash;
  if (Array.isArray(tasks))
    rest.tasks = tasks.map(({ saved, ...task }) => {
      if (task.submitted === undefined && saved !== undefined)
        task.submitted = saved;
      return task;
    });
  return rest;
}

export function formatRun(run, { verbose = false } = {}) {
  const full = renameRunFields(run);
  if (verbose) return full;
  const { durationSeconds, elapsedSeconds, remainingSeconds } = full.clock;
  const compact = {
    runId: full.runId,
    status: full.status,
    difficulty: full.difficulty,
    clock: { durationSeconds, elapsedSeconds, remainingSeconds },
    tasks: full.tasks.map(({ id, submitted, filledFields }) => ({
      id, submitted, filledFields,
    })),
  };
  if (full.result)
    compact.result = {
      percent: full.result.percent,
      tasks: full.result.tasks.map(({ id, percent }) => ({ id, percent })),
    };
  if (full.failure !== undefined) compact.failure = full.failure;
  return compact;
}

export function formatQuestion(response, taskId) {
  if (typeof response.task === "string") {
    const question = {
      taskId: response.taskId,
      remainingSeconds: response.clock.remainingSeconds,
      task: response.task,
    };
    if (Object.keys(response.types ?? {}).length) question.types = response.types;
    question.response = response.response;
    question.submitted = response.submitted;
    return question;
  }
  const closed = { taskId, status: response.status, remainingSeconds: 0 };
  if (response.failure !== undefined) closed.failure = response.failure;
  return closed;
}
