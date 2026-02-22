# Phase 1.2 Spec: Royalty Discrepancy Display

**Created:** 2026-02-23
**Status:** Ready for engineering
**Type:** Display enhancement — no new API endpoints, no schema changes
**File to modify:** `frontend/app/(app)/contracts/[id]/page.tsx`

---

## Context

The backend already persists `licensee_reported_royalty`, `discrepancy_amount`, and `has_discrepancy` on every sales period. The `SalesPeriod` TypeScript type already includes all three fields. The contract detail page's sales periods table does not display any of them.

This spec closes that gap.

---

## 1. Sales Periods Table Changes

### Current columns
Period | Net Sales | Calculated Royalty | MG Applied

### New columns
Period | Net Sales | Licensee Reported | Calculated Royalty | Discrepancy | MG Applied

**Column placement rationale:** Licensee Reported sits immediately left of Calculated Royalty so the user's eye naturally compares the two numbers side by side. Discrepancy follows as the result of that comparison. MG Applied stays last as it is supplementary context.

### Column definitions

**Licensee Reported**
- Display `licensee_reported_royalty` formatted as currency.
- When `null` (period was entered without a licensee figure), show an em dash (`—`) in muted gray. Do not show a zero or a badge — null means the data was never captured, not that the licensee reported $0.

**Calculated Royalty**
- No change to existing display.

**Discrepancy**
- Only shown when `licensee_reported_royalty` is not null.
- When null, show em dash in muted gray (consistent with Licensee Reported column).
- When `has_discrepancy` is false (values match within rounding), show a "Match" badge in green.
- When `has_discrepancy` is true, show the discrepancy amount and direction (see Section 2).

---

## 2. Discrepancy Indicators

### Under-reported (licensee reported less than calculated)
Condition: `discrepancy_amount > 0` — the licensee owes more than they reported.

Display:
- Amber badge labeled "Under by" with the discrepancy amount
- Example: `Under by $280.00`
- Color: amber (same `badge-warning` style used for MG Applied)

Rationale: Under-reporting is the financially consequential case for a licensor. Amber matches the existing warning pattern in the app and signals "action may be needed."

### Over-reported (licensee reported more than calculated)
Condition: `discrepancy_amount < 0` — the licensee reported paying more than owed.

Display:
- Blue badge labeled "Over by" with the absolute discrepancy amount
- Example: `Over by $120.00`
- Color: blue (`badge-info` or equivalent — a new badge style if not already present)

Rationale: Over-reporting is unusual and worth noting, but it is not a collection problem. Blue signals "informational" without implying urgency.

### Match
Condition: `has_discrepancy` is false.

Display:
- Green badge labeled "Match"
- Color: green (`badge-success` style already used for Active contract status)

### Discrepancy amount formatting
Always display as the **absolute value** in currency format. The badge label ("Under by" / "Over by") carries the direction. Do not display negative numbers in the Discrepancy column.

**No percentage.** Amount only. Percentages require the user to know the base to interpret — amount is unambiguous and directly actionable. A PM or accountant reading "$280 under" immediately knows what to chase; "$4.4% under" requires mental math.

---

## 3. Summary-Level Discrepancy Info

Add a third summary stat card in the existing right-column stat section, below "Sales Periods."

**Show only when** at least one period in the contract has `has_discrepancy: true`.

**Card content:**
- Label: "Total Discrepancy (YTD)"
- Value: sum of `discrepancy_amount` across all periods where `has_discrepancy` is true, formatted as currency
- Sub-label below the value: "X period(s) flagged" where X is the count of periods with `has_discrepancy: true`
- Color: amber text on the value to signal it requires attention

**When no discrepancies exist across any period:** Do not render the card at all. Showing "$0.00" with a green check adds visual noise and implies the licensor should be tracking something that does not need tracking.

**When some periods have null `licensee_reported_royalty`:** Exclude those periods from both the sum and the count. Only count periods where discrepancy data was captured and `has_discrepancy` is true.

**Computation (in component, no API call):**
```typescript
const periodsWithDiscrepancy = salesPeriods.filter(p => p.has_discrepancy === true)
const totalDiscrepancy = periodsWithDiscrepancy.reduce(
  (sum, p) => sum + (p.discrepancy_amount ?? 0), 0
)
```

---

## 4. Table Overflow Behavior

Adding two columns to a four-column table risks horizontal crowding on narrower viewports. The table already uses `overflow-x-auto` — that handles it. No responsive column hiding is needed for this phase.

---

## 5. Acceptance Criteria

- [ ] "Licensee Reported" column appears in the sales periods table
- [ ] Null `licensee_reported_royalty` renders as `—` (not `$0.00`, not blank)
- [ ] "Discrepancy" column appears in the sales periods table
- [ ] Null discrepancy (no licensee figure captured) renders as `—`
- [ ] Under-reported periods show amber "Under by $X.XX" badge
- [ ] Over-reported periods show blue "Over by $X.XX" badge
- [ ] Matching periods show green "Match" badge
- [ ] Discrepancy amount always displays as absolute value
- [ ] Total Discrepancy summary card appears only when at least one period has `has_discrepancy: true`
- [ ] Summary card value is the correct sum of discrepancy amounts across flagged periods
- [ ] Summary card sub-label shows the correct count of flagged periods
- [ ] Summary card does not appear when all periods match or have no licensee figure
- [ ] All existing table tests continue to pass; new display states have test coverage

---

## 6. Out of Scope

- Editing or correcting a saved `licensee_reported_royalty` value — that is a separate editing feature
- Filtering or sorting the table by discrepancy status
- Exporting discrepancy data
- Per-category discrepancy breakdown (the backend stores a single reported royalty per period, not per category)
- Email or notification when a discrepancy is detected
