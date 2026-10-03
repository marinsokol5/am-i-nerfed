import { createHash, createHmac } from "node:crypto";
import { randomSource } from "./random.js";
import { generateCompact } from "./compact.js";
import { hardCoordination } from "./hard-coordination.js";
import { solveScores } from "./coordination.js";

// Version 2 presents the same puzzles as version 1 with typed response shapes.
export const TASK_BANK_VERSION = 2;
export const LEVELS = ["easy", "medium", "hard"];
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const derive = (seed, label) =>
  createHmac("sha256", seed)
    // Fixed at 1 so later bank versions regenerate the same puzzles per seed.
    .update(`assessment-bank/1/${label}`)
    .digest("hex");
// Response shapes mirror the answer with a type name at each leaf: JSON
// primitives in lowercase, capitalized names defined in the task's types.
const shape = (value, type) =>
  value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, type)]))
    : type;
const FRACTION = { Fraction: 'exact rational string, e.g. "3/2"' };
// Answer keys group fields by scoring stage; solvers see one flat object.
export function flatten(answer) {
  const flat = {};
  for (const fields of Object.values(answer))
    for (const [key, value] of Object.entries(fields)) {
      if (Object.hasOwn(flat, key)) throw Error(`Duplicate answer field ${key}`);
      flat[key] = value;
    }
  return flat;
}
export function nest(answer, flat) {
  if (flat === null || typeof flat !== "object" || Array.isArray(flat))
    return flat;
  return Object.fromEntries(
    Object.entries(answer).map(([stage, fields]) => [
      stage,
      Object.fromEntries(
        Object.keys(fields)
          .filter((key) => Object.hasOwn(flat, key))
          .map((key) => [key, flat[key]]),
      ),
    ]),
  );
}
// Leaf names and values in order: equal lists mean the same puzzle answers,
// even when a later version regroups fields.
export const answerLeaves = (value, key = "") =>
  value && typeof value === "object"
    ? Object.entries(value).flatMap(([k, v]) => answerLeaves(v, k))
    : [[key, value]];
const names = "ABCDEFGH";

// Port of the lab's public-announcement hat solver. Partition once per turn.
export function hatWorlds(counts) {
  const out = [],
    n = counts.reduce((a, b) => a + b, 0);
  function visit(prefix) {
    if (prefix.length === n) {
      out.push(prefix);
      return;
    }
    counts.forEach((count, color) => {
      if (count) {
        counts[color]--;
        visit([...prefix, color]);
        counts[color]++;
      }
    });
  }
  visit([]);
  return out;
}
export function hatRun(worlds, visibility, order, actual) {
  let remaining = worlds;
  const replies = [];
  for (const speaker of order) {
    const key = (w) => visibility[speaker].map((i) => w[i]).join(",");
    const cells = new Map();
    for (const w of remaining) {
      const k = key(w);
      if (!cells.has(k)) cells.set(k, new Set());
      cells.get(k).add(w[speaker]);
    }
    const reply = (w) => {
      const own = cells.get(key(w));
      return own.size === 1 ? [...own][0] : -1;
    };
    const said = reply(actual);
    replies.push(said);
    remaining = remaining.filter((w) => reply(w) === said);
  }
  return { replies, remaining };
}
function hats(seed, level) {
  const r = randomSource(seed),
    counts = [
      [2, 2, 1],
      [2, 2, 1, 1],
      [2, 2, 2, 1],
    ][level];
  const worlds = hatWorlds([...counts]),
    n = worlds[0].length,
    base = [...Array(n).keys()];
  const rounds = level === 0 ? 1 : 2,
    order = Array.from({ length: rounds }, () => base).flat();
  const colors = r
    .shuffle(["red", "blue", "white", "green"])
    .slice(0, counts.length);
  for (let trial = 0; trial < 12000; trial++) {
    const visibility = base.map((i) =>
      r
        .shuffle(base.filter((j) => i !== j))
        .slice(0, 1 + r.integer(n - 2))
        .sort(),
    );
    const actual = r.choose(worlds),
      first = hatRun(worlds, visibility, order, actual);
    if (first.remaining.length !== 1 || !first.replies.includes(-1)) continue;
    const alt = level === 2 ? r.shuffle(base) : [...base].reverse();
    if (alt.every((v, i) => v === base[i])) continue;
    const second = hatRun(
      worlds,
      visibility,
      Array.from({ length: rounds }, () => alt).flat(),
      actual,
    );
    const initialKnowledge = base.map(
      (s) => hatRun(worlds, visibility, [s], actual).replies[0],
    );
    if (
      !first.replies.some(
        (a, i) => a !== -1 && initialKnowledge[order[i]] === -1,
      )
    )
      continue;
    if (
      rounds === 2 &&
      !first.replies
        .slice(n)
        .some((a, i) => a !== -1 && first.replies[i] === -1)
    )
      continue;
    const color = (a) => (a === -1 ? "unknown" : colors[a]);
    const answer = {
      knowledge: {
        hats: Object.fromEntries(actual.map((a, i) => [names[i], color(a)])),
        alternative: Object.fromEntries(
          second.replies.map((a, i) => [
            `round${Math.floor(i / n) + 1}_${names[alt[i % n]]}`,
            color(a),
          ]),
        ),
      },
    };
    const prompt = `${n} people (${base.map((i) => names[i]).join(", ")}) wear exactly ${counts.map((v, i) => `${v} ${colors[i]}`).join(", ")} hats. Nobody sees their own hat.\nVisibility:\n${visibility.map((v, i) => `${names[i]} sees ${v.map((j) => names[j]).join(", ")}.`).join("\n")}\nEveryone knows the counts, visibility, protocol, and everyone's perfect reasoning, commonly. On each turn a person MUST name their own color if certain from their view and every preceding public reply; otherwise they say unknown. There are no other signals. They speak in order ${base.map((i) => names[i]).join(", ")} for ${rounds} round(s), retaining all previous replies.\nObserved transcript:\n${first.replies.map((a, i) => `Round ${Math.floor(i / n) + 1}, ${names[order[i]]}: ${color(a)}`).join("\n")}\nFind all hats. Then restart from scratch with the same hats but order ${alt.map((i) => names[i]).join(", ")} in each of ${rounds} round(s), commonly known from the beginning; nobody has heard the original transcript. Predict every reply in that alternative run.`;
    return {
      prompt,
      answer,
      types: { Color: colors, Reply: [...colors, "unknown"] },
      response: {
        hats: shape(answer.knowledge.hats, "Color"),
        alternative: shape(answer.knowledge.alternative, "Reply"),
      },
    };
  }
  throw Error(
    "Could not generate a unique hat task; retry initialization with a new seed.",
  );
}

