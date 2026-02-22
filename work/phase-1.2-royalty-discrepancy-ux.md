# Phase 1.2 UX Specification: Royalty Discrepancy Display on Contract Detail Page

**Created:** 2026-02-23
**Status:** Ready for implementation
**Feature:** Surface licensee reported royalty, system calculated royalty, and discrepancy indicators in the contract detail sales periods table.
**File:** `/frontend/app/(app)/contracts/[id]/page.tsx`
**Related types:** `/frontend/types/index.ts` — `SalesPeriod.licensee_reported_royalty`, `SalesPeriod.discrepancy_amount`, `SalesPeriod.has_discrepancy`

---

## 1. Problem Statement

The current sales periods table shows four columns: Period, Net Sales, Calculated Royalty, and MG Applied. It does not surface `licensee_reported_royalty` or `discrepancy_amount`, which are already persisted on each `SalesPeriod` row. Users who upload reports with licensee-reported figures have no way to see whether the licensee's number matches the system's calculation from the contract detail page.

This spec defines:
- An updated column layout that adds the reported royalty and a discrepancy indicator
- Visual language for under-reported, over-reported, and exact-match states
- A summary card in the sidebar stat area to show aggregate discrepancy exposure
- Tailwind class patterns consistent with the existing design system

---

## 2. Data Model Reference

From `/frontend/types/index.ts`:

```ts
export interface SalesPeriod {
  // ...existing fields...
  licensee_reported_royalty?: number | null   // what the licensee said they owe
  discrepancy_amount?: number | null          // positive = under-reported, negative = over-reported
  has_discrepancy?: boolean                   // true when |discrepancy_amount| > threshold
}
```

Discrepancy semantics (from backend convention):
- `discrepancy_amount > 0` — licensee under-reported (they said less than the contract requires)
- `discrepancy_amount < 0` — licensee over-reported (they said more than the contract requires)
- `discrepancy_amount === 0` or `null` — exact match or no reported figure

A period without `licensee_reported_royalty` (i.e., uploaded before Phase 1.1 or without the column mapped) should render gracefully — the new columns collapse to dashes rather than breaking the layout.

---

## 3. Updated Table Column Layout

### Column order

| # | Column | Alignment | Notes |
|---|---|---|---|
| 1 | Period | Left | Unchanged |
| 2 | Net Sales | Right | Unchanged |
| 3 | Reported Royalty | Right | New — licensee's stated figure |
| 4 | Calculated Royalty | Right | Was col 3 — unchanged |
| 5 | Discrepancy | Right | New — amount + badge |
| 6 | MG Applied | Center | Was col 4 — unchanged |

Placing Reported before Calculated creates a natural left-to-right reading flow: "what they said" then "what the contract says" then "the difference."

MG Applied moves to the end because it is a secondary flag — rarely actioned inline — so it should not interrupt the core royalty comparison columns.

### Column header markup

```tsx
<thead>
  <tr className="border-b border-gray-200">
    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-900">
      Period
    </th>
    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">
      Net Sales
    </th>
    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">
      Reported Royalty
    </th>
    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">
      Calculated Royalty
    </th>
    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-900">
      Discrepancy
    </th>
    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-900">
      MG Applied
    </th>
  </tr>
</thead>
```

---

## 4. Row Markup

### Conditional rendering logic

```tsx
{salesPeriods.map((period) => {
  const hasReported = period.licensee_reported_royalty != null
  const discrepancy = period.discrepancy_amount ?? null
  const discrepancyPct =
    hasReported && period.royalty_calculated > 0
      ? (Math.abs(discrepancy ?? 0) / period.royalty_calculated) * 100
      : null

  return (
    <tr key={period.id} className="hover:bg-gray-50">
      {/* Period */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">
            {formatDate(period.period_start)} – {formatDate(period.period_end)}
          </span>
        </div>
      </td>

      {/* Net Sales */}
      <td className="py-3 px-4 text-right font-medium text-gray-900 tabular-nums">
        {formatCurrency(period.net_sales)}
      </td>

      {/* Reported Royalty */}
      <td className="py-3 px-4 text-right tabular-nums">
        {hasReported
          ? <span className="font-medium text-gray-900">
              {formatCurrency(period.licensee_reported_royalty!)}
            </span>
          : <span className="text-gray-400 text-sm">—</span>
        }
      </td>

      {/* Calculated Royalty */}
      <td className="py-3 px-4 text-right font-semibold text-primary-600 tabular-nums">
        {formatCurrency(period.royalty_calculated)}
      </td>

      {/* Discrepancy */}
      <td className="py-3 px-4 text-right">
        {hasReported && discrepancy !== null
          ? <DiscrepancyCell amount={discrepancy} percentage={discrepancyPct} />
          : <span className="text-gray-400 text-sm">—</span>
        }
      </td>

      {/* MG Applied */}
      <td className="py-3 px-4 text-center">
        {period.minimum_applied
          ? <span className="badge-warning">Yes</span>
          : <span className="text-sm text-gray-500">No</span>
        }
      </td>
    </tr>
  )
})}
```

