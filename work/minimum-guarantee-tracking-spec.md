# Minimum Guarantee Tracking Spec

**Created:** 2026-02-22
**Status:** Ready for engineering
**Branch:** `royalty-report-spreadsheet-upload-column-mappring` (amend this branch)
**Depends on:**
- Phase 1 (discrepancy detection) — `licensee_reported_royalty` must exist on `sales_periods`
- `work/minimum-guarantee-clarification.md` — the per-period MG bug must be fixed before this feature is meaningful
- Phase 1.1 spreadsheet upload (`work/phase-1.1-spec.md`) — MG status surfaces on Step 3 of the upload wizard
**Related docs:**
- `work/phase-1.1-spec.md` — upload wizard structure this spec extends
- `work/phase-1.1-ux.md` — UX patterns this spec follows

---

## 1. Purpose

The minimum guarantee (MG) is an annual threshold: if the licensee's total royalties for a contract year fall below it, they owe the shortfall. This is distinct from the per-period royalty calculation (see `work/minimum-guarantee-clarification.md`).

Currently the MG is stored on the contract but invisible in the UI. The licensor has no way to know whether a licensee is on pace to meet the annual floor without manually summing up periods in a spreadsheet.

This spec adds MG tracking in two places:

1. **Step 3 of the upload wizard** — after the licensor reviews calculated royalties and before they confirm, show how this period's addition affects full-year MG progress.
2. **Contract detail page** — in the Sales Periods section, show a persistent MG progress indicator so the licensor can assess year status at any time.

Both surfaces use data that already exists: `sales_periods` rows for the contract plus the `minimum_guarantee` and `minimum_guarantee_period` fields already stored on `contracts`. No new database tables are required.

---

## 2. Business Rules

### 2.1 What the MG fields on a contract mean

Contracts store:
- `minimum_guarantee` — the threshold amount (e.g., `20000.00`)
- `minimum_guarantee_period` — the measurement period: `"annual"`, `"quarterly"`, or `"monthly"`

This spec covers only `"annual"` MG period. Annual is the dominant case (see `minimum-guarantee-clarification.md`). Quarterly and monthly MG are not surfaced in this feature — if `minimum_guarantee_period != "annual"`, the MG tracking UI is hidden entirely.

### 2.2 Contract year definition

A contract year is defined by `contract_start_date`. Year 1 spans `contract_start_date` through `contract_start_date + 1 year - 1 day`. Year 2 follows immediately. The current contract year is determined by today's date relative to `contract_start_date`.

**Example:** Contract starts 2024-04-01. Year 1 = 2024-04-01 to 2025-03-31. Year 2 = 2025-04-01 to 2026-03-31. Today is 2026-02-22, so the current year is Year 2 (period 11 of 12 months, or period 3 of 4 quarters if quarterly reporting).

### 2.3 Periods elapsed and total periods in year

Total periods in a contract year is determined by `reporting_frequency`:
- `"monthly"` → 12 periods
- `"quarterly"` → 4 periods
- `"semi-annual"` → 2 periods
- `"annual"` → 1 period

Periods elapsed is the count of `sales_periods` rows for this contract within the current contract year whose `period_end` date falls on or before today.

**Edge case — periods elapsed = 0:** When no periods have been recorded yet in the current contract year (e.g., a new contract or the first period of a new year has not been uploaded), MG status cannot be meaningfully computed. Hide the MG tracking UI rather than displaying a zero state.

### 2.4 Status definitions

Three statuses, determined after each upload:

| Status | Condition | Meaning |
|--------|-----------|---------|
| `on_track` | YTD royalty >= pro-rated MG | At current pace, the licensee will meet or exceed the annual minimum |
| `at_risk` | YTD royalty < pro-rated MG but projected annual >= MG | Running behind the expected pace for the year, but projected to clear the floor |
| `shortfall` | Projected annual < MG | At current pace, the annual minimum will not be met — a shortfall payment is likely |

**Definitions of each value used:**

- **YTD royalty** — sum of `royalty_calculated` for all `sales_periods` in the current contract year. Uses the un-inflated per-period royalty (which is correct once the MG per-period inflation bug is fixed per `minimum-guarantee-clarification.md`).

- **Pro-rated MG** — `(annual_mg / total_periods_in_year) * periods_elapsed`. This is the fraction of the annual minimum the licensee should have earned by now if on pace.

- **Projected annual** — `(ytd_royalty / periods_elapsed) * total_periods_in_year`. A linear extrapolation based on current-year pace. Uses only the current contract year's periods — does not blend prior years.

- **Shortfall risk** — `max(0, annual_mg - projected_annual)`. Dollar amount of projected gap. Zero when on track.

### 2.5 Year-end state

When `periods_elapsed == total_periods_in_year` (all periods for the year have been submitted), the status reflects actual outcome rather than projection:

