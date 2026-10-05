import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  withLock,
  stateRoot,
  privateDirectory,
  writeJSON,
  active,
} from "./storage.js";
import {
  appVersion,
  prepareBank,
  initializationStatus,
  startAssessment,
  assessmentAction,
  assessmentTimer,
  listHistory,
  destroyHistory,
} from "./assessment.js";
import { clientCommand, runAssessment } from "./runner.js";
import { installSkill } from "./install.js";
import {
  formatRun,
  formatQuestion,
  formatQuestions,
  formatStart,
  formatAnswer,
} from "./output.js";

const help = `am-i-nerfed — private reasoning assessments

  init
  run --agent codex|claude --model MODEL --effort LEVEL
      [--difficulty easy|medium|hard] [--seconds N] [--no-system-prompt]
      [--grace-seconds N] [--max-output-tokens N] [--transcript PATH]
      [--verbose] [--json]
  start [--difficulty easy|medium|hard] [--seconds N]
        [--invocation skill|manual] [--agent NAME] [--provider NAME]
        [--model MODEL] [--effort LEVEL] [--verbose]
  question --run ID --task ID
  questions --run ID
  answer --run ID --task ID [--json JSON | --file PATH | stdin] [--verbose]
  status --run ID [--verbose]
  timer --run ID
  finish --run ID [--verbose]
  history list [--model MODEL] [--effort LEVEL] [--provider NAME]
               [--agent NAME] [--invocation cli|skill|manual]
               [--difficulty LEVEL] [--seconds N] [--version VERSION]
               [--task-version N] [--baseline ID] [--status STATUS]
               [--system-prompt native|none] [--json]
  history destroy --yes
  reset --yes
  doctor [--init]
  skill install [--yes] [--agent NAME] [--global|--project] [--copy]
  --version

Six tasks per assessment; default medium difficulty and 120 seconds.
run launches a fresh native CLI session with a process watchdog.
--grace-seconds lets the client end its turn after the run closes, so it
reports exact token usage; --transcript saves the client's session log.
--max-output-tokens stops the run once the client's output, including
reasoning, exceeds N tokens, checked twice a second.
start/question/answer/status/finish compose an in-context assessment. They
enforce the answer deadline but cannot stop an independently hosted agent.
Difficulty and reasoning effort are different settings. Unknown metadata
should be omitted. Commands return compact JSON; --verbose adds run metadata.
Transport commands return JSON. history has --json for scripts.
AM_I_NERFED_CLAUDE_COMMAND / AM_I_NERFED_CODEX_COMMAND replace the client
command, e.g. AM_I_NERFED_CLAUDE_COMMAND="am run claude-work".
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
// Assessment commands are read by agents: one line, no indentation tokens.
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const text = (value) =>
  String(value ?? "unknown").replace(/[\u0000-\u001f\u007f]/g, " ");
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
      "System",
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
      r.systemPrompt ?? "—",
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
    const opts = options(rest, [], ["--init"]);
    let initialization;
    try {
      initialization = initializationStatus(stateRoot());
    } catch {
      initialization = {
        initialized: false,
        initializationError: "The configured local state directory is unavailable or invalid.",
      };
    }
    if (opts["--init"]) {
      print(initialization.initialized);
      return;
    }
    const clients = ["codex", "claude"].map((agent) => {
      const [executable, ...prefix] = clientCommand(agent);
      const result = spawnSync(executable, [...prefix, "--version"], {
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
      ...initialization,
      clients,
      supervisedRunner: process.platform !== "win32",
      note: "Local state was checked without modification or starting an assessment. No model calls were made. Authentication was not tested.",
    });
    return;
  }
  if (command === "init" || command === "reset") {
    const opts = options(rest, [], command === "reset" ? ["--yes"] : []);
    if (command === "reset" && !opts["--yes"])
      throw Error(
        "Reset creates a new bank and baseline; use reset --yes. Old history is preserved.",
      );
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
      return {
        initialized: true,
        existing,
        baselineId: state.current.baselineId,
        taskBankVersion: bank.taskBankVersion,
        tasks: bank.tasks.length,
        difficulties: ["easy", "medium", "hard"],
        defaultDifficulty: "medium",
        defaultSeconds: 120,
      };
    });
    print(result);
    return;
  }
  if (command === "run") {
    const opts = options(
      rest,
      [
        ...settingFlags,
        ...assessmentFlags,
        "--transcript",
        "--grace-seconds",
        "--max-output-tokens",
      ],
      ["--json", "--verbose", "--no-system-prompt"],
    );
    const verbose = Boolean(opts["--verbose"]);
    const systemPrompt = opts["--no-system-prompt"] ? "none" : "native";
    const transcript = opts["--transcript"]
      ? path.resolve(opts["--transcript"])
      : undefined;
    const number = (flag) =>
      opts[flag] === undefined ? undefined : Number(opts[flag]);
    const graceSeconds = number("--grace-seconds"),
      maxOutputTokens = number("--max-output-tokens");
    for (const flag of [
      "--verbose",
      "--json",
      "--no-system-prompt",
      "--transcript",
      "--grace-seconds",
      "--max-output-tokens",
    ])
      delete opts[flag];
    if (!opts["--agent"] || !opts["--model"] || !opts["--effort"])
      throw Error("run requires --agent, --model and --effort");
    const chosen = {
      ...settings(opts),
      verbose,
      systemPrompt,
      transcript,
      graceSeconds,
      maxOutputTokens,
    };
    if (verbose)
      process.stderr.write(
        `Running ${chosen.difficulty ?? "medium"} assessment through ${chosen.agent}…\n`,
      );
    const result = await runAssessment(chosen);
    print(formatRun(result, { verbose }));
    if (result.failure) process.exitCode = 1;
    return;
  }
  if (command === "start") {
    const opts = options(rest, [
      ...settingFlags,
      ...assessmentFlags,
      "--invocation",
      "--provider",
    ], ["--verbose"]);
    const verbose = Boolean(opts["--verbose"]);
    delete opts["--verbose"];
    if (
      opts["--invocation"] &&
      !["skill", "manual"].includes(opts["--invocation"])
    )
      throw Error(
        "Direct start uses skill or manual; use run for a supervised CLI assessment",
      );
    emit(
      formatStart(
        withLock((root) => startAssessment(active(root), settings(opts))),
        { verbose },
      ),
    );
    return;
  }
  if (["question", "questions", "answer", "status", "finish"].includes(command)) {
    const opts = options(rest, [
      "--run",
      ...(["question", "answer"].includes(command) ? ["--task"] : []),
      ...(command === "answer" ? ["--json", "--file"] : []),
    ], command.startsWith("question") ? [] : ["--verbose"]);
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
    const verbose = Boolean(opts["--verbose"]);
    emit(
      command === "question"
        ? formatQuestion(result, opts["--task"])
        : command === "questions"
          ? formatQuestions(result)
          : command === "answer"
          ? formatAnswer(result, { verbose })
          : formatRun(result, { verbose }),
    );
    if (result.accepted === false) process.exitCode = 1;
    return;
  }
  if (command === "timer") {
    const opts = options(rest, ["--run"]);
    if (!opts["--run"]) throw Error("Retain the --run ID returned by start");
    emit(assessmentTimer(active(stateRoot()), opts["--run"]));
    return;
  }
  if (command === "history" && rest[0] === "destroy") {
    const opts = options(rest.slice(1), [], ["--yes"]);
    if (!opts["--yes"])
      throw Error(
        "history destroy permanently deletes every recorded run; use history destroy --yes. The task bank is kept.",
      );
    print(withLock(destroyHistory));
    return;
  }
  if (command === "history") {
    const historyArgs = rest[0] === "list" ? rest.slice(1) : rest;
    const map = {
      "--model": "model",
      "--effort": "effort",
      "--system-prompt": "systemPrompt",
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
