import { createHash } from "node:crypto";
import { randomSource } from "./random.js";

// Knowledge protocols over a finite perfect-recall partition model. Every
// structural choice (F's truth table, who speaks what to whom, and each
// question) is drawn per seed and stated in the prompt, so answers vary in
// structure rather than only in relabeled bits.
const NOTATION = `K_X(P) means P is true in every world consistent with X's observations at that stage. W_X(P) means K_X(P) OR K_X(NOT P): X knows whether P, not necessarily that P is true. A false knowledge claim does not assert its negation is known. All agents reason perfectly, remember everything they observe, and commonly know this protocol. The actual world below is given to you only; it is not extra information for the agents.`;
const AGENTS = "ABC";

// Formulas: ["F"], ["bit", i], ["not", p], ["K", x, p], ["W", x, p].
function render(p) {
  if (p[0] === "F") return "F";
  if (p[0] === "bit") return `${"abc"[p[1]]} = 1`;
  if (p[0] === "not")
    return p[1][0] === "bit" ? `${"abc"[p[1][1]]} = 0` : `NOT ${render(p[1])}`;
  return `${p[0]}_${AGENTS[p[1]]}(${render(p[2])})`;
}
// Nested operators never repeat the same agent directly: K_A(K_A(P)) = K_A(P).
function formula(r, depth, outer = -1) {
  if (depth === 0) return r.choose([["F"], ["F"], ["bit", 0], ["bit", 1], ["bit", 2]]);
  const agent = r.choose([0, 1, 2].filter((x) => x !== outer)),
    child = formula(r, depth - 1, agent);
  if (r.integer(2)) return ["W", agent, child];
  return ["K", agent, r.integer(3) ? child : ["not", child]];
}
// A reply is the speaker's own knowledge claim, so the speaker can always make it.
function reply(r, speaker) {
  const child = formula(r, r.integer(2), speaker);
  return r.integer(2)
    ? ["W", speaker, child]
    : ["K", speaker, r.integer(2) ? child : ["not", child]];
}

function model(worlds, fact) {
  const keys = (views) => views.map((own) => own.map((v) => v.join("|")));
  function truth(p, stage) {
    if (p[0] === "F") return fact;
    if (p[0] === "bit") return worlds.map((w) => Boolean(w.current[p[1]]));
    if (p[0] === "not") return truth(p[1], stage).map((v) => !v);
    const values = truth(p[2], stage),
      cells = new Map();
    stage[p[1]].forEach((key, i) => {
      const cell = cells.get(key) ?? { all: true, none: true };
      if (values[i]) cell.none = false;
      else cell.all = false;
      cells.set(key, cell);
    });
    return stage[p[1]].map((key) => {
      const cell = cells.get(key);
      return p[0] === "K" ? cell.all : cell.all || cell.none;
    });
  }
  // Each listed reply is heard by its speaker and listener, or by everyone.
  function play(views, replies, everyone = false) {
    const stages = [keys(views)],
      values = [];
    replies.forEach(([speaker, listener, p], step) => {
      const v = truth(p, stages.at(-1));
      values.push(v);
      for (const agent of everyone ? [0, 1, 2] : [speaker, listener])
        v.forEach((x, i) => views[agent][i].push(`r${step}=${x}`));
      stages.push(keys(views));
    });
    return { stages, values };
  }
  return { truth, play };
}

const varies = (values) => values.some(Boolean) && values.some((v) => !v);
function balanced(values, low, high) {
  const share = values.filter(Boolean).length / values.length;
  return share >= low && share <= high;
}
function factTable(r) {
  const rows = r.shuffle([...Array(8).keys()]).slice(0, 2 + r.integer(5));
  const set = new Set(rows);
  return {
    set,
    text: rows
      .sort((x, y) => x - y)
      .map((i) => [i >> 2, (i >> 1) & 1, i & 1].join(""))
      .join(", "),
  };
}
const row = (bits) => (bits[0] << 2) | (bits[1] << 1) | bits[2];
function pickReplies(r) {
  return [0, 1].map(() => {
    const speaker = r.integer(3),
      listener = r.choose([0, 1, 2].filter((x) => x !== speaker));
    return [speaker, listener, reply(r, speaker)];
  });
}
const replyText = (replies) =>
  replies
    .map(
      ([s, l, p], i) =>
        `${i + 1}. ${AGENTS[s]} answers the Boolean question ${render(p)}; only ${AGENTS[l]} hears ${AGENTS[s]}'s reply.`,
    )
    .join("\n");