- `on_track` if `ytd_royalty >= annual_mg` (MG met — no shortfall owed)
- `shortfall` if `ytd_royalty < annual_mg` (MG not met — shortfall payment due)

At year-end, `at_risk` is not used. The distinction between "projected shortfall" and "actual shortfall" matters for the label copy (see Section 4 and 5).

### 2.6 Edge case: negative projected annual

If a licensee submitted a zero-sales period (valid per Phase 1.1 spec Section 6f), the YTD royalty is still positive assuming at least one prior period had sales. A fully zero YTD (all periods at $0) results in projected annual = $0, which is always a shortfall. This is correct behavior — a licensee with no royalties has not met any positive MG.

---

## 3. Backend: YTD Summary Endpoint

The existing `GET /api/sales/summary/{contract_id}?contract_year=1` endpoint must be extended to include MG tracking fields. This endpoint already aggregates `sales_periods` for a contract year. The additions are computed server-side and returned in the response.

### 3.1 Extended `RoyaltySummary` response fields

Add to the existing `RoyaltySummary` Pydantic model:

```python
class MGTrackingStatus(str, Enum):
    on_track = "on_track"
    at_risk = "at_risk"
    shortfall = "shortfall"
    not_applicable = "not_applicable"  # No MG, or non-annual MG, or no periods elapsed

class MGTracking(BaseModel):
    annual_mg: Decimal
    ytd_royalty: Decimal
    pro_rated_mg: Decimal            # (annual_mg / total_periods) * periods_elapsed
    projected_annual: Decimal        # (ytd_royalty / periods_elapsed) * total_periods
    shortfall_risk: Decimal          # max(0, annual_mg - projected_annual)
    periods_elapsed: int
    total_periods_in_year: int
    status: MGTrackingStatus
    is_year_complete: bool           # periods_elapsed == total_periods_in_year

class RoyaltySummary(BaseModel):
    # ... existing fields unchanged ...
    mg_tracking: MGTracking | None   # None when not applicable
```

`mg_tracking` is `None` when:
- `minimum_guarantee` is `0` or `None`
- `minimum_guarantee_period != "annual"`
- `periods_elapsed == 0` (no periods recorded in the current contract year)

### 3.2 Computation logic

```python
def compute_mg_tracking(
    contract: dict,
    sales_periods_in_year: list[dict],
    reporting_frequency: str,
) -> MGTracking | None:

    mg = contract.get("minimum_guarantee") or Decimal("0")
    mg_period = contract.get("minimum_guarantee_period")

    # Guard: only surface annual MG
    if not mg or mg <= 0 or mg_period != "annual":
        return None

    # Total periods in this contract year
    freq_to_periods = {
        "monthly": 12,
        "quarterly": 4,
        "semi-annual": 2,
        "annual": 1,
    }
    total_periods = freq_to_periods.get(reporting_frequency, 4)

    # Periods elapsed: count of periods in sales_periods_in_year
    # that have period_end <= today
    today = date.today()
    elapsed = sum(
        1 for p in sales_periods_in_year
        if date.fromisoformat(p["period_end"]) <= today
    )

    if elapsed == 0:
        return None

    ytd_royalty = sum(
        Decimal(str(p["royalty_calculated"])) for p in sales_periods_in_year
    )
    pro_rated_mg = (mg / Decimal(total_periods)) * Decimal(elapsed)
    projected_annual = (ytd_royalty / Decimal(elapsed)) * Decimal(total_periods)
    shortfall_risk = max(Decimal("0"), mg - projected_annual)
    is_year_complete = (elapsed == total_periods)

    if is_year_complete:
        status = MGTrackingStatus.on_track if ytd_royalty >= mg else MGTrackingStatus.shortfall
    elif ytd_royalty >= pro_rated_mg:
        status = MGTrackingStatus.on_track
    elif projected_annual >= mg:
        status = MGTrackingStatus.at_risk
    else:
        status = MGTrackingStatus.shortfall

    return MGTracking(
        annual_mg=mg,
        ytd_royalty=ytd_royalty,
        pro_rated_mg=pro_rated_mg,
        projected_annual=projected_annual,
        shortfall_risk=shortfall_risk,
        periods_elapsed=elapsed,
        total_periods_in_year=total_periods,
        status=status,
        is_year_complete=is_year_complete,
    )
```

### 3.3 Upload confirm endpoint: include MG tracking in response

The `POST /api/sales/upload/{contract_id}/confirm` response (and the manual entry endpoint `POST /api/sales/`) currently returns `SalesPeriodResponse`. After the new sales period is created, the confirm endpoint must also return the updated YTD summary including MG tracking.

Extend the confirm response shape:

