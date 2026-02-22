# Phase 1.1.1 UX Spec: Column Mapping Improvements

**Created:** 2026-02-22
**Status:** Ready for implementation
**Scope:** Improvements to Step 2 (Map Columns) of the spreadsheet upload wizard
**Base spec:** `work/phase-1.1-ux.md`
**Affected file:** `/frontend/components/sales-upload/column-mapper.tsx`

---

## 1. Summary of Changes

Two problems with the current Step 2:

1. **No data preview during mapping.** The user sees column names like `"Net Sales Amt"` or `"SKU"` but has no visibility into what values are actually in those columns. They must remember what was in the spreadsheet while making decisions.

2. **"Ignore" is all-or-nothing for unrecognized columns.** Columns that do not fit the six Likha fields (net_sales, gross_sales, returns, product_category, licensee_reported_royalty, territory) must be discarded entirely. Any useful metadata — SKU, product name, region code, internal reference number — is thrown away.

This spec adds:

- **Inline sample values** shown beneath each detected column name, drawn from the first 3 `sample_rows` of `UploadPreviewResponse`.
- **A third mapping option — "Keep as metadata"** — which captures arbitrary columns as key-value pairs attached to the sales period. This sits between the six named Likha fields and "Ignore this column" in the dropdown, visually and conceptually.

---

## 2. Data Shape Context

The `UploadPreviewResponse` type already includes `sample_rows: Record<string, string>[]` — an array of up to 5 rows where keys are the original column names and values are cell contents. No backend changes are required for the preview feature.

For the "Keep as metadata" feature, the `ColumnMapping` type and `UploadConfirmRequest` will need to accommodate the new `metadata` field value. See Section 7 for the type changes required.

---

## 3. Feature A: Inline Column Data Preview

### 3.1 What changes

The `MappingRow` sub-component gains a third column: a narrow sample-values strip that shows the first 3 cell values from `sample_rows` for that column. This strip sits to the right of the dropdown on desktop, and below the dropdown on mobile.

The table header grows from 2 columns to 3.

### 3.2 Updated table header

```tsx
{/* Desktop: 3-column header — hidden on mobile */}
<div className="hidden sm:grid sm:grid-cols-[1fr_1fr_160px] bg-gray-50 border-b border-gray-200 px-4 py-2">
  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
    Column in your file
  </span>
  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
    Maps to
  </span>
  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
    Sample values
  </span>
</div>
```

The third column uses a fixed `160px` width. Sample values are short strings — this is enough room for most values without bloating the layout. The outer card can widen slightly: bump the wizard shell from `max-w-3xl` (48rem) to `max-w-4xl` (56rem) when on this step, or keep `max-w-3xl` and let the sample column truncate. Truncation is fine — the point is orientation, not full readability.

### 3.3 Updated MappingRow props

```tsx
interface MappingRowProps {
  detectedColumn: string
  selectedField: LikhaField | 'metadata'   // extended — see Section 5
  onChange: (field: LikhaField | 'metadata') => void
  isLastRow: boolean
  sampleValues: string[]   // NEW — up to 3 values, empty strings allowed
}
```

`sampleValues` is derived in the parent by extracting `sampleRows.slice(0, 3).map(row => row[detectedColumn] ?? '')`.

### 3.4 Updated MappingRow JSX

The row layout changes from `sm:grid-cols-2` to `sm:grid-cols-[1fr_1fr_160px]`. The sample values strip is a new third cell.

```tsx
function MappingRow({ detectedColumn, selectedField, onChange, isLastRow, sampleValues }: MappingRowProps) {
  const isIgnored = selectedField === 'ignore'
  const isMetadata = selectedField === 'metadata'

  return (
    <div
      className={`
        flex flex-col sm:grid sm:grid-cols-[1fr_1fr_160px] items-start sm:items-center
        px-4 py-3 gap-2 sm:gap-4
        ${!isLastRow ? 'border-b border-gray-100' : ''}
        hover:bg-gray-50
      `}
    >
      {/* Col 1: Detected column name */}
      <div className="flex items-center gap-2 min-w-0 w-full">
        <code className="text-sm text-gray-800 font-mono bg-gray-100 px-2 py-0.5 rounded truncate max-w-full">
          {detectedColumn}
        </code>
      </div>

      {/* Col 2: Field dropdown */}
      <div className="w-full">
        <select
          value={selectedField}
          onChange={(e) => onChange(e.target.value as LikhaField | 'metadata')}
          className={`
            w-full px-3 py-2 text-sm border rounded-lg
            focus:ring-2 focus:ring-primary-500 focus:border-transparent
            ${isIgnored
              ? 'border-gray-200 bg-gray-50 text-gray-500'
              : isMetadata
              ? 'border-violet-200 bg-violet-50 text-violet-700'
              : 'border-gray-300 bg-white text-gray-900'
            }
          `}
          aria-label={`Map column "${detectedColumn}" to Likha field`}
        >
          {FIELD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Col 3: Sample values — desktop inline, mobile hidden */}
      <div className="hidden sm:flex flex-col gap-0.5 min-w-0">
        {sampleValues.length === 0 ? (
          <span className="text-xs text-gray-400 italic">no data</span>
        ) : (
          sampleValues.map((val, i) => (
            <span
              key={i}
              className="text-xs text-gray-500 truncate max-w-[152px]"
              title={val}
            >
              {val === '' ? <span className="italic text-gray-400">empty</span> : val}
            </span>
          ))
        )}
      </div>
    </div>
  )
}
```

