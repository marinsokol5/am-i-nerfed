// Independent optimal protocols and trivial baselines for a coordination
// table, found by enumerating rules rather than through the production
// solver, valuation or baselines.
// The last agent C is completed context by context: once A and B are fixed,
// each of C's contexts adds its own payoff, so all C rules are summed cheaply.
const AGENTS = ["A", "B", "C"];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const reduced = (n, d) => `${n / gcd(n, d)}/${d / gcd(n, d)}`;

export function optimalProtocols({ symbols, rows, weights, qualified }) {
  const count = 2 ** symbols;
  const rule = (bits, offset = 0) =>
    Array.from({ length: symbols }, (_, s) => (bits >> (offset + s)) & 1).join(
      "",
    );
  const data = rows.map((row, i) => ({
    symbols: [...row].map(Number),
    weight: weights[i],
    qualified: qualified.map((mode) => AGENTS.indexOf(mode[i])),
  }));
  const gain = (row, actions) => {
    if (actions[0] + actions[1] + actions[2] !== 1) return [0, 0];
    return row.qualified.map((q) => (actions[q] ? row.weight : 0));
  };
  // Best C over `contexts` signal-extended contexts, given A's and B's actions.
  function completeC(actions, context, contexts) {
    const add = Array.from({ length: contexts }, () => [
      [0, 0],
      [0, 0],
    ]);
    for (const row of data)
      for (const c of [0, 1]) {
        const g = gain(row, [...actions(row), c]),
          cell = add[context(row)][c];
        cell[0] += g[0];
        cell[1] += g[1];
      }
    let best = { value: -1 };
    for (let x = 0; x < 2 ** contexts; x++) {
      let s1 = 0,
        s2 = 0;
      for (let k = 0; k < contexts; k++) {
        const g = add[k][(x >> k) & 1];
        s1 += g[0];
        s2 += g[1];
      }
      if (Math.min(s1, s2) > best.value)
        best = { value: Math.min(s1, s2), x };
    }
    return best;
  }
  const bit = (bits, index) => (bits >> index) & 1;

  const policies = [];
  for (let a = 0; a < count; a++)
    for (let b = 0; b < count; b++)
      for (let c = 0; c < count; c++) {
        const scores = [0, 0];
        for (const row of data) {
          const [x, y, z] = row.symbols,
            g = gain(row, [bit(a, x), bit(b, y), bit(c, z)]);
          scores[0] += g[0];
          scores[1] += g[1];
        }
        policies.push({
          scores,
          protocol: { A: rule(a), B: rule(b), C: rule(c) },
        });
      }
  const argmax = (candidates, value) =>
    candidates.reduce((best, p) =>
      value(p.scores) > value(best.scores) ? p : best,
    );
  const robust = ([s1, s2]) => Math.min(s1, s2),
    first = ([s1]) => s1,
    second = ([, s2]) => s2;
  const base = argmax(policies, robust),
    mode1 = argmax(policies, first),
    mode2 = argmax(policies, second);

  // A mixture of two policies f, g with weight p on f: min of two lines in p
  // peaks at p = 0, p = 1, or where the expectations cross.
  function mixture(candidates) {
    const pure = argmax(candidates, robust);
    let best = {
      n: robust(pure.scores),
      d: 1,
      p: "1/1",
      first: pure.protocol,
      second: pure.protocol,
    };
    const distinct = [
      ...new Map(candidates.map((p) => [p.scores.join(","), p])).values(),
    ];
    for (const f of distinct)
      for (const g of distinct) {
        const [f1, f2] = f.scores,
          [g1, g2] = g.scores;
        if (f1 - f2 <= 0 || g2 - g1 <= 0) continue;
        const d = f1 - f2 + g2 - g1,
          n = f1 * g2 - f2 * g1;
        if (n * best.d > best.n * d)
          best = {
            n,
            d,
            p: reduced(g2 - g1, d),
            first: f.protocol,
            second: g.protocol,
          };
      }
    return best;
  }
  const mixed = mixture(policies);

  // Trivial policies: one agent's rule is all ones, the others all zeros.
  // Binding and broadcast versions ignore what they hear, so they score as
  // base does.
  const all = count - 1,
    trivial = [
      policies[all * count * count],
      policies[all * count],
      policies[all],
    ],
    trivialMix = mixture(trivial);

  let binding = { value: -1 };
  for (let a = 0; a < count; a++)
    for (let b = 0; b < count ** 2; b++) {
      const actions = (row) => {
          const [x, y] = row.symbols,
            first = bit(a, x);
          return [first, bit(b, y + symbols * first)];
        },
        context = (row) => row.symbols[2] + symbols * bit(a, row.symbols[0]);
      const best = completeC(actions, context, 2 * symbols);
      if (best.value > binding.value) binding = { ...best, a, b };
    }

  // Complementing the message and swapping every agent's two rules changes
  // nothing, so symbol 0 announces 0. A acts on a alone: both rules agree.
  let broadcast = { value: -1 };
  for (let m = 0; m < count; m += 2)
    for (let a = 0; a < count; a++)
      for (let b = 0; b < count ** 2; b++) {
        const actions = (row) => {
            const [x, y] = row.symbols;
            return [bit(a, x), bit(b, y + symbols * bit(m, x))];
          },
          context = (row) => row.symbols[2] + symbols * bit(m, row.symbols[0]);
        const best = completeC(actions, context, 2 * symbols);
        if (best.value > broadcast.value) broadcast = { ...best, m, a, b };
      }

  const signal = (bits, names) =>
    Object.fromEntries(names.map((name, i) => [name, rule(bits, symbols * i)]));
  const heard = ["if_A_waits", "if_A_dispatches"],
    message = ["if_message_0", "if_message_1"];
  return {
    values: {
      base: `${Math.min(...base.scores)}/1`,
      mixed: reduced(mixed.n, mixed.d),
      mode_1: `${mode1.scores[0]}/1`,
      mode_2: `${mode2.scores[1]}/1`,
      binding: `${binding.value}/1`,
      broadcast: `${broadcast.value}/1`,
    },
    protocols: {
      base: base.protocol,
      mixed: { p: mixed.p, first: mixed.first, second: mixed.second },
      mode_1: mode1.protocol,
      mode_2: mode2.protocol,
      binding: {
        A: rule(binding.a),
        B: signal(binding.b, heard),
        C: signal(binding.x, heard),
      },
      broadcast: {
        message: rule(broadcast.m),
        A: { if_message_0: rule(broadcast.a), if_message_1: rule(broadcast.a) },
        B: signal(broadcast.b, message),
        C: signal(broadcast.x, message),
      },
    },
    baselines: {
      base: `${robust(argmax(trivial, robust).scores)}/1`,
      mixed: reduced(trivialMix.n, trivialMix.d),
      mode_1: `${first(argmax(trivial, first).scores)}/1`,
      mode_2: `${second(argmax(trivial, second).scores)}/1`,
      binding: `${robust(argmax(trivial, robust).scores)}/1`,
      broadcast: `${robust(argmax(trivial, robust).scores)}/1`,
    },
    // The best mixture of trivial policies, which sits exactly at its baseline.
    trivialMixture: {
      p: trivialMix.p,
      first: trivialMix.first,
      second: trivialMix.second,
    },
  };
}
