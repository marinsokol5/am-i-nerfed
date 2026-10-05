# Evaluation harness

`eval/harness.js` runs every model listed in [`models.json`](models.json) at every configured level, one run at a time, through this checkout's `am-i-nerfed run`. It needs an initialized baseline (`am-i-nerfed init`) and signed-in `claude` and `codex` clients.

```bash
node eval/harness.js --dry-run                       # list the planned runs
node eval/harness.js                                 # run them all
node eval/harness.js --models gpt-6-astra --levels hard
node eval/harness.js summarize eval/run-2026-10-05-1200   # rebuild result.md
```

Each sweep writes to `eval/run-<date>-<time>/`:

- `result.md`: models ranked by their mean score over all levels, with time left and output tokens per level, then every run. It is rewritten after each run.
- `result.json`: the same data.
- `record-<agent>-<model>-<difficulty>-<seconds>.json`: the full run record, plus the harness settings and progress lines.
- `transcript-<agent>-<model>-<difficulty>-<seconds>.jsonl`: Claude's stream-json output, or Codex's native session log. Transcripts contain the private task text, so Git ignores them.

A client that fails before the assessment starts is retried `retries` times; its files are kept with a `failed-<attempt>-` prefix.

## Configuration

- `effort`: reasoning effort for every run.
- `levels`: `{ difficulty, seconds }` pairs.
- `providers.<name>.agent`: `claude` or `codex`.
- `providers.<name>.command`: client command, for example `am run claude-ms18`; `null` uses the plain client.
- `providers.<name>.models`: model IDs.
- `graceSeconds`: how long a client may keep running after its run closes. Answers after the deadline are still rejected; the grace lets the client end its turn, so Claude reports exact token usage.
- `retries`: attempts after a client fails to start.

## Token counts

Output tokens include reasoning. Exact counts come from the client's own end-of-turn report. A Codex run stopped before it ends its turn reports the last count in its session log, which misses the response that was cut off. A Claude run stopped mid-turn reports exact input tokens but an output estimate from its stream. `result.md` marks both with `~`.
