#!/usr/bin/env node
// A stand-in for the claude CLI that calls the Messages API directly, so a
// run sees no client harness: no system prompt and one tool that runs an
// assessment command. Use it as the Claude client command:
//   node eval/api-client.js --key-file PATH
// It reads the exam prompt on stdin and prints the stream-json events the
// runner reads from Claude Code: raw stream events, each finished response,
// and a final result with the summed usage.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { permittedCommand } from "../src/runner.js";

const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.includes("--version")) {
  console.log("am-i-nerfed api-client 1 (Messages API)");
  process.exit(0);
}
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");

const model = value("--model"), effort = value("--effort"), keyFile = value("--key-file");
if (!model || !effort || !keyFile) {
  emit({ type: "error", message: "api-client needs --model, --effort and --key-file" });
  process.exit(1);
}
const client = new Anthropic({ apiKey: fs.readFileSync(keyFile, "utf8").trim() });
const tools = [{
  name: "assessment",
  description: "Run one assessment command, for example ./assessment questions.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
}];

function run(command) {
  const result = spawnSync("/bin/sh", ["-c", command], { encoding: "utf8" });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  return { content: output || `Exit code ${result.status}`, is_error: result.status !== 0 };
}

const prompt = fs.readFileSync(0, "utf8");
const messages = [{ role: "user", content: prompt }];
const total = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  output_tokens: 0, output_tokens_details: { thinking_tokens: 0 } };
emit({ type: "system", subtype: "init", model, tools: tools.map((tool) => tool.name) });

try {
  for (let turn = 1; ; turn++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort },
      cache_control: { type: "ephemeral" },
      tools,
      messages,
    });
    for await (const event of stream) emit({ type: "stream_event", event });
    const message = await stream.finalMessage();
    for (const field of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"])
      total[field] += message.usage[field] ?? 0;
    total.output_tokens_details.thinking_tokens += message.usage.output_tokens_details?.thinking_tokens ?? 0;
    // The runner vets shell commands the way Claude Code reports them, so
    // each assessment call is shown as a Bash command.
    emit({ type: "assistant", message: { ...message, content: message.content.map((block) =>
      block.type === "tool_use" ? { ...block, name: "Bash", input: { command: String(block.input?.command) } } : block) } });
    const calls = message.content.filter((block) => block.type === "tool_use");
    if (message.stop_reason !== "tool_use" || !calls.length) {
      emit({ type: "result", subtype: "success", is_error: false, stop_reason: message.stop_reason,
        num_turns: turn, usage: total });
      break;
    }
    messages.push({ role: "assistant", content: message.content });
    const results = calls.map((call) => {
      const command = call.input?.command;
      if (typeof command !== "string")
        return { type: "tool_result", tool_use_id: call.id, is_error: true, content: "command must be a string" };
      if (!permittedCommand(command))
        return { type: "tool_result", tool_use_id: call.id, is_error: true, content: "Only the assessment commands are allowed" };
      return { type: "tool_result", tool_use_id: call.id, ...run(command) };
    });
    emit({ type: "user", message: { role: "user", content: results } });
    messages.push({ role: "user", content: results });
  }
} catch (error) {
  emit({ type: "error", message: error instanceof Anthropic.APIError ? `API error ${error.status}: ${error.message}` : error.message });
  process.exit(1);
}