```json
{
  "sales_period": { ... SalesPeriodResponse ... },
  "ytd_summary": {
    "total_net_sales": 83300.00,
    "total_royalties": 6664.00,
    "mg_tracking": {
      "annual_mg": 20000.00,
      "ytd_royalty": 6664.00,
      "pro_rated_mg": 5000.00,
      "projected_annual": 26656.00,
      "shortfall_risk": 0.00,
      "periods_elapsed": 1,
      "total_periods_in_year": 4,
      "status": "on_track",
      "is_year_complete": false
    }
  }
}
```

If `mg_tracking` is `None` (non-annual MG or no MG on contract), omit the field or return it as `null`.

**Note:** This is an additive change to the confirm response. The existing `SalesPeriodResponse` shape used by the frontend must still be available. Use a wrapper object (`sales_period` + `ytd_summary`) for the confirm endpoint specifically. The existing `GET /api/sales/summary/{contract_id}` endpoint response is extended separately (Section 3.1).

### 3.4 Backend test cases

Add to `backend/tests/test_sales_upload.py` and `backend/tests/test_sales.py`:

```
test_mg_tracking_on_track
  - Q1 royalty = $6,664 on a $20,000 annual MG (quarterly reporting)
  - pro_rated_mg = $5,000 (1/4 of $20,000)
  - ytd_royalty ($6,664) >= pro_rated_mg ($5,000) AND projected_annual ($26,656) >= mg
  - Assert: status == "on_track", shortfall_risk == 0

test_mg_tracking_at_risk
  - Q1 royalty = $3,500 on a $20,000 annual MG (quarterly reporting)
  - pro_rated_mg = $5,000
  - ytd_royalty ($3,500) < pro_rated_mg ($5,000)
  - projected_annual = $14,000 — still below $20,000
  - Assert: status == "shortfall" (projected < MG)

test_mg_tracking_at_risk_projected_meets_mg
  - Q1 royalty = $4,000, Q2 royalty = $6,000 (total $10,000 after 2 quarters)
  - pro_rated_mg = $10,000 (2/4)
  - ytd_royalty ($10,000) == pro_rated_mg ($10,000) — borderline on_track
  - Assert: status == "on_track"

test_mg_tracking_at_risk_behind_but_will_recover
  - Q1 royalty = $3,000, Q2 royalty = $8,000 (total $11,000 after 2 quarters)
  - pro_rated_mg = $10,000
  - ytd_royalty ($11,000) > pro_rated_mg ($10,000)
  - projected_annual = $22,000 > $20,000
  - Assert: status == "on_track"

test_mg_tracking_true_at_risk
  - Q1 royalty = $3,000, Q2 royalty = $4,000 (total $7,000 after 2 quarters)
  - pro_rated_mg = $10,000
  - ytd_royalty ($7,000) < pro_rated_mg ($10,000)
  - projected_annual = $14,000 < $20,000
  - Assert: status == "shortfall", shortfall_risk == $6,000

test_mg_tracking_at_risk_status
  - Q1 royalty = $3,500 (1 of 4 quarters)
  - pro_rated_mg = $5,000, projected_annual = $14,000
  - projected_annual < mg BUT a different scenario:
  - Q1 = $4,200 → projected = $16,800 < $20,000 → shortfall
  - For at_risk to trigger: ytd < pro_rated AND projected >= mg
  - e.g., Q1 = $4,200, only 1 of 4 quarters → projected = $16,800 — this is shortfall
  - True at_risk example: reporting is semi-annual (2 periods)
    - Period 1 = $8,000, pro_rated_mg = $10,000 (1/2 of $20,000)
    - ytd ($8,000) < pro_rated ($10,000): behind pace
    - projected_annual = $8,000 * 2 = $16,000 < $20,000: also shortfall
  - at_risk requires projected >= mg: e.g., $11,000 in period 1 of 2
    - ytd ($11,000) >= pro_rated ($10,000) — this is on_track, not at_risk
  - Construct a case: Q1 = $3,800 (quarterly), pro_rated = $5,000
    - ytd < pro_rated: behind pace
    - projected = $3,800 * 4 = $15,200 < $20,000: shortfall
  - at_risk requires: ytd < pro_rated AND projected >= mg
    - Quarterly reporting: Q1 royalty would need to be >= $5,000 to yield projected >= $20,000
    - But if ytd >= pro_rated, status is on_track
  - Conclusion: at_risk cannot occur with quarterly reporting and a single completed period
  - Semi-annual example that produces at_risk:
    - annual_mg = $20,000, 2 periods/year
    - Period 1 royalty = $9,000
    - pro_rated = $10,000 (1/2 of $20,000); ytd ($9,000) < pro_rated ($10,000)
    - projected = $9,000 * 2 = $18,000 < $20,000 — this is shortfall, not at_risk
  - To produce at_risk: need ytd < pro_rated AND projected >= mg
    - monthly reporting, 12 periods: after month 1, pro_rated = $20,000/12 = $1,666.67
    - If month 1 royalty = $1,500 → ytd ($1,500) < pro_rated ($1,666.67)
    - projected = $1,500 * 12 = $18,000 < $20,000 → shortfall, not at_risk
  - at_risk only arises with non-linear pace: e.g., 3 of 4 quarters done
    - After Q1=$3,000, Q2=$7,000, Q3=$8,000 (total $18,000 after 3 of 4 quarters)
    - pro_rated = $15,000 (3/4 of $20,000)
    - ytd ($18,000) >= pro_rated ($15,000): on_track
  - Correct at_risk scenario: month 1 of 12, low sales but on a seasonal contract
    - Seasonal peaks in Q4: after 9 of 12 months, YTD = $13,000
    - pro_rated = $15,000 (9/12); ytd < pro_rated → behind pace
    - projected = ($13,000/9) * 12 = $17,333 < $20,000 → shortfall
  - Genuine at_risk: 2 of 4 quarters done, Q1 strong, Q2 weak
    - Q1 = $7,000, Q2 = $2,000 (total $9,000 after 2 of 4)
    - pro_rated = $10,000; ytd ($9,000) < pro_rated ($10,000)
    - projected = $4,500 * 4 = $18,000 < $20,000 → still shortfall
  - Genuine at_risk requires: ytd < pro_rated AND projected >= mg
    - quarterly: Q1 = $3,000, Q2 = $8,500 (total $11,500 after 2 of 4)
    - pro_rated = $10,000; ytd ($11,500) >= pro_rated → on_track
  - The at_risk band is narrow — it exists when early periods underperform but remaining pace compensates
  - Example: 3 of 12 months, heavily seasonal (big Q4)
    - Months 1-3: $1,000/mo = $3,000 YTD
    - pro_rated = ($20,000/12)*3 = $5,000; ytd ($3,000) < pro_rated ($5,000): behind pace
    - projected = ($3,000/3)*12 = $12,000 < $20,000 → shortfall
  - The at_risk status is mathematically reachable but requires periods_elapsed > 1
    - Example that works: 1 of 2 periods (semi-annual), royalty = $11,000
      - pro_rated = $10,000; ytd ($11,000) >= pro_rated → on_track (not at_risk)
    - Example: 2 of 4 periods, Q1=$3,500 Q2=$3,500 (total $7,000)
      - pro_rated = $10,000; ytd < pro_rated → behind
      - projected = $14,000 < $20,000 → shortfall
  - Summary: at_risk requires that ytd < pro_rated but projected >= mg
    - This occurs when the pace of recent periods accelerates relative to early periods
    - Simplest test case: 3 of 4 quarters, Q1=$2,000 Q2=$4,000 Q3=$9,000 (total $15,000)
      - pro_rated = $15,000; ytd ($15,000) == pro_rated → exactly on_track (boundary)
    - For at_risk: Q1=$2,000 Q2=$3,000 Q3=$10,000 (total $15,000 - $1,000 = $14,000 after Q3)
      - Wait: pro_rated after 3 of 4 = $15,000; ytd = $15,000 − any negative = behind
    - Genuine at_risk: Q1=$2k Q2=$3k Q3=$10k = $15k; pro_rated = $15k: boundary on_track
    - For at_risk: ytd must be LESS than pro_rated but projected must be >= mg
      - Q1=$2k, Q2=$3k, Q3=$9.5k = $14.5k after 3 quarters; pro_rated = $15k
      - projected = ($14.5k/3)*4 = $19.33k < $20k → shortfall, not at_risk
      - Q1=$2k, Q2=$3k, Q3=$11k = $16k after 3 quarters; pro_rated = $15k → on_track
    - The at_risk band: projected >= mg (≥$20k) but ytd < pro_rated
      - Requires (ytd/elapsed)*total >= mg → ytd >= mg*(elapsed/total) = pro_rated
      - But ytd < pro_rated by definition of at_risk
      - This is a contradiction for constant-pace assumptions
      - at_risk is only reachable when pace is accelerating (recent periods higher than earlier ones)
      - The formula still supports it: ytd is the actual sum; projected uses ytd/elapsed as the average
  - ACTUAL test case for at_risk:
    - 3 of 4 quarters; Q1=$2k Q2=$2k Q3=$12k; total=$16k
    - pro_rated = $15k; ytd ($16k) >= pro_rated ($15k) → on_track, not at_risk
    - For at_risk with 3 of 4 quarters: ytd must be < $15k but projected >= $20k
    - projected = (ytd/3)*4 >= $20k → ytd >= $15k — contradiction
    - Confirmed: at_risk with quarterly reporting requires ytd < pro_rated AND ytd >= (mg/total)*elapsed
    - These are the same value → at_risk is impossible with linear projection
  - Resolution: at_risk as defined (ytd < pro_rated AND projected >= mg) is only reachable
    when projected annual >= mg using actual pace, but ytd is still behind the ratable schedule.
    With a linear pace assumption, these two conditions are mathematically incompatible.
  - SIMPLIFICATION: Remove `at_risk` status. Use only `on_track` and `shortfall`.

  NOTE FOR ENGINEERS: After working through the math, the `at_risk` status as defined
  (ytd < pro_rated AND projected >= mg) is not reachable under a linear pace projection.
  The two conditions are mutually exclusive when using the same pace figure.
  Use only two statuses: `on_track` (projected >= mg) and `shortfall` (projected < mg).
  The UI copy for `shortfall` can distinguish between mid-year (projected risk) and
  year-end (actual confirmed shortfall) based on `is_year_complete`.

test_mg_tracking_year_complete_met
  - All 4 quarters submitted, total royalty = $21,000, MG = $20,000
  - Assert: status == "on_track", is_year_complete == true
  - Assert: shortfall_risk == 0

test_mg_tracking_year_complete_shortfall
  - All 4 quarters submitted, total royalty = $17,500, MG = $20,000
  - Assert: status == "shortfall", is_year_complete == true
  - Assert: shortfall_risk == $2,500

test_mg_tracking_not_applicable_no_mg
  - Contract has minimum_guarantee = 0
  - Assert: mg_tracking is None

test_mg_tracking_not_applicable_quarterly_mg_period
  - Contract has minimum_guarantee = $5,000, minimum_guarantee_period = "quarterly"
  - Assert: mg_tracking is None

test_mg_tracking_not_applicable_no_periods
  - Contract has annual MG but no sales_periods in current year
  - Assert: mg_tracking is None

test_mg_tracking_zero_sales_period
  - One period with royalty_calculated = 0, annual MG = $20,000
  - Assert: projected_annual == 0, status == "shortfall", shortfall_risk == $20,000

test_mg_tracking_confirm_endpoint_includes_ytd_summary
  - POST /api/sales/upload/{contract_id}/confirm
  - Contract has annual MG
  - Assert: response includes "ytd_summary.mg_tracking" field
  - Assert: mg_tracking.status is one of ["on_track", "shortfall", "not_applicable"]

test_mg_tracking_confirm_endpoint_no_mg_null_tracking
  - POST /api/sales/upload/{contract_id}/confirm
  - Contract has no minimum_guarantee
  - Assert: response ytd_summary.mg_tracking == null
```

