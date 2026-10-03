---
name: am-i-nerfed
description: Run a timed reasoning assessment on the current agent.
metadata:
  version: "0.9.1"
---

## Prerequisites

- The `am-i-nerfed` CLI is installed and available in the current shell -> run `am-i-nerfed --version` to verify; otherwise ask user to run `npm install -g am-i-nerfed` themselves and restart the session.
- The question bank of `am-i-nerfed` has been created -> run `am-i-nerfed doctor --init` and check that it prints back `true`; otherwise ask user to run `am-i-nerfed init` themselves.
- Skill arguments -> difficulty <DIFFICULTY>: `easy`, `medium`, or `hard` (default `medium`) and a total allowance in positive whole seconds <TIME> (default `120`); for example `/am-i-nerfed medium 120` (`/am-i-nerfed <DIFFICULTY> <TIME>`). These select the puzzle difficulty level and time budget, not your reasoning effort. Reject invalid arguments before starting.

## Rules

- You have limited <TIME> to complete, as well as you can, 5 <DIFFICULTY> tasks; timer starts with `am-i-nerfed start` and is exposed to you at any moment through `am-i-nerfed timer --run <RUN-ID>`.
- Solve the tasks inside of the current conversation -> using the current model, reasoning effort, instructions, and prior conversation. Do not launch a fresh model, do not use a subagent, do not call `am-i-nerfed run`.
- Solve by reasoning only -> no code calculations, browsing, file inspection, prior answers, outside models or delegation. Only the assessment CLI is permitted for retrieving questions, answering and checking time.
- No correctness feedback is returned while an assessment is active. 
- It's highly recommended to attempt all 5 tasks before spending the remaining time on refinements. Use short reasoning passes and frequent partial answers to avoid losing work.
- There is no reward for finishing the assessment early or for stopping work with the timer still ticking. Saved answers are kept; being mid-thought when time runs out costs nothing.

## Assessment

1. Start the assessment -> `am-i-nerfed start --invocation skill --difficulty <DIFFICULTY> --seconds <TIME>`; substituting requested difficulty/time. Add `--agent` (`codex`, `claude`, `hermes`, ...), `--provider` (`openai`, `anthropic`, `nous`, ...), `--model` (`gpt-6-astra`, `claude-opus-5-5`, ...), and `--effort` (`low`, `medium`, `high`, ...) only when actually known, omitting unknown values; this metadata is self-reported.
    a) Retain the exact returned run ID (<RUN-ID>) and five task IDs (<TASK-ID>).
2. Retrieve individual task and see currently submitted answer -> `am-i-nerfed question --run <RUN-ID> --task <TASK-ID>`, or all five at once -> `am-i-nerfed questions --run <RUN-ID>`. Answer in the shape of `response`; each value is a JSON type (boolean, integer, string) or a name defined in `types`.
3. Submit a new answer or revise existing -> `am-i-nerfed answer --run <RUN-ID> --task <TASK-ID> --json '<JSON>'`. Quoted stdin or `--file` is also accepted if needed for transport; do not use files to calculate answers. Partial JSON objects merge recursively, omitted fields preserve prior work.
4. You can check timer at any moment through `am-i-nerfed timer --run <RUN-ID>`.
5. Once the deadline has passed, stop reasoning and obtain the evaluation result through `am-i-nerfed status --run <RUN-ID>`. Late answers/revisions are rejected. If you are 100% sure in each of your answers and see no use in thinking more about any one of them, you can call `am-i-nerfed finish --run <RUN-ID>` instead of waiting. Final score is at `result.percent`; communicate it back to the user.
