# Minimum Guarantee Clarification

**Created:** 2026-02-22
**Status:** Approved — corrects a live implementation bug
**Relates to:** `backend/app/services/royalty_calc.py`, Phase 1.1 spec

---

## The Short Answer

The minimum guarantee must never adjust a single period's royalty. It is an annual threshold tracked in aggregate. The current code violates this. Here is the correct model:

- **Per-period royalty:** Rate times royalty base, full stop.
- **Minimum guarantee:** A running annual comparison between the YTD royalty total and the annual minimum. Tracked separately, used for forecasting and year-end shortfall alerts only.

---

## The Specific Scenario

**Contract:** Sunrise Apparel, 8% royalty on net sales, $20,000 annual minimum guarantee.

**Q1 upload:**
- Gross sales: $87,500
- Returns: $4,200
- Net sales: $87,500 - $4,200 = $83,300
- Calculated royalty: 8% x $83,300 = **$6,664**

That $6,664 is the correct, complete royalty due for Q1. Nothing else is added to it, subtracted from it, or blended into it because of the minimum guarantee. The minimum guarantee is not part of the per-period royalty calculation at all.

---

## What the Contract Actually Says

Section 5 of the Sunrise Apparel contract (`contract-1-sunrise-apparel.md`, Section 5.3):

> Royalty Due = Net Sales x 8%

Section 6 is a separate clause:

> If, at the end of any **contract year**, the total royalties actually paid for that year are less than the Annual Minimum Guarantee, Licensee shall pay the **shortfall amount** within thirty (30) days following the end of that contract year.

Two entirely separate obligations. The royalty due for a period is a fraction of sales. The minimum guarantee is a year-end true-up. The contract does not say "each quarter, pay the greater of 8% of net sales or $5,000." It says "pay 8% of net sales each quarter, and if the year's total falls below $20,000, pay the difference in January."

---

## Why This Matters in Practice

Under the current code, if a licensee has a slow quarter and the 8% royalty calculation comes in below the pro-rated quarterly floor ($5,000 = $20,000 / 4), the system inflates the reported royalty to the floor. This is wrong for three reasons:

1. **It misrepresents the payment due.** The licensee owes 8% of what they sold, not a prorated share of the annual minimum. The minimum guarantee is settled once, at year-end.

2. **It obscures the real trend.** If a licensor sees $5,000 per quarter and believes that is correct, they have no reason to be concerned. The actual picture might be that the licensee is running below pace (e.g., $3,500 actual royalty per quarter x 4 = $14,000 projected, which is $6,000 short of the $20,000 annual minimum). That shortfall risk is invisible because the code is hiding the actual calculated royalties behind the inflated floor.

3. **It interferes with discrepancy detection.** The Phase 1 feature (`discrepancy_amount`) compares the system-calculated royalty against what the licensee reported. If the system-calculated royalty has already been inflated by a minimum guarantee floor, the discrepancy comparison is against the wrong number. The licensor will see a false discrepancy even when the licensee's math is correct.

---

## The User's Insight: Minimum Guarantee as a Forecast

The user's framing is correct: "if licensee is able to maintain this for another 3 quarters then the minimum guarantee forecast should be on a positive trend."

This tells us exactly how the minimum guarantee should function in the UI. It is a tracking and forecasting feature, not a calculation modifier:

- After each uploaded period, update the YTD royalty total.
- Compare that total against the pro-rated annual minimum for how far into the year we are.
- Project the year-end total based on current pace.
- Surface whether the licensee is on track, behind, or comfortably ahead.

The licensor is not thinking about minimum guarantee as "how much do I charge this quarter." They are thinking about "is this licensee going to hit the annual floor, or am I heading toward a shortfall conversation in January?" That is a forecasting question, not a per-period calculation.

---

## What the Current Code Does Wrong

In `backend/app/services/royalty_calc.py`, the function `apply_minimum_guarantee()` (lines 178-213) divides the annual minimum by the number of periods and enforces that amount as a floor on the per-period royalty:

```python
period_floor = minimum_guarantee / Decimal(periods_in_year)

if calculated_royalty < period_floor:
    return RoyaltyWithMinimum(royalty=period_floor, minimum_applied=True)
```

For the Sunrise Apparel scenario with quarterly reporting:
- `period_floor = $20,000 / 4 = $5,000`
- If calculated royalty = $3,500 (a slow quarter), the code returns $5,000 instead of $3,500

This is doubly compounded by `calculate_royalty_with_minimum()` (lines 216-247), which is called by the upload confirm endpoint (per `phase-1.1-spec.md`, Section 4, step 9):

> Call `calculate_royalty_with_minimum()` — same engine as manual entry

This means the per-period inflation is baked into every sales period record stored in the database. The `minimum_applied: true` flag exists on `SalesPeriodResponse` and is returned to the frontend, but the damage is already done: the stored `royalty_calculated` value is wrong.

