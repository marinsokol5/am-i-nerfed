import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { durationSeconds } from "./duration.js";
import {
  codexEnvironment,
  codexEvidence,
  codexSessionFile,
  latestTokenUsage,
} from "./codex-context.js";
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

// --no-system-prompt replaces each client's built-in system prompt with this
// line. Codex rejects empty instructions, so both clients get the same text.
export const MINIMAL_SYSTEM_PROMPT = "Follow the user's instructions.";

// Keep in sync with skills/am-i-nerfed/SKILL.md (## Rules, ## Assessment);
// only the CLI-specific parts may differ. See AGENTS.md. A token budget
// replaces the time wording; its seconds remain a safety limit.
export function examPrompt({
  seconds = 120,
  difficulty = "medium",
  maxOutputTokens,
} = {}) {
  const tokens = Boolean(maxOutputTokens);
  return `## Rules

${
  tokens
    ? `- You have a budget of ${maxOutputTokens} output tokens, including reasoning, to complete, as well as you can, the six ${difficulty} tasks. Every command response shows \`outputTokens\` used so far; check \`./assessment budget\` after every reasoning pass. A safety limit also stops the session after ${seconds} seconds.`
    : `- You have limited ${seconds} seconds to complete, as well as you can, the six ${difficulty} tasks; the timer started when this session launched and is exposed to you at any moment through \`./assessment budget\`.`
}
- Solve by reasoning only -> no code calculations, browsing, file inspection, prior answers, outside models or delegation. Only the assessment commands below are permitted for retrieving questions, answering and checking ${tokens ? "your budget" : "time"}.
- No correctness feedback is returned while an assessment is active.
- It's highly recommended to attempt all tasks before spending the remaining ${tokens ? "budget" : "time"} on refinements. Use short reasoning passes and partial answers to avoid losing work. Partially correct answers influence final score, so saving something early is worth it.
- ${
    tokens
      ? "There is no reward for finishing the assessment early or for stopping work with budget left. Saved answers are kept; being mid-thought when the budget runs out costs nothing."
      : "There is no reward for finishing the assessment early or for stopping work with the timer still ticking. Saved answers are kept; being mid-thought when time runs out costs nothing."
  }
- ${
    tokens
      ? "Do not write a summary of your answers; it spends budget and earns nothing."
      : "Do not write a summary of your answers before the deadline; it spends time and earns nothing."
  }
- Run one command at a time, exactly as shown, without shell wrappers, pipelines or other syntax.

## Assessment