### 3.5 Sample values — edge cases

| Situation | Display |
|---|---|
| Cell is empty string | Shows `empty` in italic gray (`text-gray-400 italic`) |
| Cell value is very long | Truncated with `truncate max-w-[152px]`; full value in `title` tooltip |
| Column has no data in first 3 rows | Shows `no data` in italic gray |
| All 3 values are identical | Show all 3 — repetition confirms consistency, does not need deduplication |
| Numeric values | Show as-is; no formatting applied at this stage (it is raw spreadsheet text) |

### 3.6 Mobile behavior

On mobile the sample values strip (`hidden sm:flex`) is not shown. The column name and dropdown stack vertically as before. This is acceptable — mobile users are less likely to be doing column mapping tasks on a phone, and the column name itself gives enough orientation. If a user needs to verify data, they can reference their original spreadsheet.

---

## 4. Feature B: "Keep as Metadata" Mapping Option

### 4.1 The problem restated

A licensee spreadsheet often includes columns that are not royalty-calculation inputs but are still worth retaining — SKUs, product names, region codes, internal PO numbers. Under the current design these must be ignored. The data is silently discarded and unavailable if a discrepancy needs to be investigated later.

### 4.2 The solution

Add a new field value `'metadata'` to the mapping options, positioned between the six named Likha fields and "Ignore this column." When a column is mapped to `metadata`, its per-row key-value pairs are captured and stored alongside the sales period as an opaque `metadata` object.

This is audit-friendly: the licensor can see the original data and refer back to it. It does not affect royalty calculations.

### 4.3 Updated FIELD_OPTIONS

```tsx
const FIELD_OPTIONS: { value: LikhaField | 'metadata'; label: string; group?: string }[] = [
  // --- Royalty calculation fields ---
  { value: 'net_sales',                  label: 'Net Sales',                   group: 'Royalty Fields' },
  { value: 'gross_sales',                label: 'Gross Sales',                 group: 'Royalty Fields' },
  { value: 'returns',                    label: 'Returns / Allowances',        group: 'Royalty Fields' },
  { value: 'product_category',           label: 'Product Category',            group: 'Royalty Fields' },
  { value: 'licensee_reported_royalty',  label: 'Licensee Reported Royalty',   group: 'Royalty Fields' },
  { value: 'territory',                  label: 'Territory',                   group: 'Royalty Fields' },
  // --- Capture without calculation ---
  { value: 'metadata',                   label: 'Keep as additional data',     group: 'Other' },
  // --- Discard ---
  { value: 'ignore',                     label: 'Ignore this column',          group: 'Other' },
]
```

Native HTML `<select>` supports `<optgroup>` for grouped options. Use it here to create a visual separator between the royalty fields and the two utility options. This is semantically correct, accessible, and requires no JavaScript.

```tsx
<select
  value={selectedField}
  onChange={(e) => onChange(e.target.value as LikhaField | 'metadata')}
  className={`
    w-full px-3 py-2 text-sm border rounded-lg
    focus:ring-2 focus:ring-primary-500 focus:border-transparent
    ${isIgnored
      ? 'border-gray-200 bg-gray-50 text-gray-500'
      : isMetadata
      ? 'border-violet-200 bg-violet-50 text-violet-700'
      : 'border-gray-300 bg-white text-gray-900'
    }
  `}
  aria-label={`Map column "${detectedColumn}" to Likha field`}
>
  <optgroup label="Royalty Fields">
    <option value="net_sales">Net Sales</option>
    <option value="gross_sales">Gross Sales</option>
    <option value="returns">Returns / Allowances</option>
    <option value="product_category">Product Category</option>
    <option value="licensee_reported_royalty">Licensee Reported Royalty</option>
    <option value="territory">Territory</option>
  </optgroup>
  <optgroup label="Other">
    <option value="metadata">Keep as additional data</option>
    <option value="ignore">Ignore this column</option>
  </optgroup>
</select>
```

### 4.4 Visual treatment for "metadata" state

A column mapped to `metadata` gets a distinct look from both "mapped to a Likha field" (gray-300 border) and "ignored" (gray-200 / bg-gray-50). Use a soft violet treatment — violet is conventionally used for labels and tags in SaaS apps, distinct from the blue primary color and the semantic status colors.