The `calculate_ytd_summary()` function (lines 289-340) then compounds the problem by summing these inflated per-period royalties into the YTD total. The shortfall it computes is meaningless because it is comparing the minimum guarantee against royalties that have already been padded up.

---

## What the Correct Behavior Should Be

### Per-period royalty (the only calculation at upload/entry time)

```
royalty_due = net_sales * rate
```

That is it. `calculate_royalty()` (lines 124-155) is already correct. The problem is that `apply_minimum_guarantee()` is being called on top of it.

`calculate_royalty_with_minimum()` and `apply_minimum_guarantee()` should not be called during individual period creation. They should only be used (with appropriate renaming and refactoring) in the YTD summary context, and even there the behavior must change (see below).

### Minimum guarantee tracking (a YTD summary concern, not a per-period concern)

The `calculate_ytd_summary()` function is conceptually the right place for minimum guarantee logic. But it needs to compute correctly:

- `total_royalties_ytd` must be the honest sum of all `royalty_calculated` values — the actual earnings, not padded values
- `ytd_progress_pct` — what percentage of the annual minimum has been earned YTD
- `projected_annual` — extrapolation: `(total_royalties_ytd / periods_completed) * total_periods_in_year`
- `on_track` — boolean: is `projected_annual >= minimum_guarantee`
- `shortfall_risk` — dollar amount of the projected gap: `max(minimum_guarantee - projected_annual, 0)`

The shortfall should only become a concrete payment obligation at year-end. Before that, it is a forecast, a warning, a conversation to have — not a line item on a quarterly invoice.

### Year-end shortfall (the actual minimum guarantee payment obligation)

At year-end (after the final period of the contract year is recorded), if `total_royalties_ytd < minimum_guarantee`, the shortfall becomes a real obligation:

```
shortfall_due = minimum_guarantee - total_royalties_ytd
```

This shortfall payment is separate from any individual period's royalty. It is a distinct line item that the licensor collects from the licensee in January. Likha should eventually support recording this shortfall payment as a separate event, but that is a future enhancement.

---

## What Needs to Change

### 1. Remove minimum guarantee enforcement from per-period creation

The upload confirm endpoint and the manual sales entry endpoint must stop calling `calculate_royalty_with_minimum()`. They should call `calculate_royalty()` only.

The `minimum_applied` field on `SalesPeriodResponse` becomes meaningless under the correct model. It should be removed from the response or deprecated (never set to `true`).

### 2. Fix `calculate_ytd_summary()` to produce forecasting metrics

Replace the current shortfall logic (which compares full annual MG against the YTD total mid-year) with:

- Pro-rated progress: how many periods have been completed vs. total periods in the year
- Projected annual royalty at current pace
- Whether the projected annual meets the minimum guarantee
- Shortfall risk: the dollar gap between projected annual and minimum guarantee (only meaningful if negative)

Year-end shortfall (a hard obligation) should be clearly distinguished from mid-year shortfall risk (a forecast).

### 3. `apply_minimum_guarantee()` function scope

The function is not useless — it correctly describes what the minimum guarantee clause says at year-end. But it should only be invoked when all periods for the contract year have been submitted, and it should compare the full annual minimum against the actual (un-inflated) year total. Rename it or add a guard condition to make the intended call site clear.

### 4. Frontend display

The contract detail page should show a minimum guarantee tracking section separate from the per-period royalty card. Something like:

- YTD royalties earned: $X
- Annual minimum: $Y
- Progress: Z% of annual minimum (simple bar)
- At this pace, projected annual: $P
- Status: On track / Below pace (shortfall risk: $S)

This matches the user's mental model. They want to glance at the contract and know whether the licensee is trending toward the floor, not have the system silently inflate the royalty invoice.

---

## Summary of the Bug

| | Current behavior | Correct behavior |
|---|---|---|
| Q1 royalty ($83,300 net, 8%) | Max($6,664, $5,000) = $6,664 (no inflation this quarter, but logic is wrong) | $6,664 |
| Q1 royalty if net sales were $40,000 | Max($3,200, $5,000) = **$5,000** (wrong — inflated) | **$3,200** |
| YTD total after slow Q1 | Reported as $5,000 (hidden the true $3,200) | $3,200 |
| Minimum guarantee warning | Invisible — system padded up the royalty and sees no problem | Visible — $3,200 vs. $5,000 pro-rated pace, 36% below expected pace |
| Discrepancy detection accuracy | Broken — compares licensee's math against an inflated system figure | Correct — compares licensee's math against the honest 8% calculation |

The fix is not to improve the minimum guarantee enforcement — it is to remove it from per-period calculation entirely and surface it as a tracking and forecasting feature in the YTD summary.