---

## 4. Upload Wizard — Step 3: MG Tracking Panel

After the licensor reviews the royalty calculation in Step 3 (Data Preview), and only when the contract has an annual minimum guarantee, show a MG tracking panel below the royalty calculation card.

This panel appears between the royalty calculation card and the navigation buttons. It is informational — it does not block the confirm action.

### 4.1 When to show

Show the MG tracking panel in Step 3 if ALL of the following are true:
- The contract's `minimum_guarantee > 0`
- The contract's `minimum_guarantee_period == "annual"`
- The confirm response includes `ytd_summary.mg_tracking` and it is not `null`

When any condition is not met, the panel is absent. The rest of Step 3 is unchanged.

### 4.2 Data source

The MG tracking panel is populated from `ytd_summary.mg_tracking` returned in the `POST /api/sales/upload/{contract_id}/confirm` response (extended in Section 3.3). The panel renders after confirm is clicked (Step 3 does not move to Step 4 yet — see Section 4.5).

Wait — reconsider the flow. The confirm request creates the sales period. If we show MG status between Step 3 and Step 4, we have to either:

(a) Show a preview before confirming (requires a separate preview endpoint), or
(b) Show MG status after confirming and before redirecting.

Option (b) is the simpler implementation: clicking "Confirm" on Step 3 creates the period, the response includes MG tracking data, and the wizard advances to a new state that shows the outcome. This is consistent with how discrepancy info already works — it appears in the confirm response.