```
Mapped to Likha field:  border-gray-300 bg-white text-gray-900
Mapped to metadata:     border-violet-200 bg-violet-50 text-violet-700
Ignored:                border-gray-200 bg-gray-50 text-gray-500
```

This ensures at a glance the user can see three distinct states across the rows.

### 4.5 Metadata summary callout

When at least one column is mapped to `metadata`, show a contextual callout below the mapping table explaining what will happen to that data. This is a trust-building detail — the user needs to know the data is not lost.

```tsx
{hasMetadataMapped && (
  <div className="flex items-start gap-3 px-4 py-3 bg-violet-50 border border-violet-200
                  rounded-lg mb-6 text-sm text-violet-800">
    <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-violet-600" />
    <span>
      Columns marked "Keep as additional data" will be saved with this sales period.
      They won't affect royalty calculations but will be available for reference.
    </span>
  </div>
)}
```

`Info` is imported from `lucide-react` — it is already in the project's icon set.

`hasMetadataMapped` is derived from the current `mappings` state:

```tsx
const hasMetadataMapped = Object.values(mappings).includes('metadata')
```

### 4.6 Interaction: duplicate-use guard

The six named Likha fields should only map to one column each. If the user selects `net_sales` for a second column, the first column that had `net_sales` should revert to `ignore`. This prevents two columns contributing to the same calculation field.

`metadata` and `ignore` are exempt from this guard — multiple columns can be marked either way.

This is the same deduplication behavior implied (but not explicitly stated) in `phase-1.1-ux.md`. Make it explicit:

```tsx
const handleMappingChange = (column: string, field: LikhaField | 'metadata') => {
  setMappings((prev) => {
    const next = { ...prev }

    // If the field is a unique Likha field (not metadata or ignore),
    // clear any existing column already mapped to that field
    const uniqueFields: Array<LikhaField | 'metadata'> = [
      'net_sales', 'gross_sales', 'returns',
      'product_category', 'licensee_reported_royalty', 'territory',
    ]
    if (uniqueFields.includes(field)) {
      for (const col of Object.keys(next)) {
        if (next[col] === field && col !== column) {
          next[col] = 'ignore'
        }
      }
    }

    next[column] = field
    return next
  })
}
```

When a field is de-duped, no toast or alert is shown — the visual update to the other row's dropdown is feedback enough. Showing an alert here would be disruptive mid-task.

---

## 5. Type Changes Required

### 5.1 `LikhaField` in `/frontend/types/index.ts`

Add `'metadata'` to the union:

```ts
// Before
export type LikhaField =
  | 'net_sales'
  | 'gross_sales'
  | 'returns'
  | 'product_category'
  | 'licensee_reported_royalty'
  | 'territory'
  | 'ignore'

// After
export type LikhaField =
  | 'net_sales'
  | 'gross_sales'
  | 'returns'
  | 'product_category'
  | 'licensee_reported_royalty'
  | 'territory'
  | 'metadata'
  | 'ignore'
```

`ColumnMapping` (`{ [columnName: string]: LikhaField }`) automatically accepts `metadata` once `LikhaField` is extended — no other type changes needed on the frontend.

### 5.2 Backend note

The `column_mapping` field sent in `UploadConfirmRequest` will now contain rows with `"metadata"` as a value. The backend must handle this field value:
- Exclude `metadata`-mapped columns from royalty calculations (treat like `ignore` for calculation purposes)
- Store the original cell values for `metadata`-mapped columns in a `metadata` JSON column on the sales period row

This is a backend concern and is noted here for handoff to the frontend-engineer and backend developer.

---

## 6. Updated Full ColumnMapper Layout

This section shows the complete revised card structure integrating both features.

```
+--------------------------------------------------------------+
| MAP COLUMNS                                                   |
| We detected 6 columns in your file.                          |
| Tell us what each one represents.                            |
+--------------------------------------------------------------+
| [Saved mapping applied banner — conditional]                  |
| [Net Sales required warning — conditional]                    |
+--------------------------------------------------------------+
| Column in your file   | Maps to          | Sample values     |
+--------------------------------------------------------------+
| "Net Sales Amt"       | [Net Sales    v] | 1200.00           |
|                       |                  | 980.50            |
|                       |                  | 1450.00           |
+--                    -+--               -+--                -+
| "Category"            | [Product Cat. v] | Apparel           |
|                       |                  | Footwear          |
|                       |                  | Apparel           |
+--                    -+--               -+--                -+
| "SKU"                 | [Keep as add. v] | SKU-4821          |
|                       | (violet tint)    | SKU-3310          |
|                       |                  | SKU-4821          |
+--                    -+--               -+--                -+
| "Internal Ref"        | [Ignore       v] | REF-001           |
|                       | (muted)          | REF-002           |
|                       |                  | REF-001           |
+--------------------------------------------------------------+
| [i] Columns marked "Keep as additional data" will be saved   |
|     with this period but won't affect royalty calculations.  |
|     (violet callout — shown only when metadata is mapped)    |
+--------------------------------------------------------------+
| [x] Save this mapping for future uploads from Sunrise...     |
+--------------------------------------------------------------+
|          [Back]                         [Continue]           |
+--------------------------------------------------------------+
```

