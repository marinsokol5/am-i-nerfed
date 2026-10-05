import test from "node:test";
import assert from "node:assert/strict";
import { buildResults, configFromRecords, markdown, plan, runName, tokenUsage } from "../eval/harness.js";

const config = {
  effort: "high",
  graceSeconds: 30,
  retries: 1,
  levels: [{ difficulty: "easy", seconds: 90 }, { difficulty: "hard", seconds: 360 }],
  providers: {
    anthropic: { agent: "claude", command: "am run acct", models: ["claude-a", "claude-b"] },
    openai: { agent: "codex", command: null, models: ["gpt-a"] },
  },
};
const record = (agent, model, difficulty, seconds, percent, elapsed, execution) => ({
  harness: { run: { agent, model, difficulty, seconds }, progress: ["start: 90s remaining", "answer: 80s remaining"] },
  run: { runId: `${model}-${difficulty}-0000`, status: "expired", appVersion: "1.0.0", taskBankVersion: 13,
    baselineId: "baseline-1", clock: { durationSeconds: seconds, elapsedSeconds: elapsed },
    result: { percent }, execution: { reason: "deadline", failure: null, ...execution } },
});

test("the plan runs every configured model at every level through its provider's client", () => {
  const runs = plan(config);
  assert.equal(runs.length, 6);
  assert.deepEqual(runs[0], { provider: "anthropic", agent: "claude", command: "am run acct",
    model: "claude-a", difficulty: "easy", seconds: 90, maxOutputTokens: null });
  assert.deepEqual(plan(config, { models: ["gpt-a"], levels: ["hard"] }).map(runName), ["codex-gpt-a-hard-360"]);
  const budgeted = { ...config, levels: [{ difficulty: "hard", seconds: 1800, maxOutputTokens: 25000 }] };
  assert.deepEqual(plan(budgeted, { models: ["gpt-a"] }).map(runName), ["codex-gpt-a-hard-1800-25000t"]);
});

test("token counts prefer exact reports and mark estimates", () => {
  assert.deepEqual(tokenUsage({ execution: { terminal: true,
    usage: { input_tokens: 3, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 40,
      output_tokens_details: { thinking_tokens: 30 } } } }),
  { output: 40, reasoning: 30, input: 113, exact: true });
  assert.deepEqual(tokenUsage({ execution: { terminal: false, usage: null, streamUsage: { responses: 2, input_tokens: 3,
    cache_creation_input_tokens: 10, cache_read_input_tokens: 100, estimated_output_tokens: 55,
    estimated_reasoning_tokens: 20 } } }),
  { output: 55, reasoning: 20, input: 113, exact: false });
  assert.deepEqual(tokenUsage({ execution: { terminal: false, nativeEvidence: { reportedTokenUsage: {
    input_tokens: 900, output_tokens: 70, reasoning_output_tokens: 56 } } } }),
  { output: 70, reasoning: 56, input: 900, exact: false });
  assert.equal(tokenUsage({ execution: { terminal: false } }), null);
});

test("results rank complete models by their mean score and list every run", () => {
  const records = [
    record("claude", "claude-a", "easy", 90, 80, 60, { terminal: true, wallSeconds: 60,
      usage: { output_tokens: 1200, output_tokens_details: { thinking_tokens: 900 } },
      commandCounts: { start: 1, answer: 6, budget: 2, timer: 1 } }),
    record("claude", "claude-a", "hard", 360, 40, 360, { terminal: false, streamUsage: { input_tokens: 1,
      cache_creation_input_tokens: 0, cache_read_input_tokens: 0, estimated_output_tokens: 5000 } }),
    record("claude", "claude-b", "easy", 90, 100, 90, {}),
    record("codex", "gpt-a", "easy", 90, 90, 90, { nativeEvidence: { reportedTokenUsage: { input_tokens: 9, output_tokens: 700 } } }),
    record("codex", "gpt-a", "hard", 360, 50, 360, {}),
  ];
  const results = buildResults(records, config);
  assert.deepEqual(results.rows.map((row) => [row.model, row.average]), [["gpt-a", 70], ["claude-a", 60], ["claude-b", null]]);
  assert.deepEqual(results.clients, { anthropic: "am run acct", openai: "codex" });
  const table = markdown(results);
  assert.match(table, /\| 1 \| `gpt-a` \| 90\.0% \| 50\.0% \| \*\*70\.0%\*\* \| 0 \/ 0 \| ~700 \/ — \| — \/ — \| — \/ — \| — \/ — \|/);
  assert.match(table, /\| 2 \| `claude-a` \| 80\.0% \| 40\.0% \| \*\*60\.0%\*\* \| 30 \/ 0 \| 1,200 \/ ~5,000 \| 900 \(75%\) \/ — \| 20 \/ — \| 3 \/ — \|/);
  assert.match(table, /\| — \| `claude-b` \| 100\.0% \| — \| \*\*—\*\* \|/);
  assert.equal(results.runs.length, 5);
  assert.equal(results.runs[0].answers, 1);
});

test("a run directory's settings are rebuilt from its records", () => {
  const records = [
    { harness: { run: { provider: "openai", agent: "codex", command: null, model: "gpt-a", difficulty: "hard", seconds: 360 },
      effort: "high", graceSeconds: 30, maxOutputTokens: 5000, graceTokens: 1000 }, run: { systemPrompt: "none" } },
    { harness: { run: { provider: "anthropic", agent: "claude", command: "am run acct", model: "claude-a", difficulty: "easy", seconds: 90 },
      effort: "high", graceSeconds: 30, maxOutputTokens: 5000, graceTokens: 1000 }, run: { systemPrompt: "none" } },
  ];
  assert.deepEqual(configFromRecords(records), { effort: "high", graceSeconds: 30, retries: 0, maxOutputTokens: null,
    graceTokens: 1000, systemPrompt: "none",
    levels: [{ difficulty: "easy", seconds: 90, maxOutputTokens: 5000 }, { difficulty: "hard", seconds: 360, maxOutputTokens: 5000 }],
    providers: { openai: { agent: "codex", command: null, models: ["gpt-a"] },
      anthropic: { agent: "claude", command: "am run acct", models: ["claude-a"] } } });
});
