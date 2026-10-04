import { createHash, createHmac } from "node:crypto";
import { randomSource } from "./random.js";
import { generateCompact } from "./compact.js";
import { coordinationTask } from "./coordination-task.js";

// Version 2 presents the same puzzles as version 1 with typed response shapes.
// Version 3 regenerates hard knowledge scenario B when it repeats scenario A.
// Version 4 randomizes knowledge protocol structure, not only bit labels.
// Version 5 asks only hats nobody names and caps what copying predicts.
// Version 6 caps the most common alternative reply at half.
// Version 7 scores coordination protocols and enlarges the hard tier.
export const TASK_BANK_VERSION = 7;
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
// Each turn groups the remaining worlds by what the speaker sees, with a
// bitmask of the speaker's own colors per group. View keys depend only on the
// speaker and whom they see, so they are cached per world list: hats-xl
// replays thousands of eight-person runs.
const hatCache = new WeakMap();
let hatTurn = 0;
export function hatRun(worlds, visibility, order, actual) {
  if (!hatCache.has(worlds)) {
    const n = worlds[0].length,
      radix = 1 + Math.max(...worlds[0]),
      size = radix ** (n - 1);
    hatCache.set(worlds, {
      radix,
      views: new Map(),
      bits: Array.from({ length: n }, (_, s) =>
        Int32Array.from(worlds, (w) => 1 << w[s]),
      ),
      cells: new Int32Array(size),
      stamps: new Float64Array(size),
    });
  }
  const { radix, views, bits, cells, stamps } = hatCache.get(worlds);
  const key = (seen, w) => seen.reduce((k, i) => k * radix + w[i], 0);
  const replies = [];
  let remaining = Int32Array.from(worlds.keys()),
    count = worlds.length;
  for (const speaker of order) {
    const seen = visibility[speaker],
      view = `${speaker}:${seen}`;
    if (!views.has(view))
      views.set(view, Int32Array.from(worlds, (w) => key(seen, w)));
    const own = views.get(view),
      bit = bits[speaker];
    // A stamp clears each group on its first use this turn.
    hatTurn++;
    for (let t = 0; t < count; t++) {
      const k = own[remaining[t]];
      if (stamps[k] !== hatTurn) {
        stamps[k] = hatTurn;
        cells[k] = 0;
      }
      cells[k] |= bit[remaining[t]];
    }
    // One possible own color is named, otherwise unknown; worlds where the
    // speaker would have replied differently drop out.
    const mask = cells[key(seen, actual)],
      certain = (mask & (mask - 1)) === 0;
    replies.push(certain ? actual[speaker] : -1);
    let kept = 0;
    for (let t = 0; t < count; t++) {
      const cell = cells[own[remaining[t]]];
      if (certain ? cell === mask : (cell & (cell - 1)) !== 0)
        remaining[kept++] = remaining[t];
    }
    count = kept;
  }
  return {
    replies,
    remaining: Array.from(remaining.subarray(0, count), (i) => worlds[i]),
  };
}
// Level 3 is hats-xl, ported from lab/hardhunt hatsXL: eight people, at
// least two hidden hats, and no informative-transcript checks.
function hats(seed, level) {
  const r = randomSource(seed),
    counts = [
      [2, 2, 1],
      [2, 2, 1, 1],
      [2, 2, 2, 1],
      [3, 2, 2, 1],
    ][level],
    xl = level === 3;
  const worlds = hatWorlds([...counts]),
    n = worlds[0].length,
    base = [...Array(n).keys()];
  const rounds = level === 0 ? 1 : 2,
    order = Array.from({ length: rounds }, () => base).flat();
  const colors = r
    .shuffle(["red", "blue", "white", "green", ...(xl ? ["black"] : [])])
    .slice(0, counts.length);
  for (let trial = 0; trial < (xl ? 200000 : 60000); trial++) {
    const visibility = base.map((i) =>
      r
        .shuffle(base.filter((j) => i !== j))
        .slice(0, 1 + r.integer(n - 2))
        .sort(),
    );
    const actual = r.choose(worlds),
      first = hatRun(worlds, visibility, order, actual);
    if (first.remaining.length !== 1 || !first.replies.includes(-1)) continue;
    // A named color is that person's hat, so only the hats of people who
    // never name a color are asked; at least one must exist.
    const named = new Set(
      first.replies.flatMap((a, i) => (a === -1 ? [] : [order[i]])),
    );
    const hidden = base.filter((i) => !named.has(i));
    if (hidden.length < (xl ? 2 : 1)) continue;
    const alt = level >= 2 ? r.shuffle(base) : [...base].reverse();
    if (alt.every((v, i) => v === base[i])) continue;
    const second = hatRun(
      worlds,
      visibility,
      Array.from({ length: rounds }, () => alt).flat(),
      actual,
    );
    // Copying each person's reply from the same original round must not
    // predict most of the alternative run.
    const copied = second.replies.filter(
      (a, i) => a === first.replies[Math.floor(i / n) * n + alt[i % n]],
    ).length;
    if (2 * copied > second.replies.length) continue;
    // No single reply (usually "unknown") may fill most of the alternative
    // run, or answering it everywhere would score well without reasoning.
    const replyCounts = new Map();
    for (const a of second.replies)
      replyCounts.set(a, (replyCounts.get(a) ?? 0) + 1);
    if (2 * Math.max(...replyCounts.values()) > second.replies.length) continue;
    if (!xl) {
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
    }
    const color = (a) => (a === -1 ? "unknown" : colors[a]);
    const answer = {
      knowledge: {
        hats: Object.fromEntries(hidden.map((i) => [names[i], color(actual[i])])),
        alternative: Object.fromEntries(
          second.replies.map((a, i) => [
            `round${Math.floor(i / n) + 1}_${names[alt[i % n]]}`,
            color(a),
          ]),
        ),
      },
    };
    const prompt = `${n} people (${base.map((i) => names[i]).join(", ")}) wear exactly ${counts.map((v, i) => `${v} ${colors[i]}`).join(", ")} hats. Nobody sees their own hat.\nVisibility:\n${visibility.map((v, i) => `${names[i]} sees ${v.map((j) => names[j]).join(", ")}.`).join("\n")}\nEveryone knows the counts, visibility, protocol, and everyone's perfect reasoning, commonly. On each turn a person MUST name their own color if certain from their view and every preceding public reply; otherwise they say unknown. There are no other signals. They speak in order ${base.map((i) => names[i]).join(", ")} for ${rounds} round(s), retaining all previous replies.\nObserved transcript:\n${first.replies.map((a, i) => `Round ${Math.floor(i / n) + 1}, ${names[order[i]]}: ${color(a)}`).join("\n")}\nFind the hats of everyone who never names a color: ${hidden.map((i) => names[i]).join(", ")}. Then restart from scratch with the same hats but order ${alt.map((i) => names[i]).join(", ")} in each of ${rounds} round(s), commonly known from the beginning; nobody has heard the original transcript. Predict every reply in that alternative run.`;
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
  throw Error("Unknown card predicate");
}
// Easy and medium only; the hard tier has no cards.
function cards(seed, level) {
  const r = randomSource(seed),
    size = [10, 14][level];
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
    if (current.length !== 1 || dialogue.length < 3) continue;
    const speaker = ["Ann", "Bob", "Cid"];
    const text = ({ kind, j }) =>
      ({
        knows: "I know which card it is.",
        unknown: "I do not know which card it is.",
        knows_unknown: `I know that ${speaker[j]} does not know which card it is.`,
        unknown_whether: `I do not know whether ${speaker[j]} knows which card it is.`,
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
// nested-belief update rule unambiguous and independently replayable. Level 3
// is tracking-xl: seven people and beliefs nested four deep.
export function tracking(seed, level) {
  const r = randomSource(seed),
    people = ["Mia", "Leo", "Ava", "Noah", "Zoe", "Eli", "Ivy"].slice(
      0,
      4 + level,
    );
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
    for (let i = 0; i < [18, 40, 75, 120][level]; i++) {
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
  // Scenario B must differ from A in at least half its answers, otherwise
  // the second protocol adds little beyond the first. Both ask deeper nesting.
  const first = generateCompact(derive(seed, "first"), "deep");
  const differing = (b) =>
    Object.entries(flatten(first.answer)).filter(
      ([key, value]) => flatten(b.answer)[key] !== value,
    ).length;
  let second;
  for (let attempt = 0; ; attempt++) {
    if (attempt === 200) throw Error("Could not generate distinct scenarios.");
    second = generateCompact(
      derive(seed, attempt ? `second/${attempt}` : "second"),
      "deep",
    );
    if (2 * differing(second) >= Object.keys(flatten(first.answer)).length)
      break;
  }
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
// Coordination difficulty is the table: symbols per agent, rows, and cases.
const CASES = ["base", "mixed", "mode_1", "mode_2", "binding", "broadcast"];
const COORDINATION = [
  { symbols: 2, rows: 6, cases: ["base", "mode_1", "mode_2"] },
  { symbols: 3, rows: 18, cases: CASES },
  { symbols: 4, rows: 26, cases: CASES },
];
export function coordination(seed, level) {
  return coordinationTask(seed, COORDINATION[level]);
}
// Each tier lists its families in task order. Hard trades cards for larger
// hat and tracking puzzles.
const FAMILIES = [
  ["hats", hats],
  ["cards", cards],
  ["knowledge", knowledge],
  ["tracking", tracking],
  ["coordination", coordination],
];
const TIERS = [
  FAMILIES,
  FAMILIES,
  [
    ["hats", hats],
    ["hats-xl", (seed) => hats(seed, 3)],
    ["knowledge", knowledge],
    ["tracking-xl", (seed) => tracking(seed, 3)],
    ["coordination", coordination],
  ],
];
export function generateTaskBank(seed) {
  const tasks = LEVELS.flatMap((difficulty, level) =>
    TIERS[level].map(([family, generate], index) => {
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
