import test from "node:test";
import assert from "node:assert/strict";
import { buildResults, markdown, plan, runName, tokenUsage } from "../eval/harness.js";

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
    model: "claude-a", difficulty: "easy", seconds: 90 });
  assert.deepEqual(plan(config, { models: ["gpt-a"], levels: ["hard"] }).map(runName), ["codex-gpt-a-hard-360"]);
});

test("token counts prefer exact reports and mark estimates", () => {
  assert.deepEqual(tokenUsage({ execution: { terminal: true,
    usage: { input_tokens: 3, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 40 } } }),
  { output: 40, input: 113, exact: true });
  assert.deepEqual(tokenUsage({ execution: { terminal: false, usage: null, streamUsage: { responses: 2, input_tokens: 3,
    cache_creation_input_tokens: 10, cache_read_input_tokens: 100, estimated_output_tokens: 55 } } }),
  { output: 55, input: 113, exact: false });
  assert.deepEqual(tokenUsage({ execution: { terminal: false, nativeEvidence: { reportedTokenUsage: {
    input_tokens: 900, output_tokens: 70 } } } }), { output: 70, input: 900, exact: false });
  assert.equal(tokenUsage({ execution: { terminal: false } }), null);
});

test("results rank complete models by their mean score and list every run", () => {
  const records = [
    record("claude", "claude-a", "easy", 90, 80, 60, { terminal: true, usage: { output_tokens: 1200 },
      commandCounts: { start: 1, answer: 6, budget: 2, timer: 1 } }),
    record("claude", "claude-a", "hard", 360, 40, 360, { terminal: false, streamUsage: { input_tokens: 1,
      cache_creation_input_tokens: 0, cache_read_input_tokens: 0, estimated_output_tokens: 5000 } }),
    record("claude", "claude-b", "easy", 90, 100, 90, {}),
    record("codex", "gpt-a", "easy", 90, 90, 90, { nativeEvidence: { reportedTokenUsage: { input_tokens: 9, output_tokens: 700 } } }),
    record("codex", "gpt-a", "hard", 360, 50, 360, {}),
  ];
  const results = buildResults(records, config);
  assert.deepEqual(results.rows.map((row) => [row.model, row.average]), [["gpt-a", 70], ["claude-a", 60], ["claude-b", null]]);
  assert.deepEqual(results.clients, { claude: "am run acct", codex: "codex" });
  const table = markdown(results);
  assert.match(table, /\| 1 \| `gpt-a` \| 90\.0% \| 50\.0% \| \*\*70\.0%\*\* \| 0 \/ 0 \| ~700 \/ — \| — \/ — \|/);
  assert.match(table, /\| 2 \| `claude-a` \| 80\.0% \| 40\.0% \| \*\*60\.0%\*\* \| 30 \/ 0 \| 1,200 \/ ~5,000 \| 3 \/ — \|/);
  assert.match(table, /\| — \| `claude-b` \| 100\.0% \| — \| \*\*—\*\* \|/);
  assert.equal(results.runs.length, 5);
  assert.equal(results.runs[0].answers, 1);
});
