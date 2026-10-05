# Evaluation 2026-10-05 12:23 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt native · grace 30s · output budgets with safety limits of 900s

Clients: anthropic `am run claude-ms18` · openai `codex`

| Rank | Model | Medium 5k tokens | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Tokens/s | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | `gpt-6-astra` | 82.4% | **82.4%** | 654 | ~5,137 | ~4,176 (81%) | 21 | — |
| 2 | `claude-opus-5-5` | 78.9% | **78.9%** | 832 | ~5,121 | — | 74 | — |

Per-level columns list Medium 5k tokens. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Tokens/s divides output tokens by the client's wall time, including startup and assessment commands. Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Tokens/s | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| `claude-opus-5-5` | Medium 5k tokens | 78.9% | finished (budget) | 832 | 5 | — | ~5,121 | — | 74 |  | ae65ee17 |
| `gpt-6-astra` | Medium 5k tokens | 82.4% | finished (budget) | 654 | 7 | — | ~5,137 | ~4,176 (81%) | 21 |  | 06d0aff6 |
