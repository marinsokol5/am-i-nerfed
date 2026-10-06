// Codex counts come from its session log, which misses a response cut off by
// the stop. Claude's exact count arrives only when it ends its own turn;
// otherwise it is estimated from the stream.
export function tokenUsage(run) {
  const execution = run?.execution;
  if (!execution) return null;
  const native = execution.nativeEvidence?.reportedTokenUsage;
  if (native)
    return { output: native.output_tokens, reasoning: native.reasoning_output_tokens ?? null,
      input: native.input_tokens, exact: Boolean(execution.terminal) };
  const usage = execution.terminal ? execution.usage : null;
  if (usage?.output_tokens != null)
    return { output: usage.output_tokens, reasoning: usage.output_tokens_details?.thinking_tokens ?? null, exact: true,
      input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) };
  const stream = execution.streamUsage;
  if (stream)
    return { output: stream.estimated_output_tokens, reasoning: stream.estimated_reasoning_tokens ?? null,
      exact: Boolean(stream.exact),
      input: stream.input_tokens + stream.cache_creation_input_tokens + stream.cache_read_input_tokens };
  return null;
}
