---
name: am-i-nerfed
description: Run a private timed reasoning assessment using the current agent and conversation context. Use when the user asks to run Am I nerfed or assess their current agent. Works wherever shell commands are available.
metadata:
  version: "0.5.1"
---

Assess yourself using the current model, reasoning effort, instructions, and conversation. Do not launch a fresh model, use a subagent, or call `am-i-nerfed run`. That command is the separate clean CLI mode.

Accept difficulty `easy`, `medium`, or `hard` (default `medium`) and an optional total allowance in positive whole seconds (default `120`; for example, `$am-i-nerfed medium 200` or `/am-i-nerfed medium 200`). These select the puzzle level and shared time budget, not your reasoning effort. Each run has five tasks. Reject invalid arguments before starting.

A portable skill cannot interrupt its host model during reasoning. Briefly state that this is an in-context assessment with an enforced answer deadline, but no guaranteed computation cutoff. Do not promise a hard token budget or that your process will be killed. If the user requires a hard computation cutoff, explain that they need the supervised CLI mode and do not start an in-context attempt instead.

1. Call `am-i-nerfed start --invocation skill --difficulty medium --seconds 120`, substituting requested difficulty/time. Add `--agent`, `--provider`, `--model`, and `--effort` only when actually known; omit unknown values. This metadata is self-reported. Retain the exact returned run ID and five task IDs. If not initialized, tell the user to run `am-i-nerfed init`; do not initialize or reset during the assessment.
2. Retrieve tasks individually with `am-i-nerfed question --run ID --task TASK_ID`. Read the returned clock and answer schema. Solve by reasoning yourself: no code calculations, browsing, file inspection, prior answers, outside models or delegation. Only the assessment CLI is permitted for retrieving questions, answering and checking time. Existing conversation context remains part of what is measured; acknowledge known prior exposure to these puzzles.
3. Submit early and revise through `am-i-nerfed answer --run ID --task TASK_ID --json '<JSON>'`. Quoted stdin or `--file` is also accepted if needed for transport; do not use files to calculate answers. Partial JSON objects merge recursively: omitted fields preserve prior work, explicit null clears a field, arrays/scalars replace. Unknowns may be null. Every accepted answer, question, and status response includes elapsed/remaining time. No correctness feedback is returned while active.
4. Attempt all five tasks before spending the remaining time on refinements. Use short reasoning passes and frequent partial answers to avoid losing work. `am-i-nerfed status --run ID` checks the clock without changing an answer. Once the deadline has passed, stop reasoning and obtain the result. Late answers are rejected. Do not start another run to extend the budget.
5. When ready, call `am-i-nerfed finish --run ID`. Finishing early is final; there is no reminder or retry to improve the score. Always finish before ending your turn voluntarily. A returned closed/expired result is also final. Report total and task scores, time used, and that this was a skill run in the existing context. Do not reveal answer keys or interpret the percentage as universal intelligence.

Correct only syntax after invalid JSON. Retry a failed delivery with the same run ID and exact answer, at most twice, and heed the returned deadline. If blocked, preserve the run ID and report the blockage. Never reset, borrow another run, or claim a grade you did not receive. The user can inspect past results with `am-i-nerfed history list --invocation skill`; do not inspect history while solving.
