/** Exact two-mode dispatch optimization over complete private contexts.
 *
 * A success prescribes one-hot actions at each actor's full observation. Two
 * successful events are compatible precisely when those prescriptions agree.
 * The weighted conflict graph therefore has the same Pareto frontier as the
 * complete local-policy problem. No selected puzzle answers are stored here.
 */

export const CASES = Object.freeze([
  "base",
  "mixed",
  "mode_1",
  "mode_2",
  "forced_wait",
  "forced_dispatch",
  "binding",
  "broadcast",
  "relay",
  "priority_ABC",
]);

const BASE_CASES = new Set([
  "base",
  "mixed",
  "mode_1",
  "mode_2",
  "public_base",
  "no_swap_base",
]);
const graphCache = new Map();
const GRAPH_CACHE_LIMIT = 512;

// Structural equality preserves tuple-like contexts crossing the JSON boundary.
// Tags prevent a string, a number, and an array from sharing a local context.
function contextKey(value) {
  if (value === null) return "null";
  if (typeof value === "string") return `s${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "b1" : "b0";
  if (typeof value === "number" && Number.isFinite(value)) return `n${value}`;
  if (Array.isArray(value)) return `a[${value.map(contextKey).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `o{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${contextKey(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Contexts must contain JSON-compatible values");
}

function partition(values, key = (value) => value) {
  const cells = new Map();
  return values.map((value) => {
    const encoded = key(value);
    if (!cells.has(encoded)) cells.set(encoded, cells.size);
    return cells.get(encoded);
  });
}

function prepare(contexts, targets, weights, forcedContext) {
  if (
    !Array.isArray(contexts) ||
    contexts.length !== 3 ||
    !Array.isArray(contexts[0]) ||
    !contexts[0].length
  ) {
    throw new RangeError("Expected three actors and at least one history");
  }
  const count = contexts[0].length;
  if (
    contexts.some((own) => !Array.isArray(own) || own.length !== count) ||
    !Array.isArray(targets) ||
    targets.length !== 2
  ) {
    throw new RangeError("Context/history or mode dimensions disagree");
  }
  const keys = contexts.map((own) => own.map(contextKey));
  const normalized = keys.map((own) => partition(own));
  const forcedIndex =
    forcedContext === undefined
      ? -1
      : keys[0].indexOf(contextKey(forcedContext));
  const modes = targets.map((mode) => {
    if (!Array.isArray(mode) || mode.length !== count)
      throw new RangeError("Target/history dimensions disagree");
    return mode.map((target) => {
      let qualified;
      if (Number.isInteger(target)) qualified = [target];
      else if (Array.isArray(target) || target instanceof Set)
        qualified = [...target];
      else
        throw new TypeError(
          "Targets must be actor indices or collections of actor indices",
        );
      if (
        qualified.some(
          (actor) => !Number.isInteger(actor) || actor < 0 || actor > 2,
        )
      ) {
        throw new RangeError(
          "Qualified actors must be integer indices 0, 1, or 2",
        );
      }
      return qualified.reduce((mask, actor) => mask | (1 << actor), 0);
    });
  });
  const multiplicities =
    weights === undefined || weights === null ? Array(count).fill(1) : weights;
  if (
    !Array.isArray(multiplicities) ||
    multiplicities.length !== count ||
    multiplicities.some(
      (weight) => !Number.isSafeInteger(weight) || weight <= 0,
    )
  ) {
    throw new RangeError(
      "Weights must be positive safe-integer history multiplicities",
    );
  }
  if (
    !Number.isSafeInteger(
      multiplicities.reduce((sum, weight) => sum + weight, 0),
    )
  ) {
    throw new RangeError(
      "Total history weight exceeds exact integer arithmetic",
    );
  }
  return {
    contexts: normalized,
    targets: modes,
    weights: multiplicities,
    forcedContext: forcedIndex < 0 ? undefined : normalized[0][forcedIndex],
  };
}

/** Nondominated integer payoff pairs, descending by the first payoff. */
export function pareto(points) {
  const sorted = [...points].sort(
    (left, right) => right[0] - left[0] || right[1] - left[1],
  );
  let highest = -1;
  return sorted.filter((point) => {
    if (point[1] <= highest) return false;
    highest = point[1];
    return true;
  });
}

function priorityOrder(caseName) {
  if (!caseName.startsWith("priority_")) return null;
  const order = caseName.slice("priority_".length);
  if ([...order].sort().join("") !== "ABC")
    throw new RangeError("Priority order must contain A, B, C exactly once");
  return [...order].map((letter) => "ABC".indexOf(letter));
}

function requirements(contexts, history, actor, caseName, order) {
  const actions = [0, 1, 2].map((person) => Number(person === actor));
  if (caseName === "binding") {
    return [
      [`0:${contexts[0][history]}`, actions[0]],
      [`1:${contexts[1][history]}:${actions[0]}`, actions[1]],
      [`2:${contexts[2][history]}:${actions[0]}`, actions[2]],
    ];
  }
  if (order)
    return order.map((person, position) => [
      `${person}:${contexts[person][history]}:${order
        .slice(0, position)
        .map((previous) => actions[previous])
        .join("")}`,
      actions[person],
    ]);
  return actions.map((action, person) => [
    `${person}:${contexts[person][history]}`,
    action,
  ]);
}

function bitCount(mask) {
  let count = 0;
  while (mask) {
    mask &= mask - 1n;
    count += 1;
  }
  return count;
}

function solveConflictGraph(conflicts, eventWeights, bits, bitIndices) {
  const cacheKey = `${conflicts.map((mask) => mask.toString(36)).join(",")}|${eventWeights.map((point) => point.join(",")).join(";")}`;
  if (graphCache.has(cacheKey)) {
    const hit = graphCache.get(cacheKey);
    graphCache.delete(cacheKey);
    graphCache.set(cacheKey, hit);
    return hit;
  }
  const memo = new Map([[0n, [[0, 0]]]]);
  function search(mask) {
    if (memo.has(mask)) return memo.get(mask);
    let remaining = mask;
    let isolated = 0n;
    let extraFirst = 0;
    let extraSecond = 0;
    let pivot = -1;
    let maximumDegree = -1;
    while (remaining) {
      const least = remaining & -remaining;
      const index = bitIndices.get(least);
      const neighbors = conflicts[index] & mask;
      if (!neighbors) {
        isolated |= least;
        extraFirst += eventWeights[index][0];
        extraSecond += eventWeights[index][1];
      } else {
        const degree = bitCount(neighbors);
        if (degree > maximumDegree) {
          maximumDegree = degree;
          pivot = index;
        }
      }
      remaining ^= least;
    }
    let result;
    if (isolated) {
      result = search(mask & ~isolated).map(([first, second]) => [
        first + extraFirst,
        second + extraSecond,
      ]);
    } else {
      const remainder = mask & ~bits[pivot];
      const [first, second] = eventWeights[pivot];
      const included = search(remainder & ~conflicts[pivot]).map(([x, y]) => [
        x + first,
        y + second,
      ]);
      result = pareto([...search(remainder), ...included]);
    }
    memo.set(mask, result);
    return result;
  }
  const result = search((1n << BigInt(eventWeights.length)) - 1n);
  graphCache.set(cacheKey, result);
  if (graphCache.size > GRAPH_CACHE_LIMIT)
    graphCache.delete(graphCache.keys().next().value);
  return result;
}

function graphFrontier(
  contexts,
  targets,
  weights,
  caseName = "base",
  forcedContext,
) {
  const order = priorityOrder(caseName);
  const eventWeights = [];
  const localOutputs = new Map();
  const bits = [];
  const bitIndices = new Map();
  for (let history = 0; history < weights.length; history += 1) {
    const eligible = targets[0][history] | targets[1][history];
    for (let actor = 0; actor < 3; actor += 1) {
      if (!(eligible & (1 << actor))) continue;
      if (
        caseName.startsWith("forced_") &&
        contexts[0][history] === forcedContext &&
        (actor === 0) !== (caseName === "forced_dispatch")
      )
        continue;
      const index = eventWeights.length;
      const bit = 1n << BigInt(index);
      bits.push(bit);
      bitIndices.set(bit, index);
      eventWeights.push(
        targets.map(
          (mode) =>
            weights[history] * Number(Boolean(mode[history] & (1 << actor))),
        ),
      );
      for (const [key, action] of requirements(
        contexts,
        history,
        actor,
        caseName,
        order,
      )) {
        if (!localOutputs.has(key)) localOutputs.set(key, [0n, 0n]);
        localOutputs.get(key)[action] |= bit;
      }
    }
  }
  const conflicts = Array(eventWeights.length).fill(0n);
  for (const [zero, one] of localOutputs.values()) {
    for (const [mask, opposite] of [
      [zero, one],
      [one, zero],
    ]) {
      let remaining = mask;
      while (remaining) {
        const least = remaining & -remaining;
        conflicts[bitIndices.get(least)] |= opposite;
        remaining ^= least;
      }
    }
  }
  return solveConflictGraph(conflicts, eventWeights, bits, bitIndices);
}

function* assignments(contexts) {
  const normalized = partition(contexts);
  const cellCount = Math.max(...normalized) + 1;
  const policy = Array(cellCount).fill(0);
  // Complementing a free message everywhere preserves the available policies.
  function* tails(position) {
    if (position === cellCount) {
      yield normalized.map((context) => policy[context]);
      return;
    }
    for (let bit = 0; bit <= 1; bit += 1) {
      policy[position] = bit;
      yield* tails(position + 1);
    }
  }
  yield* tails(1);
}

function appendSignal(contexts, signal) {
  return partition(
    contexts.map((context, history) => `${context}:${signal[history]}`),
  );
}

function frontierPrepared(
  { contexts, targets, weights, forcedContext },
  caseName,
) {
  if (typeof caseName !== "string")
    throw new TypeError("Case name must be a string");
  if (caseName.startsWith("forced_")) {
    if (!["forced_wait", "forced_dispatch"].includes(caseName))
      throw new RangeError(`Unknown case: ${caseName}`);
    if (forcedContext === undefined)
      throw new RangeError("The forced local context must occur for actor A");
  }
  if (
    BASE_CASES.has(caseName) ||
    ["forced_wait", "forced_dispatch", "binding"].includes(caseName) ||
    caseName.startsWith("priority_")
  ) {
    return graphFrontier(contexts, targets, weights, caseName, forcedContext);
  }
  if (!["broadcast", "relay"].includes(caseName))
    throw new RangeError(`Unknown case: ${caseName}`);
  let points = [];
  const seen = new Set();
  function incorporate(augmented) {
    const signature = augmented.map((own) => own.join(",")).join(";");
    if (seen.has(signature)) return;
    seen.add(signature);
    points = pareto([...points, ...graphFrontier(augmented, targets, weights)]);
  }
  for (const first of assignments(contexts[0])) {
    if (caseName === "broadcast") {
      incorporate(contexts.map((own) => appendSignal(own, first)));
    } else {
      const middle = appendSignal(contexts[1], first);
      for (const second of assignments(middle)) {
        incorporate([contexts[0], middle, appendSignal(contexts[2], second)]);
      }
    }
  }
  return points;
}

/** Deterministic frontier. Hidden modes never become part of local contexts. */
export function payoffFrontier(
  contexts,
  targets,
  { caseName = "base", forcedContext, weights } = {},
) {
  return frontierPrepared(
    prepare(contexts, targets, weights, forcedContext),
    caseName,
  ).map((point) => [...point]);
}

function gcd(left, right) {
  left = left < 0n ? -left : left;
  right = right < 0n ? -right : right;
  while (right) [left, right] = [right, left % right];
  return left;
}

function fraction(numerator, denominator = 1n) {
  if (!denominator) throw new RangeError("Zero denominator");
  if (denominator < 0n) [numerator, denominator] = [-numerator, -denominator];
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

function rationalString([numerator, denominator]) {
  return `${numerator}/${denominator}`;
}

function mixedFraction(points) {
  if (!points.length) throw new RangeError("Expected at least one payoff pair");
  let best = [
    BigInt(Math.max(...points.map((point) => Math.min(...point)))),
    1n,
  ];
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    const left = points[leftIndex].map(BigInt);
    const a = left[0] - left[1];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < points.length;
      rightIndex += 1
    ) {
      const right = points[rightIndex].map(BigInt);
      const b = right[0] - right[1];
      if (a * b >= 0n) continue;
      const candidate = fraction(
        left[0] * right[1] - left[1] * right[0],
        a - b,
      );
      if (candidate[0] * best[1] > best[0] * candidate[1]) best = candidate;
    }
  }
  return best;
}

/** Exact robust expectation when one shared draw chooses a complete policy. */
export function mixedOptimum(points) {
  return rationalString(mixedFraction(points));
}

/** Reduced rational strings for independently optimized architectures. */
export function solveScores(
  contexts,
  targets,
  { forcedContext, weights, cases = CASES } = {},
) {
  const prepared = prepare(contexts, targets, weights, forcedContext);
  const base = frontierPrepared(prepared, "base");
  const answers = {};
  for (const caseName of cases) {
    if (caseName === "mixed") {
      answers[caseName] = mixedOptimum(base);
      continue;
    }
    let value;
    if (caseName === "mode_1" || caseName === "mode_2") {
      value = Math.max(
        ...base.map((point) => point[Number(caseName.at(-1)) - 1]),
      );
    } else {
      const points =
        caseName === "base" ? base : frontierPrepared(prepared, caseName);
      value = Math.max(...points.map((point) => Math.min(...point)));
    }
    answers[caseName] = `${value}/1`;
  }
  return answers;
}
