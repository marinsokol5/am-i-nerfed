# Am I nerfed

A private reasoning assessment for your coding agent. Five tasks, a shared time allowance, and a percentage you can compare with your own previous runs.

Two invocation methods share the same task bank and grader:

- **CLI:** a fresh Codex or Claude Code session through your existing login, using the native system prompt with personal/project instructions excluded. A watchdog stops the owned process group.
- **Skill:** the current agent solves the assessment in its existing conversation, with its current instructions and reasoning effort. Works with other agents that can execute shell commands. The answer deadline is enforced, but a portable skill cannot interrupt its host mid-response.

History records the invocation method so these different contexts remain visible.

## Setup

Requires Node.js 22.20 or newer. The package is not published yet. To try the working repository without installing globally:

```bash
npm install
node bin/am-i-nerfed.js init --agent codex --model YOUR_MODEL --effort medium
node bin/am-i-nerfed.js run
```

After a release is published:

```bash
npm install --global am-i-nerfed
am-i-nerfed init
am-i-nerfed run
```

Interactive initialization asks for your preferred agent, model and effort. Noninteractive `init` can receive those flags or simply create the bank; `run` needs a configured or explicitly supplied agent and model. Initialization generates questions and answer keys locally and makes no model calls. Re-running `init` preserves the existing bank.

## Daily CLI use

```bash
am-i-nerfed run
am-i-nerfed run --agent claude --model YOUR_MODEL --effort medium
am-i-nerfed run --difficulty easy
am-i-nerfed run --difficulty hard --seconds 300
am-i-nerfed doctor
```

Defaults are **medium difficulty and 120 seconds**. Any positive whole number of seconds is accepted, for example `--seconds 200`. Difficulty selects questions; effort is the model's reasoning setting. There is no silent fallback to another model or effort. Returned metadata records settings as configured, plus any observed model/effort evidence exposed by the client. Equivalent effort names across providers do not guarantee equivalent computation.

The supervised runner currently supports macOS and Linux. It invokes installed `codex` or `claude` executables directly and retains their native authentication locations. No credentials are read or copied by Am I nerfed. Codex assessments use an application-owned Codex home without personal instructions, linking only the existing `auth.json`; file-backed Codex login is currently required. Native CLI versions must support the isolation and event-stream flags used by the adapters. Managed organizational policies still apply.

The clock starts at client launch, after local bank generation and version checks. Startup, reasoning, retrieval and answer submission all count. Every transport response includes the immutable deadline, elapsed seconds and remaining seconds. The model retrieves questions individually and can save partial work repeatedly. Early finishing, or ending the first turn, ends the assessment permanently: **no reminder or second attempt**.

At the deadline, the runner requests termination and escalates to killing its process group after a short grace period. Short answer-transport operations finish their cleanup separately, while the grader rejects late writes. The local cutoff does not guarantee that a provider has immediately cancelled every in-flight server request, nor a fixed subscription-usage percentage. Client startup/permission failures are recorded as failed measurements without a score.

Only the assessment transport is allowed for solving runs; no code solving, browsing, file inspection or delegation. Native permission controls are supplemented by an event audit. This is an honest-use assessment, not a security boundary against a malicious agent with the same OS access.

## Skill use

Install the skill through the bundled, pinned Agent Skills (`skills`) package if you want the in-context mode; this command delegates to its standard installer:

```bash
am-i-nerfed skill install
am-i-nerfed skill install --yes --global --agent codex
```

Invoke `$am-i-nerfed medium` in Codex or `/am-i-nerfed medium` in Claude Code. The skill also accepts `easy`, `hard`, and any positive whole number of seconds, for example `$am-i-nerfed medium 200`. It runs the **current model directly**, without a fresh CLI solver or subagent. Existing instructions and prior conversation remain part of the measurement.

The skill records `invocation: skill`, self-reported metadata where known, and `clockEnforcement: answer-deadline`. It checks time frequently and stops when the deadline is observed. **It cannot promise to kill ongoing reasoning at two minutes.** Use the supervised CLI when computation cutoff is required. Unknown model/effort values stay unknown.

## Composable assessment commands

These are the same operations the skill uses:

