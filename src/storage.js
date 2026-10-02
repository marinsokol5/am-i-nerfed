import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { difficultyLevel } from "./difficulty.js";
import { generate } from "./generate.js";
export function stateRoot() {
  const root = path.resolve(
    process.env.AM_I_NERFED_HOME ||
      path.join(os.homedir(), ".local", "state", "am-i-nerfed"),
  );
  const cwd = fs.realpathSync(process.cwd());
  let existing = root;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const resolved = path.join(
    fs.realpathSync(existing),
    path.relative(existing, root),
  );
  if (
    [path.parse(root).root, os.homedir(), os.tmpdir(), cwd].some(
      (p) => path.resolve(p) === resolved,
    ) ||
    cwd.startsWith(resolved + path.sep)
  )
    throw Error(
      "Private state needs its own directory outside the current project",
    );
  if (process.env.AM_I_NERFED_HOME && resolved.startsWith(cwd + path.sep))
    throw Error("AM_I_NERFED_HOME must be outside the current project");
  for (let ancestor = resolved; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, ".git")))
      throw Error("Private state must be outside Git repositories");
    if (path.dirname(ancestor) === ancestor) break;
  }
  if (fs.existsSync(root)) {
    const st = fs.lstatSync(root);
    if (!st.isDirectory() || st.isSymbolicLink())
      throw Error("Private state directory must be a real directory");
    const allowed = new Set(["current.json", "baselines", ".lock"]);
    if (
      fs
        .readdirSync(root)
        .some(
          (name) =>
            !allowed.has(name) &&
            !/^current\.json\.[0-9a-f-]+\.tmp$/.test(name),
        )
    )
      throw Error(
        "Private state directory contains unrelated files; choose an empty dedicated directory",
      );
  }
  return root;
}
export function privateDirectory(p) {
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(p);
  if (!st.isDirectory() || st.isSymbolicLink())
    throw Error("Private state directory must be a real directory");
  if (process.getuid && st.uid !== process.getuid())
    throw Error("Private state directory belongs to another user");
  fs.chmodSync(p, 0o700);
}
export function writeJSON(p, value, { exclusive = false } = {}) {
  const contents = JSON.stringify(value) + "\n";
  if (exclusive) {
    fs.writeFileSync(p, contents, { flag: "wx", mode: 0o600 });
    return;
  }
  const temp = p + "." + randomUUID() + ".tmp";
  fs.writeFileSync(temp, contents, { flag: "wx", mode: 0o600 });
  fs.renameSync(temp, p);
}
export function readJSON(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile() || st.isSymbolicLink())
    throw Error("Invalid private state file");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
export function withLock(action) {
  const root = stateRoot();
  privateDirectory(root);
  const lock = path.join(root, ".lock");
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error(
        "Another am-i-nerfed command is active. If a process crashed, remove the private state .lock directory after verifying it has stopped.",
      );
    throw e;
  }
  try {
    return action(root);
  } finally {
    fs.rmdirSync(lock);
  }
}
export function active(root) {
  const pointer = path.join(root, "current.json");
  if (!fs.existsSync(pointer))
    throw Error("Not initialized. Run am-i-nerfed init first.");
  const current = readJSON(pointer);
  if (!/^[0-9a-f-]{36}$/.test(current.baselineId))
    throw Error("Invalid baseline identity");
  // v0.1 only had runId, and every v0.1 run was the hard case.
  current.runIds = { ...current.runIds };
  if (current.runId && !current.runIds.hard)
    current.runIds.hard = current.runId;
  const base = path.join(root, "baselines", current.baselineId);
  return { current, base, dataset: readJSON(path.join(base, "dataset.json")) };
}
export function runPath(base, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("Invalid run ID");
  return path.join(base, "runs", id + ".json");
}
export function datasetFor(state, difficulty, { create = true } = {}) {
  difficultyLevel(difficulty);
  if (difficulty === "hard") return state.dataset;
  const directory = path.join(state.base, "variants");
  const filename = path.join(directory, difficulty + ".json");
  if (!fs.existsSync(filename)) {
    if (!create)
      throw Error(
        "Frozen difficulty case is missing; it cannot be regenerated while resuming or grading this run.",
      );
    if (typeof state.dataset.seed !== "string" || !state.dataset.seed)
      throw Error(
        "Private baseline is missing its generation secret; existing hard runs remain available.",
      );
    const dataset = generate(state.dataset.seed, difficulty);
    privateDirectory(directory);
    writeJSON(filename, dataset, { exclusive: true });
  }
  const dataset = readJSON(filename);
  if (dataset.difficulty !== difficulty)
    throw Error("Private variant difficulty does not match its file");
  return dataset;
}
export function recordedDifficulty(run) {
  return difficultyLevel(run.difficulty ?? "hard");
}
export function readRun(base, id) {
  let run;
  try {
    run = readJSON(runPath(base, id));
  } catch (error) {
    if (error.code === "ENOENT")
      throw Error(
        "Run ID was not found on the current baseline. Keep the original ID; do not adopt another chat's run.",
      );
    throw error;
  }
  return {
    ...run,
    difficulty: recordedDifficulty(run),
    status:
      run.status === "pending" && fs.existsSync(runPath(base, id) + ".claim")
        ? "consumed_without_result"
        : run.status,
  };
}
export function newRun(
  root,
  state,
  difficulty = "hard",
  dataset = state.dataset,
) {
  const id = randomUUID(),
    run = {
      id,
      baselineId: state.current.baselineId,
      difficulty: difficultyLevel(difficulty),
      generatorVersion: dataset.generatorVersion,
      promptHash: dataset.promptHash,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
  writeJSON(runPath(state.base, id), run, { exclusive: true });
  state.current.runIds[difficulty] = id;
  if (difficulty === "hard") state.current.runId = id;
  writeJSON(path.join(root, "current.json"), state.current);
  return run;
}
