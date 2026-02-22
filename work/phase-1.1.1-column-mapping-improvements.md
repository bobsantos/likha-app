# Phase 1.1.1 Spec: Column Mapping Improvements

**Created:** 2026-02-22
**Status:** Ready for engineering
**Branch:** `royalty-report-spreadsheet-upload-column-mappring` (amend this branch)
**Depends on:** Phase 1.1 spec (`work/phase-1.1-spec.md`) — these are targeted amendments, not a replacement

---

## Context

Two problems surfaced during Phase 1.1 spec review:

1. **"Ignore" is the only option for columns that don't match a Likha field.** The current 6-field list (`net_sales`, `gross_sales`, `returns`, `product_category`, `licensee_reported_royalty`, `territory`) does not cover all columns a licensee royalty report might contain. A column like "Report Period" or "Licensee Name" has no mapping target, so the only option is to discard it. But some of these columns contain information that could meaningfully update or confirm existing contract data.

2. **No preview of the original spreadsheet data during mapping.** Step 2 of the wizard shows the column name and a single sample value in a dropdown table. The user cannot see enough rows to verify whether their mapping choices make sense before proceeding to Step 3.

These two improvements are self-contained enough to spec separately. They do not require new database tables or new API endpoints — they amend existing structures from Phase 1.1.

---

## Change 1: Additional Mapping Targets

### What fields should be mappable beyond the current 6

The current 6 fields (`net_sales`, `gross_sales`, `returns`, `product_category`, `licensee_reported_royalty`, `territory`) are all calculation inputs. The expanded mapping table should also accept informational fields that appear on royalty reports but are not used in calculation.

The full updated mapping target list:

| Display Label in UI | Internal Field Name | Used In Calculation | Action on Confirm |
|---------------------|---------------------|---------------------|-------------------|
| Net Sales | `net_sales` | Yes — required | Aggregate and calculate royalty |
| Gross Sales | `gross_sales` | Yes — optional | Used to derive net_sales if no net_sales column |
| Returns / Allowances | `returns` | Yes — optional | Subtracted from gross to derive net_sales |
| Product Category | `product_category` | Yes — required for category-rate contracts | Group rows for per-category calculation |
| Licensee Reported Royalty | `licensee_reported_royalty` | Yes — discrepancy detection | Populate `sales_periods.licensee_reported_royalty` |
| Territory | `territory` | No (reserved Phase 2) | Stored in category_breakdown metadata; not used in calculation yet |
| Report Period | `report_period` | No | Cross-check against period_start/period_end entered in Step 1; warn if mismatch |
| Licensee Name | `licensee_name` | No | Cross-check against `contracts.licensee_name`; warn if mismatch |
| Royalty Rate | `royalty_rate` | No | Cross-check against contract rate; warn if mismatch |
| Ignore | `ignore` | — | Discard column |

The three new informational fields — `report_period`, `licensee_name`, and `royalty_rate` — are cross-check fields, not data-capture fields. They do not modify the contract record or the sales period. They produce warnings in Step 3 if the uploaded file contains a different value than what Likha has on file.

### Why only cross-checks, not contract updates

The original question was: "should unmapped columns update contract information?"

The answer is no, with one limited exception (see below). The reasons:

- The contract record (licensee name, royalty rate, territories, dates) is already confirmed by the licensor when the contract is activated. Allowing an uploaded file to silently overwrite contract terms is a data integrity risk. A licensee could upload a file with a different royalty rate and inadvertently change how their own future periods are calculated.
- The licensor's job during upload is to verify the licensee's report, not to edit their contract. If a discrepancy exists between the contract and the report, they should see it as a warning and decide deliberately.
- The right place to update contract data is the contract edit form, not the upload flow.

**The one exception: `licensee_reported_royalty` period aggregation.** This already exists in Phase 1.1 and is correct — the upload flow is the right place to capture what the licensee claimed they owe, because that value comes from the report itself.

### Cross-check behavior (Step 3)

When a column is mapped to `licensee_name`, `report_period`, or `royalty_rate`, the confirm step extracts the value from the first non-null data row and compares it to the contract:

