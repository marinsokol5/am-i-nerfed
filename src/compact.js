import { createHash } from "node:crypto";
import { randomSource } from "./random.js";
import {
  F,
  K,
  Kw,
  Not,
  current,
  makeRun,
  knowledgeAnswers,
} from "./epistemic.js";

// These cases intentionally omit the report ledger and policy search in hard.
// Callers derive an independent secret stream for each difficulty before calling.
const ZERO_CHECKS = { R0: 0, D5: 0, R14: 0, D7: 0 };
const NOTATION = `K_X(P) means P is true in every world consistent with X's observations at that stage. W_X(P) means K_X(P) OR K_X(NOT P): X knows whether P, not necessarily that P is true. A false knowledge claim does not assert its negation is known. All agents reason perfectly, remember everything they observe, and commonly know this protocol. The actual world below is given to you only; it is not extra information for the agents.`;

function schema(answer) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(answer).map(([stage, fields]) => [
        stage,
        Object.fromEntries(Object.keys(fields).map((name) => [name, null])),
      ]),
    ),
    null,
    2,
  );
}

function easyModel(targets) {
  const worlds = Array.from({ length: 8 }, (_, i) => [
    i >> 2,
    (i >> 1) & 1,
    i & 1,
  ]);
  const facts = worlds.map(
    ([a, b, c]) => (a === targets[0] && b === targets[1]) || c === targets[2],
  );
  const views = worlds.map((bits) => bits.map((bit) => [bit]));
  const stages = [];
  const snapshot = () => {
    const signatures = views.map((view) => view.map((v) => JSON.stringify(v)));
    function truth(formula, world) {
      const [op, actor, child] = formula;
      if (op === "fact") return facts[world];
      if (op === "current") return Boolean(worlds[world][actor]);
      if (op === "not") return !truth(actor, world);
      if (op === "or") return truth(actor, world) || truth(child, world);
      if (op === "knows")
        return worlds.every(
          (_, other) =>
            signatures[world][actor] !== signatures[other][actor] ||
            truth(child, other),
        );
      throw Error("Unknown easy-case formula");
    }
    return { truth };
  };
  stages.push(snapshot());
  const replies = [];
  for (const [speaker, listener, formula] of [
    [2, 0, Kw(2, F)],
    [0, 1, Kw(0, F)],
  ]) {
    const values = worlds.map((_, i) => stages.at(-1).truth(formula, i));
    replies.push(values);
    for (const actor of [speaker, listener])
      worlds.forEach((_, i) => views[i][actor].push(values[i]));
    stages.push(snapshot());
  }
  return { worlds, stages, replies };
}

const EASY_QUERIES = [
  ["after_C_A_knows_F", 1, K(0, F), "after C's reply: K_A(F)"],
  ["final_B_knows_F", 2, K(1, F), "after both replies: K_B(F)"],
  ["final_B_decides_F", 2, Kw(1, F), "after both replies: W_B(F)"],
  [
    "final_C_knows_A_decides_F",
    2,
    K(2, Kw(0, F)),
    "after both replies: K_C(W_A(F))",
  ],
  ["final_A_knows_NOT_F", 2, K(0, Not(F)), "after both replies: K_A(NOT F)"],
  [
    "final_B_knows_a_is_1",
    2,
    K(1, current(0)),
    "after both replies: K_B(a = 1)",
  ],
];

function easy(random) {
  const targets = Array.from({ length: 3 }, () => random.integer(2));
  const run = easyModel(targets);
  const keys = run.worlds.map((_, actual) => ({
    report_C: run.replies[0][actual],
    report_A: run.replies[1][actual],
    ...Object.fromEntries(
      EASY_QUERIES.map(([name, stage, formula]) => [
        name,
        run.stages[stage].truth(formula, actual),
      ]),
    ),
  }));
  const candidates = keys.flatMap((key, i) => {
    const trueCount = Object.values(key).filter(Boolean).length;
    return trueCount >= 1 && trueCount <= 7 ? [i] : [];
  });
  if (!candidates.length) throw Error("No balanced easy case");
  const actual = random.choose(candidates);
  const answer = { knowledge: keys[actual] };
  const prompt = `Am I nerfed — easy

Three agents A, B, C each have a fixed bit a, b, c. Every one of the eight triples is initially possible. Each agent privately sees only their own bit; there are no swaps or later bit observations.

Target bits: (${targets.join(",")}). Let F mean (a = ${targets[0]} AND b = ${targets[1]}) OR c = ${targets[2]}.

${NOTATION}

Two mandatory replies happen in order:
1. C answers the Boolean question W_C(F); only A hears C's reply.
2. A then answers the Boolean question W_A(F); only B hears A's reply.
Speakers remember their own replies. Everyone knows who hears each reply and that both replies happen. Nobody else hears the value; an unheard reply is not a public announcement. Replies are recomputed after each update.

Actual initial bits (a,b,c): (${run.worlds[actual].join(",")}).

Return these eight Booleans in the schema below. report_C and report_A are the two spoken replies. The other fields ask:
${EASY_QUERIES.map(([name, , , description]) => `- ${name}: ${description}.`).join("\n")}

Return only JSON; replace each null with true or false. If unsolved, leave null; no explanations or tools.
${schema(answer)}
`;
  return { prompt, answer };
}

