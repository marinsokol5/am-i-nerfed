import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);

export function installerArguments(opts) {
  if (opts["--global"] && opts["--project"])
    throw Error("Choose either --global or --project, not both.");
  if (opts["--project"] && !opts["--yes"])
    throw Error(
      "For interactive installation, omit --project and choose Project in the installer; for headless installation, use --yes --project.",
    );
  const args = [
    "add",
    fileURLToPath(new URL("../skills", import.meta.url)),
    "--skill",
    "am-i-nerfed",
  ];
  if (opts["--agent"]) args.push("--agent", ...opts["--agent"]);
  if (opts["--global"]) args.push("--global");
  if (opts["--copy"]) args.push("--copy");
  if (opts["--yes"]) args.push("--yes", "--json");
  // The upstream noninteractive default is project scope; it has no --project flag.
  return args;
}
export async function installSkill(opts) {
  const args = installerArguments(opts);
  if (!opts["--yes"] && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw Error(
      "Interactive skill installation requires a terminal. Run skill install there, or explicitly use --yes with --agent and --global/--project for headless installation. Initialization was not changed.",
    );
  const executable = path.join(
    path.dirname(require.resolve("skills/package.json")),
    "bin",
    "cli.mjs",
  );
  const env = { ...process.env, DO_NOT_TRACK: "1" };
  if (!opts["--yes"]) {
    // All terminal descriptors remain inherited so the actual upstream chooser
    // retains raw input, terminal width, colors and cursor behavior. FD 3 carries
    // a receipt observed from the pinned installer's own output, never a prompt.
    const receipt = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./skills-interactive.js", import.meta.url)),
          executable,
          ...args,
        ],
        { env, stdio: ["inherit", "inherit", "inherit", "pipe"] },
      );
      let output = "";
      child.stdio[3].on("data", (data) => (output += data));
      child.on("error", reject);
      child.on("close", (code, signal) => {
        let result;
        try {
          result = JSON.parse(output);
        } catch {
          result = {};
        }
        if (code !== 0 || signal)
          return reject(
            Error(
              "Agent Skills installation did not finish. Initialization was not changed.",
            ),
          );
        if (result.cancelled) return resolve(null);
        if (!result.installed || result.failed)
          return reject(
            Error(
              "Agent Skills did not confirm successful installation. Initialization was not changed.",
            ),
          );
        resolve({ installed: true, interactive: true, installer: "skills" });
      });
    });
    return receipt;
  }
  const result = spawnSync(process.execPath, [executable, ...args], {
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw Error(
      `Agent Skills installation failed${result.error ? ": " + result.error.message : ": " + (result.stderr || result.stdout).slice(-1500)}. Initialization was not changed.`,
    );
  let records;
  try {
    records = JSON.parse(result.stdout);
  } catch {
    throw Error(
      "Agent Skills returned an unreadable installation result. Initialization was not changed.",
    );
  }
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.some((r) => r.status !== "installed")
  )
    throw Error(
      "Agent Skills did not confirm installation. Initialization was not changed.",
    );
  return {
    installed: true,
    interactive: false,
    agents: records[0].agents,
    scope: records[0].scope,
    mode: records[0].mode,
  };
}
