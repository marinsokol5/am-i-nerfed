# Evaluation 2026-10-05 09:40 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt none · grace 30s · output budget 5,000 tokens

Clients: claude `am run claude-ms18`

| Rank | Model | Medium 900s | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | `claude-sonnet-5-5` | 0.0% | **0.0%** | 854 | 5,806 | 5,177 (89%) | 0 |

Per-level columns list Medium 900s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---|---|
| `claude-sonnet-5-5` | Medium 900s | 0.0% | finished (budget) | 854 | 3 | 0 | 5,806 | 5,177 (89%) |  | 5b9c8b0e |
