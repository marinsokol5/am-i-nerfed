import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = {
  ...process.env,
  PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
};
const hasReleaseTools = ["npm", "git"].every(
  (command) => spawnSync(command, ["--version"], { env }).status === 0,
);

function fixture(t, git = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "am-i-nerfed-version-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const cwd = path.join(temp, "package");
  for (const file of [
    "package.json",
    "scripts/skill-version.js",
    "skills/am-i-nerfed/SKILL.md",
  ]) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(cwd, file));
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
  );
  manifest.version = "0.1.0";
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(cwd, "package-lock.json"),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      packages: { "": { name: manifest.name, version: manifest.version } },
    }),
  );
  const childEnv = {
    ...env,
    npm_config_cache: path.join(temp, "cache"),
    npm_config_offline: "true",
    npm_config_ignore_scripts: "false",
  };
  delete childEnv.npm_lifecycle_event;
  delete childEnv.npm_config_git_tag_version;
  const run = (command, args) =>
    spawnSync(command, args, { cwd, env: childEnv, encoding: "utf8" });
  const ok = (command, args) => {
    const result = run(command, args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  ok(process.execPath, ["scripts/skill-version.js"]);
  if (git) {
    ok("git", ["init", "-q"]);
    ok("git", ["config", "user.name", "Version test"]);
    ok("git", ["config", "user.email", "version-test@example.invalid"]);
    ok("git", ["config", "commit.gpgsign", "false"]);
    ok("git", ["config", "tag.gpgsign", "false"]);
    ok("git", ["add", "."]);
    ok("git", ["commit", "-qm", "fixture"]);
  }
  return { cwd, run, ok };
}

test(
  "npm version includes the synchronized skill in its release commit",
  { skip: !hasReleaseTools },
  (t) => {
    const f = fixture(t, true);
    f.ok("npm", ["version", "patch"]);
    assert.match(
      f.ok("git", ["show", "v0.1.1:skills/am-i-nerfed/SKILL.md"]),
      /  version: "0\.1\.1"/,
    );
    assert.equal(
      JSON.parse(f.ok("git", ["show", "v0.1.1:package.json"])).version,
      "0.1.1",
    );
    assert.equal(
      JSON.parse(f.ok("git", ["show", "v0.1.1:package-lock.json"])).version,
      "0.1.1",
    );
    assert.equal(f.ok("git", ["status", "--porcelain"]), "");
  },
);

test(
  "no-tag bumps update the skill without staging; non-Git synchronization works",
  { skip: !hasReleaseTools },
  (t) => {
    const f = fixture(t, true);
    f.ok("npm", ["version", "patch", "--no-git-tag-version"]);
    assert.match(
      fs.readFileSync(path.join(f.cwd, "skills/am-i-nerfed/SKILL.md"), "utf8"),
      /  version: "0\.1\.1"/,
    );
    assert.equal(f.ok("git", ["diff", "--cached", "--name-only"]), "");
    const withoutGit = fixture(t);
    withoutGit.ok("npm", ["version", "patch", "--no-git-tag-version"]);
    withoutGit.ok(process.execPath, ["scripts/skill-version.js", "--check"]);
  },
);

test(
  "packing rejects a mismatched skill release",
  { skip: !hasReleaseTools },
  (t) => {
    const f = fixture(t);
    const file = path.join(f.cwd, "skills/am-i-nerfed/SKILL.md");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace('version: "0.1.0"', 'version: "0.0.0"'),
    );
    const result = f.run("npm", ["pack", "--dry-run", "--json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Skill version must match/);
  },
);

test("CLI reports its manifest version from outside the package directory", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin/am-i-nerfed.js"), "--version"],
    { cwd: os.tmpdir(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
      .version,
  );
});
