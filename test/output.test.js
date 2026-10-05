import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatRun, renameRunFields } from "../src/output.js";
import { initializedState } from "./initialized-state.js";

const cli = fileURLToPath(new URL("../bin/am-i-nerfed.js", import.meta.url));
const compactKeys = ["runId", "status", "difficulty", "clock", "tasks"];
const clockKeys = ["durationSeconds", "elapsedSeconds", "remainingSeconds"];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-output-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "state"), cwd = path.join(root, "project"), bin = path.join(root, "bin");
  fs.mkdirSync(cwd); fs.mkdirSync(bin);
  const env = { ...process.env, AM_I_NERFED_HOME: home, PATH: bin + path.delimiter + process.env.PATH };
  const exec = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
  const json = (...args) => {
    const result = exec(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const initialized = initializedState(home);
  const recordPath = id => path.join(home, "baselines", initialized.baselineId, "assessments", id + ".json");
  return { root, home, bin, exec, json, initialized, recordPath };
}

test("start, answer and status are compact by default; verbose restores metadata", t => {
  const f = fixture(t), start = f.json("start", "--seconds", "500");
  assert.deepEqual(Object.keys(start), ["runId", "difficulty", "clock", "tasks"]);
  assert.deepEqual(Object.keys(start.clock), clockKeys);
  assert.ok(start.tasks.length === 6 && start.tasks.every(id => typeof id === "string"));
  const startVerbose = f.json("start", "--seconds", "500", "--verbose");
  assert.equal(typeof startVerbose.taskBankHash, "string");
  assert.equal(startVerbose.tasks[0].submitted, false);
  const active = f.json("status", "--run", start.runId);
  assert.deepEqual(Object.keys(active), compactKeys);
  assert.deepEqual(Object.keys(active.clock), clockKeys);
  assert.deepEqual(active.tasks[0], { id: start.tasks[0], submitted: false, filledFields: 0 });
  const answered = f.json("answer", "--run", start.runId, "--task", start.tasks[0], "--json", "null");
  assert.deepEqual(Object.keys(answered), ["accepted", "taskId", "remainingSeconds"]);
  assert.equal(answered.accepted, true);
  const answerVerbose = f.json("answer", "--run", start.runId, "--task", start.tasks[0], "--json", "null", "--verbose");
  assert.equal(typeof answerVerbose.taskBankHash, "string");
  const submitted = f.json("status", "--run", start.runId);
  assert.deepEqual(submitted.tasks[0], { id: start.tasks[0], submitted: true, filledFields: 0 });
  const verbose = f.json("status", "--run", start.runId, "--verbose");
  assert.equal(verbose.baselineId, f.initialized.baselineId);
  assert.equal(typeof verbose.clock.startedAt, "string");
  assert.equal(typeof verbose.tasks[0].family, "string");
  assert.equal(typeof verbose.tasks[0].promptHash, "string");
  assert.equal(verbose.tasks[0].submitted, true);
  assert.equal("result" in active, false);
  assert.equal("result" in verbose, false);
  const finished = f.json("finish", "--run", start.runId);
  assert.deepEqual(Object.keys(finished), [...compactKeys.slice(0, 4), "result"]);
  const late = f.exec("answer", "--run", start.runId, "--task", start.tasks[0], "--json", "null");
  assert.equal(late.status, 1);
  assert.deepEqual(Object.keys(JSON.parse(late.stdout)), ["accepted", "reason", ...compactKeys.slice(0, 4), "result"]);
});

test("completed status keeps scores compact and normalizes legacy receipts without rewriting them", t => {
  const f = fixture(t), start = f.json("start");
  f.json("answer", "--run", start.runId, "--task", start.tasks[0], "--json", "null");
  f.json("finish", "--run", start.runId);
  const file = f.recordPath(start.runId), record = JSON.parse(fs.readFileSync(file));
  record.receipt.bankHash = record.receipt.taskBankHash;
  delete record.receipt.taskBankHash;
  record.receipt.tasks = record.receipt.tasks.map(({ submitted, ...task }) => ({ ...task, saved: submitted }));
  fs.writeFileSync(file, JSON.stringify(record));
  const before = fs.readFileSync(file, "utf8");
  const compact = f.json("status", "--run", start.runId);
  const verbose = f.json("status", "--run", start.runId, "--verbose");
  assert.deepEqual(Object.keys(compact), [...compactKeys.slice(0, 4), "result"]);
  assert.deepEqual(Object.keys(compact.result), ["percent", "tasks"]);
  assert.deepEqual(Object.keys(compact.result.tasks[0]), ["id", "percent"]);
  assert.equal(compact.result.percent, verbose.result.percent);
  assert.equal(verbose.result.taskWeightPercent, 100 / 6);
  assert.equal(typeof verbose.result.tasks[0].stages, "object");
  assert.equal(verbose.taskBankHash, record.receipt.bankHash);
  assert.equal("bankHash" in verbose, false);
  assert.equal(verbose.tasks[0].submitted, true);
  assert.equal("saved" in verbose.tasks[0], false);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const history = f.json("history", "list", "--json").runs[0];
  assert.equal(history.taskBankHash, verbose.taskBankHash);
  assert.equal("bankHash" in history, false);
});

test("question returns task text, response shape, submitted answers and remaining seconds only", t => {
  const f = fixture(t), start = f.json("start", "--seconds", "500", "--difficulty", "easy");
  const taskId = start.tasks[0];
  const question = f.json("question", "--run", start.runId, "--task", taskId);
  assert.deepEqual(Object.keys(question), ["taskId", "remainingSeconds", "task", "types", "response", "submitted"]);
  assert.equal(question.taskId, taskId);
  assert.doesNotMatch(question.task, /Am I nerfed|Reason yourself without code|Submit partial|null/);
  // easy-1 is hats: named enums, a flat shape without the scoring stage, and an empty start.
  assert.deepEqual(question.types.Reply, [...question.types.Color, "unknown"]);
  assert.deepEqual(Object.keys(question.response), ["hats", "alternative"]);
  assert.ok(Object.values(question.response.hats).every(type => type === "Color"));
  assert.ok(Object.values(question.response.alternative).every(type => type === "Reply"));
  assert.deepEqual(question.submitted, {});
  assert.ok(question.remainingSeconds > 0 && question.remainingSeconds <= 500);
  const bankFile = path.join(f.home, "baselines", f.initialized.baselineId, "task-bank.json");
  const bankBefore = fs.readFileSync(bankFile, "utf8");
  assert.equal(question.task, JSON.parse(bankBefore).tasks.find(task => task.id === taskId).prompt);
  const draft = { hats: { A: question.types.Color[0] }, marin: 5 };
  f.json("answer", "--run", start.runId, "--task", taskId, "--json", JSON.stringify(draft));
  const revised = f.json("question", "--run", start.runId, "--task", taskId);
  assert.deepEqual(revised, { ...question, submitted: draft, remainingSeconds: revised.remainingSeconds });
  assert.ok(revised.remainingSeconds <= question.remainingSeconds);
  assert.equal(fs.readFileSync(bankFile, "utf8"), bankBefore);
  const boolean = f.json("question", "--run", start.runId, "--task", start.tasks[2]);
  assert.equal("types" in boolean, false);
  const unsupported = f.exec("question", "--run", start.runId, "--task", taskId, "--verbose");
  assert.equal(unsupported.status, 1);
  assert.equal(unsupported.stdout, "");
  f.json("finish", "--run", start.runId);
  assert.deepEqual(f.json("question", "--run", start.runId, "--task", taskId), {
    taskId, status: "finished", remainingSeconds: 0,
  });
});

test("field normalization leaves answer contents and original objects untouched, and failures stay visible", () => {
  const legacy = {
    runId: "test", status: "failed", difficulty: "easy", bankHash: "bank",
    clock: { durationSeconds: 120, elapsedSeconds: 1, remainingSeconds: 0 },
    tasks: [{ id: "easy-1", saved: false, filledFields: 0, family: "hats" }],
    draft: { saved: "answer-field", bankHash: "another-answer-field" },
    failure: "Synthetic client failure", execution: { failure: "Synthetic client failure" },
  };
  const before = structuredClone(legacy), normalized = renameRunFields(legacy);
  assert.deepEqual(legacy, before);
  assert.deepEqual(normalized.draft, before.draft);
  assert.equal(normalized.taskBankHash, "bank");
  const compact = formatRun(legacy);
  assert.equal(compact.failure, legacy.failure);
  assert.equal("result" in compact, false);
  assert.equal("execution" in compact, false);
  assert.deepEqual(formatRun(legacy, { verbose: true }).execution, legacy.execution);
});

test("run and native status use compact JSON by default; verbose restores metadata and diagnostics", t => {
  const f = fixture(t);
  const fake = `#!${process.execPath}
const cp = require('node:child_process');
if(process.argv.includes('--version')){console.log('fake-cli');process.exit(0);}
process.stdin.resume();
process.stdin.on('end',()=>{
  const call=(args)=>{const r=cp.spawnSync('./assessment',args,{encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout);};
  const started=call(['start']);
  const question=call(['question','--task',started.tasks[0]]);
  if(!['taskId','remainingSeconds','task','response','submitted'].every(k=>k in question) || 'runId' in question || question.task.includes('Reason yourself without code'))throw Error('Question leaked wrapper text or run metadata');
  const compact=call(['status']);
  const verbose=call(['status','--verbose']);
  if('taskBankHash' in compact || 'family' in compact.tasks[0] || !verbose.taskBankHash || !verbose.tasks[0].family)throw Error('Wrong native status projection');
  call(['finish']);
  console.log(JSON.stringify({type:'result',is_error:false}));
});
`;
  fs.writeFileSync(path.join(f.bin, "claude"), fake, { mode: 0o700 });
  for (const flags of [[], ["--json"], ["--verbose"], ["--json", "--verbose"]]) {
    const result = f.exec("run", "--agent", "claude", "--model", "fake-model", "--effort", "medium", "--seconds", "60", ...flags);
    assert.equal(result.status, 0, result.stderr);
    const run = JSON.parse(result.stdout);
    assert.equal(run.status, "finished");
    assert.equal(run.result.percent, 0);
    if (flags.includes("--verbose")) {
      assert.equal(run.agent, "claude");
      assert.equal(typeof run.taskBankHash, "string");
      assert.equal(run.execution.failure, null);
      assert.ok(run.clock.startedAt);
      assert.match(result.stderr, /Running/);
    } else {
      assert.deepEqual(Object.keys(run), [...compactKeys.slice(0, 4), "result"]);
      assert.deepEqual(Object.keys(run.clock), clockKeys);
      assert.equal(result.stderr, "");
    }
  }
});

test("a Claude run answered by a different model than requested fails", t => {
  const f = fixture(t);
  const fake = `#!${process.execPath}
const cp = require('node:child_process');
if(process.argv.includes('--version')){console.log('fake-cli');process.exit(0);}
process.stdin.resume();
process.stdin.on('end',()=>{
  const call=(args)=>{const r=cp.spawnSync('./assessment',args,{encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout);};
  call(['start']);
  console.log(JSON.stringify({type:'assistant',message:{id:'m1',model:'fallback-model',content:[{type:'text',text:'x'}]}}));
  call(['finish']);
  console.log(JSON.stringify({type:'result',is_error:false}));
});
`;
  fs.writeFileSync(path.join(f.bin, "claude"), fake, { mode: 0o700 });
  const result = f.exec("run", "--agent", "claude", "--model", "fake-model", "--effort", "medium", "--seconds", "60", "--verbose");
  assert.equal(result.status, 1);
  const run = JSON.parse(result.stdout);
  assert.equal(run.execution.failure, "Client switched to a different model");
  assert.deepEqual(run.execution.observedModels, ["fallback-model"]);
});

test("a Claude run answered by a dated snapshot of the requested model passes", t => {
  const f = fixture(t);
  const fake = `#!${process.execPath}
const cp = require('node:child_process');
if(process.argv.includes('--version')){console.log('fake-cli');process.exit(0);}
process.stdin.resume();
process.stdin.on('end',()=>{
  const call=(args)=>{const r=cp.spawnSync('./assessment',args,{encoding:'utf8'});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout);};
  call(['start']);
  console.log(JSON.stringify({type:'assistant',message:{id:'m1',model:'fake-model-20251001',content:[{type:'text',text:'x'}]}}));
  call(['finish']);
  console.log(JSON.stringify({type:'result',is_error:false}));
});
`;
  fs.writeFileSync(path.join(f.bin, "claude"), fake, { mode: 0o700 });
  const result = f.exec("run", "--agent", "claude", "--model", "fake-model", "--effort", "medium", "--seconds", "60", "--verbose");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).execution.failure, null);
});