// Lab card dialogue: epistemic predicates are evaluated against the public set.
export function cardTruth(kind, i, j, w, cards) {
  const cell = (person, world) =>
    cards.filter((c) => c[person] === world[person]);
  const knows = (person, world) => cell(person, world).length === 1;
  if (kind === "knows") return knows(i, w);
  if (kind === "unknown") return !knows(i, w);
  if (kind === "knows_unknown") return cell(i, w).every((c) => !knows(j, c));
  if (kind === "unknown_whether")
    return new Set(cell(i, w).map((c) => knows(j, c))).size === 2;
  const k = 3 - i - j;
  if (kind === "nested")
    return cell(i, w).every((c) =>
      cardTruth("unknown_whether", j, k, c, cards),
    );
  throw Error("Unknown card predicate");
}
function cards(seed, level) {
  const r = randomSource(seed),
    size = [10, 14, 18][level];
  const universe = Array.from({ length: 80 }, (_, i) => [
    Math.floor(i / 20),
    Math.floor(i / 5) % 4,
    i % 5,
  ]);
  const labels = [
    ["red", "blue", "green", "white"],
    ["circle", "square", "star", "heart"],
    ["1", "2", "3", "4", "5"],
  ];
  const cardName = (c) => c.map((v, i) => labels[i][v]).join(" ");
  for (let attempt = 0; attempt < 3000; attempt++) {
    const all = r.shuffle(universe).slice(0, size),
      actual = r.choose(all);
    let current = all;
    if ([0, 1, 2].some((i) => cardTruth("knows", i, null, actual, all)))
      continue;
    const dialogue = [],
      remaining = {};
    for (let turn = 0; turn < 8 && current.length > 1; turn++) {
      const choices = [];
      for (const kind of [
        "unknown",
        "knows",
        "knows_unknown",
        ...(level ? ["unknown_whether"] : []),
        ...(level === 2 ? ["nested"] : []),
      ])
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            if (
              i === j ||
              dialogue.at(-1)?.i === i ||
              !cardTruth(kind, i, j, actual, current)
            )
              continue;
            const next = current.filter((w) =>
              cardTruth(kind, i, j, w, current),
            );
            if (
              next.length < current.length &&
              (dialogue.length || next.length > 1)
            )
              choices.push({ kind, i, j, next });
          }
      if (!choices.length) break;
      const choice = r.choose(choices);
      current = choice.next;
      dialogue.push(choice);
      remaining[`after${dialogue.length}`] = current.length;
    }
    if (current.length !== 1 || dialogue.length < 3 + Number(level === 2))
      continue;
    const speaker = ["Ann", "Bob", "Cid"];
    const text = ({ kind, i, j }) =>
      ({
        knows: "I know which card it is.",
        unknown: "I do not know which card it is.",
        knows_unknown: `I know that ${speaker[j]} does not know which card it is.`,
        unknown_whether: `I do not know whether ${speaker[j]} knows which card it is.`,
        nested: `I know that ${speaker[j]} does not know whether ${speaker[3 - i - j]} knows which card it is.`,
      })[kind];
    const answer = { knowledge: { card: cardName(actual), remaining } };
    return {
      prompt:
        `One card is drawn from this complete public list:\n${all.map(cardName).join("\n")}\nAnn sees only color; Bob only shape; Cid only number. The list, observations and perfect truthful reasoning are common knowledge. All replies are public. Each statement describes knowledge AFTER all preceding replies.\n${dialogue.map((s, i) => `${i + 1}. ${speaker[s.i]}: ${text(s)}`).join("\n")}\nIdentify the card, using its exact three-word spelling above. After each reply, count the cards still possible for an observer who hears the dialogue but sees no attribute.`,
      answer,
      response: { card: "string", remaining: shape(remaining, "integer") },
    };
  }
  throw Error("Could not generate card dialogue.");
}