---

## 5. DiscrepancyCell Component

This is an inline presentational component — no state, no API calls. It accepts the raw `amount` (signed) and the pre-computed `percentage`.

### Visual states

| Condition | Badge label | Badge classes | Amount display |
|---|---|---|---|
| Under-reported (`amount > 0.01`) | Under-reported | `bg-red-100 text-red-700` | `+{amount}` in red |
| Over-reported (`amount < -0.01`) | Over-reported | `bg-amber-100 text-amber-700` | `{amount}` in amber |
| Exact match (`|amount| <= 0.01`) | Match | `bg-green-100 text-green-700` | `$0.00` in green |

The 0.01 threshold avoids flagging floating-point rounding noise (e.g. $0.001 difference) as a real discrepancy.

### Component markup

```tsx
// DiscrepancyCell — inline component, no file needed, define above the page component

function DiscrepancyCell({
  amount,
  percentage,
}: {
  amount: number
  percentage: number | null
}) {
  const isExact = Math.abs(amount) <= 0.01
  const isUnder = amount > 0.01
  // isOver = amount < -0.01

  if (isExact) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          Match
        </span>
        <span className="text-xs text-green-600 tabular-nums">$0.00</span>
      </div>
    )
  }

  if (isUnder) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          <TrendingDown className="w-3 h-3" />
          Under-reported
        </span>
        <span className="text-xs font-medium text-red-600 tabular-nums">
          +{formatCurrency(amount)}
          {percentage !== null && (
            <span className="text-red-400 ml-1">({percentage.toFixed(1)}%)</span>
          )}
        </span>
      </div>
    )
  }

  // Over-reported
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <TrendingUp className="w-3 h-3" />
        Over-reported
      </span>
      <span className="text-xs font-medium text-amber-600 tabular-nums">
        {formatCurrency(amount)}
        {percentage !== null && (
          <span className="text-amber-400 ml-1">({percentage.toFixed(1)}%)</span>
        )}
      </span>
    </div>
  )
}
```

The `+` sign prefix on under-reported amounts makes it explicit that the number represents money the licensor is still owed. Over-reported amounts are negative by convention — the minus sign is already present in the formatted number.

Icons (`TrendingDown` for under, `TrendingUp` for over) reinforce meaning for users who have difficulty distinguishing red from amber. Both icons are from Lucide React, consistent with the rest of the page.

---

## 6. Color Coding Rationale

### Under-reported — Red (`bg-red-100 text-red-700`)

Red signals that action is likely needed. The licensee reported less than the contract requires, which means potential underpayment. This is the highest-priority discrepancy state for the licensor.

Red is not used for over-reporting because over-reporting is benign from the licensor's perspective (they are receiving at least what the contract requires) and using red for both states would be misleading.

### Over-reported — Amber (`bg-amber-100 text-amber-700`)

Amber signals an anomaly worth noting but not urgently actionable. The licensee paid more than required, which is unusual and may indicate a calculation error on their side. It warrants review but is not a financial loss for the licensor.

This matches the existing use of `badge-warning` (amber) for soft/informational alerts in the app (e.g., draft contract banner, MG Applied).

### Exact match — Green (`bg-green-100 text-green-700`)

Green signals that the reported figure matches the system calculation. This uses `badge-success` color semantics, consistent with the "Active" contract status badge.

### No reported figure — Gray dash

When `licensee_reported_royalty` is null (period uploaded before Phase 1.1, or the column was not mapped), the Reported Royalty and Discrepancy cells show `—` in `text-gray-400`. This avoids false negatives — a missing figure is neutral, not a discrepancy.

---

## 7. Discrepancy Display Format

### Amount

Formatted with `formatCurrency` (existing helper, matches all other monetary values on the page). The under-reported amount is prefixed with `+` to reinforce directionality — it is additional money owed to the licensor. Example: `+$1,240.00`.

### Percentage

Computed as `|discrepancy_amount| / royalty_calculated * 100`, rounded to one decimal place. Displayed in a lighter shade of the same hue (`text-red-400`, `text-amber-400`) as secondary metadata below the amount. This lets users quickly gauge materiality without obscuring the dollar figure.

