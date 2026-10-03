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
node bin/am-i-nerfed.js init
node bin/am-i-nerfed.js run --agent codex --model YOUR_MODEL --effort medium
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

## Exploratory benchmark

One scored iteration per model × difficulty × time allowance: easy, medium and hard, each at 60, 120 and 300 seconds. Every run uses five tasks from the same frozen 15-task bank. Models are sorted by the arithmetic mean of all nine equally weighted scores, highest first; no best-run selection. Early finishes are final, with no reminders. Allowances include client startup, question retrieval and answer submission; only answers saved before the deadline count. **One iteration is not representative:** this exploratory table does not establish a reliable model ranking.

| Rank | Model ID | Mean score | Runs | Am I nerfed version | Test date (Europe/Amsterdam) |
|---:|---|---:|---:|---|---|
| 1 | `claude-opus-5-5` | 83.55%‡ | 9/9 | 0.5.3 | 2026-10-02 |
| 2 | `gpt-6.1-sol` | 77.09% | 9/9 | 0.5.3 | 2026-10-02 |
| 3 | `claude-sonnet-5-5` | 75.07% | 9/9 | 0.5.4, 0.5.5 | 2026-10-02–2026-10-03 |
| 4 | `gpt-6-astra` | 74.53% | 9/9 | 0.5.2, 0.5.3 | 2026-10-02 |
| 5 | `gpt-6-sol` | 65.97% | 9/9 | 0.5.2, 0.5.3 | 2026-10-02 |
| 6 | `gpt-5.6-terra` | 59.68%† | 9/9 | 0.5.3 | 2026-10-02 |
| 7 | `claude-opus-5` | 58.14% | 9/9 | 0.5.4, 0.5.5 | 2026-10-03 |
| 8 | `gpt-6-luna` | 43.11%† | 9/9 | 0.5.2, 0.5.3 | 2026-10-02 |
| 9 | `claude-sonnet-5` | 22.65% | 9/9 | 0.5.4, 0.5.5 | 2026-10-02–2026-10-03 |

**Separate effort cohort.** Haiku 4.5 was requested at medium, but this model does not support that effort setting. Native request evidence shows enabled thinking with an unknown token budget; effective effort is unknown. Its scores are reported separately and excluded from the ranking above.

| Model ID | Mean score | Runs | Am I nerfed version | Test date (Europe/Amsterdam) |
|---|---:|---:|---|---|
| `claude-haiku-4-5-20251001` | 10.63% | 9/9 | 0.5.4, 0.5.5 | 2026-10-03 |

Fresh native Codex and Claude Code sessions excluded personal/project instructions. Ranked models have verified medium effort; provider system prompts and tools still differ, and matching effort labels do not guarantee equal computation. Test dates use Europe/Amsterdam, and each row lists the actual application versions used.

Am I nerfed **0.5.2–0.5.5** was tested with an unchanged bank, grading and time limits. Version 0.5.4 added an optional invitation to challenge assumptions or double-check with remaining time. Versions 0.5.3 and 0.5.5 made malformed answer JSON and missing final quotes recoverable transport errors, respectively. The instruction change and different native clients prevent a controlled comparison of models alone.

One Sonnet 5.5 medium/60-second attempt was excluded **without a score** after the harness incorrectly aborted a missing-quote error at 28 seconds. Only that cell was repeated after the 0.5.5 fix; all seven completed 0.5.4 runs were retained.

Native CLI versions tested: Codex 0.160.0; Claude Code 2.1.287. Task-bank version **1**, protocol version **1**.

† Delivery issues: GPT-6 Luna medium/120s (2 incomplete question outputs; 2 not fully retrieved later); GPT-5.6 Terra hard/120s (1 incomplete question output; 1 not fully retrieved later). Scores are preserved and include retrieval errors as well as reasoning.

‡ Opus 5.5’s hard/60-second result was recovered from its original saved receipt after a cleanup error. It was not rerun; its exact process-stop timestamp is unavailable.

## Development

```bash
npm test
npm pack
```

The package contains the runtime and skill. Local research, prior experiments, generated instances, model outputs and caches are ignored by Git and excluded from the package. Tests use synthetic fixtures and fake CLI processes rather than paid model calls. Updating package version synchronizes skill metadata; packing rejects a mismatch.
