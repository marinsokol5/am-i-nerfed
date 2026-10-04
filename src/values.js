// Value checks shared by the assessment, graders and checkpoint tasks.

export const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Whether `actual` is a duplicate-free array of exactly the values of the
 * duplicate-free `expected`, in any order. */
export function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && new Set(actual).size === actual.length
    && Array.from(actual).every((value) => expected.includes(value));
}
