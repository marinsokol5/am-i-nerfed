import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  withLock,
  privateDirectory,
  writeJSON,
  readJSON,
  active,
} from "./storage.js";
import {
  appVersion,
  prepareBank,
  startAssessment,
  assessmentAction,
  listHistory,
} from "./assessment.js";
import { runAssessment } from "./runner.js";
import { installSkill } from "./install.js";

const help = `am-i-nerfed — private reasoning assessments

  init [--agent codex|claude] [--model MODEL] [--effort LEVEL]
  run [--agent codex|claude] [--model MODEL] [--effort LEVEL]
      [--difficulty easy|medium|hard] [--seconds N] [--json]
  start [--difficulty easy|medium|hard] [--seconds N]
        [--invocation skill|manual] [--agent NAME] [--provider NAME]
        [--model MODEL] [--effort LEVEL]
  question --run ID --task ID
  answer --run ID --task ID [--json JSON | --file PATH | stdin]
  status --run ID
  finish --run ID
  history list [--model MODEL] [--effort LEVEL] [--provider NAME]
               [--agent NAME] [--invocation cli|skill|manual]
               [--difficulty LEVEL] [--seconds N] [--version VERSION]
               [--task-version N] [--baseline ID] [--status STATUS] [--json]
  reset --yes
  doctor
  skill install [--yes] [--agent NAME] [--global|--project] [--copy]
  --version

Five tasks per assessment; default medium difficulty and 120 seconds.
run launches a fresh native CLI session with a process watchdog.
start/question/answer/status/finish compose an in-context assessment. They
enforce the answer deadline but cannot stop an independently hosted agent.
Difficulty and reasoning effort are different settings. Unknown metadata
should be omitted. Transport commands return JSON. run/history have --json
for scripts; progress goes to stderr.
`;
function options(args, values = [], booleans = []) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (booleans.includes(key)) {
      out[key] = true;
      continue;
    }
    if (!values.includes(key)) throw Error(`Unknown option: ${key}`);
    if (args[i + 1] === undefined || args[i + 1].startsWith("--"))
      throw Error(`Missing value for ${key}`);
    if (Object.hasOwn(out, key)) throw Error(`Repeated option: ${key}`);
    const value = args[++i];
    if (key !== "--json" && value.length > 300)
      throw Error(`Value too long for ${key}`);
    out[key] = value;
  }
  return out;
}
const print = (value) =>
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
const text = (value) =>
  String(value ?? "unknown").replace(/[\u0000-\u001f\u007f]/g, " ");