1. Start the assessment -> \`./assessment start\`. Call it once, immediately, and retain the returned task IDs (<TASK-ID>).
2. Retrieve individual task and see currently submitted answer -> \`./assessment question --task <TASK-ID>\`, or all tasks at once -> \`./assessment questions\`. Answer in the shape of \`response\`; each value is a JSON type (boolean, integer, string) or a name defined in \`types\`.
3. Submit a new answer or revise existing -> \`./assessment answer --task <TASK-ID> --json '<JSON>'\`. Partial JSON objects merge recursively, omitted fields preserve prior work.
${
  tokens
    ? "4. Check your remaining budget at any moment through `./assessment budget`; every other command response also shows `outputTokens`."
    : "4. You can check your remaining time at any moment through `./assessment budget`."
}
${
  tokens
    ? "5. Do not call finish or end your turn before your budget is spent. Once every task has an answer, re-check the answer you are least sure of and save any correction, then move to the next least certain one. Keep reasoning until your budget runs out; do not check the budget repeatedly without working."
    : "5. Do not call finish or end your turn before the deadline. Once every task has an answer, re-check the answer you are least sure of and save any correction, then move to the next least certain one. Keep reasoning until the timer runs out; do not wait or poll the timer without working."
}
${
  tokens
    ? "6. Once your output passes the budget, your saved answers are graded and later answers/revisions are rejected, so end your turn. Ending your turn also ends the assessment."
    : "6. At the deadline your process is stopped and your saved answers are graded; late answers/revisions are rejected. Ending your turn also ends the assessment."
}
`;
}

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
      "--include-partial-messages",
      "--verbose",
      "--tools",
      "Bash",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--allowedTools",
      "Bash(./assessment *)",
      ...(opts.systemPrompt === "none"
        ? ["--system-prompt", MINIMAL_SYSTEM_PROMPT]
        : []),
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
    ...(opts.systemPrompt === "none"
      ? { model_instructions_file: opts.instructionsFile }
      : {}),
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
// AM_I_NERFED_CLAUDE_COMMAND / AM_I_NERFED_CODEX_COMMAND replace the client
// executable, for example "am run claude-work"; words are split on whitespace.
export function clientCommand(agent, source = process.env) {
  const custom = source[`AM_I_NERFED_${agent.toUpperCase()}_COMMAND`]?.trim();
  return custom ? custom.split(/\s+/) : [agent];
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
      /^(?:easy|medium|hard)-[1-6]$/.test(tokens[3]) &&
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
  if (action === "status")
    return tokens.length === 0 || (tokens.length === 1 && tokens[0] === "--verbose");
  if (["start", "questions", "budget", "timer", "finish"].includes(action))
    return tokens.length === 0;
  if (!["question", "answer"].includes(action)) return false;
  if (
    tokens[0] !== "--task" ||
    !/^(?:easy|medium|hard)-[1-6]$/.test(tokens[1] ?? "")
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
// Exact input and cache tokens of every streamed Claude response. Output is
// exact for finished responses and estimated for one cut off by a stop.
function streamUsage(responses, estimatedOutput, estimatedReasoning, exact) {
  if (!responses.size) return null;
  const sum = (field) =>
    [...responses.values()].reduce(
      (total, usage) => total + (Number(usage[field]) || 0),
      0,
    );
  return {
    responses: responses.size,
    input_tokens: sum("input_tokens"),
    cache_creation_input_tokens: sum("cache_creation_input_tokens"),
    cache_read_input_tokens: sum("cache_read_input_tokens"),
    estimated_output_tokens: estimatedOutput,
    estimated_reasoning_tokens: estimatedReasoning,
    exact,
  };
}
export async function supervise(
  executable,
  args,
  {
    cwd,
    env,
    prompt,
    deadline,
    onEvent,
    isFinished,
    startupMs = 90000,
    graceMs = 0,
    transcript,
    maxOutputTokens,
    graceTokens = 0,
    nativeOutputTokens,
    onOutputTokens,
  },
) {
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const transcriptFd = transcript ? fs.openSync(transcript, "w", 0o600) : null;
  let reason = null,
    failure = null,
    buffer = "",
    usage = null,
    terminal = false,
    threadId = null,
    killTimer,
    graceTimer,
    stoppedAt;
  const observedModels = new Set(),
    observedEfforts = new Set(),
    started = Date.now();
  // Claude streams each response's input and cache tokens exactly. Partial
  // messages report each finished response's exact output; the response in
  // progress is estimated from thinking progress and streamed characters.
  const responses = new Map(),
    finished = new Map();
  let thinkingEstimate = 0,
    thinkingChars = 0,
    visibleChars = 0,
    current = null,
    outputTokens = null,
    responseStart = 0,
    budgetBase = null,
    usedAtClose = null,
    nextBudgetCheck = 0;
  const thinkingInProgress = () =>
    Math.max(thinkingEstimate - current.thinking, current.thinkingChars / 4);
  const finishedTotal = (field) =>
    [...finished.values()].reduce((total, counts) => total + counts[field], 0);
  const estimatedOutput = () => {
    if (finished.size || current)
      return (
        finishedTotal("output") +
        (current
          ? Math.round(thinkingInProgress() + current.visibleChars / 3)
          : 0)
      );
    // Without partial messages, only whole blocks are seen.
    return Math.max(
      [...responses.values()].reduce(
        (total, usage) => total + (Number(usage.output_tokens) || 0),
        0,
      ),
      Math.round(Math.max(thinkingEstimate, thinkingChars / 4) + visibleChars / 4),
    );
  };
  const estimatedReasoning = () =>
    finished.size || current
      ? finishedTotal("thinking") + (current ? Math.round(thinkingInProgress()) : 0)
      : Math.round(Math.max(thinkingEstimate, thinkingChars / 4));
  const firstDeadline = deadline();
  const monotonicEnd = firstDeadline
    ? performance.now() + Math.max(0, firstDeadline - Date.now())
    : Infinity;
  // A token budget is spent once a response starts over it: that response's
  // answers still count, as with Codex, whose count arrives after a response
  // has run its commands. Claude's start-of-response count stands in for it;
  // its live estimate only shows the usage. A closed run may then use
  // graceTokens more output to end its turn.
  const checkBudget = () => {
    const used = nativeOutputTokens ? nativeOutputTokens(threadId) : estimatedOutput();
    if (used == null) return;
    const before = !nativeOutputTokens && (finished.size || current) ? responseStart : used;
    if (used !== outputTokens || before !== budgetBase) onOutputTokens?.({ used, before });
    outputTokens = used;
    budgetBase = before;
    if (!reason && before >= maxOutputTokens) {
      usedAtClose = used;
      stop("budget");
    }
    if (reason === "budget" && used >= usedAtClose + graceTokens) kill();
  };
  const kill = () => {
    if (killTimer) return;
    signalGroup(child, "SIGTERM");
    killTimer = setTimeout(() => signalGroup(child, "SIGKILL"), 200);
  };
  // A closed run may let the client end its turn for graceMs, and within a
  // token budget for graceTokens more output, so it reports exact usage.
  // Answers after the deadline or a spent budget are already rejected.
  const stop = (why) => {
    if (reason) return;
    reason = why;
    stoppedAt = Date.now();
    if (graceMs > 0 && ["finished", "deadline", "budget"].includes(why) && !terminal)
      graceTimer = setTimeout(kill, graceMs);
    else kill();
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
    if (maxOutputTokens && !killTimer && performance.now() >= nextBudgetCheck) {
      nextBudgetCheck = performance.now() + 500;
      checkBudget();
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
      if (transcriptFd !== null) fs.writeSync(transcriptFd, line + "\n");
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
      if (e.type === "system" && e.subtype === "thinking_tokens")
        thinkingEstimate += Number(e.estimated_tokens_delta) || 0;
      const streamed = e.type === "stream_event" ? e.event : null;
      if (streamed?.type === "message_start") {
        current = { id: streamed.message?.id, thinking: thinkingEstimate, thinkingChars: 0, visibleChars: 0 };
        responseStart = finishedTotal("output");
        if (maxOutputTokens && !killTimer) checkBudget();
        if (typeof streamed.message?.model === "string")
          observedModels.add(streamed.message.model);
      } else if (streamed?.type === "content_block_delta" && current) {
        const delta = streamed.delta ?? {};
        if (delta.type === "thinking_delta")
          current.thinkingChars += String(delta.thinking ?? "").length;
        else
          current.visibleChars += String(delta.text ?? delta.partial_json ?? "").length;
      } else if (streamed?.type === "message_delta" && current) {
        const n = Number(streamed.usage?.output_tokens);
        if (Number.isFinite(n)) {
          finished.set(current.id ?? finished.size, {
            output: n,
            thinking:
              Number(streamed.usage.output_tokens_details?.thinking_tokens) || 0,
          });
          current = null;
        }
      }
      if (e.type === "assistant") {
        if (e.message?.id && e.message.usage)
          responses.set(e.message.id, e.message.usage);
        for (const block of e.message?.content ?? []) {
          if (block.type === "thinking")
            thinkingChars += String(block.thinking ?? "").length;
          else if (block.type === "text")
            visibleChars += String(block.text ?? "").length;
          else if (block.type === "tool_use")
            visibleChars += JSON.stringify(block.input ?? {}).length;
        }
      }
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
        // A client that reports within its grace period has nothing left to do.
        if (graceTimer) {
          clearTimeout(graceTimer);
          kill();
        }
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
  clearTimeout(graceTimer);
  if (transcriptFd !== null) {
    if (buffer) fs.writeSync(transcriptFd, buffer);
    fs.closeSync(transcriptFd);
  }
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
    streamUsage: streamUsage(
      responses,
      estimatedOutput(),
      estimatedReasoning(),
      finished.size > 0 && !current,
    ),
    outputTokensSeen: maxOutputTokens ? outputTokens : null,
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
  const { agent, model, effort } = options;
  if (!["codex", "claude"].includes(agent))
    throw Error("Choose --agent codex or --agent claude");
  if (typeof model !== "string" || !model || model.length > 200)
    throw Error("Supply --model explicitly");
  if (typeof effort !== "string" || !effort)
    throw Error("Supply --effort explicitly");
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
  const systemPrompt = options.systemPrompt ?? "native";
  if (!["native", "none"].includes(systemPrompt))
    throw Error("Invalid system prompt mode");
  const seconds = durationSeconds(
    options.seconds ?? (options.maxOutputTokens ? 1800 : 120),
  );
  const graceSeconds = options.graceSeconds ?? (options.maxOutputTokens ? 30 : 0);
  const maxOutputTokens = options.maxOutputTokens;
  if (
    maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)
  )
    throw Error("--max-output-tokens must be a positive integer");
  const graceTokens = maxOutputTokens ? (options.graceTokens ?? 1000) : 0;
  if (!Number.isSafeInteger(graceTokens) || graceTokens < 0)
    throw Error("--grace-tokens must be a non-negative integer");
  if (!Number.isSafeInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 300)
    throw Error("--grace-seconds must be an integer from 0 to 300");
  const [executable, ...prefix] = clientCommand(agent);
  const version = spawnSync(executable, [...prefix, "--version"], {
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
    runFile = path.join(work, "run.json"),
    calls = path.join(work, "calls.jsonl"),
    budgetFile = maxOutputTokens ? path.join(work, "budget.json") : null;
  const settings = {
    ...options,
    seconds,
    agent,
    model,
    effort,
    systemPrompt,
    provider: agent === "codex" ? "openai" : "anthropic",
  };
  const instructionsFile = path.join(work, "system-prompt.md");
  if (systemPrompt === "none")
    fs.writeFileSync(instructionsFile, MINIMAL_SYSTEM_PROMPT, { mode: 0o600 });
  const launchedAt = Date.now();
  writeJSON(config, {
    state,
    events,
    options: settings,
    startedAt: launchedAt,
    calls,
    budget: budgetFile && { file: budgetFile, limit: maxOutputTokens },
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
  const prompt = examPrompt({ ...options, seconds });
  const deadline = () => launchedAt + seconds * 1000;
  let execution,
    seenEvents = 0;
  try {
    const isFinished = () => {
      try {
        const lines = fs.readFileSync(events, "utf8").trim().split("\n");
        if (lines.length > seenEvents) {
          const last = JSON.parse(lines.at(-1));
          if (options.verbose)
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
      executable,
      [...prefix, ...nativeCommand(agent, { ...settings, work, state, instructionsFile })],
      {
        cwd: work,
        env: childEnv,
        prompt,
        deadline,
        isFinished,
        graceMs: graceSeconds * 1000,
        transcript: options.transcript,
        maxOutputTokens,
        graceTokens,
        nativeOutputTokens:
          agent === "codex"
            ? (threadId) =>
                latestTokenUsage(
                  codexSessionFile(childEnv.CODEX_HOME, threadId, launchedAt),
                )?.output_tokens ?? null
            : undefined,
        onOutputTokens:
          budgetFile &&
          (({ used, before }) =>
            writeJSON(budgetFile, { used, before, limit: maxOutputTokens })),
      },
    );
    execution.clientVersion = version.stdout.trim();
    execution.graceSeconds = graceSeconds;
    execution.maxOutputTokens = maxOutputTokens ?? null;
    execution.graceTokens = maxOutputTokens ? graceTokens : null;
    // How often the solver ran each assessment command, budget checks included.
    execution.commandCounts = {};
    if (fs.existsSync(calls))
      for (const line of fs.readFileSync(calls, "utf8").split("\n").filter(Boolean)) {
        const { action } = JSON.parse(line);
        execution.commandCounts[action] = (execution.commandCounts[action] ?? 0) + 1;
      }
    if (agent === "codex") {
      execution.nativeEvidence = codexEvidence(
        childEnv.CODEX_HOME,
        execution.threadId,
        launchedAt,
      );
      // The native session log is richer than the client's event stream.
      const session = codexSessionFile(
        childEnv.CODEX_HOME,
        execution.threadId,
        launchedAt,
      );
      if (options.transcript && session) {
        fs.copyFileSync(session, options.transcript);
        fs.chmodSync(options.transcript, 0o600);
      }
      if (execution.nativeEvidence?.instructionFileMessages)
        execution.failure =
          "Personal or project instruction files were loaded into the clean assessment";
      if (execution.nativeEvidence?.efforts.some((value) => value !== effort))
        execution.failure =
          "Native session recorded a different reasoning effort";
      if (execution.nativeEvidence?.models.some((value) => value !== model))
        execution.failure = "Native session recorded a different model";
      const base = execution.nativeEvidence?.baseInstructions;
      if (
        base != null &&
        (systemPrompt === "none") !== (base === MINIMAL_SYSTEM_PROMPT)
      )
        execution.failure =
          "Native session used a different system prompt than requested";
    }
    if (execution.observedEfforts.some((value) => value !== effort))
      execution.failure = "Client reported a different reasoning effort";
    // Claude Code can silently switch to another model, for example after a
    // safety classifier stops a response; that run measures a different model.
    // A dated snapshot of the requested alias is the same model.
    const sameModel = (value) => value === model || new RegExp(`^${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{8}$`).test(value);
    if (agent === "claude" && !execution.observedModels.every(sameModel))
      execution.failure = "Client switched to a different model";
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
