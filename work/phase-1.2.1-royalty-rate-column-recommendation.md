# Recommendation: Handling the "Royalty Rate" Column from Licensee CSVs

## Context

Phase 1.2.1 already recommends routing "Royalty Rate" columns to `ignore` to avoid corrupting
the `licensee_reported_royalty` mapping. The user raises a valid follow-up: the rate the
licensee actually applied is diagnostic evidence. If a licensee applied 8% instead of the
contracted 10% on Apparel, the licensor should not need to re-open the original spreadsheet
to understand why the royalty is short. That rate is the root cause, and it should be visible.

This note addresses whether and how to capture it.

---

## The Core Tension

The "Royalty Rate" column in a licensee CSV creates a specific problem for the current data
model: the system aggregates each upload into a single `SalesPeriod` record with one
`net_sales` total and one `royalty_calculated` value. But with per-category rates, each row
in the CSV may have a *different* applied rate. There is no row-level storage in
`SalesPeriod` to hold per-row rates.

Trying to store the licensee's applied rate at the period level would require either:
1. Collapsing it to a single value (only works for flat-rate contracts — wrong for category rates)
2. Storing it as a dict keyed by category (mirrors `category_breakdown` — adds schema complexity)

Neither approach is trivial, and neither solves the real user need cleanly.

---

## Recommendation: Capture Rate Discrepancies at the Category Level, Deferred to Phase 1.3+

### What NOT to do now

Do not add a `licensee_reported_rate` field to `SalesPeriod`, `SalesPeriodCreate`, or the
frontend `SalesPeriod` type at this stage. The field would require:

- A new DB column or JSON column to store per-category rates
- A migration
- Changes to `apply_mapping` to extract rate values per category
- UI to display it alongside the existing discrepancy indicators

That is a feature, not a fix. The phase 1.2.1 bug being addressed is a mapping
ambiguity. Capturing the licensee's rate is a separate capability.

### What to do in phase 1.2.1 (the immediate fix)

Route "Royalty Rate" columns to `ignore` as specified. This is correct. The
`IGNORE_SYNONYMS` approach in the phase-1.2.1 spec handles this cleanly and prevents
the mapping corruption without losing anything — the column data remains in `all_rows`
inside the parser and is simply not aggregated.

### What to build in a later phase (1.3 or 1.4)

When the discrepancy workflow is fleshed out, add a `licensee_rate_notes` or
`rate_discrepancy` field at the period level. The right shape is:

```python
# On SalesPeriodCreate / SalesPeriod
licensee_applied_rates: Optional[Dict[str, Decimal]] = None
# e.g. {"Apparel": Decimal("0.08"), "Accessories": Decimal("0.12")}
```

This mirrors the existing `category_breakdown` pattern and does not require a new
relational table. It is nullable so flat-rate contracts and uploads without a rate
column are unaffected.

The mapping UI would add a new `LikhaField` value: `"licensee_applied_rate"`. When a
column is mapped to this field, `apply_mapping` collects the per-row rate values,
associates them with the row's category (if a category column is also mapped), and
returns them as a dict. For flat-rate contracts, all rows would have the same rate and
the dict would collapse to a single entry.

The discrepancy view can then show:

```
Apparel: licensee applied 8%, contract says 10% — accounts for $1,840 of the $2,300 shortfall
```

That is a high-value, user-testable feature. It belongs in a focused phase after the
core upload flow is validated.

---

## Decision Summary

| Question | Answer |
|---|---|
| Add `licensee_reported_rate` to SalesPeriod now? | No. Out of scope for 1.2.1. |
| Store the column data anywhere at all now? | No. Route to `ignore`; data stays in raw rows but is not persisted. |
| Is the user's insight valid? | Yes. Rate discrepancy is the root cause of many royalty shortfalls. |
| When to build it? | Phase 1.3+ as `licensee_applied_rates: Dict[str, Decimal]`, keyed by category. |
| What enables it technically? | Category column already in the model; `apply_mapping` already iterates per row. The infrastructure is mostly there. |

The phase 1.2.1 fix (ignore the rate column) is still correct. It prevents corruption
today and does not foreclose the richer feature. The rate-capture capability should be
scoped as its own deliverable once the base upload flow is user-validated.