Example under-reported cell:
```
[↓ Under-reported]
+$1,240.00 (15.5%)
```

Example over-reported cell:
```
[↑ Over-reported]
-$320.00 (4.0%)
```

Example match cell:
```
[Match]
$0.00
```

The percentage is omitted when `royalty_calculated` is zero (to avoid division by zero) and when `licensee_reported_royalty` is null.

---

## 8. Summary Card for Total Discrepancies

Add a third stat card to the existing sidebar summary area (currently: Total Royalties YTD + Sales Periods count). The card appears only when at least one period has `has_discrepancy === true`.

### Placement

After the two existing stat cards in the `space-y-6` sidebar column:

```tsx
{/* Existing cards */}
<div className="card animate-fade-in"> {/* Total Royalties YTD */} </div>
<div className="card animate-fade-in"> {/* Sales Periods count */} </div>

{/* New discrepancy summary card — conditional */}
{totalUnderReported > 0 && (
  <div className="card animate-fade-in border border-red-200 bg-red-50">
    <h3 className="text-sm font-medium text-red-700 mb-1">
      Open Discrepancies
    </h3>
    <p className="text-3xl font-bold text-red-700 tabular-nums">
      {formatCurrency(totalUnderReported)}
    </p>
    <p className="text-xs text-red-500 mt-1">
      Across {underReportedCount} period{underReportedCount !== 1 ? 's' : ''}
    </p>
  </div>
)}
```

This card only shows for under-reported totals because that is the actionable case. Over-reported periods do not create financial exposure for the licensor and do not warrant a persistent summary.

### Derived values

Compute these alongside the existing `totalRoyalties`:

```tsx
const totalUnderReported = salesPeriods
  .filter((p) => (p.discrepancy_amount ?? 0) > 0.01)
  .reduce((sum, p) => sum + (p.discrepancy_amount ?? 0), 0)

const underReportedCount = salesPeriods.filter(
  (p) => (p.discrepancy_amount ?? 0) > 0.01
).length
```

### Card appearance

The card uses `border border-red-200 bg-red-50` — a tinted card variant rather than the default `card` class which applies `bg-white`. This creates visual weight appropriate to the alert nature of the information without being as alarming as a full error banner. The number is large and bold (`text-3xl font-bold text-red-700`) to match the existing stat card typography style.

When `totalUnderReported === 0` the card does not render at all, keeping the sidebar clean for contracts without discrepancies.

---

## 9. Table Section Header Update

When any discrepancy exists, add a subdued notice below the "Sales Periods" heading to prime the user before they read the table. This replaces scanning through the table to find issues.

```tsx
<div className="flex items-center justify-between mb-4">
  <div>
    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
      <BarChart3 className="w-5 h-5" />
      Sales Periods
    </h2>
    {underReportedCount > 0 && (
      <p className="text-sm text-red-600 mt-0.5 flex items-center gap-1">
        <AlertCircle className="w-3.5 h-3.5" />
        {underReportedCount} period{underReportedCount !== 1 ? 's have' : ' has'} under-reported royalties
      </p>
    )}
  </div>
  {/* Upload Report button — unchanged */}
</div>
```

The inline notice uses `text-sm text-red-600` with a small `AlertCircle` icon. It is secondary to the heading, not a full banner, so it does not compete visually with the card content.

---

## 10. Row-Level Visual Emphasis

To draw attention to problematic rows without relying solely on the Discrepancy cell, apply a subtle left border accent to rows with under-reported discrepancies:

```tsx
<tr
  key={period.id}
  className={`
    hover:bg-gray-50
    ${(period.discrepancy_amount ?? 0) > 0.01
      ? 'border-l-2 border-l-red-400'
      : (period.discrepancy_amount ?? 0) < -0.01
      ? 'border-l-2 border-l-amber-400'
      : 'border-l-2 border-l-transparent'
    }
  `}
>
```

All rows get `border-l-2` with a transparent color as default so the table columns do not shift when discrepancy rows appear. Only the border color changes.

This technique avoids full row background coloring (e.g., `bg-red-50` on the entire row) which would reduce readability of the cell values, especially the financial figures.

---

## 11. Tailwind Class Reference

All classes are consistent with existing design system tokens in `globals.css` and the project color palette.

### Badge variants

| State | Classes |
|---|---|
| Under-reported badge | `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700` |
| Over-reported badge | `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700` |
| Match badge | `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700` |

Note: there is no `badge-danger` in `globals.css` (only `badge-primary`, `badge-success`, `badge-warning`). The under-reported badge uses explicit red utilities rather than a missing token. If this pattern recurs in future features, a `badge-danger` token (`bg-red-100 text-red-700`) should be added to `globals.css`.