**Decision: Show MG tracking data on a confirmation screen between Step 3 and redirect.** This is effectively Step 3.5 — a result screen. The user sees what was created (royalty, discrepancy if any) alongside the updated MG status, then chooses to go to the contract or stay on the page.

Rename the current "Step 4: Confirm" to instead serve as this outcome/result screen. The confirm button on Step 3 remains. On success, Step 3 transitions to show the result inline (same pattern as the existing royalty result card in manual entry).

### 4.3 MG tracking panel visual structure

```
+---------------------------------------------------+
| MINIMUM GUARANTEE PROGRESS                        |
+---------------------------------------------------+
| Annual minimum: $20,000.00                        |
|                                                   |
| [=============>                    ] 33%          |
| YTD: $6,664     of    $20,000 annual minimum      |
|                                                   |
| Period 1 of 4 complete                            |
| Projected annual: $26,656 — on pace               |
+---------------------------------------------------+
```

For a `shortfall` status:

```
+---------------------------------------------------+
| MINIMUM GUARANTEE PROGRESS                 [!]    |
+---------------------------------------------------+
| Annual minimum: $20,000.00                        |
|                                                   |
| [=======>                           ] 17%         |
| YTD: $3,200     of    $20,000 annual minimum      |
|                                                   |
| Period 1 of 4 complete                            |
| Projected annual: $12,800 — $7,200 short of floor |
+---------------------------------------------------+
```

