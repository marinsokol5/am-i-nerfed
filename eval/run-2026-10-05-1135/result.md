# Evaluation 2026-10-05 09:36 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt none · grace 30s

Clients: claude `node /Users/marinsokol/projects/hard-challenge-skill/eval/api-client.js --key-file /private/tmp/claude-501/-Users-marinsokol-projects-hard-challenge-skill/dfeef96e-8a85-482a-a822-1f2a3eecee9b/scratchpad/anthropic-api-key`

| Rank | Model | Medium 120s | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | `claude-sonnet-5-5` | 66.7% | **66.7%** | 38 | 8,918 | 7,246 (81%) | 1 |

Per-level columns list Medium 120s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---|---|
| `claude-sonnet-5-5` | Medium 120s | 66.7% | finished (finished) | 38 | 6 | 1 | 8,918 | 7,246 (81%) |  | fbe2bb52 |