const NORMAL_DESCRIPTIONS = [
  ["physical_A_knows_F", "physical: K_A(F)"],
  ["physical_B_knows_current_B", "physical: W_B(b = 1)"],
  [
    "after_B_A_decides_C_decides_B_knows_current_B",
    "after B: W_A(W_C(K_B(b = 1)))",
  ],
  ["after_B_C_knows_whether_A_decides_F", "after B: W_C(W_A(F))"],
  ["after_B_C_knows_A_ignorant", "after B: K_C(NOT W_A(F))"],
  ["final_C_knows_whether_F", "final: W_C(F)"],
  ["final_C_knows_whether_B_decides_F", "final: W_C(W_B(F))"],
  [
    "after_B_B_knows_A_decides_C_knows_current_C",
    "after B: K_B(W_A(K_C(c = 1)))",
  ],
];

function normal(random) {
  const gates = Array.from({ length: 3 }, () => random.integer(2));
  const parameters = {
    offsets: [...gates, 0],
    parity_offset: 0,
    mode_offset: 0,
  };
  const run = makeRun(ZERO_CHECKS, parameters);
  const candidates = run.histories.flatMap((_, i) => {
    const trueCount = Object.values(knowledgeAnswers(run, i)).filter(
      Boolean,
    ).length;
    return trueCount >= 3 && trueCount <= 7 ? [i] : [];
  });
  if (!candidates.length) throw Error("No balanced normal case");
  const actual = random.choose(candidates);
  const { initial, event } = run.histories[actual];
  const counterfactual = {};
  for (const variant of [
    "public_event",
    "public_reports",
    "forget_A",
    "no_swap",
  ]) {
    const alternate = makeRun(ZERO_CHECKS, parameters, variant);
    const index = alternate.histories.findIndex(
      (h) =>
        h.event === (variant === "no_swap" ? 0 : event) &&
        h.initial.every((bit, i) => bit === initial[i]),
    );
    if (variant === "public_event")
      counterfactual.public_event_C_knows_current_C = alternate.stages
        .at(-1)
        .truth(Kw(2, current(2)))[index];
    if (variant === "public_reports")
      counterfactual.public_reports_C_decides_B_decides_F = alternate.stages
        .at(-1)
        .truth(Kw(2, Kw(1, F)))[index];
    if (variant === "forget_A")
      counterfactual.forget_A_report_A = alternate.answers[1][index];
    if (variant === "no_swap")
      counterfactual.no_swap_report_B = alternate.answers[0][index];
  }
  const answer = {
    knowledge: knowledgeAnswers(run, actual),
    counterfactual,
  };
  const prompt = `Am I nerfed — normal

Three agents A, B, C initially have bits (a0,b0,c0). All eight triples and all three events are possible, independently: e=0 does nothing; e=1 swaps A's and B's bits; e=2 swaps A's and C's bits. Thus there are 24 possible initial-triple/event histories. Bits after the event are (a,b,c). Each agent initially sees only their own bit. After the event only A privately sees their current bit, and only B privately learns e. C gets no new observation. There are no other observations.

Gates (x,y,z): (${gates.join(",")}). F is the Boolean proposition (a XOR x) AND (b XOR y XOR ([e=2] AND z)); [e=2] is 1 when e=2 and 0 otherwise. XOR is addition modulo two, and bits 1/0 mean true/false.

${NOTATION}

After the physical observations, two mandatory Boolean replies occur:
1. B answers K_B(NOT W_A(F)); only C hears B's reply.
2. A then answers W_A(F); only C hears A's reply.
Speakers remember their own replies. Everyone knows who hears each reply and that both replies happen. Nobody else hears the value. An unheard reply is not a public announcement: retain histories with both possible values for nonlisteners. Evaluate each reply using knowledge immediately before it, then update only the speaker and listener's observations. In particular, B's false reply does not mean B knows that A knows whether F.

Actual initial bits (a0,b0,c0): (${initial.join(",")}); actual event e=${event}.

Stages: physical = after bit/event observations, before replies; after B = immediately after B's reply; final = after both replies. Every occurrence of a, b, c means the current post-event bit. Answer knowledge.report_B and knowledge.report_A with the two spoken replies. The other knowledge fields mean:
${NORMAL_DESCRIPTIONS.map(([name, description]) => `- ${name}: ${description}.`).join("\n")}

For each counterfactual, restart the entire protocol independently with the same actual initial bits and event, except where changed below. All agents commonly know the changed rule from the start. Recompute both replies and every nested knowledge claim; do not carry over factual-world reply values.
- public_event_C_knows_current_C: e is announced to everyone at the physical stage; answer final W_C(c = 1).
- public_reports_C_decides_B_decides_F: both replies are heard by everyone; answer final W_C(W_B(F)).
- forget_A_report_A: A never sees a0 (instead of losing memory after seeing it); A still sees a after the event. Answer A's second reply.
- no_swap_report_B: only e=0 is possible, commonly known from the start, so the universe has eight histories and F uses e=0. Answer B's first reply.

Return only JSON in this schema; replace each null with true or false. If unsolved, leave null; no explanations or tools.
${schema(answer)}
`;
  return { prompt, answer };
}

export function generateCompact(seed, difficulty) {
  if (!["easy", "normal"].includes(difficulty))
    throw Error("Compact difficulty must be easy or normal");
  const { prompt, answer } = (difficulty === "easy" ? easy : normal)(
    randomSource(seed),
  );
  return {
    generatorVersion: 1,
    difficulty,
    prompt,
    answer,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
  };
}
