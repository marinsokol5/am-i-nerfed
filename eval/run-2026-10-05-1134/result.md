# Evaluation 2026-10-05 09:35 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt none · grace 30s

Clients: claude `am run claude-ms18`

| Rank | Model | Medium 120s | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | `claude-sonnet-5-5` | 67.2% | **67.2%** | 42 | 8,104 | 6,284 (78%) | 1 |

Per-level columns list Medium 120s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---|---|
| `claude-sonnet-5-5` | Medium 120s | 67.2% | finished (finished) | 42 | 7 | 1 | 8,104 | 6,284 (78%) |  | 2f635951 |