**`licensee_name` cross-check:**
- Extract: first non-null value in the mapped column
- Compare: case-insensitive substring match against `contracts.licensee_name`
- If mismatch: show warning in Step 3 — "Uploaded file says licensee is '[extracted value]' — your contract says '[contract value]'. Proceed anyway or go back to check the file."
- If match: no warning

**`report_period` cross-check:**
- Extract: first non-null value in the mapped column (expect a string like "Q1 2025" or "Jan-Mar 2025" or a date)
- Compare: attempt to parse the value into a date range; check whether it overlaps with `period_start`/`period_end` entered in Step 1
- If parseable and overlapping: no warning
- If parseable and no overlap: show warning — "Uploaded file reports period '[extracted value]' — you entered [period_start] to [period_end] in Step 1. Verify the dates are correct."
- If not parseable: no warning (do not error on unparseable period strings)

**`royalty_rate` cross-check:**
- Extract: first non-null numeric value in the mapped column (strip % sign if present)
- Compare: against the contract's flat rate (if the contract has a flat rate as a string like "8%")
- If the contract uses tiered or category rates: skip this check (too complex to compare)
- If mismatch (tolerance: 0.01 percentage points): show warning — "Uploaded file uses rate [extracted value]% — your contract specifies [contract rate]%. Verify your contract terms."
- If match: no warning

All cross-check warnings are non-blocking. The user sees them in Step 3 and can still confirm. They are displayed with amber styling, the same visual treatment as the discrepancy card.

### Keyword synonyms for new fields

Add to `FIELD_SYNONYMS` in `spreadsheet_parser.py`:

```python
"licensee_name": [
    "licensee", "licensee name", "company", "company name",
    "manufacturer", "partner"
],
"report_period": [
    "period", "reporting period", "report period", "quarter",
    "fiscal period", "report date", "period covered"
],
"royalty_rate": [
    "rate", "royalty rate", "applicable rate", "rate (%)",
    "rate applied"
],
```

**Conflict note:** "royalty rate" as a synonym could match both `royalty_rate` and `licensee_reported_royalty` via the `royalty` synonym in the existing list. The existing `licensee_reported_royalty` synonyms include "royalty" as a broad match. To prevent false collision, ensure the synonym check for `royalty_rate` requires the word "rate" to be present alongside "royalty" — do not match on "royalty" alone for this field.

### Changes to Phase 1.1 spec

**Section 5a** — update the canonical field names table (add `report_period`, `licensee_name`, `royalty_rate`).

**Section 5b** — add the new synonyms above to `FIELD_SYNONYMS`.

**Section 3b confirm endpoint** — after aggregation, before creating the sales period, run cross-check logic and collect warnings. Include a `warnings` array in the `201` response:

```json
{
  "id": "uuid",
  "net_sales": 83300.00,
  "royalty_calculated": 6664.00,
  ...
  "upload_warnings": [
    {
      "field": "licensee_name",
      "extracted_value": "Sunrise Apparel LLC",
      "contract_value": "Sunrise Apparel Co.",
      "message": "Uploaded file says licensee is 'Sunrise Apparel LLC' — your contract says 'Sunrise Apparel Co.'. Verify the file is from the correct licensee."
    }
  ]
}
```

`upload_warnings` is an empty array when no warnings exist. The frontend renders each warning as an amber callout card in Step 3 between the data preview and the confirm button.

**Section 9a TypeScript types** — add `report_period`, `licensee_name`, `royalty_rate` to the `LikhaField` union type. Add `UploadWarning` interface and `upload_warnings` field to the confirm response type.

---

## Change 2: Spreadsheet Preview During Column Mapping

### Problem

The current Step 2 design shows one sample value per column in the mapping table. This is not enough for the user to verify their choices. A column named "Amount" with a single sample value of "12500.00" is ambiguous — is it gross sales, net sales, or the royalty due? The user needs to see multiple rows in context.

### What the preview should show

During Step 2 (column mapping), display a read-only data table beneath the mapping controls. This table shows the raw spreadsheet data exactly as Likha parsed it, before any mapping is applied.

**Layout:**

