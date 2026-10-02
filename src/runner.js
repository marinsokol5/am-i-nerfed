import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { durationSeconds } from "./duration.js";
import { codexEnvironment, codexEvidence } from "./codex-context.js";
import { spawn, spawnSync } from "node:child_process";
import {
  withLock,
  active,
  privateDirectory,
  writeJSON,
  readJSON,
} from "./storage.js";
import {
  prepareBank,
  startAssessment,
  assessmentAction,
  annotateAssessment,
} from "./assessment.js";

export const EXAM_INSTRUCTIONS = `Take this private reasoning assessment yourself. Only the supplied assessment commands may be used. Do not calculate with code, browse, read files, inspect the transport, consult prior answers or delegate. Retrieve each task individually. Save partial answers as soon as useful, then continue or revise; omitted fields preserve earlier work and null clears a field. All five tasks count equally. Clock feedback arrives with every command. If you have answers for all five tasks with time remaining, feel free to challenge your assumptions or double-check your answers. You do not need to stop before time runs out. You may finish early when satisfied; ending your turn also ends the assessment. There are no reminders or second chances. Only saved answers count; no correctness feedback is available before closing the run.`;

export function nativeCommand(agent, opts) {
  if (agent === "claude")
    return [
      "-p",
      "--model",
      opts.model,
      "--effort",
      opts.effort,
      "--safe-mode",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--no-chrome",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "Bash",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--allowedTools",
      "Bash(./assessment *)",
    ];
  if (agent !== "codex") throw Error("Choose agent codex or claude");
  const settings = {
    model_reasoning_effort: opts.effort,
    approval_policy: "never",
    project_doc_max_bytes: 0,
    developer_instructions: "",
    "features.memories": false,
    "features.hooks": false,
    "features.apps": false,
    "features.plugins": false,
    "features.multi_agent": false,
    "features.multi_agent_v2": false,
    "features.skip_host_skill_discovery": true,
    "skills.max_context_tokens": 1,
    "features.browser_use": false,
    "features.in_app_browser": false,
    "features.computer_use": false,
    "features.image_generation": false,
    "features.skill_search": false,
    "features.workspace_dependencies": false,
    "features.view_image": false,
    web_search: "disabled",
    "features.shell_snapshot": false,
  };
  return [
    "--no-daemon",
    "exec",
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--strict-config",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--add-dir",
    opts.state,
    "-C",
    opts.work,
    "-m",
    opts.model,
    ...Object.entries(settings).flatMap(([key, value]) => [
      "-c",
      `${key}=${JSON.stringify(value)}`,
    ]),
    "-",
  ];
}
export function cleanEnvironment(agent, source = process.env) {
  const keep = [
    "HOME",
    "PATH",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "TERM",
    agent === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR",
  ];
  return {
    ...Object.fromEntries(
      keep.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
    ),
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  };
}
export function permittedCommand(command) {
  // Accept the quoted arguments generated for transport; never accept shell
  // evaluation, redirection, command chains or unrelated commands.
  if (typeof command !== "string" || command.includes("\0")) return false;
  const tokens = [];
  let token = "",
    quote = null,
    started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else token += c;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (
        c === "\\" &&
        i + 1 < command.length &&
        ['"', "\\", "$", "`"].includes(command[i + 1])
      )
        token += command[++i];
      else if (c === "$" || c === "`") return false;
      else token += c;
      started = true;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (c === "\\") {
      if (i + 1 >= command.length || /[\n\r]/.test(command[i + 1]))
        return false;
      token += command[++i];
      started = true;
      continue;
    }
    if (/[\n\r]/.test(c)) return false;
    if (/\s/.test(c)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    if (/[;&|<>$`\\(){}]/.test(c)) return false;
    token += c;
    started = true;
  }
  // A missing closing quote in the final literal answer argument is a shell
  // syntax error, not an extra command. Let the shell report it so the solver
  // can correct its transport syntax within the original time allowance.
  if (
    quote &&
    !(
      tokens.length === 5 &&
      tokens[0] === "./assessment" &&
      tokens[1] === "answer" &&
      tokens[2] === "--task" &&
      /^(easy|medium|hard)-[1-5]$/.test(tokens[3]) &&
      tokens[4] === "--json"
    )
  )
    return false;
  if (started) tokens.push(token);
  if (
    tokens.length === 3 &&
    /^(?:\/(?:bin|usr\/bin)\/)?(?:bash|zsh|sh)$/.test(tokens[0]) &&
    ["-lc", "-c"].includes(tokens[1])
  )
    return permittedCommand(tokens[2]);
  if (tokens.shift() !== "./assessment") return false;
  const action = tokens.shift();
  if (["start", "status", "finish"].includes(action))
    return tokens.length === 0;
  if (!["question", "answer"].includes(action)) return false;
  if (
    tokens[0] !== "--task" ||
    !/^(easy|medium|hard)-[1-5]$/.test(tokens[1] ?? "")
  )
    return false;
  if (action === "question") return tokens.length === 2;
  if (tokens.length !== 4 || tokens[2] !== "--json") return false;
  // Payload validation belongs to the transport. Malformed JSON is a
  // recoverable answer error, not evidence of a forbidden solver command.
  return true;
}

// Exported for an OS-level test using a fake client and child process, without
// paying for a model call. Both the parent and its descendants are terminated.
export function signalGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
}
export async function supervise(
  executable,
  args,
  { cwd, env, prompt, deadline, onEvent, isFinished, startupMs = 90000 },
) {
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let reason = null,
    failure = null,
    buffer = "",
    usage = null,
    terminal = false,
    threadId = null,
    killTimer,
    stoppedAt;
  const observedModels = new Set(),
    observedEfforts = new Set(),
    started = Date.now();
  const firstDeadline = deadline();
  const monotonicEnd = firstDeadline
    ? performance.now() + Math.max(0, firstDeadline - Date.now())
    : Infinity;
  const stop = (why) => {
    if (reason) return;
    reason = why;
    stoppedAt = Date.now();
    signalGroup(child, "SIGTERM");
    killTimer = setTimeout(() => signalGroup(child, "SIGKILL"), 200);
  };
  const interrupt = () => stop("cancelled");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const watch = setInterval(() => {
    const end = deadline();
    if (isFinished?.()) stop("finished");
    else if (performance.now() >= monotonicEnd || (end && Date.now() >= end))
      stop("deadline");
    else if (!end && Date.now() - started >= startupMs) {
      failure = "Assessment did not start";
      stop("failed");
    }
  }, 25);
  child.stderr.resume();
  child.once("exit", (code) => {
    if (code !== 0 && !reason) {
      failure = "Client exited unexpectedly";
      stop("failed");
    }
  });
  child.stdout.on("data", (b) => {
    buffer += b.toString();
    if (buffer.length > 8 * 1024 * 1024) {
      failure = "Oversized client event";
      stop("failed");
      buffer = "";
      return;
    }
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === "thread.started") threadId = e.thread_id;
      if (typeof e.model === "string") observedModels.add(e.model);
      if (typeof e.message?.model === "string")
        observedModels.add(e.message.model);
      if (typeof e.effort === "string") observedEfforts.add(e.effort);
      const calls = [];
      if (e.item?.type === "command_execution") calls.push(e.item.command);
      if (e.type === "assistant")
        for (const block of e.message?.content ?? [])
          if (block.type === "tool_use") {
            if (block.name !== "Bash") calls.push(null);
            else calls.push(block.input?.command);
          }
      if (
        e.item &&
        ["mcp_tool_call", "web_search", "file_change"].includes(e.item.type)
      )
        calls.push(null);
      if (calls.some((c) => !permittedCommand(c))) {
        failure = "Disallowed solver tool or shell command";
        stop("failed");
      }
      if (
        e.type === "error" ||
        e.type === "turn.failed" ||
        e.is_error ||
        e.error ||
        e.subtype === "permission_denied" ||
        e.permission_denials?.length
      ) {
        if (!reason) {
          failure = "Client or permission error";
          stop("failed");
        }
      }
      if (e.type === "turn.completed" || (e.type === "result" && !e.is_error)) {
        terminal = true;
        usage = e.usage ?? null;
        stop("finished");
      }
      onEvent?.(e);
    }
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  const result = await new Promise((resolve) => {
    child.on("error", (error) => {
      failure = error.message;
      resolve({ exitCode: null });
    });
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  clearInterval(watch);
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (!reason) {
    reason = "failed";
    failure ??= "Client exited without completing its turn";
  }
  // Always kill a remaining process group, including when the leader exited.
  if (killTimer) {
    await new Promise((r) => setTimeout(r, 210));
    clearTimeout(killTimer);
  }
  let cleanupFailure = null;
  try {
    signalGroup(child, "SIGKILL");
  } catch (error) {
    // The leader has closed and the scheduled cutoff has already run. Keep
    // the saved assessment and timing evidence even if final cleanup fails.
    cleanupFailure = error.message;
  }
  if (reason === "cancelled") failure = "Cancelled by user";
  return {
    ...result,
    reason,
    failure,
    cleanupFailure,
    usage,
    terminal,
    threadId,
    stoppedAt: stoppedAt ?? Date.now(),
    observedModels: [...observedModels],
    observedEfforts: [...observedEfforts],
    wallSeconds: (Date.now() - started) / 1000,
  };
}

export async function runAssessment(options) {
  if (process.platform === "win32")
    throw Error(
      "The supervised runner currently requires macOS or Linux; the portable skill remains available",
    );
  const { agent, model } = options,
    effort = options.effort ?? "medium";
  if (!["codex", "claude"].includes(agent))
    throw Error("Choose --agent codex or --agent claude");
  if (typeof model !== "string" || !model || model.length > 200)
    throw Error("Supply --model explicitly");
  if (
    ![
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
      "minimal",
      "none",
    ].includes(effort)
  )
    throw Error("Invalid reasoning effort");
  if (!["easy", "medium", "hard"].includes(options.difficulty ?? "medium"))
    throw Error("Invalid difficulty");
  const seconds = durationSeconds(options.seconds);
  const version = spawnSync(agent, ["--version"], {
    encoding: "utf8",
    timeout: 10000,
    env: cleanEnvironment(agent),
  });
  if (version.status !== 0)
    throw Error(
      `${agent} is not available; install and sign in to that CLI first`,
    );
  const state = withLock((root) => {
    prepareBank(active(root));
    return root;
  });
  const childEnv =
    agent === "codex"
      ? codexEnvironment(state, cleanEnvironment(agent))
      : cleanEnvironment(agent);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-run-"));
  privateDirectory(work);
  const events = path.join(work, "events.jsonl"),
    config = path.join(work, "transport.json"),
    runFile = path.join(work, "run.json");
  const settings = {
    ...options,
    seconds,
    agent,
    model,
    effort,
    provider: agent === "codex" ? "openai" : "anthropic",
  };
  const launchedAt = Date.now();
  writeJSON(config, {
    state,
    events,
    options: settings,
    startedAt: launchedAt,
  });
  const moduleURL = new URL("./runner-transport.js", import.meta.url).href;
  const transportSource = `import {transport} from ${JSON.stringify(moduleURL)}; try { transport(${JSON.stringify(config)},process.argv.slice(1)); } catch(e) { console.error(e.message); process.exitCode=1; }`;
  fs.writeFileSync(
    path.join(work, "assessment"),
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nconst result=spawnSync(process.execPath,['--input-type=module','-e',${JSON.stringify(transportSource)},...process.argv.slice(2)],{detached:true,stdio:'inherit'});process.exit(result.status??1);\n`,
    { mode: 0o700 },
  );
  // .mjs package scope makes the extensionless executable unambiguously ESM.
  fs.writeFileSync(path.join(work, "package.json"), '{"type":"module"}', {
    mode: 0o600,
  });
  const prompt = `${EXAM_INSTRUCTIONS}\nYou have ${options.seconds ?? 120} seconds TOTAL for five ${options.difficulty ?? "medium"} tasks, measured from client launch. Call ./assessment start immediately to obtain the task IDs and remaining time.\nCommands:\n./assessment start\n./assessment question --task TASK_ID\n./assessment answer --task TASK_ID --json '{"knowledge":{}}'\n./assessment status\n./assessment finish\nUse each question's actual answer schema. Run one command at a time, exactly as above, without shell wrappers, pipelines or other syntax. Start once and retain the task IDs returned. Your process will be stopped at the deadline.\n`;
  const deadline = () => launchedAt + (options.seconds ?? 120) * 1000;
  let execution,
    seenEvents = 0;
  try {
    const isFinished = () => {
      try {
        const lines = fs.readFileSync(events, "utf8").trim().split("\n");
        if (lines.length > seenEvents) {
          const last = JSON.parse(lines.at(-1));
          process.stderr.write(
            `${last.action}: ${last.clock.remainingSeconds}s remaining\n`,
          );
          seenEvents = lines.length;
        }
        const last = lines.at(-1);
        return ["finished", "expired"].includes(JSON.parse(last).status);
      } catch {
        return false;
      }
    };
    execution = await supervise(
      agent,
      nativeCommand(agent, { ...settings, work, state }),
      { cwd: work, env: childEnv, prompt, deadline, isFinished },
    );
    execution.clientVersion = version.stdout.trim();
    if (agent === "codex") {
      execution.nativeEvidence = codexEvidence(
        childEnv.CODEX_HOME,
        execution.threadId,
        launchedAt,
      );
      if (execution.nativeEvidence?.instructionFileMessages)
        execution.failure =
          "Personal or project instruction files were loaded into the clean assessment";
      if (execution.nativeEvidence?.efforts.some((value) => value !== effort))
        execution.failure =
          "Native session recorded a different reasoning effort";
      if (execution.nativeEvidence?.models.some((value) => value !== model))
        execution.failure = "Native session recorded a different model";
    }
    if (execution.observedEfforts.some((value) => value !== effort))
      execution.failure = "Client reported a different reasoning effort";
    if (!fs.existsSync(runFile)) {
      execution.failure ??= "Client ended before starting an assessment";
      return withLock((root) => {
        const current = active(root),
          failed = startAssessment(
            current,
            { ...settings, invocation: "cli" },
            launchedAt,
          );
        return annotateAssessment(current, failed.runId, {
          ...execution,
          assessmentStarted: false,
        });
      });
    }
    const runId = readJSON(runFile).runId;
    // Short transport operations may be releasing their lock after interruption.
    let result;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        result = withLock((root) => {
          const current = active(root);
          assessmentAction(
            current,
            "finish",
            { runId },
            () => execution.stoppedAt,
          );
          return annotateAssessment(current, runId, execution);
        });
        break;
      } catch (e) {
        if (!e.message.includes("Another am-i-nerfed") || attempt === 19)
          throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    return result;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
