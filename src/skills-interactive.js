// Terminal-preserving receipt adapter for the pinned skills@1.7.0 CLI.
// Upstream exits 0 on interactive cancellation and has no interactive JSON mode.
import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
let transcript = "";
const receipt = { installed: false, cancelled: false, failed: false };
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write;
  stream.write = function (chunk, ...args) {
    transcript = (transcript + stripVTControlCharacters(String(chunk))).slice(
      -8192,
    );
    if (/Installed \d+ skills?\b/.test(transcript)) receipt.installed = true;
    if (/Installation cancelled\b/.test(transcript)) receipt.cancelled = true;
    if (/(?:Failed to install \d+|Installation failed)\b/.test(transcript))
      receipt.failed = true;
    return original.call(this, chunk, ...args);
  };
}
process.on("exit", () => {
  try {
    writeSync(3, JSON.stringify(receipt));
  } catch {
    /* Parent cannot confirm success without a receipt. */
  }
});
const [, , executable, ...args] = process.argv;
process.argv = [process.execPath, executable, ...args];
await import(pathToFileURL(executable).href);
