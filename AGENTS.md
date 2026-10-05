# Agent notes

## Keep assessment instructions in sync

The same assessment instructions exist in two places:

- `skills/am-i-nerfed/SKILL.md` (`## Rules`, `## Assessment`): skill mode, solved in the current conversation.
- `examPrompt` in `src/runner.js`: CLI mode (`am-i-nerfed run`), sent to a fresh Codex or Claude session.

When you change one, change the other in the same commit, using the same wording. Only the mode-specific parts may differ:

- commands: `am-i-nerfed … --run <RUN-ID>` in the skill, `./assessment …` in CLI mode
- skill only: arguments, metadata flags, the in-conversation rule, reporting the score to the user
- CLI only: the clock starts at launch, the process is stopped at the deadline, ending the turn ends the run, one command at a time without shell syntax, the optional output-token budget
