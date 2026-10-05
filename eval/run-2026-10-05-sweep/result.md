# Evaluation 2026-10-05 12:18 UTC

am-i-nerfed 0.11.0 · task bank v13 · baseline b24557ac · effort high · system prompt none · grace 30s

Clients: claude `am run claude-ms18` · codex `codex`

| Rank | Model | Easy 90s | Medium 180s | Hard 360s | Average | Time left (s) | Output tokens | Reasoning tokens (share) | Budget checks |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | `gpt-6-astra` | 100.0% | 84.4% | 57.8% | **80.7%** | 0 / 0 / 0 | 2,023 / 4,682 / 10,676 | 1,511 (75%) / 3,816 (82%) / 9,063 (85%) | 2 / 1 / 0 |
| 2 | `claude-fable-5-1` | 100.0% | 80.4% | 60.2% | **80.2%** | 0 / 53 / 58 | 7,883 / 11,613 / 29,325 | 5,799 (74%) / 9,479 (82%) / 25,949 (88%) | 8 / 1 / 1 |
| 3 | `claude-opus-5-5` | 100.0% | 79.9% | 58.8% | **79.6%** | 39 / 60 / 111 | 4,190 / 10,834 / 23,890 | 2,970 (71%) / 8,821 (81%) / 20,562 (86%) | 0 / 1 / 0 |
| 4 | `gpt-6.1-sol` | 100.0% | 79.3% | 38.3% | **72.5%** | 0 / 0 / 0 | 2,083 / 4,716 / 9,195 | 1,557 (75%) / 3,947 (84%) / 7,713 (84%) | 1 / 1 / 0 |
| 5 | `gpt-6-sol` | 83.3% | 77.0% | 34.0% | **64.8%** | 0 / 0 / 0 | 1,560 / 5,256 / 10,356 | 1,035 (66%) / 4,316 (82%) / 9,024 (87%) | 0 / 2 / 1 |
| 6 | `claude-sonnet-5-5` | 80.6% | 62.3% | 37.2% | **60.0%** | 25 / 59 / 101 | 6,900 / 13,697 / 31,483 | 5,999 (87%) / 11,724 (86%) / 28,563 (91%) | 1 / 1 / 0 |
| 7 | `claude-opus-5` | 66.7% | 81.8% | 22.3% | **56.9%** | 0 / 0 / 28 | 9,010 / 14,777 / 28,501 | 8,130 (90%) / 13,370 (90%) / 26,330 (92%) | 0 / 0 / 1 |
| 8 | `gpt-5.6-terra` | 63.9% | 60.7% | 15.8% | **46.8%** | 0 / 0 / 0 | 3,259 / 4,834 / 8,914 | 2,483 (76%) / 3,967 (82%) / 7,381 (83%) | 0 / 0 / 0 |
| 9 | `claude-sonnet-5` | 75.2% | 48.4% | 2.7% | **42.1%** | 39 / 151 / 286 | 9,462 / 5,779 / 14,484 | 7,738 (82%) / 3,762 (65%) / 13,389 (92%) | 0 / 0 / 1 |
| 10 | `gpt-6-luna` | 61.1% | 48.8% | 16.2% | **42.0%** | 0 / 0 / 11 | 4,104 / 8,859 / 17,627 | 3,591 (88%) / 8,007 (90%) / 16,198 (92%) | 1 / 1 / 5 |
| 11 | `gpt-5.6-sol` | 0.0% | 65.8% | 17.2% | **27.7%** | 0 / 0 / 0 | ~186 / 2,949 / 6,277 | ~18 (10%) / 1,895 (64%) / 5,159 (82%) | 0 / 0 / 1 |
| 12 | `claude-haiku-4-5` | 0.0% | 31.2% | 22.0% | **17.7%** | 0 / 5 / 66 | 11,029 / 18,345 / 32,863 | 10,555 (96%) / 16,613 (91%) / 26,920 (82%) | 1 / 3 / 4 |
| 13 | `claude-opus-4-6` | 0.0% | 0.0% | 0.0% | **0.0%** | 0 / 0 / 0 | ~7,770 / ~11,770 / ~23,821 | ~7,619 (98%) / ~11,619 (99%) / ~23,669 (99%) | 0 / 0 / 0 |

