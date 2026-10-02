import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { generate } from "./generate.js";
import { evaluateRun } from "./submission.js";
import { examAction } from "./exam.js";
import {
  withLock,
  privateDirectory,
  writeJSON,
  active,
  newRun,
  datasetFor,
  readRun,
} from "./storage.js";
import { installSkill } from "./install.js";
import {
  DIFFICULTIES,
  DEFAULT_DIFFICULTY,
  difficultyLevel,
} from "./difficulty.js";
const usage = `am-i-nerfed — private reasoning benchmark\n\n  init [--reset] [--yes] [--agent NAME] [--global|--project] [--copy]\n  question [--difficulty easy|normal|hard] [--new]\n  question --run ID\n  eval --run ID [--file answer.json] [--label TEXT]\n  status [--difficulty LEVEL]\n  history [--difficulty LEVEL]\n  exam start [--seconds 120|300]\n  exam question --exam ID --question q1\n  exam save --exam ID --question q1 [--json JSON | --file PATH]\n  exam status --exam ID\n  exam finish --exam ID\n\ninit opens the standard Agent Skills interactive installer. Use --yes explicitly\nfor headless installation (project scope unless --global is supplied).\nquestion defaults to normal and always allocates a fresh independent run.\nUse question --run ID to resume exactly that run; keep its ID through submission.\neval reads one JSON answer from stdin or --file. Valid JSON consumes the run,\nincluding null, missing sections and schema errors. Invalid JSON does not.\nIdentical JSON delivery retries return the same receipt; changed answers fail.\nAM_I_NERFED_HOME overrides the private state directory; keep it outside projects.\n`;
function options(args, allowed) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!allowed.has(name)) throw Error(`Unknown option: ${name}`);
    if (allowed.get(name) === "boolean") {
      out[name] = true;
      continue;
    }
    if (!args[i + 1] || args[i + 1].startsWith("--"))
      throw Error(`Missing value for ${name}`);
    if (name === "--agent") (out[name] ??= []).push(args[++i]);
    else out[name] = args[++i];
  }
  return out;
}
function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
async function readSubmission(filename) {
  if (filename) {
    const st = fs.statSync(filename);
    if (st.size > 1048576) throw Error("Submission exceeds 1 MiB");
    const source = fs.readFileSync(filename, "utf8");
    if (Buffer.byteLength(source, "utf8") > 1048576)
      throw Error("Submission exceeds 1 MiB");
    return source;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1048576) throw Error("Submission exceeds 1 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ["help", "--help", "-h"].includes(command)) {
    process.stdout.write(usage);
    return;
  }
  if (command === "--version") {
    const { version } = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    process.stdout.write(version + "\n");
    return;
  }
  if (command === "exam") {
    const [action, ...examArgs] = rest;
    const flags = new Map(
      action === "start" ? [["--seconds", "value"]] : [["--exam", "value"]],
    );
    if (["question", "save"].includes(action)) flags.set("--question", "value");
    if (action === "save") {
      flags.set("--json", "value");
      flags.set("--file", "value");
    }
    if (!["start", "question", "save", "status", "finish"].includes(action))
      throw Error("Use exam start, question, save, status, or finish");
    const opts = options(examArgs, flags);
    if (
      opts["--seconds"] !== undefined &&
      !["120", "300"].includes(opts["--seconds"])
    )
      throw Error("Choose --seconds 120 or --seconds 300");
    if (action !== "start" && !opts["--exam"])
      throw Error("An --exam ID is required");
    if (["question", "save"].includes(action) && !opts["--question"])
      throw Error("A --question ID is required");
    let patch;
    if (action === "save") {
      if (opts["--json"] !== undefined && opts["--file"])
        throw Error("Choose --json, --file, or stdin, not multiple inputs");
      const source = opts["--json"] ?? (await readSubmission(opts["--file"]));
      if (Buffer.byteLength(source, "utf8") > 1048576)
        throw Error("Submission exceeds 1 MiB");
      try {
        patch = JSON.parse(source);
      } catch {
        throw Error("Invalid JSON draft; no answers were saved or graded");
      }
    }
    withLock((root) => {
      const result = examAction(active(root), action, {
        examId: opts["--exam"],
        questionId: opts["--question"],
        durationSeconds:
          opts["--seconds"] === undefined
            ? undefined
            : Number(opts["--seconds"]),
        patch,
      });
      print(result);
      if (result.accepted === false) process.exitCode = 1;
    });
    return;
  }
  if (command === "init") {
    const opts = options(
      rest,
      new Map([
        ["--reset", "boolean"],
        ["--yes", "boolean"],
        ["--global", "boolean"],
        ["--copy", "boolean"],
        ["--project", "boolean"],
        ["--agent", "value"],
      ]),
    );
    // Installation is explicit init behavior. Never called while answering a question.
    const installation = await installSkill(opts);
    if (!installation) {
      process.stderr.write(
        "Initialization cancelled; your private baseline was not changed.\n",
      );
      return;
    }
    withLock((root) => {
      const pointer = path.join(root, "current.json");
      if (fs.existsSync(pointer) && !opts["--reset"]) {
        const state = active(root);
        for (const level of DIFFICULTIES) datasetFor(state, level);
        print({
          initialized: true,
          existing: true,
          baselineId: state.current.baselineId,
          skill: installation,
          difficulties: DIFFICULTIES,
          defaultDifficulty: DEFAULT_DIFFICULTY,
        });
        return;
      }
      process.stderr.write(
        "Generating and validating your private case locally…\n",
      );
      const seed = randomBytes(32).toString("hex"),
        dataset = generate(seed),
        baselineId = randomUUID(),
        base = path.join(root, "baselines", baselineId);
      privateDirectory(path.join(base, "runs"));
      writeJSON(
        path.join(base, "dataset.json"),
        { ...dataset, seed, baselineId, createdAt: new Date().toISOString() },
        { exclusive: true },
      );
      const current = { baselineId, runId: null, runIds: {} };
      const state = { current, base, dataset: { ...dataset, seed } };
      for (const level of DIFFICULTIES) datasetFor(state, level);
      writeJSON(pointer, current);
      print({
        initialized: true,
        existing: false,
        baselineId,
        difficulties: DIFFICULTIES,
        defaultDifficulty: DEFAULT_DIFFICULTY,
        skill: installation,
        reset: Boolean(opts["--reset"]),
        note: "Stable private baseline created. Invoke /am-i-nerfed or $am-i-nerfed in a fresh chat.",
      });
    });
    return;
  }
  if (command === "question") {
    const opts = options(
      rest,
      new Map([
        ["--new", "boolean"],
        ["--run", "value"],
        ["--difficulty", "value"],
      ]),
    );
    const selected = difficultyLevel(opts["--difficulty"]);
    if (opts["--run"] && opts["--new"])
      throw Error(
        "--run resumes an existing run; it cannot be combined with --new.",
      );
    withLock((root) => {
      const state = active(root);
      let run,
        dataset,
        difficulty = selected;
      if (opts["--run"]) {
        run = readRun(state.base, opts["--run"]);
        if (
          run.id !== opts["--run"] ||
          run.baselineId !== state.current.baselineId
        )
          throw Error("Run does not belong to the current baseline");
        difficulty = run.difficulty;
        if (opts["--difficulty"] && selected !== difficulty)
          throw Error(
            "Requested difficulty does not match this run; keep its original ID and difficulty.",
          );
        dataset = datasetFor(state, difficulty, { create: false });
        if (run.promptHash && run.promptHash !== dataset.promptHash)
          throw Error("The frozen case no longer matches this run.");
      } else {
        dataset = datasetFor(state, difficulty);
        run = newRun(root, state, difficulty, dataset);
      }
      print({
        runId: run.id,
        runStatus: run.status,
        baselineId: state.current.baselineId,
        difficulty,
        generatorVersion: dataset.generatorVersion,
        promptHash: dataset.promptHash,
        prompt: dataset.prompt,
        submission: {
          command: `am-i-nerfed eval --run ${run.id}`,
          format:
            "One best-effort JSON answer on stdin; unknowns may be null. Identical delivery retries are safe.",
        },
      });
    });
    return;
  }
  if (command === "eval") {
    const opts = options(
      rest,
      new Map([
        ["--run", "value"],
        ["--file", "value"],
        ["--label", "value"],
      ]),
    );
    if (!opts["--run"]) throw Error("eval requires --run ID from question");
    if ((opts["--label"]?.length || 0) > 200)
      throw Error("Label must be at most 200 characters");
    let submission;
    try {
      submission = JSON.parse(await readSubmission(opts["--file"]));
    } catch (e) {
      throw Error(
        `Submission not accepted: ${e.message}. No score was queried and the run was not consumed.`,
      );
    }
    withLock((root) => {
      const state = active(root);
      print(
        evaluateRun(state, opts["--run"], submission, opts["--label"] || null),
      );
    });
    return;
  }
  if (command === "status" || command === "history") {
    const opts = options(rest, new Map([["--difficulty", "value"]]));
    const difficulty = difficultyLevel(opts["--difficulty"]);
    withLock((root) => {
      const state = active(root);
      if (command === "status") {
        const currentRuns = Object.fromEntries(
          DIFFICULTIES.map((level) => {
            const id = state.current.runIds[level];
            const run = id ? readRun(state.base, id) : null;
            return [
              level,
              run
                ? {
                    id: run.id,
                    difficulty: level,
                    status: run.status === "pending" ? "pending" : "consumed",
                    generatorVersion:
                      run.generatorVersion ??
                      (level === "hard"
                        ? state.dataset.generatorVersion
                        : null),
                    promptHash:
                      run.promptHash ??
                      (level === "hard" ? state.dataset.promptHash : null),
                  }
                : null,
            ];
          }),
        );
        print({
          baselineId: state.current.baselineId,
          difficulty,
          defaultDifficulty: DEFAULT_DIFFICULTY,
          currentRun: currentRuns[difficulty],
          currentRuns,
        });
      } else {
        const runs = fs
          .readdirSync(path.join(state.base, "runs"))
          .filter((n) => n.endsWith(".json"))
          .map((n) => readRun(state.base, n.slice(0, -5)))
          .filter(
            (run) => !opts["--difficulty"] || run.difficulty === difficulty,
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        print({
          baselineId: state.current.baselineId,
          difficulty: opts["--difficulty"] ?? "all",
          runs,
        });
      }
    });
    return;
  }
  throw Error(`Unknown command: ${command}. Use --help.`);
}
