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
  examPrompt,
} from "../src/runner.js";
import { listHistory } from "../src/assessment.js";
import { codexEnvironment, codexEvidence, codexSessionFile } from "../src/codex-context.js";

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
    "./assessment question --task easy-6",
    "./assessment question --task medium-6",
    "./assessment question --task hard-6",
    `./assessment answer --task easy-6 --json '{"program":"CDF"}'`,
    `./assessment answer --task medium-6 --json '{"program":"ABCDEF"}`,
    `./assessment answer --task hard-6 --json '{"program":"AB"}'`,
    `./assessment answer --task hard-6 --json '{"program":"AB"}`,
    `./assessment answer --task hard-5 --json '{"coordination":{"base":"3/2"}}'`,
    `/bin/zsh -lc './assessment status'`,
    `/opt/homebrew/bin/bash -lc './assessment budget'`,
    `/usr/local/bin/zsh -lc './assessment questions'`,
    `/bin/dash -c './assessment start'`,
    "./assessment status --verbose",
    "./assessment timer",
    "./assessment budget",
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
    "./assessment question --task easy-7",
    "./assessment question --task medium-7",
    "./assessment question --task hard-7",
    `./assessment answer --task easy-7 --json 'null'`,
    `./assessment answer --task medium-7 --json 'null`,
    "./assessment status\n./assessment finish",
    "./assessment status --verbose extra",
    "./assessment status --verbose --verbose",
    "./assessment status --verbose; python3 solve.py",
    "./assessment timer extra",
    "./assessment budget --task medium-1",
    "./assessment questions --task medium-1",
    "./assessment questions | cat",
    "./assessment timer; python3 solve.py",
    "./assessment status '",
    "./assessment answer --task medium-3 --json 'null' extra '",
    './assessment answer --task medium-3 --json "$(cat secret)',
  ])
    assert.equal(permittedCommand(command), false, command);
});
test("CLI and skill retain matching task counts and partial-answer guidance", () => {
  const skill = fs.readFileSync(new URL("../skills/am-i-nerfed/SKILL.md", import.meta.url), "utf8");
  const prompt = examPrompt({ seconds: 300, difficulty: "hard" });
  for (const shared of [
    "to complete, as well as you can, the six",
    "It's highly recommended to attempt all tasks before spending the remaining time on refinements. Use short reasoning passes and partial answers to avoid losing work. Partially correct answers influence final score, so saving something early is worth it.",
    "Partial JSON objects merge recursively, omitted fields preserve prior work.",
    "No correctness feedback is returned while an assessment is active.",
    "Do not write a summary of your answers before the deadline; it spends time and earns nothing.",
  ]) {
    assert.ok(prompt.includes(shared), shared);
    assert.ok(skill.includes(shared), shared);
  }
  assert.match(prompt, /limited 300 seconds/);
  assert.match(prompt, /the six hard tasks/);
  assert.match(skill, /the six <DIFFICULTY> tasks/);
  assert.doesNotMatch(prompt, /all five|five returned|all 5 tasks/);
  assert.doesNotMatch(skill, /all five|five task IDs|all 5 tasks/);
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
test("a grace period lets a client report exact usage after the deadline, then stops it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-grace-"));
  try {
    const transcript = path.join(dir, "transcript.jsonl"),
      input = { command: "./assessment timer" };
    const events = [
      { type: "system", subtype: "thinking_tokens", estimated_tokens_delta: 40 },
      { type: "assistant", message: { id: "m1", usage: { input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 2 },
        content: [{ type: "text", text: "x".repeat(40) }] } },
      { type: "assistant", message: { id: "m1", usage: { input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 2 },
        content: [{ type: "tool_use", name: "Bash", input }] } },
    ];
    const started = Date.now();
    const result = await supervise(process.execPath, ["-e",
      `for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e));` +
      `setTimeout(() => console.log(JSON.stringify({type:'result',usage:{output_tokens:77}})), 600);setInterval(()=>{},1000);`,
    ], {
      cwd: dir, env: process.env, prompt: "x", transcript,
      deadline: () => started + 300, graceMs: 5000,
    });
    assert.equal(result.reason, "deadline");
    assert.ok(result.stoppedAt - started < 600, "The run closes at the deadline, before the client reports");
    assert.equal(result.terminal, true);
    assert.equal(result.usage.output_tokens, 77);
    assert.ok(result.wallSeconds < 3, "A client that reports is stopped without waiting out the grace");
    assert.deepEqual(result.streamUsage, {
      responses: 1, input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 100,
      estimated_output_tokens: Math.round(40 + (40 + JSON.stringify(input).length) / 4),
      estimated_reasoning_tokens: 40, exact: false,
    });
    assert.equal(fs.readFileSync(transcript, "utf8").trim().split("\n").length, 4);
    assert.equal(fs.statSync(transcript).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("partial messages count each finished Claude response exactly and estimate only the one in progress", async () => {
  const response = (id, n) => [
    { type: "stream_event", event: { type: "message_start", message: { id, model: "claude-x", usage: { input_tokens: 2, output_tokens: 1 } } } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "y".repeat(30) } } },
    { type: "assistant", message: { id, usage: { input_tokens: 2, output_tokens: 1 }, content: [{ type: "text", text: "y".repeat(30) }] } },
    ...(n == null ? [] : [{ type: "stream_event", event: { type: "message_delta",
      usage: { output_tokens: n, output_tokens_details: { thinking_tokens: n / 2 } } } }]),
  ];
  const run = (events) => supervise(process.execPath, ["-e",
    `for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e));setInterval(()=>{},1000)`,
  ], { cwd: os.tmpdir(), env: process.env, prompt: "x", deadline: () => Date.now() + 600 });
  const done = await run([...response("m1", 120), ...response("m2", 80)]);
  assert.deepEqual([done.streamUsage.estimated_output_tokens, done.streamUsage.estimated_reasoning_tokens,
    done.streamUsage.exact], [200, 100, true]);
  assert.deepEqual(done.observedModels, ["claude-x"]);
  const [start, ...rest] = response("m2", null);
  const cut = await run([...response("m1", 120), start,
    { type: "system", subtype: "thinking_tokens", estimated_tokens_delta: 50 }, ...rest]);
  assert.deepEqual([cut.streamUsage.estimated_output_tokens, cut.streamUsage.estimated_reasoning_tokens,
    cut.streamUsage.exact], [120 + 50 + 10, 60 + 50, false]);
});
test("a client still working when its grace period ends is stopped", async () => {
  const started = Date.now();
  const result = await supervise(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    cwd: os.tmpdir(), env: process.env, prompt: "x",
    deadline: () => started + 200, graceMs: 400,
  });
  assert.equal(result.reason, "deadline");
  assert.equal(result.terminal, false);
  assert.equal(result.streamUsage, null);
  assert.ok(result.wallSeconds >= 0.55 && result.wallSeconds < 2.5, String(result.wallSeconds));
});
test("an output budget stops a client whose streamed thinking passes it", async () => {
  const seen = [];
  const result = await supervise(process.execPath, ["-e",
    "let n=0;setInterval(()=>console.log(JSON.stringify({type:'system',subtype:'thinking_tokens',estimated_tokens_delta:100,estimated_tokens:n+=100})),100)",
  ], {
    cwd: os.tmpdir(), env: process.env, prompt: "x", deadline: () => Date.now() + 60000,
    graceMs: 30000, maxOutputTokens: 500, onOutputTokens: (used) => seen.push(used),
  });
  assert.equal(result.reason, "budget");
  // Usage is checked twice a second, so a busy machine may see a few more deltas.
  assert.ok(result.outputTokensSeen >= 500 && result.outputTokensSeen < 2000, String(result.outputTokensSeen));
  assert.ok(result.wallSeconds < 5, "Without grace tokens a spent budget stops the client at once");
  assert.ok(seen.length >= 1 && seen.at(-1).used === result.outputTokensSeen);
});
test("a response that starts within the budget keeps its answers; the next one closes the run", async () => {
  const seen = [], started = Date.now();
  const events = (id, n) => [
    { type: "stream_event", event: { type: "message_start", message: { id, usage: { input_tokens: 1, output_tokens: 1 } } } },
    { type: "system", subtype: "thinking_tokens", estimated_tokens_delta: n },
    ...(n > 0 ? [{ type: "stream_event", event: { type: "message_delta", usage: { output_tokens: n } } }] : []),
  ];
  const result = await supervise(process.execPath, ["-e",
    `const say=(es)=>es.forEach((e)=>console.log(JSON.stringify(e)));say(${JSON.stringify(events("m1", 650))});` +
    `setTimeout(()=>say(${JSON.stringify(events("m2", 0))}),900);setInterval(()=>{},1000);`,
  ], {
    cwd: os.tmpdir(), env: process.env, prompt: "x", deadline: () => started + 60000,
    graceMs: 300, maxOutputTokens: 500, onOutputTokens: (counts) => seen.push(counts),
  });
  assert.equal(result.reason, "budget");
  assert.ok(result.stoppedAt - started >= 800, "The run closes when the next response starts");
  assert.ok(seen.some(({ used, before }) => used >= 650 && before === 0), JSON.stringify(seen));
  assert.deepEqual(seen.at(-1), { used: 650, before: 650 });
});
test("a spent budget lets a client use its grace tokens, then stops it", async () => {
  const result = await supervise(process.execPath, ["-e",
    "let n=0;setInterval(()=>console.log(JSON.stringify({type:'system',subtype:'thinking_tokens',estimated_tokens_delta:100,estimated_tokens:n+=100})),100)",
  ], {
    cwd: os.tmpdir(), env: process.env, prompt: "x", deadline: () => Date.now() + 60000,
    graceMs: 30000, maxOutputTokens: 500, graceTokens: 300,
  });
  assert.equal(result.reason, "budget");
  // Grace tokens count from the usage at closing, which a busy machine checks late.
  assert.ok(result.outputTokensSeen >= 800 && result.outputTokensSeen < 2500, String(result.outputTokensSeen));
  assert.ok(result.wallSeconds < 8, String(result.wallSeconds));
});
test("a single response is stopped at twice the budget", async () => {
  const started = Date.now();
  const result = await supervise(process.execPath, ["-e",
    "console.log(JSON.stringify({type:'stream_event',event:{type:'message_start',message:{id:'m1',usage:{input_tokens:1,output_tokens:1}}}}));" +
    "setInterval(()=>console.log(JSON.stringify({type:'system',subtype:'thinking_tokens',estimated_tokens_delta:100})),50)",
  ], {
    cwd: os.tmpdir(), env: process.env, prompt: "x", deadline: () => started + 60000,
    graceMs: 30000, maxOutputTokens: 500, graceTokens: 5000,
  });
  assert.equal(result.reason, "budget");
  assert.ok(result.outputTokensSeen >= 1000, String(result.outputTokensSeen));
  assert.ok(result.wallSeconds < 5, String(result.wallSeconds));
});
test("an output budget uses the native count when the client reports one", async () => {
  const started = Date.now();
  const result = await supervise(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    cwd: os.tmpdir(), env: process.env, prompt: "x", deadline: () => started + 60000,
    maxOutputTokens: 1000, nativeOutputTokens: () => (Date.now() - started > 700 ? 1500 : 200),
  });
  assert.equal(result.reason, "budget");
  assert.equal(result.outputTokensSeen, 1500);
  assert.equal(result.streamUsage, null);
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
test("packaged runner and transport complete six-task lifecycles at every difficulty using a fake native client", async () => {
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
  const fake = `#!${process.execPath}\nconst cp=require('node:child_process');if(process.argv.includes('--version')){console.log('fake-cli-test');process.exit(0);}process.stdin.resume();process.stdin.on('end',()=>{const call=(args)=>{const r=cp.spawnSync('./assessment',args,{encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout)};const run=call(['start']);const all=call(['questions']);if(all.tasks.length!==6 || !run.tasks.includes(run.difficulty+'-6'))throw Error('questions');for(const t of run.tasks){call(['question','--task',t]);call(['answer','--task',t,'--json','null']);}call(['finish']);console.log(JSON.stringify({type:'turn.completed',usage:{output_tokens:1}}));});\n`;
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
    for (const difficulty of ["easy", "medium", "hard"]) {
      const result = await runAssessment({
        agent: "codex",
        model: "fake-model",
        effort: "medium",
        difficulty,
        seconds: 200,
      });
      assert.equal(result.status, "finished");
      assert.equal(result.result.tasks.length, 6);
      assert.equal(result.result.taskWeightPercent, 100 / 6);
      assert.equal(result.result.percent, 0);
      assert.equal(result.invocation, "cli");
      assert.equal(result.clock.durationSeconds, 200);
      assert.equal(result.clockEnforcement, "process-watchdog");
      assert.equal(result.execution.failure, null);
      assert.equal(result.systemPrompt, "native");
      assert.equal(fs.existsSync(path.join(state, ".lock")), false);
    }
    // An additional run launches through a wrapper that requires an account argument.
    fs.writeFileSync(
      path.join(bin, "launcher"),
      `#!/bin/sh\n[ "$1" = "acct-x" ] || exit 9\nshift\nexec "${path.join(bin, "codex")}" "$@"\n`,
      { mode: 0o700 },
    );
    process.env.AM_I_NERFED_CODEX_COMMAND = `${path.join(bin, "launcher")} acct-x`;
    const transcript = path.join(dir, "transcript.jsonl");
    const bare = await runAssessment({
      agent: "codex",
      model: "fake-model",
      effort: "medium",
      difficulty: "hard",
      seconds: 200,
      systemPrompt: "none",
      graceSeconds: 2,
      transcript,
    });
    assert.equal(bare.systemPrompt, "none");
    assert.equal(bare.execution.failure, null);
    assert.equal(bare.execution.graceSeconds, 2);
    assert.match(fs.readFileSync(transcript, "utf8"), /"turn\.completed"/);
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

test("a Codex session log is found under the local date on either side of the UTC date", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-codex-days-"));
  try {
    // A run at 01:00 UTC on 2026-10-06 is still the evening of 2026-10-05 west of UTC.
    const startedAt = Date.parse("2026-10-06T01:00:00Z"), dir = path.join(home, "sessions", "2026", "10", "05");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "rollout-2026-10-05T18-00-00-thread-1.jsonl"), "");
    assert.equal(codexSessionFile(home, "thread-1", startedAt), path.join(dir, "rollout-2026-10-05T18-00-00-thread-1.jsonl"));
    assert.equal(codexSessionFile(home, "thread-2", startedAt), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
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
