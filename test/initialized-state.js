import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/am-i-nerfed.js", import.meta.url));
let template;

/** Fill `state` with an initialized baseline and return init's output.
 * Building a private bank takes seconds, so each test process runs `init`
 * once and later fixtures copy that state. */
export function initializedState(state) {
  if (!template) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nerfed-init-template-"));
    process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
    const cwd = path.join(root, "project"), home = path.join(root, "state");
    fs.mkdirSync(cwd);
    const result = spawnSync(process.execPath, [cli, "init"], {
      cwd, env: { ...process.env, AM_I_NERFED_HOME: home }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    template = { home, output: result.stdout };
  }
  fs.cpSync(template.home, state, { recursive: true });
  return JSON.parse(template.output);
}
