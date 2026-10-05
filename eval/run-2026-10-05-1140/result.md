# Evaluation 2026-10-05 12:23 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt none · grace 30s · output budgets with safety limits of 900s

Clients: anthropic-api `node /Users/marinsokol/projects/hard-challenge-skill/eval/api-client.js --key-file /private/tmp/claude-501/-Users-marinsokol-projects-hard-challenge-skill/dfeef96e-8a85-482a-a822-1f2a3eecee9b/scratchpad/anthropic-api-key`

| Rank | Model | Medium 5k tokens | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Tokens/s | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | `claude-sonnet-5-5` | 61.5% | **61.5%** | 847 | ~6,062 | ~5,287 (87%) | 106 | 0 |

Per-level columns list Medium 5k tokens. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Tokens/s divides output tokens by the client's wall time, including startup and assessment commands. Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Tokens/s | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| `claude-sonnet-5-5` | Medium 5k tokens | 61.5% | finished (budget) | 847 | 4 | 0 | ~6,062 | ~5,287 (87%) | 106 |  | 47554ac2 |
