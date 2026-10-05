# Evaluation 2026-10-05 09:00 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt none · grace 30s · output budget 5,000 tokens

Clients: claude `am run claude-ms18` · codex `codex`

| Rank | Model | Medium 900s | Average | Time left (s) | Output tokens | Budget checks |
|---:|---|---:|---:|---:|---:|---:|
| 1 | `gpt-6-astra` | 84.5% | **84.5%** | 636 | 5,082 | 12 |
| 2 | `claude-opus-5-5` | 66.7% | **66.7%** | 838 | 5,051 | 0 |

Per-level columns list Medium 900s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning; `~` marks counts that miss a response cut off by the stop (Codex) or are estimated from the stream (Claude). Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---|---|
| `claude-opus-5-5` | Medium 900s | 66.7% | finished (budget) | 838 | 6 | 0 | 5,051 |  | b694667f |
| `gpt-6-astra` | Medium 900s | 84.5% | finished (budget) | 636 | 8 | 12 | 5,082 |  | 519b0b7b |