// Compact adaptation of lab/tracking.py. Explicit audience semantics make the
// nested-belief update rule unambiguous and independently replayable.
export function tracking(seed, level) {
  const r = randomSource(seed),
    people = ["Mia", "Leo", "Ava", "Noah", "Zoe", "Eli"].slice(0, 4 + level);
  const objects = ["ring", "letter", "key"],
    places = ["safe", "drawer", "trunk", "toolbox"];
  const initial = Object.fromEntries(objects.map((o) => [o, r.choose(places)]));
  let events, actual, queries;
  const belief = (chain, o, log) =>
    [...log]
      .reverse()
      .find((e) => e.object === o && chain.every((p) => e.audience.includes(p)))
      ?.place ?? initial[o];
  for (let attempt = 0; attempt < 1000; attempt++) {
    events = [];
    actual = { ...initial };
    for (let i = 0; i < [18, 40, 75][level]; i++) {
      const object = r.choose(objects),
        audience = r.shuffle(people).slice(0, 1 + r.integer(people.length));
      const whisper = audience.length >= 2 && r.integer(4) === 0;
      const place = whisper
        ? belief([audience[0]], object, events)
        : r.choose(places.filter((p) => p !== actual[object]));
      if (!whisper) actual[object] = place;
      events.push({
        object,
        audience: whisper ? audience.slice(0, 2) : audience,
        place,
        whisper,
      });
    }
    queries = objects.map((object) => ({
      chain: [],
      object,
      value: actual[object],
    }));
    for (let depth = 1; depth <= 1 + level; depth++) {
      const candidates = [];
      for (let k = 0; k < 100; k++) {
        const chain = r.shuffle(people).slice(0, depth),
          object = r.choose(objects),
          value = belief(chain, object, events);
        if (
          value !== actual[object] &&
          (depth === 1 || value !== belief(chain.slice(1), object, events))
        )
          candidates.push({ chain, object, value });
      }
      const unique = [
        ...new Map(
          candidates.map((q) => [`${q.chain}/${q.object}`, q]),
        ).values(),
      ];
      if (unique.length < 2) break;
      queries.push(...r.shuffle(unique).slice(0, 2));
    }
    if (queries.length === 3 + 2 * (1 + level)) break;
  }
  if (queries.length !== 3 + 2 * (1 + level))
    throw Error("Could not generate tracking task.");
  const answer = {
    knowledge: Object.fromEntries(
      queries.map((q, i) => [`q${i + 1}`, q.value]),
    ),
  };
  const prompt = `Track objects and beliefs using these EXACT rules. Initially everyone sees ${objects.map((o) => `${o} in ${initial[o]}`).join(", ")}. A move changes reality; only its named witnesses see it. A whisper changes no object, is heard only by its two named participants, and reports the speaker's current belief (which can be false). Each person believes the most recent move or whisper they witnessed about that object. For nested beliefs, use the most recent event about the object witnessed by EVERY person in the named chain; if none, use the initial location. Do not infer anything else, including from absences. This stipulated update rule applies regardless of chain order.\n${events.map((e, i) => `${i + 1}. ${e.whisper ? `${e.audience[0]} whispers to ${e.audience[1]}: ${e.object} is in ${e.place}` : `${e.object} moved to ${e.place}; witnesses: ${e.audience.join(", ")}`}.`).join("\n")}\nQuestions:\n${queries.map((q, i) => `q${i + 1}: ${q.chain.length ? `${q.chain.join(" thinks ")} thinks: where is ${q.object}?` : `Where is ${q.object} actually?`}`).join("\n")}`;
  return {
    prompt,
    answer,
    types: { Place: places },
    response: shape(answer.knowledge, "Place"),
    oracle: {
      initial,
      events,
      queries: queries.map(({ chain, object }) => ({ chain, object })),
    },
  };
}