function printRun(run) {
  if (run.failure) {
    process.stdout.write(`Measurement failed: ${text(run.failure)}\n`);
    return;
  }
  process.stdout.write(
    `${run.result.percent.toFixed(1)}% correct\n` +
      `${text(run.agent)} · ${text(run.model)} · effort ${text(run.effort)} · ${run.difficulty} tasks · ${run.clock.elapsedSeconds}/${run.clock.durationSeconds}s\n` +
      run.result.tasks
        .map((t) => `${t.family}: ${t.percent.toFixed(1)}%`)
        .join(" · ") +
      "\n" +
      `Am I nerfed ${run.appVersion} · task bank v${run.taskBankVersion} · ${run.invocation}\n`,
  );
}
function printHistory(history) {
  if (!history.runs.length) {
    process.stdout.write("No matching assessments.\n");
    return;
  }
  const rows = [
    [
      "Date (UTC)",
      "Provider",
      "Model",
      "Effort",
      "Invocation",
      "Difficulty",
      "Score",
      "Seconds",
      "App",
      "Bank",
      "Status",
    ],
    ...history.runs.map((r) => [
      r.startedAt.slice(0, 16),
      r.provider,
      r.model,
      r.effort,
      r.invocation,
      r.difficulty,
      r.percent == null ? "—" : `${r.percent.toFixed(1)}%`,
      `${r.elapsedSeconds}/${r.durationSeconds}`,
      r.appVersion,
      `v${r.taskBankVersion}/${r.baselineId.slice(0, 8)}`,
      r.status,
    ]),
  ].map((row) => row.map(text));
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((row) => row[i].length)),
  );
  process.stdout.write(
    rows
      .map((row) =>
        row
          .map((cell, i) => cell.padEnd(widths[i]))
          .join("  ")
          .trimEnd(),
      )
      .join("\n") + "\n",
  );
}
const settingFlags = ["--agent", "--model", "--effort"];
const assessmentFlags = ["--difficulty", "--seconds"];
function settings(opts) {
  return Object.fromEntries(
    Object.entries(opts).map(([k, v]) => [
      k.slice(2),
      k === "--seconds" ? Number(v) : v,
    ]),
  );
}
async function input(opts) {
  if (opts["--json"] !== undefined && opts["--file"])
    throw Error("Choose --json, --file, or stdin");
  let source = opts["--json"];
  if (source === undefined && opts["--file"]) {
    if (fs.statSync(opts["--file"]).size > 1048576)
      throw Error("Answer exceeds 1 MiB");
    source = fs.readFileSync(opts["--file"], "utf8");
  }
  if (source === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 1048576) throw Error("Answer exceeds 1 MiB");
      chunks.push(chunk);
    }
    source = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.byteLength(source) > 1048576) throw Error("Answer exceeds 1 MiB");
  try {
    return JSON.parse(source);
  } catch {
    throw Error("Invalid JSON; no answer was accepted");
  }
}
function readSettings(root) {
  const p = path.join(root, "settings.json");
  return fs.existsSync(p) ? readJSON(p) : {};
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ["help", "--help", "-h"].includes(command)) {
    process.stdout.write(help);
    return;
  }
  if (command === "--version") {
    process.stdout.write(appVersion() + "\n");
    return;
  }
  if (command === "skill") {
    if (rest[0] !== "install") throw Error("Use skill install");
    const opts = options(
      rest.slice(1),
      ["--agent"],
      ["--yes", "--global", "--project", "--copy"],
    );
    if (opts["--agent"]) opts["--agent"] = [opts["--agent"]];
    print({ skill: await installSkill(opts) });
    return;
  }
  if (command === "doctor") {
    options(rest);
    const clients = ["codex", "claude"].map((agent) => {
      const result = spawnSync(agent, ["--version"], {
        encoding: "utf8",
        timeout: 10000,
      });
      return {
        agent,
        available: result.status === 0,
        version: result.status === 0 ? result.stdout.trim() : null,
      };
    });
    print({
      appVersion: appVersion(),
      clients,
      supervisedRunner: process.platform !== "win32",
      note: "No model calls were made. Authentication was not tested.",
    });
    return;
  }
  if (command === "init" || command === "reset") {
    const opts = options(
      rest,
      command === "init" ? settingFlags : [],
      command === "reset" ? ["--yes"] : [],
    );
    if (command === "reset" && !opts["--yes"])
      throw Error(
        "Reset creates a new bank and baseline; use reset --yes. Old history is preserved.",
      );
    const chosen = settings(opts);
    delete chosen.yes;
    if (chosen.agent && !["codex", "claude"].includes(chosen.agent))
      throw Error("Choose agent codex or claude");
    if (command === "init" && process.stdin.isTTY && process.stdout.isTTY) {
      const saved = withLock(readSettings);
      Object.assign(chosen, { ...saved, ...chosen });
      const terminal = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      try {
        if (!chosen.agent)
          chosen.agent = (
            await terminal.question(
              "Default agent (codex/claude, blank to configure later): ",
            )
          ).trim();
        if (chosen.agent && !["codex", "claude"].includes(chosen.agent))
          throw Error("Choose codex or claude");
        if (chosen.agent && !chosen.model)
          chosen.model = (
            await terminal.question("Model ID to measure: ")
          ).trim();
        if (chosen.agent && !chosen.effort)
          chosen.effort =
            (await terminal.question("Reasoning effort [medium]: ")).trim() ||
            "medium";
      } finally {
        terminal.close();
      }
    }
    const result = withLock((root) => {
      const pointer = path.join(root, "current.json");
      let state,
        existing = false;
      if (command === "init" && fs.existsSync(pointer)) {
        state = active(root);
        existing = true;
      } else {
        const baselineId = randomUUID(),
          base = path.join(root, "baselines", baselineId),
          dataset = { seed: randomBytes(32).toString("hex") };
        privateDirectory(base);
        writeJSON(path.join(base, "dataset.json"), dataset, {
          exclusive: true,
        });
        state = { base, current: { baselineId }, dataset };
      }
      const bank = prepareBank(state);
      if (!existing) writeJSON(pointer, state.current);
      if (Object.keys(chosen).length)
        writeJSON(path.join(root, "settings.json"), {
          ...readSettings(root),
          ...chosen,
        });
      return {
        initialized: true,
        existing,
        baselineId: state.current.baselineId,
        taskBankVersion: bank.taskBankVersion,
        tasks: bank.tasks.length,
        difficulties: ["easy", "medium", "hard"],
        defaultDifficulty: "medium",
        defaultSeconds: 120,
        defaults: readSettings(root),
      };
    });
    print(result);
    return;
  }
  if (command === "run") {
    const opts = options(
      rest,
      [...settingFlags, ...assessmentFlags],
      ["--json"],
    );
    const chosen = { ...withLock(readSettings), ...settings(opts) };
    process.stderr.write(
      `Running ${chosen.difficulty ?? "medium"} assessment through ${chosen.agent ?? "unconfigured client"}…\n`,
    );
    const result = await runAssessment(chosen);
    if (opts["--json"]) print(result);
    else printRun(result);
    if (result.failure) process.exitCode = 1;
    return;
  }
  if (command === "start") {
    const opts = options(rest, [
      ...settingFlags,
      ...assessmentFlags,
      "--invocation",
      "--provider",
    ]);
    if (
      opts["--invocation"] &&
      !["skill", "manual"].includes(opts["--invocation"])
    )
      throw Error(
        "Direct start uses skill or manual; use run for a supervised CLI assessment",
      );
    print(withLock((root) => startAssessment(active(root), settings(opts))));
    return;
  }
  if (["question", "answer", "status", "finish"].includes(command)) {
    const opts = options(rest, [
      "--run",
      ...(["question", "answer"].includes(command) ? ["--task"] : []),
      ...(command === "answer" ? ["--json", "--file"] : []),
    ]);
    if (!opts["--run"]) throw Error("Retain the --run ID returned by start");
    if (["question", "answer"].includes(command) && !opts["--task"])
      throw Error("A --task ID is required");
    const patch = command === "answer" ? await input(opts) : undefined;
    const result = withLock((root) =>
      assessmentAction(active(root), command, {
        runId: opts["--run"],
        taskId: opts["--task"],
        patch,
      }),
    );
    print(result);
    if (result.accepted === false) process.exitCode = 1;
    return;
  }
  if (command === "history") {
    const historyArgs = rest[0] === "list" ? rest.slice(1) : rest;
    const map = {
      "--model": "model",
      "--effort": "effort",
      "--provider": "provider",
      "--agent": "agent",
      "--invocation": "invocation",
      "--difficulty": "difficulty",
      "--seconds": "durationSeconds",
      "--version": "appVersion",
      "--task-version": "taskBankVersion",
      "--baseline": "baselineId",
      "--status": "status",
    };
    const opts = options(historyArgs, Object.keys(map), ["--json"]);
    const result = withLock((root) =>
      listHistory(
        root,
        Object.fromEntries(
          Object.entries(opts)
            .filter(([k]) => k !== "--json")
            .map(([k, v]) => [map[k], v]),
        ),
      ),
    );
    if (opts["--json"]) print(result);
    else printHistory(result);
    return;
  }
  throw Error(`Unknown command: ${command}. Use --help.`);
}