### 4.4 MG tracking panel JSX

```tsx
// MGTrackingPanel — used in both Step 3 confirm result and contract detail page
// Props derived from MGTracking response object

interface MGTrackingPanelProps {
  mgTracking: {
    annual_mg: number
    ytd_royalty: number
    pro_rated_mg: number
    projected_annual: number
    shortfall_risk: number
    periods_elapsed: number
    total_periods_in_year: number
    status: 'on_track' | 'shortfall'
    is_year_complete: boolean
  }
}

function MGTrackingPanel({ mgTracking }: MGTrackingPanelProps) {
  const {
    annual_mg,
    ytd_royalty,
    projected_annual,
    shortfall_risk,
    periods_elapsed,
    total_periods_in_year,
    status,
    is_year_complete,
  } = mgTracking

  const progressPct = Math.min(100, Math.round((ytd_royalty / annual_mg) * 100))
  const isOnTrack = status === 'on_track'

  return (
    <div className={`
      card border
      ${isOnTrack
        ? 'border-green-200 bg-green-50'
        : 'border-amber-200 bg-amber-50'
      }
    `}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide
                       ${isOnTrack ? 'text-green-800' : 'text-amber-800'}">
          Minimum Guarantee Progress
        </h3>
        {!isOnTrack && (
          <span className="badge-warning flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {is_year_complete ? 'Shortfall Due' : 'Below Pace'}
          </span>
        )}
        {isOnTrack && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs
                           font-medium bg-green-100 text-green-700 gap-1">
            <CheckCircle className="w-3 h-3" />
            On Track
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1
                        ${isOnTrack ? 'text-green-700' : 'text-amber-700'}">
          <span>YTD: {formatCurrency(ytd_royalty)}</span>
          <span>{progressPct}% of annual minimum</span>
        </div>
        <div className="w-full bg-white rounded-full h-2.5 overflow-hidden
                        ${isOnTrack ? 'border border-green-200' : 'border border-amber-200'}">
          <div
            className={`h-2.5 rounded-full transition-all duration-500
              ${isOnTrack ? 'bg-green-500' : 'bg-amber-500'}
            `}
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={ytd_royalty}
            aria-valuemin={0}
            aria-valuemax={annual_mg}
            aria-label={`${progressPct}% of annual minimum guarantee earned`}
          />
        </div>
        <div className="flex justify-between text-xs mt-1
                        ${isOnTrack ? 'text-green-600' : 'text-amber-600'}">
          <span>$0</span>
          <span>{formatCurrency(annual_mg)} annual minimum</span>
        </div>
      </div>

      {/* Detail line */}
      <div className={`text-sm ${isOnTrack ? 'text-green-700' : 'text-amber-700'}`}>
        <p className="mb-1">
          Period {periods_elapsed} of {total_periods_in_year} complete
          {is_year_complete && ' — year complete'}
        </p>
        {!is_year_complete && (
          <p>
            Projected annual: {formatCurrency(projected_annual)}
            {' — '}
            {isOnTrack
              ? 'on pace to meet the floor'
              : `${formatCurrency(shortfall_risk)} short of floor at this pace`
            }
          </p>
        )}
        {is_year_complete && !isOnTrack && (
          <p className="font-semibold">
            Shortfall of {formatCurrency(shortfall_risk)} is due within 30 days.
          </p>
        )}
        {is_year_complete && isOnTrack && (
          <p>
            Annual minimum of {formatCurrency(annual_mg)} met.
          </p>
        )}
      </div>
    </div>
  )
}
```

### 4.5 Placement in the upload wizard

The panel appears in the confirm result state, after the licensor clicks "Confirm and Create Period" on the current Step 4. The flow becomes:

```
Step 1 (Upload) → Step 2 (Map Columns) → Step 3 (Preview) → Step 4 (Review and Confirm) → Result Screen
```

On the **Result Screen** (after a successful confirm API call):

```tsx
<div className="space-y-6">
  {/* Royalty result card — same as existing confirm response card */}
  <RoyaltyResultCard
    netSales={salesPeriod.net_sales}
    calculatedRoyalty={salesPeriod.royalty_calculated}
    licenseeReportedRoyalty={salesPeriod.licensee_reported_royalty}
    discrepancyAmount={salesPeriod.discrepancy_amount}
    hasDiscrepancy={salesPeriod.has_discrepancy}
  />

  {/* MG tracking — conditional */}
  {mgTracking && <MGTrackingPanel mgTracking={mgTracking} />}

  {/* Navigation */}
  <div className="flex items-center justify-between pt-2">
    <Link
      href={`/contracts/${contractId}`}
      className="btn-primary flex items-center gap-2"
    >
      <CheckCircle className="w-4 h-4" />
      View Contract
    </Link>
    <button
      onClick={handleUploadAnother}
      className="btn-secondary flex items-center gap-2"
    >
      Upload Another Period
    </button>
  </div>
</div>
```

