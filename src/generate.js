import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { difficultyLevel } from "./difficulty.js";
import { generateCompact } from "./compact.js";
import { randomSource } from "./random.js";
import { generateReports } from "./reports.js";
import {
  makeRun,
  knowledgeAnswers,
  forcedContext,
  Kw,
  F,
  current,
} from "./epistemic.js";
import { payoffFrontier, solveScores, mixedOptimum } from "./coordination.js";
const VARIANTS = ["public_event", "public_reports", "forget_A", "no_swap"];
const rationalValue = (s) => {
  const [n, d] = s.split("/").map(Number);
  return n / d;
};
const robust = (points) => Math.max(...points.map((p) => Math.min(...p)));
const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
export function chooseParameters(random, checks) {
  const actual = random.integer(24),
    configs = [];
  for (let n = 0; n < 16; n++)
    for (let parity = 0; parity < 2; parity++)
      for (let mode = 0; mode < 3; mode++)
        configs.push({
          offsets: [n >> 3, (n >> 2) & 1, (n >> 1) & 1, n & 1],
          parity_offset: parity,
          mode_offset: mode,
        });
  let best;
  for (const p of random.shuffle(configs)) {
    const run = makeRun(checks, p);
    if (
      run.answers.some((a) => new Set(a).size < 2) ||
      run.stages.at(-1).cells[2].length > 6
    )
      continue;
    const base = payoffFrontier(run.contexts, run.targets),
      score = robust(base);
    const before = payoffFrontier(run.stages[1].contexts, run.targets),
      forgot = makeRun(checks, p, "forget_A");
    const quality = [
      Number(rationalValue(mixedOptimum(base)) > score),
      Number(score > robust(before)),
      Number(score > robust(payoffFrontier(forgot.contexts, forgot.targets))),
      -Math.abs(
        Object.values(knowledgeAnswers(run, actual)).filter(Boolean).length - 5,
      ),
      base.length,
      run.stages.at(-1).cells[2].length,
    ];
    if (!best || compare(quality, best.quality) > 0)
      best = { parameters: p, actual, quality };
  }
  if (!best) throw Error("No suitable routing parameters");
  return best;
}
export function answersFor(checks, parameters, actual) {
  const run = makeRun(checks, parameters);
  const knowledge = knowledgeAnswers(run, actual),
    coordination = solveScores(run.contexts, run.targets, {
      forcedContext: forcedContext(run),
    }),
    counterfactual = {};
  for (const variant of VARIANTS) {
    const alternate = makeRun(checks, parameters, variant);
    counterfactual[variant + "_base"] = solveScores(
      alternate.contexts,
      alternate.targets,
      { cases: ["base"] },
    ).base;
    const initial = run.histories[actual].initial,
      event = variant === "no_swap" ? 0 : run.histories[actual].event;
    const index = alternate.histories.findIndex(
      (h) => h.event === event && h.initial.every((v, i) => v === initial[i]),
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
  return { knowledge, coordination, counterfactual };
}
function generateHard(seed) {
  const random = randomSource(seed),
    reports = generateReports(random),
    selected = chooseParameters(random, reports.checks);
  const { parameters, actual } = selected;
  const answer = {
    reports: reports.reports,
    checks: reports.checks,
    ...answersFor(reports.checks, parameters, actual),
  };
  const initial = [
      (actual / 12) | 0,
      ((actual / 6) | 0) % 2,
      ((actual / 3) | 0) % 2,
    ],
    event = actual % 3;
  let prompt = readFileSync(
    new URL("./templates/case.txt", import.meta.url),
    "utf8",
  );
  const replacements = {
    ARCHIVES: reports.archives,
    OFFSETS: parameters.offsets.join(","),
    PARITY: parameters.parity_offset,
    MODE: parameters.mode_offset,
    INITIAL: initial.join(","),
    EVENT: event,
  };
  for (const [key, value] of Object.entries(replacements))
    prompt = prompt.replaceAll(`@@${key}@@`, String(value));
  return {
    generatorVersion: 1,
    prompt,
    answer,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
  };
}

// Keep the v0.1 hard stream byte-for-byte stable. Compact streams cannot consume
// or change its random draws, and each difficulty has an independent domain.
export function variantSeed(seed, difficulty) {
  difficultyLevel(difficulty);
  if (difficulty === "hard") return seed;
  return createHmac("sha256", seed)
    .update(`am-i-nerfed/compact/v1/${difficulty}`)
    .digest("hex");
}
export function generate(seed, difficulty = "hard") {
  difficultyLevel(difficulty);
  return difficulty === "hard"
    ? generateHard(seed)
    : generateCompact(variantSeed(seed, difficulty), difficulty);
}
