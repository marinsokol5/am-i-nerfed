# Am I nerfed

A private reasoning test for your coding agent. Six tasks at one difficulty, one time or token budget, one score you can compare with your earlier runs.

The tasks and answer keys are generated on your machine from a random seed, so no model has seen them. Nothing is sent anywhere.

## Install

Requires Node.js 22.20 or newer.

```bash
npm install --global am-i-nerfed
am-i-nerfed init
```

`init` builds your private task bank; it makes no model calls.

## Run

**CLI:** starts a fresh Claude Code or Codex session through your existing login and stops it at the deadline.

```bash
am-i-nerfed run --agent claude --model claude-opus-5-5 --effort high
am-i-nerfed run --agent codex --model gpt-6-astra --effort high --difficulty hard --seconds 360
am-i-nerfed run --agent claude --model claude-opus-5-5 --effort high --max-output-tokens 10000
```

Defaults are medium difficulty and 180 seconds. `--max-output-tokens` replaces the time limit with a budget of output tokens, reasoning included.

**Skill:** the agent you are already talking to takes the test in its current conversation.

```bash
am-i-nerfed skill install
```

Then ask your agent: `/am-i-nerfed medium 180` (Claude Code) or `$am-i-nerfed medium 180` (Codex). A skill cannot interrupt its host mid-answer, so only the answer deadline is enforced; use the CLI for a hard cutoff.

## What it measures

| Difficulty | Tasks |
|---|---|
| easy, medium | hats, cards, knowledge, tracking, coordination, program synthesis |
| hard | hats, knowledge, coordination, three-mode coordination, adversarial diagnosis, program synthesis |

Each task is worth a sixth of the score and gives partial credit. Only answers saved before the deadline or budget count. The solver may only use the assessment commands: no code, browsing or files. It is an honest-use test, not a security boundary.

```bash
am-i-nerfed history list
am-i-nerfed doctor
```

## Results

[eval/RESULTS.md](eval/RESULTS.md) compares 13 models under time limits and token budgets. Each cell is one run, so treat small differences as noise.

## Development

```bash
npm test
```

[eval/](eval/README.md) holds the harness that runs many models and writes those results. Keep `skills/am-i-nerfed/SKILL.md` and the CLI prompt in sync; see [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
