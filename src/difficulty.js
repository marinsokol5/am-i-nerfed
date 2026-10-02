export const DIFFICULTIES = Object.freeze(["easy", "normal", "hard"]);
export const DEFAULT_DIFFICULTY = "normal";
export function difficultyLevel(value = DEFAULT_DIFFICULTY) {
  if (!DIFFICULTIES.includes(value))
    throw Error(
      `Unknown difficulty: ${String(value)}. Choose easy, normal, or hard.`,
    );
  return value;
}
