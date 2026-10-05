# Evaluation harness

`eval/harness.js` runs every model listed in [`models.json`](models.json) at every configured level, one run at a time, through this checkout's `am-i-nerfed run`. It needs an initialized baseline (`am-i-nerfed init`) and signed-in `claude` and `codex` clients.

```bash
node eval/harness.js --dry-run                       # list the planned runs
node eval/harness.js                                 # run them all
node eval/harness.js --models gpt-6-astra --levels hard
node eval/harness.js summarize eval/run-2026-10-05-1200   # rebuild result.md from the records
```

Each sweep writes to `eval/run-<date>-<time>/`:

- `result.md`: models ranked by their mean score over all levels, with time left, output tokens, reasoning tokens and their share of the output, and budget checks per level, then every run. It is rewritten after each run.
- `result.json`: the same data.
- `config.json`: the settings the sweep ran with. `summarize` uses it, or rebuilds the settings from the records when it is missing.
- `record-<agent>-<model>-<difficulty>-<seconds>.json`: the full run record, plus the harness settings and progress lines.
- `transcript-<agent>-<model>-<difficulty>-<seconds>.jsonl`: Claude's stream-json output, or Codex's native session log. Transcripts contain the private task text, so Git ignores them.

A client that fails before the assessment starts is retried `retries` times; its files are kept with a `failed-<attempt>-` prefix.

## Configuration

- `effort`: reasoning effort for every run.
- `systemPrompt`: `none` replaces each client's built-in system prompt with "Follow the user's instructions.", so the model sees only our prompt, its shell tool and Codex's environment context; `native` keeps the client's own prompt.
- `levels`: `{ difficulty, seconds }` pairs.
- `providers.<name>.agent`: `claude` or `codex`.
- `providers.<name>.command`: client command, for example `am run claude-ms18`; `null` uses the plain client.
- `providers.<name>.models`: model IDs.
- `graceSeconds`: how long a client may keep running after its run closes. Answers after the deadline are still rejected; the grace lets the client end its turn, so Claude reports exact token usage.
- `retries`: attempts after a client fails to start.
- `maxOutputTokens`: optional budget of output tokens, including reasoning, for each run (`null` for a time-limited run; `--max-output-tokens N` overrides it). A budget replaces the time wording in the prompt, and each level's `seconds` becomes a safety limit, so set it high enough not to bind. Every command response shows the tokens used, and the prompt asks the model to check `./assessment budget` after every reasoning pass. Once the count passes the budget, answers are rejected and the client may use `graceTokens` more within `graceSeconds` to end its turn. Codex counts after each finished response, so an answer in the response that crosses the budget still counts; Claude's count is an estimate from its streamed thinking progress and output.
- `graceTokens`: output tokens a client may use after spending its budget (default 1,000).

## Token counts

Output tokens include reasoning tokens: Codex's `reasoning_output_tokens` and Claude's `thinking_tokens`, reported per response and at the end of a turn. Exact counts come from the client's own reports. A Codex run stopped before it ends its turn reports the last count in its session log, which misses the response that was cut off. Claude's stream reports each finished response's exact output; a Claude run stopped mid-response estimates only that last response. `result.md` marks both with `~`.
