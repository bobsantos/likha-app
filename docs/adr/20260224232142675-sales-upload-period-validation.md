# Close two period validation gaps in the sales upload wizard

## Context and Problem Statement

The sales upload wizard has two validation gaps around reporting periods:

1. **Period mismatch goes undetected.** A user enters Q1 2025 dates on the form but uploads a CSV whose header metadata says Q3 2025. The parser detects and skips metadata rows but discards the period info, so no warning is ever shown.

2. **Duplicate period check is incomplete and UX is poor.** A user can upload a report for a contract+period that already has a sales record. The check currently lives at confirm time — after the user has already picked a file, mapped columns, and possibly resolved categories. Finding a conflict there is disruptive, the "Go back" button in the conflict card is a no-op (it sets step to `map-columns` while already on `map-columns`), and there is no preview of what would be replaced.

## Considered Options

* **Do nothing** — rely on users to manually verify period alignment and catch duplicates by inspecting the sales history.
* **Block on mismatch** — reject the upload outright if metadata periods don't match form dates, and refuse duplicate periods entirely.
* **Warn + allow override (original decision)** — extract period metadata and show a non-blocking amber warning at preview; improve the duplicate check and let users explicitly replace an existing record via an override flow.
* **Early period-check on date selection (chosen)** — validate for overlapping periods as soon as the user completes both date fields in Step 1, before they pick a file. Show an inline preview of what overlaps and let the user decide to replace or change dates before investing effort in the upload.

## Decision Outcome

Chosen option: **"Warn + allow override"** with the duplicate check moved to the **earliest possible moment** — on date selection in Step 1, via a lightweight `period-check` endpoint. The confirm endpoint retains the overlap check as a race-condition safety net.

Gap 1 (metadata period mismatch) is already implemented correctly and is unchanged.

### Implementation

**Gap 1 — Period mismatch (non-blocking warning, already implemented):**
- `_extract_metadata_periods()` scans rows before the detected header for label/value pairs matching common period labels (e.g., "Reporting Period Start", "Period From").
- `_build_upload_warnings()` compares extracted metadata periods against the user-entered period and emits an amber warning when there is no date overlap.
- No frontend changes needed — existing amber warning cards already render `upload_warnings`.

**Gap 2 — Duplicate period (early inline warning with override):**

**New endpoint — `GET /api/upload/{contract_id}/period-check`**

Query parameters: `start` (YYYY-MM-DD), `end` (YYYY-MM-DD).

Checks for records in `sales_periods` that overlap the requested range using the same condition as the confirm endpoint (`period_start <= end AND period_end >= start`). Returns a lightweight response:

```json
{
  "has_overlap": true,
  "overlapping_periods": [
    {
      "id": "uuid",
      "period_start": "2025-01-01",
      "period_end": "2025-03-31",
      "net_sales": "95000.00",
      "royalty_calculated": "7600.00",
      "created_at": "2025-04-15T10:23:00Z"
    }
  ]
}
```

The endpoint selects `id, period_start, period_end, net_sales, royalty_calculated, created_at` — enough for a meaningful conflict preview without exposing unrelated data. Auth and contract ownership are verified via the same `verify_contract_ownership` dependency used by the other upload endpoints.

**Frontend — inline warning in Step 1 (`StepUpload` component):**

When both `periodStart` and `periodEnd` are set (i.e., both `onChange` handlers have fired and both values are non-empty), the component calls the `period-check` endpoint. This fires on each change to either date field as long as the other is already filled.

If `has_overlap: true`, an amber warning card renders inline, directly below the date fields and above the file drop zone:

```
A sales record already exists that overlaps this period.

  Q1 2025  |  Jan 1 – Mar 31, 2025  |  $95,000 net sales  |  Uploaded Apr 15
  [+ N more if multiple]

  [Replace existing record(s)]   [Change dates]
```

"Replace existing record(s)" sets `overrideDuplicate = true` in parent wizard state and dismisses the card — the upload flow continues normally. "Change dates" clears the date fields so the user can re-enter them.

If `has_overlap: false` (or either date is empty), the card is hidden. The period-check call is debounced (~400 ms) to avoid firing on every keystroke. A loading indicator (spinner) shows during the check; errors from the endpoint are silently swallowed — the check is advisory.