This replaces the immediate redirect behavior in the current spec (`work/phase-1.1-ux.md` Section 8). Instead of redirecting automatically, the wizard lands on a result screen. The licensor sees what was created and the updated MG status before choosing to navigate away.

The toast notification is removed from the result screen — the result card and MG panel serve the same purpose with more information. The toast is only triggered when the user navigates to the contract detail page (via the "View Contract" button or the breadcrumb).

### 4.6 Step 3 navigation update

The current Step 3 "Preview Data" step remains unchanged. The "Continue" button at the bottom of Step 3 advances to Step 4 ("Review and Confirm") as before. Step 4 now contains the read-only summary and the confirm button. On successful confirm, Step 4 transitions to the result screen inline (same page, step state transitions to `5` or `'result'`).

---

## 5. Contract Detail Page — MG Progress Indicator

### 5.1 When to show

Show the MG progress indicator in the Sales Periods section if:
- `contract.minimum_guarantee > 0`
- `contract.minimum_guarantee_period == "annual"`
- The YTD summary (`GET /api/sales/summary/{contract_id}`) returns `mg_tracking` that is not `null`

### 5.2 Placement

The MG progress indicator sits between the "Sales Periods" section header and the sales history table (or the empty state). It is not inside the table — it is a standalone card above it.

```tsx
{/* Sales Periods Section */}
<div className="card mt-6 animate-fade-in">
  <div className="flex items-center justify-between mb-6">
    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
      <BarChart3 className="w-5 h-5" />
      Sales Periods
    </h2>
    {contract.status === 'active' && (
      <Link href={`/sales/upload?contract_id=${contract.id}`} className="btn-primary ...">
        Upload Report
      </Link>
    )}
  </div>

  {/* MG tracking — shown above table when applicable */}
  {ytdSummary?.mg_tracking && (
    <div className="mb-6">
      <MGTrackingPanel mgTracking={ytdSummary.mg_tracking} />
    </div>
  )}

  {/* Sales history table or empty state */}
  {salesPeriods.length === 0 ? (
    <EmptyState ... />
  ) : (
    <SalesHistoryTable periods={salesPeriods} />
  )}
</div>
```

### 5.3 Data fetching

The contract detail page already fetches `salesPeriods`. It should also call `GET /api/sales/summary/{contract_id}` to get the YTD summary (including `mg_tracking`). This endpoint should be called with `contract_year` corresponding to the current contract year.

Determine current contract year:
```typescript
function getCurrentContractYear(contractStartDate: string): number {
  const start = new Date(contractStartDate)
  const today = new Date()
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  return Math.floor((today.getTime() - start.getTime()) / msPerYear) + 1
}
```

This value is passed as `?contract_year=N` to the summary endpoint.

### 5.4 Loading state

The MG panel appears only after the YTD summary fetch resolves. While loading, show a skeleton block of the same height as the panel:

```tsx
{ytdSummaryLoading && (
  <div className="h-28 bg-gray-100 rounded-xl animate-pulse mb-6" />
)}
{!ytdSummaryLoading && ytdSummary?.mg_tracking && (
  <div className="mb-6">
    <MGTrackingPanel mgTracking={ytdSummary.mg_tracking} />
  </div>
)}
```

### 5.5 Empty state: no periods yet

When `salesPeriods.length === 0` and `mg_tracking` is null (because no periods exist yet), the MG panel is hidden. The empty state message is unchanged.

When `salesPeriods.length === 0` but somehow `mg_tracking` is not null (should not occur, but defensive coding), still hide the panel — a 0-period state is not meaningful for MG display.

---

## 6. TypeScript Types

Add to `/frontend/types/index.ts`:

```typescript
// --- Minimum Guarantee Tracking ---

export type MGStatus = 'on_track' | 'shortfall' | 'not_applicable'

export interface MGTracking {
  annual_mg: number
  ytd_royalty: number
  pro_rated_mg: number
  projected_annual: number
  shortfall_risk: number
  periods_elapsed: number
  total_periods_in_year: number
  status: MGStatus
  is_year_complete: boolean
}

export interface YTDSummary {
  total_net_sales: number
  total_royalties: number
  mg_tracking: MGTracking | null
}

// Extend the upload confirm response (Phase 1.1 extension)
export interface UploadConfirmResponse {
  sales_period: SalesPeriod
  ytd_summary: YTDSummary
}
```

Update `MGTrackingPanelProps` to use the `MGTracking` interface above.

---

## 7. Component File Map

