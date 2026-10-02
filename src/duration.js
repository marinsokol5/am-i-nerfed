// No preset budgets: accept positive whole seconds whose millisecond deadline
// can be represented exactly by JavaScript's number and Date types.
export function durationSeconds(value = 120, now = Date.now()) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !Number.isSafeInteger(value * 1000) ||
    !Number.isFinite(new Date(now + value * 1000).getTime())
  ) {
    throw Error(
      "Seconds must be a positive whole number with a representable deadline",
    );
  }
  return value;
}
