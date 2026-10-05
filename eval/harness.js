#!/usr/bin/env node
// Runs every model in eval/models.json at every configured level, one run at
// a time, and writes each run's transcript and record plus a results table
// to eval/run-<date>-<time>/.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const usage = `usage: node eval/harness.js [--config FILE] [--mode time|tokens] [--models A,B]
                          [--levels easy,hard] [--max-output-tokens N] [--out DIR] [--dry-run]
       node eval/harness.js summarize RUN_DIR`;

export const runName = ({ agent, model, difficulty, seconds, maxOutputTokens }) =>
  `${agent}-${model}-${difficulty}-${seconds}${maxOutputTokens ? `-${maxOutputTokens}t` : ""}`;
// A level's output budget, its own or the sweep's; null for a time limit.
const budgetOf = (level, config) => level.maxOutputTokens ?? config.maxOutputTokens ?? null;
const sameLevel = (a, b, config) => a.difficulty === b.difficulty && a.seconds === b.seconds
  && budgetOf(a, config) === budgetOf(b, config);

export function loadConfig(file) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof config.effort !== "string") throw Error("config.effort is required");
  if (config.systemPrompt != null && !["native", "none"].includes(config.systemPrompt))
    throw Error('config.systemPrompt must be "native" or "none"');
  if (!Array.isArray(config.levels) || !config.levels.length)
    throw Error("config.levels must list { difficulty, seconds }");
  for (const [name, provider] of Object.entries(config.providers ?? {}))
    if (!["claude", "codex"].includes(provider.agent) || !Array.isArray(provider.models))
      throw Error(`Provider ${name} needs agent claude|codex and a models list`);
  return { graceSeconds: 0, retries: 1, maxOutputTokens: null, graceTokens: null, systemPrompt: "native", ...config };
}

/** Every planned run, providers in config order, each model at every level. */
export function plan(config, { models, levels } = {}) {
  return Object.entries(config.providers).flatMap(([provider, settings]) =>
    settings.models
      .filter((model) => !models || models.includes(model))
      .flatMap((model) => config.levels
        .filter(({ difficulty }) => !levels || levels.includes(difficulty))
        .map((level) => ({ provider, agent: settings.agent, command: settings.command ?? null, model,
          difficulty: level.difficulty, seconds: level.seconds, maxOutputTokens: budgetOf(level, config) }))));
}

// Codex counts come from its session log, which misses a response cut off by
// the stop. Claude's exact count arrives only when it ends its own turn;
// otherwise it is estimated from the stream.
export function tokenUsage(run) {
  const execution = run?.execution;
  if (!execution) return null;
  const native = execution.nativeEvidence?.reportedTokenUsage;
  if (native)
    return { output: native.output_tokens, reasoning: native.reasoning_output_tokens ?? null,
      input: native.input_tokens, exact: Boolean(execution.terminal) };
  const usage = execution.terminal ? execution.usage : null;
  if (usage?.output_tokens != null)
    return { output: usage.output_tokens, reasoning: usage.output_tokens_details?.thinking_tokens ?? null, exact: true,
      input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) };
  const stream = execution.streamUsage;
  if (stream)
    return { output: stream.estimated_output_tokens, reasoning: stream.estimated_reasoning_tokens ?? null,
      exact: Boolean(stream.exact),
      input: stream.input_tokens + stream.cache_creation_input_tokens + stream.cache_read_input_tokens };
  return null;
}

export function runSummary(record) {
  const { harness, run } = record;
  const clock = run?.clock;
  const tokens = tokenUsage(run), wall = run?.execution?.wallSeconds;
  return {
    ...harness.run,
    maxOutputTokens: harness.run.maxOutputTokens ?? harness.maxOutputTokens ?? null,
    percent: run?.result?.percent ?? null,
    timeLeft: clock ? clock.durationSeconds - clock.elapsedSeconds : null,
    answers: (harness.progress ?? []).filter((line) => line.startsWith("answer:")).length,
    // Budget checks were called timer before the command was renamed.
    budgetChecks: run?.execution?.commandCounts
      ? (run.execution.commandCounts.budget ?? 0) + (run.execution.commandCounts.timer ?? 0)
      : null,
    tokens,
    // Output over the client's whole wall time, including startup and commands.
    tokensPerSecond: tokens && wall ? tokens.output / wall : null,
    status: run?.status ?? "missing",
    reason: run?.execution?.reason ?? null,
    failure: run?.execution?.failure ?? record.error ?? null,
    runId: run?.runId ?? null,
  };
}

/** One row per model with each level's run and the mean over all levels. */
export function buildResults(records, config) {
  const runs = records.map(runSummary);
  const rows = Object.values(config.providers).flatMap((provider) => provider.models).map((model) => {
    const levels = config.levels.map((level) =>
      runs.find((run) => run.model === model && sameLevel(run, level, config)) ?? null);
    const complete = levels.every((run) => run?.percent != null);
    return { model, levels,
      average: complete ? levels.reduce((sum, run) => sum + run.percent, 0) / levels.length : null };
  }).filter((row) => row.levels.some(Boolean));
  rows.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  const first = records.find((record) => record.run)?.run;
  return {
    generatedAt: new Date().toISOString(),
    appVersion: first?.appVersion ?? null,
    taskBankVersion: first?.taskBankVersion ?? null,
    baselineId: first?.baselineId ?? null,
    effort: config.effort,
    graceSeconds: config.graceSeconds,
    systemPrompt: config.systemPrompt,
    levels: config.levels.map((level) => ({ ...level, maxOutputTokens: budgetOf(level, config) })),
    clients: Object.fromEntries(Object.entries(config.providers)
      .map(([name, provider]) => [name, provider.command ?? provider.agent])),
    rows,
    runs,
  };
}

const percent = (value) => (value == null ? "—" : `${value.toFixed(1)}%`);
const tokens = (usage) => (usage ? `${usage.exact ? "" : "~"}${usage.output.toLocaleString("en-US")}` : "—");
const reasoning = (usage) => (usage?.reasoning == null ? "—"
  : `${usage.exact ? "" : "~"}${usage.reasoning.toLocaleString("en-US")} (${usage.output ? Math.round((100 * usage.reasoning) / usage.output) : 0}%)`);
const levelName = ({ difficulty, seconds, maxOutputTokens }) =>
  `${difficulty[0].toUpperCase()}${difficulty.slice(1)} ${maxOutputTokens ? `${maxOutputTokens / 1000}k tokens` : `${seconds}s`}`;
const speed = (run) => (run?.tokensPerSecond == null ? "—" : Math.round(run.tokensPerSecond));

export function markdown(results) {
  const header = ["Rank", "Model", ...results.levels.map(levelName), "Average",
    "Time left (s)", "Output tokens", "Reasoning tokens (share)", "Tokens/s", "Budget checks"];
  const lines = [
    `# Evaluation ${results.generatedAt.slice(0, 16).replace("T", " ")} UTC`,
    "",
    `am-i-nerfed ${results.appVersion ?? "?"} · task bank v${results.taskBankVersion ?? "?"} · baseline ${results.baselineId?.slice(0, 8) ?? "?"} · effort ${results.effort} · system prompt ${results.systemPrompt} · grace ${results.graceSeconds}s${
      results.levels.some((level) => level.maxOutputTokens) ? ` · output budgets with safety limits of ${
        results.levels.map((level) => `${level.seconds}s`).join(" / ")}` : ""}`,
    "",
    `Clients: ${Object.entries(results.clients).map(([name, command]) => `${name} \`${command}\``).join(" · ")}`,
    "",
    `| ${header.join(" | ")} |`,
    `|${header.map((_, i) => (i === 1 ? "---" : "---:")).join("|")}|`,
    ...results.rows.map((row, i) => `| ${row.average == null ? "—" : i + 1} | \`${row.model}\` | ${
      row.levels.map((run) => percent(run?.percent)).join(" | ")} | **${percent(row.average)}** | ${
      row.levels.map((run) => run?.timeLeft ?? "—").join(" / ")} | ${
      row.levels.map((run) => tokens(run?.tokens)).join(" / ")} | ${
      row.levels.map((run) => reasoning(run?.tokens)).join(" / ")} | ${
      row.levels.map(speed).join(" / ")} | ${
      row.levels.map((run) => run?.budgetChecks ?? "—").join(" / ")} |`),
    "",
    `Per-level columns list ${results.levels.map(levelName).join(" / ")}. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning tokens, whose share of the output is in brackets; \`~\` marks counts that miss a response cut off by the stop (Codex) or estimate it from the stream (Claude). Tokens/s divides output tokens by the client's wall time, including startup and assessment commands. Budget checks count the model's \`./assessment budget\` calls.`,
    "",
    "## Runs",
    "",
    "| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Reasoning tokens (share) | Tokens/s | Failure | Run |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|",
    ...results.runs.map((run) => `| \`${run.model}\` | ${levelName(run)} | ${percent(run.percent)} | ${run.status}${
      run.reason ? ` (${run.reason})` : ""} | ${run.timeLeft ?? "—"} | ${run.answers} | ${run.budgetChecks ?? "—"} | ${tokens(run.tokens)} | ${reasoning(run.tokens)} | ${speed(run)} | ${
      run.failure ?? ""} | ${run.runId?.slice(0, 8) ?? ""} |`),
    "",
  ];
  return lines.join("\n");
}