When multiple periods overlap, all are listed in the card. The plural label "Replace existing record(s)" covers both cases.

**`overrideDuplicate` travels silently through the wizard:**

The flag is stored in the parent `SalesUploadPage` state (`overrideDuplicate: boolean`, default `false`). It is not visible to the column-mapper or category-mapper steps. It is passed to `doConfirm` and included in the `UploadConfirmRequest` body as `override_duplicate: true` when set.

**Confirm endpoint retains the overlap check as a safety net:**

The existing overlap check in `confirm_upload` (lines 724–743 of `sales_upload.py`) is kept unchanged. It handles two edge cases:
- Race condition: another period was created between the period-check call and confirm.
- Session expiry: the user left the wizard open for >15 minutes; the `overrideDuplicate` flag in state was reset but the upload_id expired anyway, requiring a fresh upload where the period-check fires again.

When `override_duplicate: true` reaches confirm, the existing logic deletes overlapping records before inserting the replacement. This is unchanged.

**Fix the "Go back" no-op bug:**

In the current duplicate conflict card (rendered on the `map-columns` step), the "Go back" button calls `setStep('map-columns')` while already on `map-columns` — it does nothing. With this redesign, the conflict is shown in Step 1 before any file is chosen, so the "Change dates" action simply clears both date fields (no step navigation needed). The conflict card on `map-columns` (the 409 fallback) should keep the "Go back" button but fix it to call `setStep('upload')` instead.

**What the confirm-time 409 catch becomes:**

The existing `duplicatePeriodError` state and the amber conflict card on the `map-columns` step remain in place as a fallback for the race-condition case. The card text can be updated to reflect that this is unexpected: "A conflict was detected at submission time. This can happen if another session uploaded a report for the same period. You can replace it or go back to Step 1 to change dates." The "Go back" button calls `setStep('upload')`.

### Edge cases

**Partial overlaps:** The overlap query uses the standard range-intersection condition. A period of Jan–Mar is considered overlapping with Feb–Apr. The preview shows exactly which records overlap, letting the user decide whether the overlap is intentional (e.g., correcting a partial period) or a mistake.

**Category-rate contracts:** No special handling needed. The period-check endpoint is contract-agnostic — it only queries `sales_periods` by `contract_id` and date range. Category breakdown is irrelevant to the overlap determination.

**Zero-sales or stub periods:** Overlapping periods with `net_sales = 0` are surfaced the same way. The user may want to replace them (e.g., a placeholder was created manually). The preview shows $0 net sales, making it obvious.

**Both dates same day (single-day period):** Valid. The range-intersection condition handles this correctly (`start <= end AND end >= start` reduces to equality).

**`period_end` before `period_start`:** The period-check endpoint returns a 400. The frontend already disables the upload button when dates are invalid; the period-check call should be skipped when `start > end`.

**Gap 3 — Contract date range and reporting frequency validation:**

Two sub-checks, both non-blocking amber warnings.

**3a — Contract date range**

Warn if the reporting period falls partially or fully outside the contract's `contract_start_date` / `contract_end_date`. Condition: `period_start < contract_start_date OR period_end > contract_end_date`. Null contract dates → skip.

**3b — Reporting frequency mismatch**

Warn if the period duration (in days, inclusive) doesn't match the contract's `reporting_frequency`. Tolerance bands:

| Frequency | Accepted day range |
|---|---|
| `monthly` | 15–55 |
| `quarterly` | 45–135 |
| `semi_annually` | 120–215 |
| `annually` | 270–400 |

Null frequency → skip.

**Where the checks live (three layers for consistency):**

1. **Frontend date picker** — When contract dates are known, default the date picker range to the contract period and use them as soft min/max hints. When frequency is known, suggest natural period boundaries (e.g., quarter starts/ends) as UX guidance, not hard enforcement.

2. **Period-check endpoint** (`GET /upload/{contract_id}/period-check`) — Extend the response with:

```json
{
  "has_overlap": true,
  "overlapping_periods": [...],
  "out_of_range": true,
  "contract_start_date": "2024-01-01",
  "contract_end_date": "2026-12-31",
  "frequency_warning": {
    "expected_frequency": "quarterly",
    "entered_days": 59,
    "expected_range": [45, 135],
    "message": "59 days entered; quarterly periods are typically 45–135 days."
  },
  "suggested_end_date": "2025-03-31"
}
```