```bash
am-i-nerfed start --invocation skill --difficulty medium --seconds 120
am-i-nerfed question --run RUN_ID --task medium-1
am-i-nerfed answer --run RUN_ID --task medium-1 --json '{"knowledge":{"field":true}}'
am-i-nerfed status --run RUN_ID
am-i-nerfed finish --run RUN_ID
```

Use the exact run/task IDs and answer schema returned by the CLI. `start` may include known `--agent`, `--provider`, `--model` and `--effort` metadata. `answer` also accepts JSON from stdin or `--file PATH`.

Answers merge recursively: omitted object fields retain previous work, explicit null clears a field, and arrays/scalars replace. Partial answers and revisions are allowed until finish or deadline. No correctness feedback is returned while the run is active. Late submissions cannot alter saved answers. `finish` is optional: saved answers freeze at the deadline without it, and `status` then returns their score. Use `finish` only to deliberately end early; there is no need to reserve time for that command. Repeated finish calls return the same receipt. There is no pause, extension, reset or retry within an attempt.

Transport commands emit JSON to stdout. `run` prints a short score summary and `history list` prints a table; add `--json` to either for structured output. Runner progress goes to stderr. Transport commands called directly enforce answer acceptance times only; they do not own or kill an external agent process.

## Private task bank and scoring

Each baseline has **15 tasks: five easy, five medium, five hard**. A run selects one difficulty and uses all five tasks under one shared clock. Every task contributes 20%; within a task, nonempty reasoning stages are weighted equally and exact answer fields earn partial credit. Missing answers earn zero for their fields.

| Family            | Easy                                  | Medium                                           | Hard                                                             |
| ----------------- | ------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Hats              | Five people, one round                | Six people, two rounds                           | Seven people, two rounds and changed order                       |
| Card dialogue     | Ten cards                             | Fourteen cards, nested uncertainty               | Eighteen cards, longer dialogue with deeper predicates available |
| Private knowledge | Fixed bits and private replies        | Swaps, private observations and counterfactuals  | Two independent normal protocols                                 |
| Belief tracking   | 18 events, direct beliefs             | 40 events, second-order beliefs                  | 75 events, third-order beliefs                                   |
| Coordination      | Eight histories, deterministic optima | Eight histories, randomization and communication | Eighteen weighted histories and restricted communication         |

The task bank combines the earlier Claude and Codex research. These are **designed difficulty levels, not calibrated difficulty guarantees**. Private seeding changes instances; finite task families can repeat or be learned. The score measures this assessment, not universal intelligence or proof of deliberate nerfing.

Banks remain frozen across software upgrades. To generate a fresh bank with the installed generator:

```bash
am-i-nerfed reset --yes
```

Reset preserves old files and history under their old baseline. Old run IDs cannot be continued against the new baseline. Compare only matching bank, difficulty, time allowance, protocol, and invocation method; use model and effort to group repeated measurements.

## History and versioning

```bash
am-i-nerfed history list
am-i-nerfed history list --provider openai --model YOUR_MODEL --effort medium
am-i-nerfed history list --invocation skill --difficulty hard
am-i-nerfed history list --agent claude --seconds 120
am-i-nerfed history list --version 0.5.0 --task-version 1
am-i-nerfed history list --baseline BASELINE_ID --status finished
```

Each run records the package version, task-bank version, bank fingerprint, protocol version, baseline, difficulty, allowance, invocation, deadline enforcement, and known model settings. A new software release and a new question bank are separate changes. History includes older baselines; it does not expose private keys or drafts. Results from the retired 0.4 prototype remain on disk, but are not migrated into the new assessment history.

Private state defaults to `~/.local/state/am-i-nerfed`. `AM_I_NERFED_HOME` can select a dedicated directory outside projects and Git repositories. Keys and saved drafts stay in owner-only files; the solver receives only questions and its own drafts. This prevents accidental sharing, not access by the same OS user. No benchmark results are sent to a separate service.

## Development

```bash
npm test
npm pack
```

The package contains the runtime and skill. Local research, prior experiments, generated instances, model outputs and caches are ignored by Git and excluded from the package. Tests use synthetic fixtures and fake CLI processes rather than paid model calls. Updating package version synchronizes skill metadata; packing rejects a mismatch.