function knowledge(seed, level) {
  if (level < 2) {
    const { prompt, answer } = generateCompact(
      seed,
      level === 0 ? "easy" : "normal",
    );
    return { prompt, answer, response: shape(flatten(answer), "boolean") };
  }
  const first = generateCompact(derive(seed, "first"), "normal"),
    second = generateCompact(derive(seed, "second"), "normal");
  const answer = {
    knowledge: {
      scenarioA: flatten(first.answer),
      scenarioB: flatten(second.answer),
    },
  };
  return {
    prompt: `Solve these two independent protocols. Their agents and observations are separate. Answer scenario A under scenarioA and scenario B under scenarioB.\nSCENARIO A\n${first.prompt}\nSCENARIO B\n${second.prompt}`,
    answer,
    response: shape(answer.knowledge, "boolean"),
  };
}
function coordination(seed, level) {
  if (level === 2) {
    const { prompt, answer } = hardCoordination(seed);
    return {
      prompt,
      answer,
      types: FRACTION,
      response: shape(answer.coordination, "Fraction"),
    };
  }
  const r = randomSource(seed),
    rows = Array.from({ length: 8 }, (_, i) => [i >> 2, (i >> 1) & 1, i & 1]);
  const targets = [0, 1].map(() => rows.map(() => r.integer(3)));
  const cases =
    level === 0
      ? ["base", "mode_1", "mode_2"]
      : ["base", "mixed", "mode_1", "mode_2", "binding", "broadcast"];
  const answer = {
    coordination: solveScores(
      [0, 1, 2].map((i) => rows.map((w) => w[i])),
      targets,
      { cases },
    ),
  };
  return {
    prompt:
      `Three agents A, B, C see only their own bit a, b, c. All eight rows below are possible in each of two hidden modes. The table, observations and rules are common knowledge. Nobody separately observes the mode, row, other bits, or qualified agent.\nabc | qualified in mode 1 | qualified in mode 2\n${rows.map((w, i) => `${w.join("")} | ${names[targets[0][i]]} | ${names[targets[1][i]]}`).join("\n")}\nEach agent dispatches (1) or waits (0). A row succeeds exactly when one agent dispatches and it is the qualified agent. A deterministic policy maps each agent's own observation to its action. Identical observations require identical actions. The SAME policy handles both modes. Let s1 and s2 count successful rows in the two modes.\nOptimize independently:\nbase: maximize min(s1,s2), simultaneous actions without messages.\nmode_1: maximize s1 alone under a base policy.\nmode_2: maximize s2 alone under a base policy.${level ? "\nmixed: a shared random draw independent of row/mode selects a complete base policy; maximize min(E[s1],E[s2]), expectation BEFORE minimum.\nbinding: A acts first; B and C observe its irrevocable action then act simultaneously using that and their own bits. All actions count. Maximize min(s1,s2).\nbroadcast: A announces one bit based on a, then everyone acts simultaneously using that message and their own bit. The message does not constrain A's action. Maximize min(s1,s2)." : ""}\nNo additional signals, observations, retries or private randomness. Return exact maxima.`,
    answer,
    types: FRACTION,
    response: shape(answer.coordination, "Fraction"),
  };
}
export function generateTaskBank(seed) {
  const families = [
    ["hats", hats],
    ["cards", cards],
    ["knowledge", knowledge],
    ["tracking", tracking],
    ["coordination", coordination],
  ];
  const tasks = LEVELS.flatMap((difficulty, level) =>
    families.map(([family, generate], index) => {
      const { prompt, answer, types = {}, response } = generate(
        derive(seed, `${difficulty}/${family}`),
        level,
      );
      return {
        id: `${difficulty}-${index + 1}`,
        difficulty,
        family,
        prompt: prompt.trim(),
        promptHash: hash({ prompt: prompt.trim(), types, response }),
        types,
        response,
        answer,
      };
    }),
  );
  return { taskBankVersion: TASK_BANK_VERSION, tasks };
}