// A formula whose operator nesting is drawn from [low, high].
const nested = (r, [low, high]) => formula(r, low + r.integer(high - low + 1));
// Distinct, world-dependent questions; a question true or false in every
// world is answerable without following the protocol.
function pickQuestions(r, count, stages, depths, truthAt) {
  const questions = [],
    seen = new Set();
  for (let tries = 0; questions.length < count && tries < 400; tries++) {
    const stage = r.choose(stages),
      p = nested(r, depths);
    const values = truthAt(p, stage),
      key = JSON.stringify(values);
    if (!varies(values) || seen.has(key)) continue;
    seen.add(key);
    questions.push({ stage, p, values });
  }
  return questions.length === count ? questions : null;
}

function easy(r) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const worlds = Array.from({ length: 8 }, (_, i) => {
      const bits = [i >> 2, (i >> 1) & 1, i & 1];
      return { initial: bits, current: bits };
    });
    const table = factTable(r),
      fact = worlds.map((w) => table.set.has(row(w.current)));
    const m = model(worlds, fact),
      replies = pickReplies(r);
    const views = [0, 1, 2].map((a) => worlds.map((w) => [`own=${w.initial[a]}`]));
    const run = m.play(views, replies);
    if (!run.values.every(varies)) continue;
    const questions = pickQuestions(r, 6, [1, 2], [1, 2], (p, s) =>
      m.truth(p, run.stages[s]),
    );
    if (!questions) continue;
    const candidates = worlds.flatMap((_, i) =>
      balanced([...run.values, ...questions.map((q) => q.values)].map((v) => v[i]), 0.25, 0.75)
        ? [i]
        : [],
    );
    if (!candidates.length) continue;
    const actual = r.choose(candidates);
    const answer = {
      knowledge: {
        report1: run.values[0][actual],
        report2: run.values[1][actual],
        ...Object.fromEntries(questions.map((q, i) => [`q${i + 1}`, q.values[actual]])),
      },
    };
    const stageName = ["", "after reply 1", "final"];
    const prompt = `Three agents A, B, C each have a fixed bit a, b, c. Every one of the eight triples is initially possible. Each agent privately sees only their own bit; there are no swaps or later bit observations.

F is true exactly when (a,b,c), written abc, is one of: ${table.text}.

${NOTATION}

Two mandatory replies happen in order:
${replyText(replies)}
Speakers remember their own replies. Everyone knows who hears each reply and that both replies happen. Nobody else hears the value; an unheard reply is not a public announcement. Each reply uses knowledge immediately before it.

Actual bits (a,b,c): (${worlds[actual].initial.join(",")}).

Stages: after reply 1 = immediately after the first reply; final = after both replies. report1 and report2 are the two spoken replies. The other fields ask:
${questions.map((q, i) => `- q${i + 1}: ${stageName[q.stage]}: ${render(q.p)}.`).join("\n")}`;
    return { prompt, answer };
  }
  throw Error("No balanced easy case");
}

