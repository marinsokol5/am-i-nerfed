import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
    const allowed = new Set([
      "current.json",
      "baselines",
      ".lock",
      "settings.json",
      "clients",
    ]);
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
  const base = path.join(root, "baselines", current.baselineId);
  return { current, base, dataset: readJSON(path.join(base, "dataset.json")) };
}