---

## 7. Updated ColumnMapper Props

The component's public interface grows by one prop:

```tsx
export interface ColumnMapperProps {
  detectedColumns: string[]
  suggestedMapping: ColumnMapping
  mappingSource: MappingSource
  licenseeName: string
  sampleRows: Record<string, string>[]   // NEW — passed from UploadPreviewResponse
  onMappingConfirm: (result: { mapping: ColumnMapping; saveMapping: boolean }) => void
  onBack: () => void
}
```

In `page.tsx`, pass `uploadPreview.sample_rows` as the `sampleRows` prop when rendering `<ColumnMapper />`.

---

## 8. Revised Wizard Page Shell Width

The mapping step now has three columns. On `max-w-3xl` (48rem) with padding, the sample values column gets squeezed. Two options:

**Option A (recommended): Widen the shell only for step 2.**

```tsx
<div className={`
  mx-auto px-4 sm:px-6 lg:px-8 py-8
  ${step === 2 ? 'max-w-4xl' : 'max-w-3xl'}
`}>
```

`max-w-4xl` is 56rem. This gives the mapping table enough room for comfortable three-column layout without making the upload and preview steps feel too wide.

**Option B: Keep `max-w-3xl` throughout.**

The sample column truncates at `max-w-[152px]` with a `title` tooltip for full values. This is acceptable — the sample is a hint, not primary content. Choose this option if the width change feels jarring.

The spec uses Option A as the default.

---

## 9. Accessibility Notes

- The `<optgroup>` elements in the select use native `label` attributes — these are announced by screen readers as group names.
- The `metadata` state's violet color passes WCAG AA contrast against the `bg-violet-50` background (`text-violet-700` on `bg-violet-50` = 4.6:1 contrast ratio — passing).
- The metadata callout uses `role` implied by its semantic `<div>` content. No `role="status"` needed since it is not a live region — it appears in the normal document flow when the mapping state changes.
- Sample values cells with `title` tooltips are hover-only. Screen reader users get the truncated text; the full value is accessible through the dropdown's `aria-label` which names the column. This is acceptable since sample values are orientation aids, not interactive elements.
- The deduplication behavior (clearing a prior field assignment) causes a visual update to another dropdown. This is a DOM mutation that screen readers may not announce. Add an `aria-live="polite"` region outside the table that describes the last deduplication action, e.g. "Net Sales reassigned from 'Revenue' to 'Ignore'." Only trigger this when a deduplication actually occurs (not on every mapping change).

```tsx
{/* Deduplication announcement — visually hidden, screen-reader only */}
{dedupMessage && (
  <div role="status" aria-live="polite" className="sr-only">
    {dedupMessage}
  </div>
)}
```

`dedupMessage` is a `useState<string>` that is set to the deduplication message inside `handleMappingChange` when a prior column is cleared, and reset to `''` after a short timeout (`setTimeout(() => setDedupMessage(''), 1000)`).

---

## 10. Component File Changes Summary

| File | Change |
|---|---|
| `/frontend/components/sales-upload/column-mapper.tsx` | Add `sampleRows` prop, update `MappingRow` with sample values strip and `metadata` field option, add `hasMetadataMapped` callout, add deduplication logic and aria-live region |
| `/frontend/types/index.ts` | Add `'metadata'` to `LikhaField` union |
| `/frontend/app/(app)/sales/upload/page.tsx` | Pass `uploadPreview.sample_rows` as `sampleRows` prop to `<ColumnMapper />`; update `max-w-3xl` to conditional `max-w-4xl` on step 2; update `mappedHeaders` derivation to include columns mapped as `'metadata'` with appropriate label |

No changes to `upload-preview.tsx`, `step-confirm.tsx`, or any other file in the wizard.

---

## 11. What "Ignore" Still Means

After these changes, `ignore` is still the right choice for columns the user actively does not want. The three options now form a clear mental model:

| Option | Meaning | Effect |
|---|---|---|
| Named Likha field | This column feeds into royalty calculation | Processed, stored in typed columns |
| Keep as additional data | Useful context, not a calculation input | Stored as metadata key-value pairs |
| Ignore this column | Not needed at all | Discarded, not stored |

This progression — from "this computes royalties" to "this is context" to "this is noise" — follows a natural decision hierarchy. Users are no longer forced into a binary of "map it" or "lose it."