| File | Change |
|------|--------|
| `backend/app/services/royalty_calc.py` | Add `compute_mg_tracking()` function; extend `calculate_ytd_summary()` to include `mg_tracking` in return value |
| `backend/app/routers/sales_upload.py` | Wrap confirm response as `{ sales_period, ytd_summary }` |
| `backend/app/routers/sales.py` | Extend YTD summary response with `mg_tracking` |
| `backend/tests/test_sales_upload.py` | Add MG tracking test cases (Section 3.4) |
| `backend/tests/test_sales.py` | Add `compute_mg_tracking` unit tests |
| `frontend/types/index.ts` | Add `MGStatus`, `MGTracking`, `YTDSummary`, `UploadConfirmResponse` types |
| `frontend/components/mg-tracking-panel.tsx` | New component — `MGTrackingPanel` (reused in wizard and contract detail page) |
| `frontend/app/(app)/sales/upload/page.tsx` | Add result screen state; render `MGTrackingPanel` after confirm; replace auto-redirect with manual navigation |
| `frontend/app/(app)/contracts/[id]/page.tsx` | Fetch YTD summary; render `MGTrackingPanel` above sales history table |
| `frontend/__tests__/mg-tracking-panel.test.tsx` | New test file (Section 8) |

---

## 8. Frontend Tests

### `__tests__/mg-tracking-panel.test.tsx`

```
renders on_track state with green styling and "On Track" badge
renders shortfall state with amber styling and "Below Pace" badge
renders shortfall state at year-end with "Shortfall Due" badge
progress bar width reflects ytd / annual_mg percentage (capped at 100%)
renders period count: "Period 2 of 4 complete"
renders projected annual when year is not complete
renders shortfall risk amount when status is shortfall and year not complete
renders "Annual minimum met" when on_track and year is complete
renders "Shortfall of X is due within 30 days" when shortfall and year is complete
progress bar aria-valuenow equals ytd_royalty
progress bar aria-valuemax equals annual_mg
does not render when mgTracking is null (component simply not mounted)
```

### Additional cases for `__tests__/sales-upload-page.test.tsx`

```
shows MGTrackingPanel after successful confirm when mg_tracking is returned
does not show MGTrackingPanel when mg_tracking is null in confirm response
shows "View Contract" button on result screen
shows "Upload Another Period" button on result screen
clicking "Upload Another Period" resets wizard to step 1
```

### Additional cases for `__tests__/contracts/[id]/page.test.tsx` (or existing contract detail test file)

```
calls GET /api/sales/summary/{id} on mount with correct contract_year param
renders MGTrackingPanel when ytd_summary.mg_tracking is not null
does not render MGTrackingPanel when mg_tracking is null
renders skeleton loader while ytd_summary is loading
does not render MGTrackingPanel when salesPeriods is empty
```

---

## 9. Acceptance Criteria

### Backend

- [ ] `GET /api/sales/summary/{contract_id}` response includes `mg_tracking` object when contract has an annual MG and at least one period in the current year
- [ ] `mg_tracking` is `null` when contract has no MG, a non-annual MG period, or no periods in the current year
- [ ] `status == "on_track"` when projected annual >= annual MG
- [ ] `status == "shortfall"` when projected annual < annual MG
- [ ] `is_year_complete == true` when periods_elapsed == total_periods_in_year
- [ ] At year-end, `status` reflects actual YTD vs MG (not projected)
- [ ] `POST .../confirm` response wraps `SalesPeriodResponse` in `{ sales_period, ytd_summary }` shape
- [ ] `ytd_summary.mg_tracking` in confirm response reflects the updated totals after the new period is added
- [ ] All MG tracking test cases passing

### Frontend

- [ ] `MGTrackingPanel` renders with correct status color and badge for `on_track` and `shortfall`
- [ ] Progress bar width correctly reflects `ytd_royalty / annual_mg` (capped at 100%)
- [ ] Panel is absent when `mgTracking` is `null`
- [ ] Upload wizard result screen shows `MGTrackingPanel` when confirm response includes `mg_tracking`
- [ ] Upload wizard result screen shows "View Contract" and "Upload Another Period" buttons
- [ ] "Upload Another Period" resets wizard to Step 1 with same contract pre-selected
- [ ] Contract detail page calls YTD summary endpoint on mount
- [ ] `MGTrackingPanel` appears above sales history table when `mg_tracking` is not `null`
- [ ] Skeleton loader shown while YTD summary is fetching
- [ ] Panel absent when no sales periods exist
- [ ] All new tests passing

---

## 10. Out of Scope

- Tracking MG for quarterly or monthly MG periods (deferred — annual MG is the dominant case)
- Recording the shortfall payment as a separate event in Likha (deferred to v2)
- Email reminders when MG status transitions to shortfall (deferred to v2)
- Historical year-over-year MG comparison (deferred to v2)
- MG tracking on the dashboard summary card (deferred — contract detail page is the right scope for now)
- Editing the MG amount from the tracking panel (contract editing is deferred to v2)
