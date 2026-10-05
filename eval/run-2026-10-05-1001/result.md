# Evaluation 2026-10-05 08:04 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · grace 30s

Clients: claude `am run claude-ms18` · codex `codex`

| Rank | Model | Medium 120s | Average | Time left (s) | Output tokens |
|---:|---|---:|---:|---:|---:|
| 1 | `claude-opus-5-5` | 79.4% | **79.4%** | 51 | 6,120 |
| 2 | `gpt-6-astra` | 66.7% | **66.7%** | 0 | 1,654 |

Time left and output tokens list Medium 120s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning; `~` marks counts that miss a response cut off by the stop (Codex) or are estimated from the stream (Claude).

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Output tokens | Failure | Run |
|---|---|---:|---|---:|---:|---:|---|---|
| `claude-opus-5-5` | Medium 120s | 79.4% | finished (finished) | 51 | 6 | 6,120 |  | c146d4f2 |
| `gpt-6-astra` | Medium 120s | 66.7% | expired (deadline) | 0 | 5 | 1,654 |  | c08ceabc |
