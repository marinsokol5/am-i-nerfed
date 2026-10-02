---
name: am-i-nerfed
description: Measure this agent's reasoning on the user's initialized private Am I nerfed case or five-minute exam. Use when the user asks to run Am I nerfed or measure their current model's reasoning performance.
metadata:
  version: "0.4.1"
---

Run the assessment yourself, using the current model and reasoning setting.

For `/am-i-nerfed exam` or `$am-i-nerfed exam`, follow the timed exam workflow below instead of the single-question steps. Otherwise accept one optional difficulty argument: `easy`, `normal`, or `hard`; default to `normal` when omitted. Examples: `/am-i-nerfed easy`, `/am-i-nerfed normal`, `/am-i-nerfed hard` in Claude Code, or `$am-i-nerfed hard` in Codex. If a supplied difficulty is invalid, ask the user to choose `easy`, `normal`, `hard`, or `exam` and do not start a run. Do not treat difficulty as the model's reasoning-effort setting.

Easy is a short private-observation puzzle; normal adds swaps, nested knowledge and counterfactuals; hard is the original merged report, knowledge and dispatch case. These are different assessments, not interchangeable scores.

## Timed exam

Use this section only for the `exam` argument. The initialized baseline has four fixed questions: easy, normal A, normal B, and compact hard (not the long single-question hard case). There is one shared **300-second deadline**, beginning with `exam start`; tool calls and pauses count.

1. Run `am-i-nerfed exam start` once and retain its exact exam ID. Every response shows the deadline, elapsed time and remaining time. Do not start another exam to extend the clock.
2. Retrieve `am-i-nerfed exam question --exam <id> --question q1`, then q2, q3 and q4. Reason yourself without code, browsing, other models, delegation, prior answers or private-file inspection. Exam CLI retrieval, status, saves and finish are the only permitted tools; use them for transport and clock feedback, not solving.
3. **Save partial work early and repeatedly.** Use `am-i-nerfed exam save --exam <id> --question q1 --json '<JSON>'` (or a quoted heredoc on stdin). Save fields you have, even if most remain unknown, before doing more reasoning or moving on. Saves recursively merge objects; omitted fields preserve previous work, explicit null clears a field, and arrays/scalars replace. Revisions are encouraged while time remains. No correctness feedback is given during the exam.
4. Give all four questions a first pass before spending the remaining time on revisions. Keep checking the clock returned by each question/save; use `exam status --exam <id>` if unsure. When time is low, save your current partial answer immediately. Do not spend the whole budget perfecting the first question or postpone all saving until the end. Unsaved reasoning earns no credit after the deadline.
5. Run `am-i-nerfed exam finish --exam <id>` when ready; this freezes the saved drafts and reveals the final grade. At the deadline the saved drafts freeze automatically, and the next exam command returns the final result. Late saves are rejected. Finish is safe to retry with the same ID. If transport is blocked, retain the ID and report the blockage; do not reset or switch exams. Report the total and four question scores, noting partial answers and any outside help. Each question is worth 25%; compare only the same baseline and exam mode.

## Single-question assessment

Follow these steps for `easy`, `normal`, or `hard`, not for `exam`.

1. Once per invocation, execute `am-i-nerfed question --difficulty <level>`. This allocates a fresh run belonging to this assessment. Retain its exact run ID and difficulty throughout the chat. If you need to reread the question, use `am-i-nerfed question --run <runId>`; never retrieve or adopt another chat's latest ID. If initialization is missing, tell the user to run `am-i-nerfed init`; do not initialize or reset during an assessment.
2. Make one best-effort reasoning pass, then a short consistency check. Unknowns are normal: use null for any unresolved field or section, and submit what you have rather than exhaustively backtracking to fill every field. The case's no-tools rule applies to solving: do not run code, browse, inspect files or package source, query other models, delegate, or read private storage. Permitted CLI calls only retrieve this run's question and deliver its answer. Do not consult prior scores or solutions. A fresh chat is preferable for each measurement.
3. Submit your best-effort JSON object to `am-i-nerfed eval --run <runId>` through standard input using a quoted shell heredoc. The shell is transport only, not a calculator. There is one final grade, not a sequence of tentative scoring queries. After a syntax error, correct only the JSON syntax. After a transport error, busy lock, lost response, or interrupted delivery, retry the **same JSON answer with the same run ID**; identical retries return the saved receipt or finish that answer's interrupted grade. Make at most two automatic delivery retries, then report the blockage while preserving the original ID and answer. Never revise an accepted answer, reset, switch IDs, or start another run to bypass a conflict. If a different answer was already accepted, a legacy consumed run cannot verify a retry, or the run belongs to an older baseline, report that blockage and retain the original ID. Honor any genuine tool approval block; do not claim scoring succeeded when delivery was blocked.
4. Report the returned difficulty, percentage and available stage scores concisely; include elapsed time if useful (wall time from question retrieval to first answer acceptance, including pauses). Say this is correctness on the user's private case, not a universal intelligence percentage or proof of nerfing. Identify the model/effort only if known; do not guess. Mention outside help, prior solutions, or a non-fresh conversation because they limit comparability.

The hard case is substantial (prior trial runs used roughly 17–19k generated tokens including reasoning, in addition to the question). Do not promise a fixed subscription-budget percentage. Easy and normal are shorter by design, but their speed and difficulty have not been calibrated across models. Compare only runs on the same baseline and difficulty, and acknowledge repeated-exposure effects. Do not reveal or reconstruct the answer key after scoring.
