# Evaluation 2026-10-05 16:45 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort medium · system prompt none · grace 30s · output budgets with safety limits of 600s / 900s / 1800s

Clients: anthropic `am run claude-ms18` · anthropic-ms55 `am run claude-ms55`

| Rank | Model | Easy 4k tokens | Medium 10k tokens | Hard 25k tokens | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Tokens/s | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | `claude-fable-5-1` | 100.0% | 83.8% | 54.7% | **79.5%** | 554 / 800 / 1557 | 4,048 / 9,720 / 22,894 | 3,048 (75%) / 8,379 (86%) / 20,607 (90%) | 86 / 96 / 94 | 0 / 0 / 0 |
| 2 | `claude-opus-5-5` | 100.0% | 79.4% | 47.8% | **75.7%** | 545 / 812 / 1550 | 4,301 / 8,220 / 23,408 | 3,078 (72%) / 6,504 (79%) / 20,487 (88%) | 77 / 92 / 93 | 0 / 1 / 0 |
| 3 | `claude-sonnet-5-5` | 83.3% | 66.7% | 28.6% | **59.5%** | 557 / 837 / 1599 | 4,915 / 7,350 / 23,563 | 3,872 (79%) / 5,990 (81%) / 20,752 (88%) | 112 / 116 / 117 | 0 / 0 / 0 |

Per-level columns list Easy 4k tokens / Medium 10k tokens / Hard 25k tokens. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Tokens/s divides output tokens by the client's wall time, including startup and assessment commands. Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Tokens/s | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| `claude-fable-5-1` | Easy 4k tokens | 100.0% | finished (finished) | 554 | 6 | 0 | 4,048 | 3,048 (75%) | 86 |  | 463969fe |
| `claude-fable-5-1` | Hard 25k tokens | 54.7% | finished (finished) | 1557 | 7 | 0 | 22,894 | 20,607 (90%) | 94 |  | e7c7a752 |
| `claude-fable-5-1` | Medium 10k tokens | 83.8% | finished (finished) | 800 | 6 | 0 | 9,720 | 8,379 (86%) | 96 |  | 3a7c08b7 |
| `claude-opus-5-5` | Easy 4k tokens | 100.0% | finished (finished) | 545 | 6 | 0 | 4,301 | 3,078 (72%) | 77 |  | ffdc2823 |
| `claude-opus-5-5` | Hard 25k tokens | 47.8% | finished (finished) | 1550 | 13 | 0 | 23,408 | 20,487 (88%) | 93 |  | 564e74b1 |
| `claude-opus-5-5` | Medium 10k tokens | 79.4% | finished (finished) | 812 | 6 | 1 | 8,220 | 6,504 (79%) | 92 |  | 40d60498 |
| `claude-sonnet-5-5` | Easy 4k tokens | 83.3% | finished (budget) | 557 | 5 | 0 | 4,915 | 3,872 (79%) | 112 |  | 219ad3cd |
| `claude-sonnet-5-5` | Hard 25k tokens | 28.6% | finished (finished) | 1599 | 12 | 0 | 23,563 | 20,752 (88%) | 117 |  | 6d87e6f0 |
| `claude-sonnet-5-5` | Medium 10k tokens | 66.7% | finished (finished) | 837 | 6 | 0 | 7,350 | 5,990 (81%) | 116 |  | 9b6ba584 |
