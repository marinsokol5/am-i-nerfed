#!/usr/bin/env node
// Runs every model in eval/models.json at every configured level, one run at
// a time, and writes each run's transcript and record plus a results table
// to eval/run-<date>-<time>/.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const usage = `usage: node eval/harness.js [--config FILE] [--models A,B] [--levels easy,hard]
                          [--max-output-tokens N] [--out DIR] [--dry-run]
       node eval/harness.js summarize RUN_DIR [--config FILE]`;

export const runName = ({ agent, model, difficulty, seconds }) =>
  `${agent}-${model}-${difficulty}-${seconds}`;

export function loadConfig(file) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof config.effort !== "string") throw Error("config.effort is required");
  if (!Array.isArray(config.levels) || !config.levels.length)
    throw Error("config.levels must list { difficulty, seconds }");
  for (const [name, provider] of Object.entries(config.providers ?? {}))
    if (!["claude", "codex"].includes(provider.agent) || !Array.isArray(provider.models))
      throw Error(`Provider ${name} needs agent claude|codex and a models list`);
  return { graceSeconds: 0, retries: 1, maxOutputTokens: null, graceTokens: null, ...config };
}

/** Every planned run, providers in config order, each model at every level. */
export function plan(config, { models, levels } = {}) {
  return Object.entries(config.providers).flatMap(([provider, settings]) =>
    settings.models
      .filter((model) => !models || models.includes(model))
      .flatMap((model) => config.levels
        .filter(({ difficulty }) => !levels || levels.includes(difficulty))
        .map(({ difficulty, seconds }) => ({ provider, agent: settings.agent,
          command: settings.command ?? null, model, difficulty, seconds }))));
}

// Codex counts come from its session log, which misses a response cut off by
// the stop. Claude's exact count arrives only when it ends its own turn;
// otherwise it is estimated from the stream.
export function tokenUsage(run) {
  const execution = run?.execution;
  if (!execution) return null;
  const native = execution.nativeEvidence?.reportedTokenUsage;
  if (native)
    return { output: native.output_tokens, input: native.input_tokens, exact: Boolean(execution.terminal) };
  const usage = execution.terminal ? execution.usage : null;
  if (usage?.output_tokens != null)
    return { output: usage.output_tokens, exact: true,
      input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) };
  const stream = execution.streamUsage;
  if (stream)
    return { output: stream.estimated_output_tokens, exact: false,
      input: stream.input_tokens + stream.cache_creation_input_tokens + stream.cache_read_input_tokens };
  return null;
}

export function runSummary(record) {
  const { harness, run } = record;
  const clock = run?.clock;
  return {
    ...harness.run,
    percent: run?.result?.percent ?? null,
    timeLeft: clock ? clock.durationSeconds - clock.elapsedSeconds : null,
    answers: (harness.progress ?? []).filter((line) => line.startsWith("answer:")).length,
    // Budget checks were called timer before the command was renamed.
    budgetChecks: run?.execution?.commandCounts
      ? (run.execution.commandCounts.budget ?? 0) + (run.execution.commandCounts.timer ?? 0)
      : null,
    tokens: tokenUsage(run),
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
      runs.find((run) => run.model === model && run.difficulty === level.difficulty && run.seconds === level.seconds) ?? null);
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
    maxOutputTokens: config.maxOutputTokens,
    levels: config.levels,
    clients: Object.fromEntries(Object.values(config.providers)
      .map((provider) => [provider.agent, provider.command ?? provider.agent])),
    rows,
    runs,
  };
}

const percent = (value) => (value == null ? "—" : `${value.toFixed(1)}%`);
const tokens = (usage) => (usage ? `${usage.exact ? "" : "~"}${usage.output.toLocaleString("en-US")}` : "—");
const levelName = ({ difficulty, seconds }) =>
  `${difficulty[0].toUpperCase()}${difficulty.slice(1)} ${seconds}s`;

export function markdown(results) {
  const header = ["Rank", "Model", ...results.levels.map(levelName), "Average",
    "Time left (s)", "Output tokens", "Budget checks"];
  const lines = [
    `# Evaluation ${results.generatedAt.slice(0, 16).replace("T", " ")} UTC`,
    "",
    `am-i-nerfed ${results.appVersion ?? "?"} · task bank v${results.taskBankVersion ?? "?"} · baseline ${results.baselineId?.slice(0, 8) ?? "?"} · effort ${results.effort} · grace ${results.graceSeconds}s${
      results.maxOutputTokens ? ` · output budget ${results.maxOutputTokens.toLocaleString("en-US")} tokens` : ""}`,
    "",
    `Clients: ${Object.entries(results.clients).map(([agent, command]) => `${agent} \`${command}\``).join(" · ")}`,
    "",
    `| ${header.join(" | ")} |`,
    `|${header.map((_, i) => (i === 1 ? "---" : "---:")).join("|")}|`,
    ...results.rows.map((row, i) => `| ${row.average == null ? "—" : i + 1} | \`${row.model}\` | ${
      row.levels.map((run) => percent(run?.percent)).join(" | ")} | **${percent(row.average)}** | ${
      row.levels.map((run) => run?.timeLeft ?? "—").join(" / ")} | ${
      row.levels.map((run) => tokens(run?.tokens)).join(" / ")} | ${
      row.levels.map((run) => run?.budgetChecks ?? "—").join(" / ")} |`),
    "",
    `Per-level columns list ${results.levels.map(levelName).join(" / ")}. Time left is the unused allowance when the model ended its turn or was stopped. Output tokens include reasoning; \`~\` marks counts that miss a response cut off by the stop (Codex) or are estimated from the stream (Claude). Budget checks count the model's \`./assessment budget\` calls.`,
    "",
    "## Runs",
    "",
    "| Model | Level | Score | Status | Time left (s) | Answers | Budget checks | Output tokens | Failure | Run |",
    "|---|---|---:|---|---:|---:|---:|---:|---|---|",
    ...results.runs.map((run) => `| \`${run.model}\` | ${levelName(run)} | ${percent(run.percent)} | ${run.status}${
      run.reason ? ` (${run.reason})` : ""} | ${run.timeLeft ?? "—"} | ${run.answers} | ${run.budgetChecks ?? "—"} | ${tokens(run.tokens)} | ${
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
    ...(config.maxOutputTokens ? ["--max-output-tokens", String(config.maxOutputTokens)] : []),
    ...(config.maxOutputTokens && config.graceTokens != null ? ["--grace-tokens", String(config.graceTokens)] : [])];
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
          effort: config.effort, graceSeconds: config.graceSeconds, maxOutputTokens: config.maxOutputTokens,
          graceTokens: config.graceTokens },
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
    for (const run of runs) console.log(`${run.agent} ${run.model} ${run.difficulty} ${run.seconds}s via ${run.command ?? run.agent}`);
    return;
  }
  const dir = runDirectory(options.out);
  console.log(`Writing ${runs.length} runs to ${path.relative(process.cwd(), dir)}`);
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  for (const run of runs) {
    if (stopping) break;
    console.log(`${new Date().toLocaleTimeString()} ${run.model} ${run.difficulty} ${run.seconds}s`);
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
  if (value("--max-output-tokens")) config.maxOutputTokens = Number(value("--max-output-tokens"));
  if (args.includes("--help")) console.log(usage);
  else if (args[0] === "summarize") {
    if (!args[1]) throw Error(usage);
    const results = writeResults(path.resolve(args[1]), config);
    console.log(markdown(results));
  } else
    await sweep(config, {
      models: value("--models")?.split(","),
      levels: value("--levels")?.split(","),
      dryRun: args.includes("--dry-run"),
      out: value("--out") && path.resolve(value("--out")),
    });
}
