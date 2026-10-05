# Evaluation results

All runs below are from 2026-10-05: am-i-nerfed 0.11.0, task bank v13, baseline `b24557ac`, high reasoning effort unless noted. Claude models ran through Claude Code and OpenAI models through Codex, unless a run says it used the direct API client. Each cell is a single run, so a difference of a few points is not meaningful.

## Main sweeps

Scores are percentages per level, then the average of the three. All three sweeps use no system prompt and a 30-second grace period; token sweeps also allow 1,000 grace tokens and stop a run at twice its budget.

| Model | Time: easy 90 s / medium 180 s / hard 360 s | Average | Tokens: easy 4k / medium 10k / hard 25k | Average | Tokens at medium effort | Average |
|---|---|---:|---|---:|---|---:|
| `gpt-6-astra` | 100 / 84 / 58 | **80.7%** | 100 / 86 / 82 | **89.3%** | — | — |
| `gpt-6.1-sol` | 100 / 79 / 38 | **72.5%** | 100 / 85 / 70 | **84.8%** | — | — |
| `gpt-5.6-sol` | 0 / 66 / 17 | **27.7%** | 100 / 73 / 54 | **75.6%** | — | — |
| `claude-fable-5-1` | 100 / 80 / 60 | **80.2%** | 100 / 82 / 42 | **74.8%** | 100 / 84 / 55 | **79.5%** |
| `claude-opus-5-5` | 100 / 80 / 59 | **79.6%** | 97 / 82 / 43 | **74.1%** | 100 / 79 / 48 | **75.7%** |
| `gpt-6-sol` | 83 / 77 / 34 | **64.8%** | 94 / 84 / 34 | **71.1%** | — | — |
| `gpt-5.6-terra` | 64 / 61 / 16 | **46.8%** | 79 / 80 / 36 | **65.0%** | — | — |
| `claude-sonnet-5-5` | 81 / 62 / 37 | **60.0%** | 100 / 64 / 27 | **63.5%** | 83 / 67 / 29 | **59.5%** |
| `gpt-6-luna` | 61 / 49 / 16 | **42.0%** | 58 / 50 / 13 | **40.4%** | — | — |
| `claude-opus-5` | 67 / 82 / 22 | **56.9%** | 0 / 64 / 27 | **30.3%** | — | — |
| `claude-sonnet-5` | 75 / 48 / 3 | **42.1%** | 0 / 48 / 3 | **16.7%** | — | — |
| `claude-haiku-4-5` | 0 / 31 / 22 | **17.7%** | 0 / 0 / 8 | **2.7%** | — | — |
| `claude-opus-4-6` | 0 / 0 / 0 | **0.0%** | 0 / 0 / 0 | **0.0%** | — | — |

- Time limits: [`run-2026-10-05-sweep`](run-2026-10-05-sweep/result.md)
- Token budgets, high effort: [`run-2026-10-05-tokens`](run-2026-10-05-tokens/result.md)
- Token budgets, medium effort (Opus 5.5, Fable 5.1 and Sonnet 5.5 only): [`run-2026-10-05-tokens-medium-effort`](run-2026-10-05-tokens-medium-effort/result.md)

Each folder's `result.md` also lists time left, output and reasoning tokens, tokens per second and budget checks.

## Trials

Single medium-level runs from building the harness. Settings changed between them, so they are not comparable with each other or with the sweeps; each shows one behavior.

| Run | Setup | What it tested | Result |
|---|---|---|---|
| [`1001`](run-2026-10-05-1001/result.md) | 120 s, native system prompt | First harness run: transcripts, records, grace period | Opus 5.5 79.4% but stopped with 51 s left; astra 66.7%, cut off at the deadline |
| [`1014`](run-2026-10-05-1014/result.md) | 5k tokens, native | First token budget: usage only via `timer`, no grace | astra 82.4%, Opus 5.5 78.9%; Opus never checked its usage |
| [`1040`](run-2026-10-05-1040/result.md) | 5k tokens, native | Usage in every response, grace tokens, `budget` command | astra 82.7%; Opus 5.5 66.7%, stopped with about 1,000 tokens left to write a summary |
| [`1054`](run-2026-10-05-1054/result.md) | 5k tokens, no system prompt | Native system prompt removed; exact Claude counts per response | astra 84.5%; Opus 5.5 66.7%, still wrote a summary |
| [`1103`](run-2026-10-05-1103/result.md) | 5k tokens, no system prompt | The "do not write a summary" rule | Opus 5.5 71.4%, still wrote a shorter summary |
| [`1117`](run-2026-10-05-1117/result.md) | 5k tokens, direct API | Opus 5.5 without Claude Code | 66.7%; cut off mid-reasoning, 90% of output was thinking |
| [`1129`](run-2026-10-05-1129/result.md) | 120 s, direct API | Opus 5.5 time limit without Claude Code | 62.8%; used nearly all the time, still ended with a summary |
| [`1134`](run-2026-10-05-1134/result.md) | 120 s, Claude Code | Sonnet 5.5 time limit | 67.2%; stopped with 42 s left, wrote a summary |
| [`1135`](run-2026-10-05-1135/result.md) | 120 s, direct API | Sonnet 5.5 time limit without Claude Code | 66.7%; stopped with 38 s left, wrote a summary |
| [`1139`](run-2026-10-05-1139/result.md) | 5k tokens, Claude Code | Sonnet 5.5 under the first budget rule | 0%: its answers came in the response that crossed the budget and were rejected, which led to the start-of-response rule |
| [`1140`](run-2026-10-05-1140/result.md) | 5k tokens, direct API | Same as `1139` without Claude Code | 61.5%; the crossing response's answer counted |
| [`1150`](run-2026-10-05-1150/result.md) | 5k tokens, Claude Code | Sonnet 5.5 under the start-of-response rule | 51.1%; stopped with about 340 tokens left, wrote a summary |
| [`1151`](run-2026-10-05-1151/result.md) | 5k tokens, direct API | Same as `1150` without Claude Code | 55.4%; stopped with about 220 tokens left, wrote a summary |