`out_of_range` is `false` and `frequency_warning` is `null` when checks pass or are skipped. `suggested_end_date` is non-null when `period_start` aligns to a natural boundary for the contract's frequency (e.g., Jan 1 for quarterly → suggest Mar 31).

3. **`_build_upload_warnings`** — Add `contract_range` and `frequency_mismatch` warnings using the existing `UploadWarning` shape. This ensures email intake and any non-wizard upload path receives the same checks.

**Frontend UX (Step 1):**

Warning cards stack above the overlap card in this order: contract-range → frequency-mismatch → overlap. Each card has "Continue anyway" and "Change dates" actions. The frequency-mismatch card may include a date suggestion: "Did you mean Jan 1 – Mar 31, 2025?" with a [Use these dates] button that populates both date fields. The drop zone is disabled until all visible warnings have been acknowledged. All acknowledgment states reset when either date field changes.

### Edge cases (Gap 3)

**Renewals and extensions:** A licensee may legitimately upload a period that extends slightly beyond the contract end date if a renewal is pending but not yet recorded. Non-blocking keeps this workflow open.

**Catch-up and partial periods:** A first or last period under a contract is often shorter than the standard frequency (e.g., a contract starting March 15 produces a short Q1). Non-blocking avoids rejecting these valid cases.

**Contract dates entered wrong:** If the user's contract record has a typo in `contract_end_date`, a hard block would be impossible to bypass without editing the contract first. The warning allows them to continue and fix the contract record separately.

**Frequency not set on contract:** Some contracts have ad-hoc reporting schedules. Null `reporting_frequency` skips the check entirely — no false positives.

**Suggested end date boundary detection:** The suggested end date is only emitted when `period_start` is within 3 days of a natural boundary for the frequency (e.g., Jan 1, Apr 1, Jul 1, Oct 1 for quarterly). Outside that window, `suggested_end_date` is null and no "Did you mean" prompt is shown.

### Files to modify

| File | Change |
|---|---|
| `backend/app/routers/sales_upload.py` | Add `GET /upload/{contract_id}/period-check` endpoint; extend response with `out_of_range`, `contract_start_date`, `contract_end_date`, `frequency_warning`, `suggested_end_date`; add `contract_range` and `frequency_mismatch` warnings to `_build_upload_warnings` |
| `frontend/app/(app)/sales/upload/page.tsx` | Add `overrideDuplicate` state; pass to `doConfirm`; fix "Go back" to `setStep('upload')`; pass period-check callback into `StepUpload`; add `StepUpload` period-check call on date field change; render amber overlap card inline below date fields; add contract-range and frequency-mismatch cards with stacking logic; date picker guidance from contract dates and frequency |
| `frontend/lib/api.ts` | Add `checkPeriodOverlap(contractId, start, end)` API helper |
| `frontend/types/index.ts` | Add `PeriodCheckResponse` type (extended with Gap 3 fields), `OverlapRecord`, and `FrequencyWarning` types |
| `backend/tests/test_period_validation.py` | New tests for contract-range and frequency-mismatch checks (out-of-range, partial overlap with contract dates, each frequency band, null skips, suggested end date boundary detection) |
| `frontend/__tests__/sales-upload-gap3.test.tsx` | New tests for contract-range and frequency-mismatch warning cards, stacking order, "Use these dates" button, drop zone gating, acknowledgment reset on date change |

No migration needed — the period-check endpoint reads `contracts` (already has `contract_start_date`, `contract_end_date`, `reporting_frequency`) and `sales_periods`, both of which already exist.

---

## UX Specification: Gap 2 — Early Period Overlap Warning

This section provides the detailed visual and interaction specification for the inline overlap warning in Step 1. It is intended as a direct implementation guide.

---

### Trigger logic

Call the period-check endpoint when **both** `periodStart` and `periodEnd` are non-empty and `periodEnd >= periodStart`. Trigger on `onChange` of either date field (not `onBlur`) so the card appears as soon as the second field is filled without requiring the user to tab away.

Debounce the call by **400 ms** to avoid firing on every keystroke when the user types a date manually. Skip the call entirely if `period_end < period_start` — the date grid already shows this as invalid and the endpoint returns a 400 for it. Silently swallow network errors from the check; the confirm-time 409 is the safety net.

