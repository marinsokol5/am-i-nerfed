# Evaluation 2026-10-05 16:04 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt none · grace 30s · output budgets with safety limits of 600s / 900s / 1800s

Clients: openai `codex` · anthropic `am run claude-ms18` · anthropic-ms55 `am run claude-ms55`

| Rank | Model | Easy 4k tokens | Medium 10k tokens | Hard 25k tokens | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Tokens/s | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | `gpt-6-astra` | 100.0% | 86.2% | 81.8% | **89.3%** | 377 / 432 / 679 | 4,439 / 10,863 / 25,161 | 3,736 (84%) / 9,622 (89%) / 22,896 (91%) | 20 / 22 / 22 | 9 / 10 / 16 |
| 2 | `gpt-6.1-sol` | 100.0% | 84.6% | 69.9% | **84.8%** | 414 / 501 / 837 | 4,335 / 10,134 / 25,551 | 3,557 (82%) / 9,054 (89%) / 23,752 (93%) | 22 / 25 / 26 | 7 / 10 / 9 |
| 3 | `gpt-5.6-sol` | 100.0% | 73.2% | 53.7% | **75.6%** | 386 / 358 / 528 | 4,635 / ~10,901 / ~25,450 | 3,637 (78%) / ~9,617 (88%) / ~23,100 (91%) | 19 / 19 / 20 | 1 / 0 / 5 |
| 4 | `claude-fable-5-1` | 100.0% | 82.2% | 42.3% | **74.8%** | 548 / 800 / 1547 | 4,628 / 9,828 / 24,135 | 3,625 (78%) / 8,305 (85%) / 22,218 (92%) | 88 / 98 / 95 | 0 / 1 / 0 |
| 5 | `claude-opus-5-5` | 97.2% | 82.2% | 42.9% | **74.1%** | 551 / 810 / 1562 | 4,565 / 8,306 / 23,764 | 3,090 (68%) / 6,851 (82%) / 20,774 (87%) | 92 / 91 / 99 | 0 / 0 / 0 |
| 6 | `gpt-6-sol` | 94.4% | 84.4% | 34.4% | **71.1%** | 424 / 475 / 816 | 4,264 / 10,762 / ~25,529 | 3,658 (86%) / 9,885 (92%) / ~24,053 (94%) | 23 / 24 / 25 | 2 / 3 / 1 |
| 7 | `gpt-5.6-terra` | 79.2% | 80.0% | 35.7% | **65.0%** | 393 / 519 / 746 | ~4,603 / 10,691 / 26,057 | ~3,782 (82%) / 9,084 (85%) / 23,402 (90%) | 19 / 28 / 25 | 0 / 2 / 2 |
| 8 | `claude-sonnet-5-5` | 100.0% | 63.8% | 26.8% | **63.5%** | 524 / 824 / 1613 | 8,252 / 9,165 / 22,841 | 7,064 (86%) / 7,557 (82%) / 21,526 (94%) | 107 / 119 / 122 | 0 / 0 / 0 |
| 9 | `gpt-6-luna` | 57.6% | 50.3% | 13.1% | **40.4%** | 509 / 687 / 1308 | ~4,414 / 11,523 / 25,978 | ~3,941 (89%) / 10,776 (94%) / 24,920 (96%) | 36 / 52 / 52 | 1 / 2 / 8 |
| 10 | `claude-opus-5` | 0.0% | 64.0% | 26.8% | **30.3%** | 494 / 737 / 1520 | ~8,118 / 12,919 / 24,912 | ~7,950 (98%) / 11,816 (91%) / 23,203 (93%) | 76 / 78 / 89 | 0 / 0 / 0 |
| 11 | `claude-sonnet-5` | 0.0% | 47.5% | 2.7% | **16.7%** | 555 / 849 / 1763 | ~8,210 / 10,090 / 6,669 | ~8,050 (98%) / 8,643 (86%) / 5,981 (90%) | 181 / 195 / 174 | 0 / 0 / 0 |
| 12 | `claude-haiku-4-5` | 0.0% | 0.0% | 8.2% | **2.7%** | 523 / 744 / 1577 | ~8,092 / ~20,096 / 24,637 | ~7,903 (98%) / ~19,957 (99%) / 23,049 (94%) | 104 / 128 / 110 | 0 / 0 / 1 |
| 13 | `claude-opus-4-6` | 0.0% | 0.0% | 0.0% | **0.0%** | 457 / 662 / 990 | ~8,123 / ~20,023 / ~50,023 | ~7,972 (98%) / ~19,872 (99%) / ~49,872 (100%) | 56 / 84 / 62 | 0 / 0 / 0 |