```
[ Column Mapping Controls — one row per column with dropdowns ]

Raw data from your file (first 5 rows):

| Product Description | SKU     | Category | Gross Sales | Returns | Net Sales Amount | Royalty Due |
|---------------------|---------|----------|-------------|---------|------------------|-------------|
| Classic Logo Tee    | APP-001 | Apparel  | 12,500.00   | 500.00  | 12,000.00        | 960.00      |
| Premium Cap         | ACC-001 | Accessor | 8,750.00    | 250.00  | 8,500.00         | 680.00      |
| ...                 |         |          |             |         |                  |             |
```

**Behavior details:**

- Show up to 5 data rows (not sample rows from the `suggested_mapping` response — the `sample_rows` field already contains 2-5 rows from the backend; use all of them)
- Column headers are the raw detected column names, not Likha field names — the user needs to see what the file actually says to make mapping decisions
- Numbers displayed as-is from the file (do not format or convert — preserve exactly what the parser found)
- Table is read-only and not interactive
- If the file has more than 7 columns, the table scrolls horizontally rather than wrapping
- Table is labeled: "Raw data from your file (showing [N] of [total_rows] rows)"
- This table does NOT update as the user changes dropdowns — it is always the raw view

**What this solves:**

The user can look at the raw data table and the column mapping controls simultaneously. When they see "Amount" in the raw table has values like "960.00" and "680.00" (clearly per-row royalty values), they can confidently map it to "Licensee Reported Royalty." Without this context, they are guessing from column names alone.

### Connection between the preview table and the mapping controls

Add a subtle visual link: when the user hovers over or focuses a mapping dropdown row, highlight the corresponding column in the raw data table (e.g., light blue column background). This helps the user orient between the two UI elements without making the interaction complex.

This hover highlight is a frontend-only enhancement and requires no API changes.

### Changes to Phase 1.1 spec

**Section 4 (Upload Flow)** — Step 2 description currently reads:

> Display one row per detected column
> Each row: column name | first sample value | dropdown (Likha field)

Update to:

> Display one row per detected column
> Each row: column name | first sample value | dropdown (Likha field)
> Below the mapping controls: raw data preview table showing up to 5 rows with original column headers
> When a mapping dropdown row is focused, highlight the corresponding column in the preview table

**Section 9a TypeScript types** — no changes needed. The `sample_rows` field already exists in `UploadPreviewResponse` and contains the data needed to render this table. The frontend just needs to render it.

**Section 8c Frontend tests** — add the following test cases to `column-mapper.test.tsx`:

```
renders raw data preview table below mapping controls
preview table shows detected column names as headers (not Likha field names)
preview table shows up to 5 sample rows
preview table shows correct row count label "showing N of M rows"
preview table does not update when mapping dropdown values change
```

---

## What is explicitly not changing

- **The `ignore` option remains.** Columns that genuinely carry no useful information (SKU, internal product codes, sequence numbers) should stay mappable to `ignore`. The new informational fields reduce the cases where `ignore` is the only option, but do not eliminate it.
- **No contract fields are written during upload.** The cross-check warnings are read-only comparisons. `contracts` table is never updated by the upload flow.
- **No new database tables or migration files.** The `upload_warnings` array is computed at response time by the confirm endpoint and is not persisted. The `licensee_column_mappings` table already stores the mapping JSON and will naturally store any of the new field names (it is JSONB with no enum constraint).
- **No new API endpoints.** The `upload_warnings` field is added to the existing `POST /api/sales/upload/{contract_id}/confirm` response shape only.

---

## Summary of spec amendments

| Phase 1.1 Section | Amendment |
|-------------------|-----------|
| Section 4, Step 2 | Add raw data preview table below mapping controls |
| Section 5a | Add `licensee_name`, `report_period`, `royalty_rate` to canonical field list |
| Section 5b | Add synonyms for 3 new fields; add conflict-resolution note for `royalty_rate` vs existing `royalty` synonym |
| Section 3b response | Add `upload_warnings: []` to confirm response shape |
| Section 9a TypeScript | Add 3 fields to `LikhaField` union; add `UploadWarning` interface; add `upload_warnings` to confirm response type |
| Section 8c tests | Add 5 new column-mapper test cases for raw preview table |
| Section 8b tests | Add test cases for cross-check warnings (licensee name mismatch, royalty rate mismatch) |