function readRecords(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /^record-.*\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

/** The settings a run directory was swept with, rebuilt from its records. */
export function configFromRecords(records) {
  const levels = [], providers = {}, order = ["easy", "medium", "hard"];
  for (const { harness } of records) {
    const { agent, model, difficulty, seconds, provider, command } = harness.run;
    const level = { difficulty, seconds, maxOutputTokens: harness.run.maxOutputTokens ?? harness.maxOutputTokens ?? null };
    if (!levels.some((known) => sameLevel(known, level, {}))) levels.push(level);
    const name = provider ?? (agent === "claude" ? "anthropic" : "openai");
    providers[name] ??= { agent, command: command ?? null, models: [] };
    if (!providers[name].models.includes(model)) providers[name].models.push(model);
  }
  levels.sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty) || a.seconds - b.seconds);
  for (const level of levels) if (level.maxOutputTokens == null) delete level.maxOutputTokens;
  const first = records[0] ?? {};
  return { effort: first.harness?.effort, graceSeconds: first.harness?.graceSeconds ?? 0, retries: 0,
    maxOutputTokens: null, graceTokens: first.harness?.graceTokens ?? null,
    systemPrompt: first.harness?.systemPrompt ?? first.run?.systemPrompt ?? "native", levels, providers };
}

