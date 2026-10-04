import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  supervise,
  nativeCommand,
  cleanEnvironment,
  permittedCommand,
  runAssessment,
  MINIMAL_SYSTEM_PROMPT,
  clientCommand,
} from "../src/runner.js";
import { listHistory } from "../src/assessment.js";
import { codexEnvironment, codexEvidence } from "../src/codex-context.js";

test("Codex assessment home excludes personal instructions and shares auth without copying it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-codex-context-"));
  try {
    const source = path.join(root, "source");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "auth.json"), "synthetic-auth-fixture");
    fs.writeFileSync(path.join(source, "AGENTS.md"), "personal marker");
    fs.writeFileSync(path.join(source, "config.toml"), "personal config");
    const env = codexEnvironment(path.join(root, "state"), {
      CODEX_HOME: source,
      PATH: "/bin",
    });
    assert.notEqual(env.CODEX_HOME, source);
    assert.equal(fs.existsSync(path.join(env.CODEX_HOME, "AGENTS.md")), false);
    assert.equal(
      fs.existsSync(path.join(env.CODEX_HOME, "config.toml")),
      false,
    );
    assert.equal(
      fs.lstatSync(path.join(env.CODEX_HOME, "auth.json")).isSymbolicLink(),
      true,
    );
    assert.equal(
      fs.realpathSync(path.join(env.CODEX_HOME, "auth.json")),
      fs.realpathSync(path.join(source, "auth.json")),
    );
    assert.equal(
      codexEnvironment(path.join(root, "state"), { CODEX_HOME: source })
        .CODEX_HOME,
      env.CODEX_HOME,
    );
    assert.equal(codexEvidence(env.CODEX_HOME, null, Date.now()), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transport audit permits literal answers and rejects command execution hidden in shell syntax", () => {
  for (const command of [
    "./assessment start",
    "./assessment question --task medium-1",
    `./assessment answer --task hard-5 --json '{"coordination":{"base":"3/2"}}'`,
    `/bin/zsh -lc './assessment status'`,
    "./assessment status --verbose",
    "./assessment timer",
    "./assessment questions",
    `./assessment answer --task easy-1 --json "{\\"knowledge\\":{}}"`,
    `./assessment answer --task medium-3 --json '{"knowledge":{}}}'`,
    `./assessment answer --task medium-3 --json '{"knowledge":{}}`,
    './assessment answer --task medium-3 --json "nope',
    `./assessment answer --task hard-1 --json nope`,
    `./assessment answer --task easy-1 --json '{\n"knowledge": {}\n}'`,
  ])
    assert.equal(permittedCommand(command), true, command);
  for (const command of [
    "cat private.json",
    "./assessment status; python3 solve.py",
    "./assessment status | cat",
    "./assessment status > dump",
    './assessment answer --task easy-1 --json "$(cat secret)"',
    "./assessment start extra",
    "./assessment question --task hard-6",
    "./assessment status\n./assessment finish",
    "./assessment status --verbose extra",
    "./assessment status --verbose --verbose",
    "./assessment status --verbose; python3 solve.py",
    "./assessment timer extra",
    "./assessment questions --task medium-1",
    "./assessment questions | cat",
    "./assessment timer; python3 solve.py",
    "./assessment status '",
    "./assessment answer --task medium-3 --json 'null' extra '",
    './assessment answer --task medium-3 --json "$(cat secret)',
  ])
    assert.equal(permittedCommand(command), false, command);
});
test("both adapters preserve native system prompts and exclude inherited custom settings", () => {
  for (const agent of ["claude", "codex"]) {
    const command = nativeCommand(agent, {
      model: "test",
      effort: "medium",
      state: "/tmp/state",
      work: "/tmp/work",
    });
    assert.ok(!command.includes("--system-prompt"));
    assert.ok(!command.some((s) => s.includes("model_instructions_file")));
    const env = cleanEnvironment(agent, {
      HOME: "/home/test",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "excluded",
      OPENAI_API_KEY: "excluded",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
    });
    assert.equal(env.HOME, "/home/test");
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
  }
});
test("--no-system-prompt replaces both clients' built-in prompts with the same line", () => {
  const claude = nativeCommand("claude", {
    model: "test", effort: "medium", systemPrompt: "none",
  });
  assert.equal(claude[claude.indexOf("--system-prompt") + 1], MINIMAL_SYSTEM_PROMPT);
  const codex = nativeCommand("codex", {
    model: "test", effort: "medium", state: "/tmp/state", work: "/tmp/work",
    systemPrompt: "none", instructionsFile: "/tmp/work/system-prompt.md",
  });
  assert.ok(
    codex.some((arg) => arg.includes("model_instructions_file") && arg.includes("/tmp/work/system-prompt.md")),
  );
});
test("Codex evidence reports the session's base instructions", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-evidence-")),
    started = Date.now();
  try {
    const dir = path.join(home, "sessions", ...new Date(started).toISOString().slice(0, 10).split("-"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "rollout-test-thread-1.jsonl"),
      JSON.stringify({ type: "session_meta", payload: { base_instructions: { text: MINIMAL_SYSTEM_PROMPT } } }) + "\n",
    );
    assert.equal(codexEvidence(home, "thread-1", started).baseInstructions, MINIMAL_SYSTEM_PROMPT);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
test("watchdog kills a stubborn parent and child process near the deadline", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-watchdog-")),
    pidFile = path.join(dir, "child.pid");
  const script = `const fs=require('node:fs');const cp=require('node:child_process');process.on('SIGTERM',()=>{});const child=cp.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const began = Date.now();
  try {
    const result = await supervise(process.execPath, ["-e", script], {
      cwd: dir,
      env: process.env,
      prompt: "test",
      deadline: () => began + 500,
    });
    assert.equal(result.reason, "deadline");
    assert.ok(Date.now() - began < 2500);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await new Promise((r) => setTimeout(r, 100));
    const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    });
    assert.ok(
      ps.status !== 0 || !ps.stdout.trim() || ps.stdout.trim().startsWith("Z"),
      `Child still running: ${ps.stdout}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("first completed turn ends immediately with no follow-up or renewed process", async () => {
  const result = await supervise(
    process.execPath,
    [
      "-e",
      `console.log(JSON.stringify({type:'turn.completed',usage:{output_tokens:3}}));setInterval(()=>{},1000)`,
    ],
    {
      cwd: os.tmpdir(),
      env: process.env,
      prompt: "one input",
      deadline: () => Date.now() + 10000,
    },
  );
  assert.equal(result.reason, "finished");
  assert.equal(result.usage.output_tokens, 3);
  assert.ok(result.wallSeconds < 2);
});
test("client failure and forbidden tool calls invalidate an attempt", async () => {
  for (const event of [
    { type: "result", is_error: true },
    {
      type: "item.started",
      item: { type: "command_execution", command: "python3 solver.py" },
    },
  ]) {
    const result = await supervise(
      process.execPath,
      [
        "-e",
        `console.log(${JSON.stringify(JSON.stringify(event))});setInterval(()=>{},1000)`,
      ],
      {
        cwd: os.tmpdir(),
        env: process.env,
        prompt: "x",
        deadline: () => Date.now() + 10000,
      },
    );
    assert.equal(result.reason, "failed");
    assert.ok(result.failure);
  }
});
test("post-close cleanup failure preserves completed execution metadata", async (t) => {
  const originalKill = process.kill.bind(process);
  let kills = 0;
  const mock = t.mock.method(process, "kill", (pid, signal) => {
    if (pid < 0 && signal === "SIGKILL" && ++kills === 2) {
      throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    }
    return originalKill(pid, signal);
  });
  try {
    const result = await supervise(process.execPath, ["-e",
      `console.log(JSON.stringify({type:'turn.completed'}));setInterval(()=>{},1000);`,
    ], {
      cwd: os.tmpdir(), env: process.env, prompt: "x",
      deadline: () => Date.now() + 10000,
    });
    assert.equal(result.reason, "finished");
    assert.equal(result.failure, null);
    assert.equal(result.cleanupFailure, "kill EPERM");
    assert.equal(result.terminal, true);
    assert.ok(Number.isFinite(result.stoppedAt));
  } finally {
    mock.mock.restore();
  }
});
test("packaged runner and transport complete a real five-task lifecycle using a fake native client", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-native-")),
    bin = path.join(dir, "bin"),
    state = path.join(dir, "state");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, "project"));
  const executable = fileURLToPath(
    new URL("../bin/am-i-nerfed.js", import.meta.url),
  );
  const init = spawnSync(process.execPath, [executable, "init"], {
    cwd: path.join(dir, "project"),
    env: { ...process.env, AM_I_NERFED_HOME: state },
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  const fake = `#!${process.execPath}\nconst cp=require('node:child_process');if(process.argv.includes('--version')){console.log('fake-cli-test');process.exit(0);}process.stdin.resume();process.stdin.on('end',()=>{const call=(args)=>{const r=cp.spawnSync('./assessment',args,{encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout)};const run=call(['start']);const all=call(['questions']);if(all.tasks.length!==5)throw Error('questions');for(const t of run.tasks){call(['question','--task',t]);call(['answer','--task',t,'--json','null']);}call(['finish']);console.log(JSON.stringify({type:'turn.completed',usage:{output_tokens:1}}));});\n`;
  fs.writeFileSync(path.join(bin, "codex"), fake, { mode: 0o700 });
  const oldPath = process.env.PATH,
    oldState = process.env.AM_I_NERFED_HOME,
    oldCodexHome = process.env.CODEX_HOME;
  const fakeHome = path.join(dir, "native-home");
  fs.mkdirSync(fakeHome);
  fs.writeFileSync(path.join(fakeHome, "auth.json"), "synthetic-auth-fixture");
  process.env.CODEX_HOME = fakeHome;
  process.env.PATH = bin + path.delimiter + oldPath;
  process.env.AM_I_NERFED_HOME = state;
  try {
    const result = await runAssessment({
      agent: "codex",
      model: "fake-model",
      effort: "medium",
      difficulty: "easy",
      seconds: 200,
    });
    assert.equal(result.status, "finished");
    assert.equal(result.result.tasks.length, 5);
    assert.equal(result.result.percent, 0);
    assert.equal(result.invocation, "cli");
    assert.equal(result.clock.durationSeconds, 200);
    assert.equal(result.clockEnforcement, "process-watchdog");
    assert.equal(result.execution.failure, null);
    assert.equal(result.systemPrompt, "native");
    assert.equal(fs.existsSync(path.join(state, ".lock")), false);
    // The second run launches through a wrapper that requires an account argument.
    fs.writeFileSync(
      path.join(bin, "launcher"),
      `#!/bin/sh\n[ "$1" = "acct-x" ] || exit 9\nshift\nexec "${path.join(bin, "codex")}" "$@"\n`,
      { mode: 0o700 },
    );
    process.env.AM_I_NERFED_CODEX_COMMAND = `${path.join(bin, "launcher")} acct-x`;
    const bare = await runAssessment({
      agent: "codex",
      model: "fake-model",
      effort: "medium",
      difficulty: "easy",
      seconds: 200,
      systemPrompt: "none",
    });
    assert.equal(bare.systemPrompt, "none");
    assert.equal(bare.execution.failure, null);
    assert.deepEqual(
      listHistory(state, { systemPrompt: "none" }).runs.map((r) => r.runId),
      [bare.runId],
    );
  } finally {
    process.env.PATH = oldPath;
    delete process.env.AM_I_NERFED_CODEX_COMMAND;
    if (oldState === undefined) delete process.env.AM_I_NERFED_HOME;
    else process.env.AM_I_NERFED_HOME = oldState;
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodexHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("client command overrides split into executable and prefix arguments", () => {
  assert.deepEqual(clientCommand("claude", {}), ["claude"]);
  assert.deepEqual(clientCommand("codex", { AM_I_NERFED_CODEX_COMMAND: "  " }), ["codex"]);
  assert.deepEqual(
    clientCommand("claude", { AM_I_NERFED_CLAUDE_COMMAND: " am  run claude-ms18 " }),
    ["am", "run", "claude-ms18"],
  );
});