---

### Loading state

While the debounced call is in-flight, show a single-line indicator in the space below the date grid. Keep it short so there is no layout shift when the card appears or disappears.

```tsx
{periodCheckState === 'loading' && (
  <div className="flex items-center gap-2 mt-3 text-sm text-gray-500">
    <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
    <span>Checking for existing records…</span>
  </div>
)}
```

Dismiss the loader as soon as the response arrives, whether or not an overlap was found.

---

### Amber warning card (overlap found)

Render immediately below the date grid inside the "Reporting Period" card section, above the file drop zone. Use `role="alert"` so screen readers announce the conflict on insertion without requiring the user to navigate to it.

```tsx
{periodCheckState === 'overlap' && !overrideIntent && (
  <div
    role="alert"
    className="mt-4 bg-amber-50 border border-amber-200 rounded-lg overflow-hidden"
  >
    {/* Header */}
    <div className="flex items-start gap-3 px-4 py-3 border-b border-amber-200">
      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-900">
          {overlappingRecords.length === 1
            ? 'A sales record already exists for this period.'
            : `${overlappingRecords.length} existing records overlap this period.`}
        </p>
        <p className="text-sm text-amber-700 mt-0.5">
          Uploading will replace{' '}
          {overlappingRecords.length === 1 ? 'it' : 'them'}.
          Review {overlappingRecords.length === 1 ? 'the record' : 'the records'} below before continuing.
        </p>
      </div>
    </div>

    {/* Overlap preview rows */}
    <div className="px-4 py-3 space-y-0">
      {overlappingRecords.slice(0, 3).map((record) => (
        <div
          key={record.id}
          className="flex items-center justify-between text-sm py-2 border-b border-amber-100 last:border-0"
        >
          <span className="text-amber-900 font-medium tabular-nums">
            {formatDate(record.period_start)} – {formatDate(record.period_end)}
          </span>
          <div className="flex items-center gap-4 text-amber-800">
            <span className="tabular-nums font-medium">
              {formatCurrency(record.net_sales)} net sales
            </span>
            <span className="text-amber-600 text-xs whitespace-nowrap">
              uploaded {formatRelativeDate(record.created_at)}
            </span>
          </div>
        </div>
      ))}
      {overlappingRecords.length > 3 && (
        <p className="text-xs text-amber-600 pt-2">
          + {overlappingRecords.length - 3} more record
          {overlappingRecords.length - 3 > 1 ? 's' : ''} will also be replaced.
        </p>
      )}
    </div>

    {/* Actions */}
    <div className="flex items-center gap-3 px-4 py-3 bg-amber-100/60 border-t border-amber-200">
      <button
        onClick={() => setOverrideIntent(true)}
        className="btn-primary text-sm"
      >
        Replace existing record{overlappingRecords.length > 1 ? 's' : ''}
      </button>
      <button
        onClick={() => {
          setPeriodStart('')
          setPeriodEnd('')
          setOverlapCheckState('idle')
          periodStartRef.current?.focus()
        }}
        className="btn-secondary text-sm"
      >
        Change reporting period
      </button>
    </div>
  </div>
)}
```

**Data shown per overlapping record:**

| Field | Format | Rationale |
|---|---|---|
| `period_start` – `period_end` | "Jan 1, 2025 – Mar 31, 2025" | Confirms which period collides |
| `net_sales` | "$95,000.00" with `tabular-nums` | Shows financial weight of what will be overwritten |
| `created_at` | Relative ("uploaded 3 days ago") | Helps distinguish stale duplicates from recent intentional uploads |

Do not show `royalty_calculated`, `id`, or category breakdown. Keep the row lean.

---

### File drop zone gating

While the overlap card is visible and unacknowledged (`periodCheckState === 'overlap' && !overrideIntent`), the file drop zone and "Upload & Parse" button are **disabled**. This prevents an accidental upload before the user has consciously chosen to replace or change dates.

```tsx
<div
  className={`
    relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-colors duration-300
    ${overlapPending ? 'pointer-events-none opacity-50' : ''}
    ${dragActive ? 'border-primary-500 bg-primary-50' : ...}
  `}
  ...
>
```

