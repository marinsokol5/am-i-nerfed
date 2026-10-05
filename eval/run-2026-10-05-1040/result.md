# Evaluation 2026-10-05 08:44 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · grace 30s · output budget 5,000 tokens

Clients: claude `am run claude-ms18` · codex `codex`

| Rank | Model | Medium 900s | Average | Time left (s) | Output tokens | Budget checks |
|---:|---|---:|---:|---:|---:|---:|
| 1 | `gpt-6-astra` | 82.7% | **82.7%** | 669 | 5,074 | 8 |
| 2 | `claude-opus-5-5` | 66.7% | **66.7%** | 842 | 5,008 | 0 |

Per-level columns list Medium 900s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning; `~` marks counts that miss a response cut off by the stop (Codex) or are estimated from the stream (Claude). Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---|---|
| `claude-opus-5-5` | Medium 900s | 66.7% | finished (finished) | 842 | 6 | 0 | 5,008 |  | c8857566 |
| `gpt-6-astra` | Medium 900s | 82.7% | finished (budget) | 669 | 7 | 8 | 5,074 |  | 135bedef |
