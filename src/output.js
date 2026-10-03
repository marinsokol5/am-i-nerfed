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
  if (typeof response.prompt === "string")
    return {
      taskId: response.taskId,
      Task: response.prompt.replace(
        /^Am I nerfed: (?:easy|medium|hard), (?:hats|cards|knowledge|tracking|coordination)\r?\n\r?\n/,
        "",
      ).replace(
        /\r?\n\r?\nReason yourself without code, browsing, private-file inspection or other agents\. Question retrieval, partial answers and clock checks through the assessment CLI are permitted transport operations\.$/,
        "",
      ),
      draft: response.draft,
      remainingSeconds: response.clock.remainingSeconds,
    };
  const closed = { taskId, status: response.status, remainingSeconds: 0 };
  if (response.failure !== undefined) closed.failure = response.failure;
  return closed;
}
