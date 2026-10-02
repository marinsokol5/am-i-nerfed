#!/usr/bin/env node
import { main } from "../src/cli.js";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 20)) {
  process.stderr.write("am-i-nerfed requires Node.js 22.20.0 or newer.\n");
  process.exit(1);
}
main().catch((error) => {
  process.stderr.write(`am-i-nerfed: ${error.message}\n`);
  process.exitCode = 1;
});
