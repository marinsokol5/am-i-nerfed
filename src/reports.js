import { readFileSync } from "node:fs";
export const REPORT_FIELDS = ["R0", "D5", "R14", "D7"];
export const PRODUCT_CODE = {
  "-": 0,
  brackets: 1,
  gaskets: 2,
  hinges: 3,
  sprockets: 4,
  widgets: 5,
};
export const products = Object.keys(PRODUCT_CODE).slice(1);
const alpha = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function counts(r, o) {
  return r.counted === "not_cancelled"
    ? o.status !== "cancelled"
    : r.counted === "delivered_only"
      ? o.status === "delivered"
      : !["cancelled", "refunded"].includes(o.status);
}
function amount(r, o) {
  let n = o.qty * o.price * 100;
  if (r.bulk !== null && o.qty >= r.bulk) {
    n = r.disc_unit_round
      ? o.qty * Math.floor((o.price * 9 + 5) / 10) * 100
      : (n * 9) / 10;
  }
  return n;
}
function rounded(r, n) {
  return r.rounding === "exact"
    ? n
    : Math.floor((n + (r.rounding === "nearest10" ? 500 : 0)) / 1000) * 1000;
}
export function reportLines(rule, orders, customers, extension = {}) {
  const r = { ...rule, ...extension },
    rows = [];
  for (const customer of customers) {
    const mine = orders.filter((o) => o.customer === customer && counts(r, o));
    if (!mine.length && !r.zero_lines) continue;
    const raw = mine.reduce(
      (s, o) => s + (r.round_each ? rounded(r, amount(r, o)) : amount(r, o)),
      0,
    );
    const pool = r.late_scope === "all" ? orders : mine;
    const late = pool.filter(
      (o) =>
        o.customer === customer &&
        o.status !== "cancelled" &&
        (o.status === "pending"
          ? r.late === "after_promised_or_pending"
          : (o.status === "delivered" ||
              (o.status === "refunded" && r.late_refunded)) &&
            o.delivered > o.promised + (r.late === "grace1" ? 1 : 0)),
    ).length;
    const ranked =
      r.top_scope === "delivered"
        ? mine.filter((o) => o.status === "delivered")
        : mine;
    const score = new Map();
    ranked.forEach((o, i) => {
      if (!score.has(o.product))
        score.set(o.product, {
          qty: 0,
          revenue: 0,
          orders: 0,
          first: i,
          last: i,
        });
      const s = score.get(o.product);
      s.qty += o.qty;
      s.revenue += amount(r, o);
      s.orders++;
      s.last = i;
    });
    const ordered = [...score.keys()].sort((a, b) => {
      const x = score.get(a),
        y = score.get(b),
        d = y[r.top] - x[r.top];
      if (d) return d;
      if (r.tie === "first_ordered") return x.first - y.first;
      if (r.tie === "last_ordered") return y.last - x.last;
      if (r.tie.startsWith("by_"))
        return y[r.tie.slice(3)] - x[r.tie.slice(3)] || alpha(a, b);
      return alpha(a, b);
    });
    rows.push({
      customer,
      orders: mine.length,
      revenue_cents: rounded(r, raw),
      late,
      top: ordered[0] ?? "-",
      raw,
    });
  }
  const seen = new Map();
  orders.forEach((o) => {
    if (!seen.has(o.customer)) seen.set(o.customer, seen.size);
  });
  rows.sort((a, b) => {
    const rev = (x) => (r.sort_on_printed ? rounded(r, x.raw) : x.raw);
    let d =
      r.sort === "revenue_desc"
        ? rev(b) - rev(a)
        : r.sort === "orders_desc"
          ? b.orders - a.orders
          : 0;
    if (!d && r.sort_tie === "secondary")
      d =
        r.sort === "revenue_desc"
          ? b.orders - a.orders
          : r.sort === "orders_desc"
            ? rev(b) - rev(a)
            : 0;
    if (!d && r.sort !== "name" && r.sort_tie === "appearance")
      d =
        (seen.get(a.customer) ?? seen.size) -
        (seen.get(b.customer) ?? seen.size);
    return d || alpha(a.customer, b.customer);
  });
  return rows.map(({ raw, ...row }) => row);
}
export function checkDigit(rows) {
  return (
    rows.reduce(
      (s, r, i) =>
        s +
        (i + 1) *
          (r.orders +
            2 * r.late +
            Math.floor(r.revenue_cents / 1000) +
            PRODUCT_CODE[r.top]),
      0,
    ) % 8
  );
}
export function ordersTable(orders) {
  return [
    "| Order | Customer | Product | Qty | Unit price | Status | Promised | Delivered |",
    "|---|---|---|---|---|---|---|---|",
    ...orders.map(
      (o) =>
        `| #${o.id} | ${o.customer} | ${o.product} | ${o.qty} | $${o.price} | ${o.status} | ${o.promised} | ${o.delivered ?? "—"} |`,
    ),
  ].join("\n");
}
export function generateReports(
  random,
  templates = JSON.parse(
    readFileSync(new URL("./templates/reports.json", import.meta.url), "utf8"),
  ),
) {
  const reports = {},
    checks = {},
    archives = [];
  for (const [index, t] of (templates.reports ?? templates).entries()) {
    const rule = t.correctAugustRule;
    let orders,
      rows,
      accepted = false;
    for (let attempt = 0; attempt < 2000; attempt++) {
      orders = Array.from({ length: 14 }, (_, i) => {
        const status = random.choose([
          "delivered",
          "delivered",
          "pending",
          "cancelled",
          "refunded",
        ]);
        const promised = 3 + random.integer(21);
        return {
          id: 1200 + i,
          customer: random.choose(t.customers),
          product: random.choose(products),
          qty: random.choose([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20]),
          price: 5 + random.integer(91),
          status,
          promised,
          delivered: ["delivered", "refunded"].includes(status)
            ? promised + random.choose([-2, -1, 0, 1, 2, 3, 5])
            : null,
        };
      });
      if (
        t.generation?.allowedStatuses &&
        orders.some((o) => !t.generation.allowedStatuses.includes(o.status))
      )
        continue;
      if (
        rule.bulk !== null &&
        t.generation?.bulkSafeGap &&
        orders.some(
          (o) =>
            counts(rule, o) &&
            o.qty > t.generation.bulkSafeGap.lo &&
            o.qty < t.generation.bulkSafeGap.hi,
        )
      )
        continue;
      rows = reportLines(rule, orders, t.customers);
      const signature = JSON.stringify(rows);
      if (
        !t.survivors.every(
          (s) =>
            JSON.stringify(
              reportLines(s.rule, orders, t.customers, s.extension),
            ) === signature,
        )
      )
        continue;
      if (
        t.julyRule &&
        JSON.stringify(reportLines(t.julyRule, orders, t.customers)) ===
          signature
      )
        continue;
      accepted = true;
      break;
    }
    if (!accepted)
      throw Error("No unambiguous report found within bounded search");
    // Order-preserving fresh names preserve all alphabetical tie semantics.
    const salt = random.hex().slice(0, 8),
      renames = new Map(
        [...t.customers]
          .sort(alpha)
          .map((c, i) => [c, `${String.fromCharCode(65 + i)}${salt} Company`]),
      );
    let prefix = t.promptPrefix;
    for (const [old, name] of renames) prefix = prefix.replaceAll(old, name);
    const namedOrders = orders.map((o) => ({
      ...o,
      customer: renames.get(o.customer),
    }));
    rows = rows.map((r) => ({ ...r, customer: renames.get(r.customer) }));
    const field = REPORT_FIELDS[index];
    reports[field] = { row_count: rows.length, rows };
    checks[field] = checkDigit(rows);
    archives.push(
      `BEGIN ARCHIVED CASE SHEET ${t.id} (output field ${field})\n${prefix}September orders:\n\n${ordersTable(namedOrders)}\n\nthanks!!\nEND ARCHIVED CASE SHEET ${t.id}\n`,
    );
  }
  return { reports, checks, archives: archives.join("\n") };
}