export function writeResults(dir, config) {
  const results = buildResults(readRecords(dir), config);
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(results, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "result.md"), markdown(results));
  return results;
}

function runDirectory(out) {
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    return out;
  }
  const now = new Date(), pad = (n) => String(n).padStart(2, "0");
  const base = path.join(root, "eval", `run-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`);
  let dir = base;
  for (let i = 2; fs.existsSync(dir); i++) dir = `${base}-${i}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function attempt(run, config, dir, number) {
  const name = runName(run);
  const transcript = path.join(dir, `transcript-${name}.jsonl`);
  const args = [path.join(root, "bin", "am-i-nerfed.js"), "run", "--agent", run.agent, "--model", run.model,
    "--effort", config.effort, "--difficulty", run.difficulty, "--seconds", String(run.seconds),
    "--grace-seconds", String(config.graceSeconds), "--transcript", transcript, "--verbose",
    ...(run.maxOutputTokens ? ["--max-output-tokens", String(run.maxOutputTokens)] : []),
    ...(run.maxOutputTokens && config.graceTokens != null ? ["--grace-tokens", String(config.graceTokens)] : []),
    ...(config.systemPrompt === "none" ? ["--no-system-prompt"] : [])];
  const env = { ...process.env };
  if (run.command) env[`AM_I_NERFED_${run.agent.toUpperCase()}_COMMAND`] = run.command;
  const startedAt = new Date().toISOString(), progress = [];
  let stdout = "", stderr = "";
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        if (/^\w+: \d+s remaining$/.test(line)) progress.push(line);
        console.log(`  ${run.model} ${run.difficulty}: ${line}`);
      }
    });
    child.on("close", (exitCode) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* recorded as an error below */ }
      const record = {
        harness: { run, attempt: number, startedAt, exitCode, progress, command: run.command ?? run.agent,
          effort: config.effort, graceSeconds: config.graceSeconds, maxOutputTokens: run.maxOutputTokens,
          graceTokens: config.graceTokens, systemPrompt: config.systemPrompt },
        run: parsed,
        error: parsed ? null : stderr.trim().split("\n").slice(-5).join("\n") || "No run record",
      };
      fs.writeFileSync(path.join(dir, `record-${name}.json`), JSON.stringify(record, null, 2) + "\n");
      resolve(record);
    });
  });
}

async function sweep(config, options) {
  const runs = plan(config, options);
  if (options.dryRun) {
    for (const run of runs) console.log(`${run.agent} ${run.model} ${run.difficulty} ${run.seconds}s${
      run.maxOutputTokens ? ` ${run.maxOutputTokens} tokens` : ""} via ${run.command ?? run.agent}`);
    return;
  }
  const dir = runDirectory(options.out);
  console.log(`Writing ${runs.length} runs to ${path.relative(process.cwd(), dir)}`);
  // The sweep's own settings, limited to what it runs, for later summaries.
  const planned = { ...config, levels: config.levels.filter((level) =>
    runs.some((run) => sameLevel(run, level, config))),
  providers: Object.fromEntries(Object.entries(config.providers).map(([name, provider]) =>
    [name, { ...provider, models: provider.models.filter((model) => runs.some((run) => run.model === model)) }])
    .filter(([, provider]) => provider.models.length)) };
  // A sweep continued in an existing directory keeps the models and levels
  // already run there, so its results cover both parts.
  const saved = path.join(dir, "config.json");
  if (fs.existsSync(saved)) {
    const previous = loadConfig(saved);
    for (const level of previous.levels)
      if (!planned.levels.some((known) => sameLevel(known, level, previous)))
        planned.levels.push(level);
    for (const [name, provider] of Object.entries(previous.providers)) {
      const current = (planned.providers[name] ??= { ...provider, models: [] });
      current.models = [...new Set([...provider.models, ...current.models])];
    }
  }
  fs.writeFileSync(saved, JSON.stringify(planned, null, 2) + "\n");
  config = planned;
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  for (const run of runs) {
    if (stopping) break;
    console.log(`${new Date().toLocaleTimeString()} ${run.model} ${levelName(run)}`);
    for (let number = 1; ; number++) {
      const record = await attempt(run, config, dir, number);
      // Only a client that never started the assessment is retried; a started
      // run is scored as it ended.
      const started = record.run && record.run.execution?.assessmentStarted !== false;
      if (started || number > config.retries) break;
      for (const file of [`record-${runName(run)}.json`, `transcript-${runName(run)}.jsonl`])
        if (fs.existsSync(path.join(dir, file)))
          fs.renameSync(path.join(dir, file), path.join(dir, `failed-${number}-${file}`));
    }
    writeResults(dir, config);
  }
  console.log(`Results: ${path.relative(process.cwd(), path.join(dir, "result.md"))}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const config = loadConfig(path.resolve(value("--config") ?? path.join(root, "eval", "models.json")));
  if (value("--mode") === "tokens") {
    if (!Array.isArray(config.tokenLevels)) throw Error("config.tokenLevels must list { difficulty, seconds, maxOutputTokens }");
    config.levels = config.tokenLevels;
  } else if (value("--mode") && value("--mode") !== "time") throw Error(usage);
  if (value("--max-output-tokens")) config.maxOutputTokens = Number(value("--max-output-tokens"));
  if (args.includes("--help")) console.log(usage);
  else if (args[0] === "summarize") {
    if (!args[1]) throw Error(usage);
    const dir = path.resolve(args[1]), saved = path.join(dir, "config.json");
    const results = writeResults(dir, fs.existsSync(saved) ? loadConfig(saved) : configFromRecords(readRecords(dir)));
    console.log(markdown(results));
  } else
    await sweep(config, {
      models: value("--models")?.split(","),
      levels: value("--levels")?.split(","),
      dryRun: args.includes("--dry-run"),
      out: value("--out") && path.resolve(value("--out")),
    });
}
