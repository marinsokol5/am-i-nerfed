// Keep the published skill and CLI on the same release version.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const skillPath = path.join(root, "skills/am-i-nerfed/SKILL.md");
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const check = process.argv.slice(2);
if (check.length && (check.length !== 1 || check[0] !== "--check")) {
  throw Error("Usage: node scripts/skill-version.js [--check]");
}
const source = fs.readFileSync(skillPath, "utf8");
const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
if (!header) throw Error("Skill YAML frontmatter is missing");
const metadata = /^metadata:\s*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/m.exec(
  header[1],
);
const field = metadata && /^  version:\s*(.+)$/m.exec(metadata[1]);
if (!field) throw Error("Skill metadata.version is missing");
const expected = JSON.stringify(version);
if (check.length) {
  if (field[1].trim() !== expected) {
    throw Error(
      `Skill version must match package version ${version}; run node scripts/skill-version.js`,
    );
  }
} else {
  const metadataValueOffset = metadata.index + metadata[0].indexOf(metadata[1]);
  const fieldValueOffset = field.index + field[0].indexOf(field[1]);
  const offset =
    source.indexOf(header[1]) + metadataValueOffset + fieldValueOffset;
  fs.writeFileSync(
    skillPath,
    source.slice(0, offset) + expected + source.slice(offset + field[1].length),
  );

  // npm stages its manifests itself; add only this generated release change.
  // Manual sync and --no-git-tag-version must not alter the user's Git index.
  if (
    process.env.npm_lifecycle_event === "version" &&
    !["", "false"].includes(process.env.npm_config_git_tag_version)
  ) {
    const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
    });
    if (git.status === 0 && git.stdout.trim() === "true") {
      const staged = spawnSync("git", ["add", "--", skillPath], {
        cwd: root,
        encoding: "utf8",
      });
      if (staged.status !== 0)
        throw Error(
          staged.stderr || "Could not stage the synchronized skill version",
        );
    }
  }
}
