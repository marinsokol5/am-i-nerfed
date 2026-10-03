import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { privateDirectory } from "./storage.js";

// project_doc_max_bytes does not suppress the global AGENTS file in every
// Codex release. Use an application-owned home, sharing only the auth file.
// A symlink lets native token refreshes use the existing credential store.
export function codexEnvironment(stateRoot, env) {
  const source = path.resolve(
    env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  );
  const identity = createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 20);
  const home = path.join(stateRoot, "clients", "codex-" + identity);
  privateDirectory(home);
  const original = path.join(source, "auth.json"),
    target = path.join(home, "auth.json");
  if (!fs.existsSync(original))
    throw Error(
      "Clean Codex assessments require an existing file-backed Codex login (auth.json).",
    );
  const resolved = fs.realpathSync(original);
  if (!fs.existsSync(target)) fs.symlinkSync(resolved, target);
  else if (
    !fs.lstatSync(target).isSymbolicLink() ||
    fs.realpathSync(target) !== resolved
  )
    throw Error(
      "The assessment Codex home has a different authentication store; it was left unchanged.",
    );
  return { ...env, CODEX_HOME: home };
}

export function codexEvidence(home, threadId, startedAt) {
  if (!threadId) return null;
  const days = [new Date(startedAt), new Date(startedAt + 86400000)];
  for (const day of days) {
    const dir = path.join(
      home,
      "sessions",
      ...day.toISOString().slice(0, 10).split("-"),
    );
    if (!fs.existsSync(dir)) continue;
    const name = fs
      .readdirSync(dir)
      .find((n) => n.endsWith(threadId + ".jsonl"));
    if (!name) continue;
    const models = new Set(),
      efforts = new Set();
    let instructionFileMessages = 0,
      tokenUsage = null,
      baseInstructions = null;
    for (const line of fs
      .readFileSync(path.join(dir, name), "utf8")
      .split("\n")) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = event.payload ?? {};
      if (event.type === "session_meta")
        baseInstructions = payload.base_instructions?.text ?? baseInstructions;
      else if (event.type === "turn_context") {
        if (payload.model) models.add(payload.model);
        if (payload.effort) efforts.add(payload.effort);
      } else if (
        event.type === "response_item" &&
        payload.type === "message" &&
        ["user", "developer"].includes(payload.role)
      ) {
        instructionFileMessages += (payload.content ?? []).filter((b) =>
          /^# AGENTS\.md instructions/.test(b.text ?? ""),
        ).length;
      } else if (event.type === "event_msg" && payload.type === "token_count") {
        tokenUsage = payload.info?.total_token_usage ?? tokenUsage;
      }
    }
    return {
      threadId,
      models: [...models],
      efforts: [...efforts],
      instructionFileMessages,
      baseInstructions,
      reportedTokenUsage: tokenUsage,
    };
  }
  return null;
}