Per-level columns list Easy 4k tokens / Medium 10k tokens / Hard 25k tokens. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Tokens/s divides output tokens by the client's wall time, including startup and assessment commands. Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Tokens/s | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| `claude-fable-5-1` | Easy 4k tokens | 100.0% | finished (budget) | 548 | 6 | 0 | 4,628 | 3,625 (78%) | 88 |  | ba100c34 |
| `claude-fable-5-1` | Hard 25k tokens | 42.3% | finished (finished) | 1547 | 7 | 0 | 24,135 | 22,218 (92%) | 95 |  | 68b69f9c |
| `claude-fable-5-1` | Medium 10k tokens | 82.2% | finished (finished) | 800 | 6 | 1 | 9,828 | 8,305 (85%) | 98 |  | 6b4f428f |
| `claude-haiku-4-5` | Easy 4k tokens | 0.0% | finished (budget) | 523 | 0 | 0 | ~8,092 | ~7,903 (98%) | 104 |  | 7057006f |
| `claude-haiku-4-5` | Hard 25k tokens | 8.2% | finished (finished) | 1577 | 6 | 1 | 24,637 | 23,049 (94%) | 110 |  | 0e88e746 |
| `claude-haiku-4-5` | Medium 10k tokens | 0.0% | finished (budget) | 744 | 0 | 0 | ~20,096 | ~19,957 (99%) | 128 |  | dc11e3cd |
| `claude-opus-4-6` | Easy 4k tokens | 0.0% | finished (budget) | 457 | 0 | 0 | ~8,123 | ~7,972 (98%) | 56 |  | 39c84640 |
| `claude-opus-4-6` | Hard 25k tokens | 0.0% | finished (budget) | 990 | 0 | 0 | ~50,023 | ~49,872 (100%) | 62 |  | e1e75078 |
| `claude-opus-4-6` | Medium 10k tokens | 0.0% | finished (budget) | 662 | 0 | 0 | ~20,023 | ~19,872 (99%) | 84 |  | cc12f44f |
| `claude-opus-5-5` | Easy 4k tokens | 97.2% | finished (budget) | 551 | 6 | 0 | 4,565 | 3,090 (68%) | 92 |  | 0370ebf6 |
| `claude-opus-5-5` | Hard 25k tokens | 42.9% | finished (finished) | 1562 | 11 | 0 | 23,764 | 20,774 (87%) | 99 |  | 0e5fd0db |
| `claude-opus-5-5` | Medium 10k tokens | 82.2% | finished (finished) | 810 | 6 | 0 | 8,306 | 6,851 (82%) | 91 |  | f291e9c5 |
| `claude-opus-5` | Easy 4k tokens | 0.0% | finished (budget) | 494 | 0 | 0 | ~8,118 | ~7,950 (98%) | 76 |  | ccb42b85 |
| `claude-opus-5` | Hard 25k tokens | 26.8% | finished (finished) | 1520 | 6 | 0 | 24,912 | 23,203 (93%) | 89 |  | e50a85bf |
| `claude-opus-5` | Medium 10k tokens | 64.0% | finished (budget) | 737 | 4 | 0 | 12,919 | 11,816 (91%) | 78 |  | d6a485b8 |
| `claude-sonnet-5-5` | Easy 4k tokens | 100.0% | finished (budget) | 524 | 6 | 0 | 8,252 | 7,064 (86%) | 107 |  | 851de058 |
| `claude-sonnet-5-5` | Hard 25k tokens | 26.8% | finished (finished) | 1613 | 4 | 0 | 22,841 | 21,526 (94%) | 122 |  | d2ccac40 |
| `claude-sonnet-5-5` | Medium 10k tokens | 63.8% | finished (finished) | 824 | 7 | 0 | 9,165 | 7,557 (82%) | 119 |  | a52f6d4d |
| `claude-sonnet-5` | Easy 4k tokens | 0.0% | finished (budget) | 555 | 0 | 0 | ~8,210 | ~8,050 (98%) | 181 |  | 43baf910 |
| `claude-sonnet-5` | Hard 25k tokens | 2.7% | finished (finished) | 1763 | 2 | 0 | 6,669 | 5,981 (90%) | 174 |  | a632693e |
| `claude-sonnet-5` | Medium 10k tokens | 47.5% | finished (finished) | 849 | 6 | 0 | 10,090 | 8,643 (86%) | 195 |  | 2a8f4bca |
| `gpt-5.6-sol` | Easy 4k tokens | 100.0% | finished (budget) | 386 | 6 | 1 | 4,635 | 3,637 (78%) | 19 |  | 795cf8fe |
| `gpt-5.6-sol` | Hard 25k tokens | 53.7% | finished (budget) | 528 | 7 | 5 | ~25,450 | ~23,100 (91%) | 20 |  | e570d189 |
| `gpt-5.6-sol` | Medium 10k tokens | 73.2% | finished (budget) | 358 | 7 | 0 | ~10,901 | ~9,617 (88%) | 19 |  | 921a78cc |
| `gpt-5.6-terra` | Easy 4k tokens | 79.2% | finished (budget) | 393 | 5 | 0 | ~4,603 | ~3,782 (82%) | 19 |  | c21595eb |
| `gpt-5.6-terra` | Hard 25k tokens | 35.7% | finished (budget) | 746 | 10 | 2 | 26,057 | 23,402 (90%) | 25 |  | 3479e041 |
| `gpt-5.6-terra` | Medium 10k tokens | 80.0% | finished (budget) | 519 | 8 | 2 | 10,691 | 9,084 (85%) | 28 |  | c904c714 |
| `gpt-6-astra` | Easy 4k tokens | 100.0% | finished (budget) | 377 | 6 | 9 | 4,439 | 3,736 (84%) | 20 |  | 4d0a4970 |
| `gpt-6-astra` | Hard 25k tokens | 81.8% | finished (budget) | 679 | 13 | 16 | 25,161 | 22,896 (91%) | 22 |  | a181706b |
| `gpt-6-astra` | Medium 10k tokens | 86.2% | finished (budget) | 432 | 8 | 10 | 10,863 | 9,622 (89%) | 22 |  | 0c5f6212 |
| `gpt-6-luna` | Easy 4k tokens | 57.6% | finished (budget) | 509 | 5 | 1 | ~4,414 | ~3,941 (89%) | 36 |  | 1c024245 |
| `gpt-6-luna` | Hard 25k tokens | 13.1% | finished (budget) | 1308 | 7 | 8 | 25,978 | 24,920 (96%) | 52 |  | 40c3d417 |
| `gpt-6-luna` | Medium 10k tokens | 50.3% | finished (budget) | 687 | 5 | 2 | 11,523 | 10,776 (94%) | 52 |  | dd969909 |
| `gpt-6-sol` | Easy 4k tokens | 94.4% | finished (budget) | 424 | 7 | 2 | 4,264 | 3,658 (86%) | 23 |  | b5cff6c8 |
| `gpt-6-sol` | Hard 25k tokens | 34.4% | finished (budget) | 816 | 9 | 1 | ~25,529 | ~24,053 (94%) | 25 |  | d116467c |
| `gpt-6-sol` | Medium 10k tokens | 84.4% | finished (budget) | 475 | 7 | 3 | 10,762 | 9,885 (92%) | 24 |  | 2948242d |
| `gpt-6.1-sol` | Easy 4k tokens | 100.0% | finished (budget) | 414 | 7 | 7 | 4,335 | 3,557 (82%) | 22 |  | c60e51ae |
| `gpt-6.1-sol` | Hard 25k tokens | 69.9% | finished (budget) | 837 | 9 | 9 | 25,551 | 23,752 (93%) | 26 |  | 0d153da7 |
| `gpt-6.1-sol` | Medium 10k tokens | 84.6% | finished (budget) | 501 | 7 | 10 | 10,134 | 9,054 (89%) | 25 |  | cfbd98ad |
