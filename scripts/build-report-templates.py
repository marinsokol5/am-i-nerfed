#!/usr/bin/env python3
"""Extract public report examples and exhaustively retain compatible rule readings.

Run with an external directory holding the four audited lab-format report JSONs:
    python3 scripts/build-report-templates.py EXTERNAL_REPORT_DIR

The output deliberately excludes the original test orders, test answers, and seeds.
It validates their uniqueness in memory as a regression check, but never writes them.
The rule-space audit is finite, not a claim of uniqueness over arbitrary business rules.
"""

import argparse
import hashlib
import itertools
import json
import re
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lab"))
import vague as v

NAMES = ("report-0", "report-drift-5", "report-14", "report-drift-7")
QUANTITIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20]
EXTENSIONS = [{}] + v.EXTENSIONS


def signature(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def tuple_rule(rule):
    return tuple(rule[k] for k in v.RKEYS)


def public_examples(item):
    prefix, separator, _ = item["prompt"].partition("September orders:\n")
    if not separator or prefix.count("Sam's July summary:") != 1 or prefix.count("Sam's August summary:") != 1:
        raise ValueError("Expected exactly two public example summaries before September")
    wants = []
    for month in ("July", "August"):
        match = re.search(r"Sam's " + month + r" summary:\s*```text\n(.*?)```", prefix, re.S)
        if not match:
            raise ValueError(f"Missing {month} literal summary")
        wants.append(match.group(1).strip().splitlines())
    return prefix, wants


def displayed(combo, orders, customers, extension=None):
    return [v.fmt_line(row) for row in v.report_lines(combo, orders, customers, extension)]


def compatible_rules(item, wants):
    customers = item["data"]["customers"]
    july, august = item["data"]["examples"]
    drift = "july_rules" in item["meta"]
    all_rules = list(itertools.product(*v.HYP_SPACE.values()))
    found = {}
    pair_count = 0
    for extension in EXTENSIONS:
        july_matches = [rule for rule in all_rules if displayed(rule, july, customers, extension) == wants[0]]
        for july_rule in july_matches:
            if drift:
                august_candidates = (
                    july_rule[:i] + (value,) + july_rule[i + 1:]
                    for i, key in enumerate(v.RKEYS)
                    for value in v.HYP_SPACE[key]
                    if value != july_rule[i]
                )
            else:
                august_candidates = (july_rule,)
            for rule in august_candidates:
                if displayed(rule, august, customers, extension) != wants[1]:
                    continue
                pair_count += 1
                survivor = {"rule": dict(zip(v.RKEYS, rule)), "extension": extension}
                # Several base values may be overwritten by a fixed extension
                # (for example a top-product tie convention). Retain one witness
                # per effective August dictionary, without dropping a reading.
                found.setdefault(signature(survivor["rule"] | extension), survivor)
    return [found[k] for k in sorted(found)], pair_count


def customer_discount_prefilter(item, wants):
    """Check count/revenue evidence for the recognized customer-month alternative.

    This is deliberately a necessary-condition audit, with no top/late/sort filter.
    Zero survivors rules out the whole searched family. A nonzero result is retained
    as a limitation and must not be treated as a validated full interpretation.
    """
    customers = item["data"]["customers"]
    months = item["data"]["examples"]
    expected = []
    for month_wants in wants:
        rows = {}
        for text in month_wants:
            m = re.fullmatch(r"(.+): (\d+) orders?, (\$[\d,.]+), \d+ late, top .+", text)
            if not m:
                raise ValueError("Unrecognized public report row")
            rows[m[1]] = (int(m[2]), m[3])
        expected.append(rows)

    original_value = v.order_value

    def eligible(order, counted, scope):
        if scope == "counted":
            return v.counts({"counted": counted}, order)
        if scope == "all":
            return True
        if scope == "non_cancelled":
            return order["status"] != "cancelled"
        return order["status"] == "delivered"

    # At most fourteen lines of twenty units are generated. This tests every
    # possible positive integer customer threshold, not just the old 1..30 range.
    profiles = [set(), set()]
    for counted, rounding, zero_lines, round_each, unit_round, scope in itertools.product(
        v.REPORT_SPACE["counted"], v.REPORT_SPACE["rounding"], v.REPORT_SPACE["zero_lines"],
        (False, True), (False, True), ("counted", "all", "non_cancelled", "delivered"),
    ):
        r = dict(counted=counted, rounding=rounding, zero_lines=zero_lines,
                 round_each=round_each, disc_unit_round=unit_round)
        for month_index, orders in enumerate(months):
            quantities = {c: sum(o["qty"] for o in orders if o["customer"] == c and eligible(o, counted, scope))
                          for c in customers}
            # Only quantity split points can change the result within a month.
            thresholds = sorted({1, 281, *(q + 1 for q in quantities.values())})
            for lower, upper in zip(thresholds, thresholds[1:]):
                got = {}
                for customer in customers:
                    mine = [o for o in orders if o["customer"] == customer and v.counts(r, o)]
                    if not mine and not zero_lines:
                        continue
                    discount = quantities[customer] >= lower
                    dr = dict(r, bulk=1 if discount else None)
                    values = [original_value(dr, o) for o in mine]
                    revenue = sum(v.rounded_cents(r, x) for x in values) if round_each else sum(values)
                    got[customer] = (len(mine), v.round_money(r, revenue))
                if got == expected[month_index]:
                    for threshold in range(lower, upper):
                        profiles[month_index].add((counted, rounding, zero_lines, round_each, unit_round, scope, threshold))
    drift = "july_rules" in item["meta"]
    if drift:
        # The discount policy (scope, threshold) is one rule coordinate. The
        # rounding-stage choices are stable conventions, as in EXTENSIONS.
        pairs = [(a, b) for a in profiles[0] for b in profiles[1]
                 if a[3:5] == b[3:5]
                 and sum((a[i] != b[i]) for i in (0, 1, 2)) + ((a[5], a[6]) != (b[5], b[6])) <= 1]
        survivors = len(pairs)
    else:
        survivors = len(profiles[0] & profiles[1])
    return {
        "scope": "10% customer-month discount; thresholds 1..280; quantity qualification over counted/all/non-cancelled/delivered orders; all counted/rounding/zero-line policies; round-each and whole-dollar discounted unit rounding; count/revenue necessary-condition prefilter only",
        "profileCountsByMonth": [len(p) for p in profiles],
        "compatibleCountRevenueProfilesOrPairs": survivors,
        "ruledOutByCountRevenue": survivors == 0,
        "limitation": "No unrestricted business-rule uniqueness claim; nonzero counts would require a full top/late/sort audit before packaging.",
    }


def build_one(name, source):
    item = json.loads(source.read_text())
    if len(item["data"]["examples"]) != 2:
        raise ValueError("Only July and August examples are supported")
    prefix, wants = public_examples(item)
    meta, data = item["meta"], item["data"]
    customers = data["customers"]
    august_rule = meta.get("august_rules", meta.get("true_rules"))
    july_rule = meta.get("july_rules", august_rule)
    for rule, orders, want in zip((july_rule, august_rule), data["examples"], wants):
        assert displayed(tuple_rule(rule), orders, customers) == want, "Metadata does not match the public example"
    survivors, pairs = compatible_rules(item, wants)
    assert survivors, "No rules reproduce both examples"
    expected = [tuple(row) for row in item["key"]["lines"]]
    assert v.report_lines(tuple_rule(august_rule), data["test"], customers) == expected
    assert all(v.report_lines(tuple_rule(s["rule"]), data["test"], customers, s["extension"]) == expected
               for s in survivors), "Original audited item is ambiguous in the enumerated space"
    drift = "july_rules" in meta
    evidence = data["examples"][1:] if drift else data["examples"]
    quantities = [o["qty"] for orders in evidence for o in orders if v.counts(august_rule, o)]
    bulk = august_rule["bulk"]
    gap = None if bulk is None else {
        "lo": max((q for q in quantities if q < bulk), default=0),
        "hi": min((q for q in quantities if q >= bulk), default=281),
    }
    customer_audit = customer_discount_prefilter(item, wants)
    if not customer_audit["ruledOutByCountRevenue"]:
        raise ValueError(f"{name}: customer-month discount alternatives require further investigation")
    return {
        "id": name,
        "promptPrefix": prefix,
        "customers": customers,
        "correctAugustRule": august_rule,
        "julyRule": july_rule if drift else None,
        "survivors": survivors,
        "generation": {
            "nOrders": 14,
            "startOrderId": 1200,
            "products": v.PRODUCTS,
            "allowedQuantities": QUANTITIES,
            "allowedStatuses": sorted({o["status"] for orders in evidence for o in orders}),
            "bulkSafeGap": gap,
            "driftChangedParameter": meta.get("changed"),
        },
        "audit": {
            "publicPrefixSha256": hashlib.sha256(prefix.encode()).hexdigest(),
            "literalExampleSummariesVerified": True,
            "compatibleRuleExtensionPairsBeforeDeduplication": pairs,
            "survivorCount": len(survivors),
            "originalTestUniqueWithinScope": True,
            "customerMonthDiscount": customer_audit,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="External directory with the four original private lab items")
    parser.add_argument("--output", type=Path, default=ROOT / "src/templates/reports.json")
    args = parser.parse_args()
    reports = []
    for name in NAMES:
        started = time.monotonic()
        report = build_one(name, args.source / f"{name}.json")
        reports.append(report)
        print(json.dumps({"id": name, "survivors": len(report["survivors"]),
                          "customerMonthDiscountRuledOut": report["audit"]["customerMonthDiscount"]["ruledOutByCountRevenue"],
                          "seconds": round(time.monotonic() - started, 2)}), flush=True)
    result = {
        "schemaVersion": 1,
        "audit": {
            "scope": "Full lab/vague.py HYP_SPACE with either no extension or each single EXTENSIONS entry; an extension remains fixed across both months. Drift requires exactly one HYP_SPACE parameter change. August rule/extension pairs are retained, not only canonical rules.",
            "vagueSourceSha256": hashlib.sha256((ROOT / "lab/vague.py").read_bytes()).hexdigest(),
            "hypothesisSpace": v.HYP_SPACE,
            "extensions": EXTENSIONS,
            "containsOriginalTestOrders": False,
            "containsOriginalTestAnswers": False,
            "containsSeeds": False,
            "runtimeRequirement": "Reject a fresh September test unless every retained survivor produces the canonical complete ordered summary; enforce status coverage and the strict-interior bulk gap guard, and make the August change matter for drift cases.",
            "limitation": "Finite plausible-reading coverage; combinations of arbitrary extensions, discount percentages other than 10%, and unrestricted business rules are not exhaustively covered.",
        },
        "reports": reports,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