const VARIANTS = {
  public_event:
    "e is announced to everyone at the physical stage instead of only to B",
  public_reports: "both replies are heard by everyone",
  forget_A:
    "A never sees a0 (instead of losing memory after seeing it); A still sees a after the event",
  no_swap:
    "only e=0 is possible, commonly known from the start, so the universe has eight histories",
};
function normalWorlds(variant) {
  return Array.from({ length: 8 }, (_, bits) => bits).flatMap((bits) =>
    (variant === "no_swap" ? [0] : [0, 1, 2]).map((event) => {
      const initial = [bits >> 2, (bits >> 1) & 1, bits & 1],
        current = [...initial];
      if (event) [current[0], current[event]] = [current[event], current[0]];
      return { initial, event, current };
    }),
  );
}
function normalRun(table, replies, variant = "main") {
  const worlds = normalWorlds(variant),
    m = model(worlds, worlds.map((w) => table.set.has(row(w.current))));
  const views = [0, 1, 2].map((a) =>
    worlds.map((w) => {
      const own = a === 0 && variant === "forget_A" ? [] : [`own=${w.initial[a]}`];
      if (a === 1 || variant === "public_event") own.push(`e=${w.event}`);
      if (a === 0) own.push(`now=${w.current[0]}`);
      return own;
    }),
  );
  return { worlds, m, run: m.play(views, replies, variant === "public_reports") };
}
// Nesting depths of the questions and of final-stage counterfactuals.
const DEPTHS = {
  normal: { questions: [1, 3], counterfactuals: [1, 2] },
  deep: { questions: [2, 4], counterfactuals: [2, 3] },
};
function normal(r, depths) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const table = factTable(r),
      replies = pickReplies(r);
    const { worlds, m, run } = normalRun(table, replies);
    if (!run.values.every(varies)) continue;
    const questions = pickQuestions(r, 8, [0, 1, 2], depths.questions, (p, s) =>
      m.truth(p, run.stages[s]),
    );
    if (!questions) continue;
    // Each counterfactual asks a reply or a final-stage question whose
    // answer depends on the world within that variant.
    const counterfactuals = Object.keys(VARIANTS).map((variant) => {
      const alt = normalRun(table, replies, variant);
      for (let tries = 0; tries < 100; tries++) {
        const kind = r.integer(3);
        const p = kind < 2 ? null : nested(r, depths.counterfactuals);
        const values = p ? alt.m.truth(p, alt.run.stages[2]) : alt.run.values[kind];
        if (varies(values)) return { variant, kind, p, alt, values };
      }
      return null;
    });
    if (counterfactuals.includes(null)) continue;
    const candidates = worlds.flatMap((w, i) => {
      const values = [...run.values, ...questions.map((q) => q.values)].map((v) => v[i]);
      for (const c of counterfactuals) {
        const j = c.alt.worlds.findIndex(
          (x) =>
            x.event === (c.variant === "no_swap" ? 0 : w.event) &&
            x.initial.every((bit, k) => bit === w.initial[k]),
        );
        values.push(c.values[j]);
      }
      return balanced(values, 0.3, 0.7) ? [{ i, values }] : [];
    });
    if (!candidates.length) continue;
    const { i: actual, values } = r.choose(candidates);
    const names = ["report1", "report2", ...questions.map((_, i) => `q${i + 1}`)];
    const answer = {
      knowledge: Object.fromEntries(names.map((name, i) => [name, values[i]])),
      counterfactual: Object.fromEntries(
        counterfactuals.map((c, i) => [c.variant, values[names.length + i]]),
      ),
    };
    const { initial, event } = worlds[actual];
    const stageName = ["physical", "after reply 1", "final"];
    const prompt = `Three agents A, B, C initially have bits (a0,b0,c0). All eight triples and all three events are possible, independently: e=0 does nothing; e=1 swaps A's and B's bits; e=2 swaps A's and C's bits. Thus there are 24 possible initial-triple/event histories. Bits after the event are (a,b,c). Each agent initially sees only their own bit. After the event only A privately sees their current bit, and only B privately learns e. C gets no new observation. There are no other observations.

F is true exactly when the post-event bits (a,b,c), written abc, are one of: ${table.text}.

${NOTATION}

After the physical observations, two mandatory Boolean replies occur:
${replyText(replies)}
Speakers remember their own replies. Everyone knows who hears each reply and that both replies happen. Nobody else hears the value. An unheard reply is not a public announcement: retain histories with both possible values for nonlisteners. Evaluate each reply using knowledge immediately before it, then update only the speaker and listener's observations.

Actual initial bits (a0,b0,c0): (${initial.join(",")}); actual event e=${event}.

Stages: physical = after bit/event observations, before replies; after reply 1 = immediately after the first reply; final = after both replies. Every occurrence of a, b, c means the current post-event bit. report1 and report2 are the two spoken replies. The other fields mean:
${questions.map((q, i) => `- q${i + 1}: ${stageName[q.stage]}: ${render(q.p)}.`).join("\n")}

For each counterfactual, restart the entire protocol independently with the same actual initial bits and event (e=0 for no_swap), except where changed below. All agents commonly know the changed rule from the start. Recompute both replies and every nested knowledge claim; do not carry over factual-world reply values.
${counterfactuals
  .map(
    (c) =>
      `- ${c.variant}: ${VARIANTS[c.variant]}; answer ${c.p ? `final ${render(c.p)}` : `reply ${c.kind + 1}`}.`,
  )
  .join("\n")}`;
    return { prompt, answer };
  }
  throw Error("No balanced normal case");
}

// Deep is the normal protocol with more deeply nested questions.
export function generateCompact(seed, difficulty) {
  if (!["easy", "normal", "deep"].includes(difficulty))
    throw Error("Compact difficulty must be easy, normal or deep");
  const r = randomSource(seed);
  const { prompt, answer } =
    difficulty === "easy" ? easy(r) : normal(r, DEPTHS[difficulty]);
  return {
    generatorVersion: 2,
    difficulty,
    prompt,
    answer,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
  };
}