The `disabled` prop on the "Upload & Parse" button already gates keyboard users. The `pointer-events-none opacity-50` on the container gates mouse and touch. Once the user clicks either action button, the drop zone returns to its normal interactive state immediately.

---

### Button behaviors

**"Replace existing record(s)"**
- Sets `overrideIntent = true` in `SalesUploadPage` state.
- Removes the warning card (condition `!overrideIntent` is now false).
- Activates the file drop zone.
- No API call is made at this point. The actual deletion happens at confirm time when `override_duplicate: true` is sent.
- The button label uses the plural suffix `s` only when `overlappingRecords.length > 1`.

**"Change reporting period"**
- Calls `setPeriodStart('')` and `setPeriodEnd('')`.
- Resets `overlapCheckState` to `'idle'`, dismissing the card.
- Resets `overrideIntent` to `false`.
- Moves focus to the `#period_start` input via `periodStartRef.current?.focus()`. This satisfies WCAG 2.1 SC 3.3.1 (focus management after dynamic content removal).

---

### State additions to `StepUpload` and `SalesUploadPage`

**In `StepUpload`** (local state):

```ts
type PeriodCheckState = 'idle' | 'loading' | 'overlap' | 'clear'

const [periodCheckState, setPeriodCheckState] = useState<PeriodCheckState>('idle')
const [overlappingRecords, setOverlappingRecords] = useState<OverlapRecord[]>([])
const periodStartRef = useRef<HTMLInputElement>(null)

// Derived: blocks the drop zone
const overlapPending = periodCheckState === 'overlap' && !overrideIntent
```

**In `SalesUploadPage`** (hoisted so it reaches `doConfirm`):

```ts
const [overrideIntent, setOverrideIntent] = useState(false)
```

Pass `overrideIntent` and `setOverrideIntent` as props to `StepUpload` alongside the existing `periodStart`/`setPeriodStart` props. Reset `overrideIntent` to `false` whenever `periodStart` or `periodEnd` changes (the user may have changed dates after acknowledging an earlier overlap).

---

### New types (`frontend/types/index.ts`)

```ts
// Returned by GET /api/upload/{contract_id}/period-check
export interface OverlapRecord {
  id: string
  period_start: string   // ISO date string
  period_end: string     // ISO date string
  net_sales: number
  created_at: string     // ISO datetime string
}

export interface PeriodCheckResponse {
  has_overlap: boolean
  overlapping_periods: OverlapRecord[]
}
```

---

### How override intent flows through the wizard

`overrideIntent` is stored in `SalesUploadPage` and is invisible to the `ColumnMapper` and `CategoryMapper` components. It is read only at the moment `doConfirm` is called:

```ts
await doConfirm(mapping, save, categoryMapping, overrideIntent)
```

No additional prompts about the overlap appear at Steps 2, 2.5, or 3. If the backend still returns a 409 at confirm time (race condition), the existing `duplicatePeriodError` fallback card on `map-columns` handles it. Update that card's "Go back" button to call `setStep('upload')` instead of `setStep('map-columns')` (the current no-op bug).

---

### Accessibility notes

- `role="alert"` on the card ensures screen readers announce the conflict immediately on insertion.
- Both action buttons are native `<button>` elements with fully descriptive text labels.
- Focus is programmatically moved to `#period_start` after "Change reporting period" — users do not need to navigate back to the field manually.
- The `opacity-50` drop zone state is purely visual; `disabled` on the upload button ensures keyboard users are also gated.

---

### Consequences

* Good, because the user discovers a period conflict before picking a file — the conflict preview gives them enough context (dates, net sales amount, upload date) to decide whether to replace or correct their dates.
* Good, because `overrideDuplicate` is set deliberately at Step 1 and travels silently to confirm — no mid-wizard interruption after column mapping or category mapping.
* Good, because the confirm-time safety net still catches race conditions; the 409 path is now a true edge case with clearer messaging.
* Good, because fixing "Go back" to `setStep('upload')` is a meaningful improvement regardless of whether a conflict was pre-detected.
* Neutral, because the period-check adds one extra network round-trip per date-field interaction, mitigated by debouncing and silent failure on error.
* Bad, because the override deletes the old record rather than versioning it — acceptable for now since the original spreadsheet is retained in Supabase Storage and can be re-uploaded if needed.
