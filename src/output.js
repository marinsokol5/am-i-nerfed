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

const compactClock = ({ durationSeconds, elapsedSeconds, remainingSeconds }) => ({
  durationSeconds, elapsedSeconds, remainingSeconds,
});

export function formatRun(run, { verbose = false } = {}) {
  const full = renameRunFields(run);
  if (verbose) return full;
  const compact = {
    runId: full.runId,
    status: full.status,
    difficulty: full.difficulty,
    clock: compactClock(full.clock),
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

// Agents only need the run ID, the clock and the task IDs to begin.
export function formatStart(run, { verbose = false } = {}) {
  const full = renameRunFields(run);
  if (verbose) return full;
  return {
    runId: full.runId,
    difficulty: full.difficulty,
    clock: compactClock(full.clock),
    tasks: full.tasks.map(({ id }) => id),
  };
}

export function formatAnswer(result, { verbose = false } = {}) {
  if (verbose) return renameRunFields(result);
  if (result.accepted)
    return {
      accepted: true,
      taskId: result.taskId,
      remainingSeconds: result.clock.remainingSeconds,
    };
  return { accepted: false, reason: result.reason, ...formatRun(result) };
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