test("run requires --agent, --model and --effort; init saves no defaults", t => {
  const f = fixture(t);
  assert.equal("defaults" in f.initialized, false);
  for (const missing of ["--agent", "--model", "--effort"]) {
    const args = { "--agent": "claude", "--model": "fake-model", "--effort": "medium" };
    delete args[missing];
    const result = f.exec("run", ...Object.entries(args).flat());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /run requires --agent, --model and --effort/);
  }
  assert.equal(f.exec("init", "--agent", "codex").status, 1);
});

test("questions returns all six tasks with one clock, and only the closed status after the run ends", t => {
  const f = fixture(t), start = f.json("start", "--seconds", "500");
  const all = f.json("questions", "--run", start.runId);
  assert.deepEqual(Object.keys(all), ["remainingSeconds", "tasks"]);
  assert.deepEqual(all.tasks.map(q => q.taskId), start.tasks);
  for (const q of all.tasks) {
    const single = f.json("question", "--run", start.runId, "--task", q.taskId);
    const { remainingSeconds, ...rest } = single;
    assert.deepEqual(q, rest);
  }
  assert.equal(f.exec("questions", "--run", start.runId, "--verbose").status, 1);
  f.json("finish", "--run", start.runId);
  assert.deepEqual(f.json("questions", "--run", start.runId), { status: "finished", remainingSeconds: 0 });
});

test("hard output exposes six tasks consistently and keeps scoring weights in verbose results", t => {
  const f = fixture(t), start = f.json("start", "--difficulty", "hard", "--seconds", "300");
  assert.deepEqual(start.tasks, ["hard-1", "hard-2", "hard-3", "hard-4", "hard-5", "hard-6"]);
  const questions = f.json("questions", "--run", start.runId);
  assert.deepEqual(questions.tasks.map(q => q.taskId), start.tasks);
  const answer = f.json("answer", "--run", start.runId, "--task", "hard-6", "--json", "null");
  assert.equal(answer.accepted, true);
  const active = f.json("status", "--run", start.runId);
  assert.equal(active.tasks.length, 6);
  assert.equal(active.tasks[5].submitted, true);
  const compact = f.json("finish", "--run", start.runId);
  const verbose = f.json("status", "--run", start.runId, "--verbose");
  assert.equal(compact.result.tasks.length, 6);
  assert.equal("taskWeightPercent" in compact.result, false);
  assert.equal(verbose.result.taskWeightPercent, 100 / 6);
  assert.equal(compact.result.percent, verbose.result.percent);
});
