# Am I nerfed

A CLI and an Agent Skill for asking “how well is my model performing right now?” It measures the agent you are actually using, with your account, model and reasoning settings, on a private reasoning case.

Use it to compare the same model on different mornings, or different models and reasoning settings **on the same personal baseline and difficulty**. The number is the percentage of this case answered correctly. It is not a universal intelligence score, evidence of deliberate nerfing, a model swap, or membership in an A/B experiment. Different private baselines or difficulty levels are not directly comparable.

## Install and initialize

Requires Node.js **22.20.0 or newer** and npm. This repository builds the npm package; it has not been published by this implementation.

```bash
# Once a release is published:
npm install --global am-i-nerfed
am-i-nerfed init
```

`init` opens the pinned [Agent Skills installer](https://github.com/vercel-labs/skills) with its standard agent selection, installation scope, method and confirmation flow. It installs the bundled `am-i-nerfed` skill, then generates your three private difficulty variants locally. Canceling the installer leaves your private baseline unchanged. It uses the installed dependency and local skill source: no `npx latest`, generation API, Python, Z3, model calls, or network request is required for the bundled skill or private-case generation. The standard installer may offer an optional additional `find-skills` installation; accepting that separate offer can use the network. npm installation itself downloads dependencies. Installer telemetry is disabled for this invocation.

Run plain `init` from a normal terminal to choose the agents and whether to install for the current project or globally. The installer itself controls which prompts are relevant to the detected agents. Its native agent-environment detection can choose noninteractive defaults when launched inside an agent.

Headless installation requires explicit `--yes`. Forward native options with `--agent`, `--global` and `--copy`; repeat `--agent` for multiple agents. The upstream noninteractive default is project scope. `--project` makes that intent explicit and is supported with `--yes` only; in interactive mode, choose Project in the scope picker.

```bash
am-i-nerfed init                              # standard interactive installer
am-i-nerfed init --yes --global --agent codex
am-i-nerfed init --yes --project --agent claude-code --copy
```

Restart or refresh your agent if needed for skill discovery. In a **fresh chat**, choose a difficulty:

| Level              | Assessment                                                   | Scoring                                       |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------- |
| `easy`             | Short puzzle about private observations and truthful reports | Knowledge stage: 100%                         |
| `normal` (default) | Swaps, nested knowledge, private reports and counterfactuals | Knowledge and counterfactual stages: 50% each |
| `hard`             | Original merged business-report, knowledge and dispatch case | Four stages: 25% each                         |

Invoke `/am-i-nerfed easy`, `/am-i-nerfed normal`, or `/am-i-nerfed hard` in Claude Code; use `$am-i-nerfed easy`, `$am-i-nerfed normal`, or `$am-i-nerfed hard` in Codex. Omitting the argument selects `normal`. Unknown difficulty names are rejected rather than silently changed. These levels select the puzzle, not the model's reasoning effort. Easy and normal are shorter by construction; their difficulty and runtime have not yet been calibrated across models. The model retrieves its own run, makes one best-effort reasoning pass and a short check, then submits its JSON answer with nulls for unresolved fields. It must not solve with code, browsing, other agents, previous answers, or private-key inspection; the skill allows CLI calls only to retrieve and submit the case.

Running `init` again preserves your baseline, fills in any missing difficulty variants, and reinstalls the skill. To generate a new case and identity, use `am-i-nerfed init --reset`. Reset replaces all three variants together and keeps old baseline files for your records but makes their run IDs inactive. Old scores should not be compared numerically with the replacement case. Initialization can take several seconds.

## Five-minute exam prototype

Invoke `/am-i-nerfed exam` in Claude Code or `$am-i-nerfed exam` in Codex. This is separate from the single-question assessments: four fixed questions on the current private baseline—easy, normal A, normal B and compact hard—share one **300-second deadline**. Compact hard is a shorter dispatch problem, not the long merged hard case. The bank is generated locally once, before the first exam clock starts, and remains frozen until baseline reset. Starting another exam creates an independent session on the same bank.

New exam banks in version 0.4.1 use a harder fourth question: 18 possible histories, three private symbols per agent, weighted outcomes, and a one-bit communication limit. Existing exam banks remain unchanged after upgrading; generating the new version for normal use requires a baseline reset. Compare scores only within the same bank.

```bash
am-i-nerfed exam start
am-i-nerfed exam question --exam EXAM_ID --question q1
am-i-nerfed exam save --exam EXAM_ID --question q1 --json '{"knowledge":{"field":true}}'
am-i-nerfed exam status --exam EXAM_ID
am-i-nerfed exam finish --exam EXAM_ID
```

For a shorter timed comparison, `am-i-nerfed exam start --seconds 120` starts a two-minute exam on the same bank. The default is 300 seconds; these are the two supported durations, and the duration cannot change after an exam starts. Compare results with their time budget recorded. The bundled skill defaults to five minutes; the development runner's `--seconds 120` option supplies matching two-minute instructions and the CLI deadline for controlled trials.

Use the actual field names from each question's schema. `exam save` also accepts `--file PATH` or JSON on stdin. Save partial work immediately and revise it as often as useful before the deadline. Object patches merge recursively: omitted fields preserve prior work, explicit null clears a field, and arrays/scalars replace the previous value. No correctness feedback appears while the exam is open; question retrieval shows your own saved draft, and save/status responses show only saved-field counts and the clock. These counts measure supplied values, not correctness.

Every question retrieval, accepted save and status response reports elapsed time, remaining time and the fixed deadline. Tool latency and pauses count. Finishing early freezes all drafts; otherwise the deadline closes the exam, and the next exam command materializes its final receipt. A save arriving at or after the deadline is rejected without changing drafts, even if reasoning began earlier. Finish is idempotent. There is no background process and no extension or pause command.

The CLI deadline freezes answers; a skill alone cannot interrupt an ongoing model response. The development runner in `experiments/run_timed_exam.py` also stops the Codex process at that same deadline. It runs fresh sessions with explicit medium effort and records session metadata to verify the setting. Model startup before `exam start` is outside the exam clock.

Each question contributes 25% to the total. Within a question, existing nonempty reasoning stages are weighted equally and correct scalars earn partial credit. Missing or null answers receive zero for those fields. Raw drafts are retained in owner-only private exam files to support revisions and recovery; they are not part of the package, public logs, or final score receipts. Single-question submissions still retain only their digests and aggregate receipts. A reset archives the bank and sessions together and invalidates old exam IDs on the new baseline.

The timer uses the local machine's clock. This is a prototype for comparing performance and pacing on the same fixed bank, not a calibrated intelligence measure or a tamper-resistant examination system. Repeated exposure to the bank can improve results independently of model capability.

## CLI workflow

```bash
am-i-nerfed question                    # normal, the default
am-i-nerfed question --difficulty easy   # allocate a separate easy run
am-i-nerfed question --difficulty hard   # allocate the original merged case
am-i-nerfed question --run RUN_ID        # reread this exact run
am-i-nerfed eval --run RUN_ID --file answer.json
am-i-nerfed status
am-i-nerfed history
am-i-nerfed question --new --difficulty hard # another hard measurement
```

`question` returns JSON containing a fresh run ID, difficulty, prompt hash and full question. **Every invocation allocates an independent run**, even when another chat is solving the same difficulty. Retain your run ID; `question --run ID` rereads exactly that run. `--new` remains a compatibility alias for fresh allocation and never invalidates earlier pending runs. Do not adopt an ID from another chat or substitute a newer ID because its prompt looks identical.

`eval` accepts JSON on standard input or from `--file`, plus an optional `--label "model / effort"` for your own records. Labels are user supplied, not verified model identity. Evaluation uses the baseline and difficulty recorded on the supplied run, independently of the most recently opened run. `history` lists all runs on the active baseline; `history --difficulty hard` filters by level. `status` shows the latest run per level for convenience, not ownership or permission to reuse that ID.

Each run accepts one final JSON answer, including partial, null or wrongly shaped answers. Correct remaining scalars still receive credit. The evaluator atomically claims the run using a hash of the normalized payload before grading. Repeating the **same run ID and identical JSON payload** returns the exact stored receipt without grading again or changing elapsed time; whitespace and object-key order do not matter, but array order, value types and fraction-string spelling do. A different answer on an accepted run is rejected without a new score or per-field correctness feedback.

Invalid JSON, oversized input (over 1 MiB), a missing input file, and a busy command lock are rejected before accepting an answer. A syntax-only correction is allowed; transport errors or a lost response can be retried using the same answer and original run ID. An interrupted claimed grade can finish only for that same payload and an unchanged frozen case. A completed legacy run without a payload digest cannot verify an identical retry and stays consumed; consult history instead. A stale lock left by a crashed process requires confirming that process has stopped before removing the private `.lock` directory, as the CLI error explains. Do not create or borrow another run to work around a conflict.

Results include `elapsedMs`, wall time from initial question retrieval to first answer acceptance, including pauses; retries do not restart that clock. This is not an isolated reasoning-time measurement. No per-field correctness, answer keys or raw submissions appear in receipts. Full raw submissions are not stored; private claims retain only their digests and delivery metadata.

Use new runs for new measurements, not iterative answer discovery. The CLI cannot distinguish a genuine morning assessment from a person deliberately querying repeated runs. Fresh chats, honest use of the no-tools protocol, and recording exposure matter: a fixed case is repeatable, but repeated exposure can improve scores without any underlying model change.

## What the score measures

The hard merged case retains its four equally weighted stages (25% each):

1. Reconstruct four business reports, including rounding, ordering and inferred changes in rules, and derive check digits.
2. Track nested knowledge under private observations and truthful private reports.
3. Optimize decentralized dispatch protocols, including communication and shared randomization.
4. Recompute knowledge and dispatch optima under counterfactual interventions.

A scalar earns credit only when correct; unknown fields and sections may be null. Exact rational score fields accept equivalent fractions or exact numeric spellings. Stage sizes are fixed by the generated answer, not by how many fields the model submits. The aggregate percentage does not measure factual knowledge, creativity, design ability, or general intelligence.

The hard merged case is substantial: prior trial runs used roughly **17–19k generated tokens including reasoning, in addition to the question**, depending on model and effort. The aspiration is a useful signal at low cost; this version does **not** establish the earlier target of about 1% of a subscription budget. A useful future direction is a measured difficulty-versus-token-cost curve.

## Private and deterministic by design

Initialization draws a cryptographically random 256-bit secret. The versioned generator deterministically derives each variant, then computes its answer locally. Hard derives fresh September orders, names, routing constants and the actual history. Easy and normal use independent HMAC-derived secret streams, so adding or generating one level cannot change another. The same secret and generator version reproduce the same case and grading. Ordinary CLI commands neither accept nor print the secret. Each private variant and answer are frozen until reset, including across package upgrades. Existing 0.1.0 datasets and pending runs remain hard, unchanged; missing easy/normal variants are generated lazily from the existing secret without changing baseline identity or invalidating a pending hard submission.

Hard uses a **bounded family**: four audited public July/August example templates and one shared dispatch structure. September orders are newly generated, and every retained plausible rule interpretation must agree on each generated report; ambiguous candidates are rejected. Easy and normal also use bounded epistemic puzzle families with a small discrete set of configurations. Reset can select an equivalent compact case; these variants are not guaranteed to be unique worldwide or impossible to memorize. Report rule alternatives and all generators are public software. This is not a claim that every instance has a novel underlying reasoning method, nor that future training cannot learn the family. Applying a learned method successfully is legitimate reasoning performance.

State is stored outside the project, by default under `~/.local/state/am-i-nerfed`, with owner-only directory/file permissions on Unix. It includes private secrets, questions and answer keys, plus aggregate run records and private payload digests; single-question raw submissions are not retained, while timed-exam drafts are retained privately for revision. Question, result and history output exclude keys and storage paths. `AM_I_NERFED_HOME` can select a dedicated private directory outside the current project and any Git repository; do not share, commit or synchronize it publicly. Reset archives old state rather than deleting it.

These protections discourage accidental exposure. They are **not an adversarial security boundary against the same OS user**: an agent with filesystem access can read the state and runtime, and a user can alter local files or reset. There is no misleading “encryption” claim. A trusted external evaluator would be needed to enforce secrecy against that actor. Do not open private state in the model's assessment chat.

## Develop and verify the package

The skill's `metadata.version` follows the npm package's semantic version. `npm version patch`, `minor` or `major` synchronizes it automatically; normal Git version commits include the skill change, while `--no-git-tag-version` only updates files. `npm pack` and publication reject mismatched versions. `am-i-nerfed --version` reports the CLI release. Skill metadata identifies the installed release; it does not automatically update an installed skill or enforce CLI compatibility.

```bash
npm install
npm test
npm pack
# Install the resulting tarball in a separate directory or isolated npm prefix.
npm install --global ./am-i-nerfed-0.4.1.tgz
```

For an isolated test, launch the CLI in a child process with its home and agent configuration directories pointing to a temporary home, and `AM_I_NERFED_HOME` pointing to a dedicated temporary state directory. Never test skill installation against your normal agent directories. Runtime tests need only Node; independent development comparisons against the existing Python/Z3 research oracles are optional and are not shipped in the package.

The package allowlist includes only the executable, runtime, public templates, invocation skill and this README. It excludes research, lab code, experiment runs, selected task artifacts, private seeds, answer keys, test fixtures and raw model outputs. Generation and grading are local and deterministic; no benchmark result is sent to a service.