### Amount text

| State | Classes |
|---|---|
| Under-reported amount | `text-xs font-medium text-red-600 tabular-nums` |
| Under-reported percentage | `text-red-400` |
| Over-reported amount | `text-xs font-medium text-amber-600 tabular-nums` |
| Over-reported percentage | `text-amber-400` |
| Match amount | `text-xs text-green-600 tabular-nums` |
| No data dash | `text-gray-400 text-sm` |

### Row accent border

| State | Classes |
|---|---|
| Under-reported row | `border-l-2 border-l-red-400` |
| Over-reported row | `border-l-2 border-l-amber-400` |
| No discrepancy row | `border-l-2 border-l-transparent` |

### Discrepancy summary card

| Element | Classes |
|---|---|
| Card container | `card animate-fade-in border border-red-200 bg-red-50` |
| Card heading | `text-sm font-medium text-red-700 mb-1` |
| Card amount | `text-3xl font-bold text-red-700 tabular-nums` |
| Card subtext | `text-xs text-red-500 mt-1` |

### Section notice

| Element | Classes |
|---|---|
| Notice text | `text-sm text-red-600 mt-0.5 flex items-center gap-1` |
| Notice icon | `w-3.5 h-3.5` (AlertCircle) |

---

## 12. Icons Required

Add two new Lucide imports to the contract detail page:

```tsx
import {
  // existing
  ArrowLeft, Calendar, MapPin, DollarSign,
  BarChart3, FileText, ExternalLink, AlertCircle, Upload,
  // new
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
```

`TrendingDown` — under-reported badge (royalty reported below contract calculation)
`TrendingUp` — over-reported badge (royalty reported above contract calculation)

Both icons are available in Lucide React and already used elsewhere in the codebase patterns.

---

## 13. Responsive Behavior

The table gains two new columns. On smaller screens, six columns may become cramped.

### Table scrolling

The table already uses `overflow-x-auto` on its wrapper (`<div className="overflow-x-auto">`). This handles the additional columns on mobile without layout breakage — users scroll horizontally to see all columns.

### Column widths

To prevent the Period column from collapsing too aggressively, add `min-w-[10rem]` to the period cell and `whitespace-nowrap` to the date string. The financial columns are already right-aligned and will take their minimum content width.

```tsx
<td className="py-3 px-4 min-w-[10rem]">
  <div className="flex items-center gap-2">
    <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
    <span className="text-sm text-gray-900 whitespace-nowrap">
      {formatDate(period.period_start)} – {formatDate(period.period_end)}
    </span>
  </div>
</td>
```

The Discrepancy cell stacks its badge and amount vertically (`flex flex-col items-end gap-1`) which keeps the column narrow and avoids wrapping badge text.

---

## 14. Accessibility Notes

- Color is never the sole indicator: under-reported rows also have the `TrendingDown` icon and the `+` prefix on the amount; over-reported rows have `TrendingUp`; exact match has the text "Match". All discrepancy states are labeled with words.
- `tabular-nums` is applied to all monetary values throughout the table so numbers align vertically by digit position.
- The discrepancy summary card is not inside the `<table>` element — it is a sidebar card visible before the table. Users of assistive technology will encounter the summary before the detail, which follows reading order correctly.
- The section notice (under-reported count) is static text, not a live region. Since it is loaded with the page data, no `aria-live` is needed.
- The `DiscrepancyCell` component does not add any `aria-label` beyond the visible text since the combination of icon, badge label, amount, and percentage already provides sufficient information.
- Percentage values use one decimal place (`toFixed(1)`) for consistency. When displayed, they are wrapped in parentheses, e.g., `(15.5%)`, which screen readers announce naturally as "15.5 percent".

---

## 15. Edge Cases

| Scenario | Behavior |
|---|---|
| `licensee_reported_royalty` is null | Reported Royalty cell shows `—` in `text-gray-400`; Discrepancy cell shows `—` |
| `discrepancy_amount` is null but `licensee_reported_royalty` is present | Compute discrepancy client-side as `royalty_calculated - licensee_reported_royalty` for display only (do not mutate state) |
| `royalty_calculated` is 0 | Percentage is omitted to avoid division by zero; amount is still shown |
| Discrepancy is within $0.01 of zero | Treated as "Match" — the exact threshold avoids floating-point noise |
| All periods have no reported royalty | Discrepancy summary card does not render; Discrepancy column headers still show (the column is part of the schema going forward) |
| Mixed periods (some with reported, some without) | Each cell is evaluated independently; no row is hidden or collapsed |