Per-level columns list Easy 90s / Medium 180s / Hard 360s. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; `~` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Budget checks count the model's `./assessment budget` calls.

## Runs

| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Failure | Run |
|---|---|---:|---|---:|---:|---:|---:|---:|---|---|
| `claude-fable-5-1` | Easy 90s | 100.0% | expired (deadline) | 0 | 6 | 8 | 7,883 | 5,799 (74%) |  | f4ee4ca2 |
| `claude-fable-5-1` | Hard 360s | 60.2% | finished (finished) | 58 | 12 | 1 | 29,325 | 25,949 (88%) |  | 480a79ec |
| `claude-fable-5-1` | Medium 180s | 80.4% | finished (finished) | 53 | 9 | 1 | 11,613 | 9,479 (82%) |  | ada0ca03 |
| `claude-haiku-4-5` | Easy 90s | 0.0% | expired (deadline) | 0 | 1 | 1 | 11,029 | 10,555 (96%) |  | d09eac3d |
| `claude-haiku-4-5` | Hard 360s | 22.0% | finished (finished) | 66 | 33 | 4 | 32,863 | 26,920 (82%) |  | 63d46d4b |
| `claude-haiku-4-5` | Medium 180s | 31.2% | finished (finished) | 5 | 6 | 3 | 18,345 | 16,613 (91%) |  | 97c547fa |
| `claude-opus-4-6` | Easy 90s | 0.0% | expired (deadline) | 0 | 0 | 0 | ~7,770 | ~7,619 (98%) |  | 3ffe8740 |
| `claude-opus-4-6` | Hard 360s | 0.0% | expired (deadline) | 0 | 0 | 0 | ~23,821 | ~23,669 (99%) |  | 6942de9d |
| `claude-opus-4-6` | Medium 180s | 0.0% | expired (deadline) | 0 | 0 | 0 | ~11,770 | ~11,619 (99%) |  | fc2693a5 |
| `claude-opus-5-5` | Easy 90s | 100.0% | finished (finished) | 39 | 6 | 0 | 4,190 | 2,970 (71%) |  | 6da841a9 |
| `claude-opus-5-5` | Hard 360s | 58.8% | finished (finished) | 111 | 16 | 0 | 23,890 | 20,562 (86%) |  | 872c5114 |
| `claude-opus-5-5` | Medium 180s | 79.9% | finished (finished) | 60 | 7 | 1 | 10,834 | 8,821 (81%) |  | 55bf2d75 |
| `claude-opus-5` | Easy 90s | 66.7% | expired (deadline) | 0 | 5 | 0 | 9,010 | 8,130 (90%) |  | 6b189312 |
| `claude-opus-5` | Hard 360s | 22.3% | finished (finished) | 28 | 7 | 1 | 28,501 | 26,330 (92%) |  | 6686965e |
| `claude-opus-5` | Medium 180s | 81.8% | expired (deadline) | 0 | 6 | 0 | 14,777 | 13,370 (90%) |  | efe664e9 |
| `claude-sonnet-5-5` | Easy 90s | 80.6% | finished (finished) | 25 | 6 | 1 | 6,900 | 5,999 (87%) |  | 5a0222da |
| `claude-sonnet-5-5` | Hard 360s | 37.2% | finished (finished) | 101 | 14 | 0 | 31,483 | 28,563 (91%) |  | 9cb32c95 |
| `claude-sonnet-5-5` | Medium 180s | 62.3% | finished (finished) | 59 | 8 | 1 | 13,697 | 11,724 (86%) |  | 9cb894e8 |
| `claude-sonnet-5` | Easy 90s | 75.2% | finished (finished) | 39 | 7 | 0 | 9,462 | 7,738 (82%) |  | a475d74f |
| `claude-sonnet-5` | Hard 360s | 2.7% | finished (finished) | 286 | 3 | 1 | 14,484 | 13,389 (92%) |  | 16d6b78c |
| `claude-sonnet-5` | Medium 180s | 48.4% | finished (finished) | 151 | 8 | 0 | 5,779 | 3,762 (65%) |  | 32ead6d2 |
| `gpt-5.6-sol` | Easy 90s | 0.0% | expired (deadline) | 0 | 0 | 0 | ~186 | ~18 (10%) |  | 96f72cb0 |
| `gpt-5.6-sol` | Hard 360s | 17.2% | expired (deadline) | 0 | 6 | 1 | 6,277 | 5,159 (82%) |  | ea661d25 |
| `gpt-5.6-sol` | Medium 180s | 65.8% | expired (deadline) | 0 | 5 | 0 | 2,949 | 1,895 (64%) |  | 3d70de68 |
| `gpt-5.6-terra` | Easy 90s | 63.9% | expired (deadline) | 0 | 5 | 0 | 3,259 | 2,483 (76%) |  | 374037ea |
| `gpt-5.6-terra` | Hard 360s | 15.8% | expired (deadline) | 0 | 8 | 0 | 8,914 | 7,381 (83%) |  | baa04c3d |
| `gpt-5.6-terra` | Medium 180s | 60.7% | expired (deadline) | 0 | 5 | 0 | 4,834 | 3,967 (82%) |  | 8b926ec0 |
| `gpt-6-astra` | Easy 90s | 100.0% | expired (deadline) | 0 | 6 | 2 | 2,023 | 1,511 (75%) |  | cacbbdf8 |
| `gpt-6-astra` | Hard 360s | 57.8% | expired (deadline) | 0 | 10 | 0 | 10,676 | 9,063 (85%) |  | 242678c7 |
| `gpt-6-astra` | Medium 180s | 84.4% | expired (deadline) | 0 | 7 | 1 | 4,682 | 3,816 (82%) |  | 0fddb9d8 |
| `gpt-6-luna` | Easy 90s | 61.1% | expired (deadline) | 0 | 6 | 1 | 4,104 | 3,591 (88%) |  | 0824cfe9 |
| `gpt-6-luna` | Hard 360s | 16.2% | finished (finished) | 11 | 9 | 5 | 17,627 | 16,198 (92%) |  | 817616cc |
| `gpt-6-luna` | Medium 180s | 48.8% | expired (deadline) | 0 | 7 | 1 | 8,859 | 8,007 (90%) |  | 7b44e184 |
| `gpt-6-sol` | Easy 90s | 83.3% | expired (deadline) | 0 | 6 | 0 | 1,560 | 1,035 (66%) |  | 7ca30151 |
| `gpt-6-sol` | Hard 360s | 34.0% | expired (deadline) | 0 | 8 | 1 | 10,356 | 9,024 (87%) |  | 0147c2c0 |
| `gpt-6-sol` | Medium 180s | 77.0% | expired (deadline) | 0 | 7 | 2 | 5,256 | 4,316 (82%) |  | 8fa86e05 |
| `gpt-6.1-sol` | Easy 90s | 100.0% | expired (deadline) | 0 | 6 | 1 | 2,083 | 1,557 (75%) |  | ca8cc575 |
| `gpt-6.1-sol` | Hard 360s | 38.3% | expired (deadline) | 0 | 9 | 0 | 9,195 | 7,713 (84%) |  | b6439a31 |
| `gpt-6.1-sol` | Medium 180s | 79.3% | expired (deadline) | 0 | 6 | 1 | 4,716 | 3,947 (84%) |  | d1e63efc |
