# Evaluation 2026-10-05 12:23 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt native · grace 30s

Clients: anthropic `am run claude-ms18` · openai `codex`

| Rank | Model | Medium 120s | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Tokens/s | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | `claude-opus-5-5` | 79.4% | **79.4%** | 51 | 6,120 | 4,412 (72%) | 87 | — |
| 2 | `gpt-6-astra` | 66.7% | **66.7%** | 0 | 1,654 | 879 (53%) | 13 | — |

Per-level columns list Medium 120s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Tokens/s divides output tokens by the client's wall time, including startup and assessment commands. Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Tokens/s | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| `claude-opus-5-5` | Medium 120s | 79.4% | finished (finished) | 51 | 6 | — | 6,120 | 4,412 (72%) | 87 |  | c146d4f2 |
| `gpt-6-astra` | Medium 120s | 66.7% | expired (deadline) | 0 | 5 | — | 1,654 | 879 (53%) | 13 |  | c08ceabc |
