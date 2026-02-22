# Phase 1.1 UX Specification: Spreadsheet Upload with Column Mapping

**Created:** 2026-02-22
**Status:** Ready for implementation
**Feature:** 4-step wizard to upload licensee Excel/CSV reports, map columns, preview data, and create a sales period.
**Route:** `/app/(app)/sales/upload/page.tsx?contract_id=[id]`
**Related plan:** `work/plan.md` — Phase 1.1 section
**Related PRD:** `docs/product/prd/royalty-report/prd-royalty-tracking.md` — Phase 1.1 section

---

## 1. Flow Overview

The wizard is a single-page linear flow. Steps are shown in a progress indicator at the top. Users cannot skip forward but can go back to earlier steps.

```
[1. Upload File] → [2. Map Columns] → [3. Preview Data] → [4. Confirm]
```

State lives in the parent page component and is passed down as props. No separate route per step — URL stays `/sales/upload?contract_id=[id]` throughout. The step state can be stored in `useState<1 | 2 | 3 | 4>`.

**Data flow summary:**

- Step 1: User picks file. Client sends `POST /api/sales/upload/{contract_id}` (multipart: file + period_start + period_end). Response contains `detected_columns`, `preview_rows` (up to 5), `suggested_mappings`, `total_rows`.
- Step 2: User adjusts column mapping. `suggested_mappings` are pre-filled.
- Step 3: Client renders `preview_rows` re-labeled with mapped headers. Calculated royalty is shown (computed client-side or fetched).
- Step 4: User clicks Confirm. Client sends `POST /api/sales/upload/{contract_id}/confirm`. On success, redirect to `/contracts/[id]`.

---

## 2. Entry Point: "Upload Report" Button on Contract Detail Page

### Placement

In `/frontend/app/(app)/contracts/[id]/page.tsx`, the "Sales Periods" section header currently has no action button. Add an "Upload Report" button to the right side of that section header — the same pattern used in the card header area at line 350–356 of the existing file.

```tsx
{/* Sales Periods Section */}
<div className="card mt-6 animate-fade-in">
  <div className="flex items-center justify-between mb-6">
    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
      <BarChart3 className="w-5 h-5" />
      Sales Periods
    </h2>
    {/* Only show for active contracts */}
    {contract.status === 'active' && (
      <Link
        href={`/sales/upload?contract_id=${contract.id}`}
        className="btn-primary flex items-center gap-2 text-sm"
      >
        <Upload className="w-4 h-4" />
        Upload Report
      </Link>
    )}
  </div>
  {/* ... rest of section */}
```

The `Upload` icon is already imported in the contract detail page (line 21).

### Empty State Update

The existing empty state (lines 357–364) should gain a direct CTA that links to the upload wizard. Replace the current empty state block:

```tsx
{salesPeriods.length === 0 ? (
  <div className="text-center py-12 bg-gray-50 rounded-lg">
    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
    <h3 className="text-lg font-medium text-gray-900 mb-1">No sales periods yet</h3>
    <p className="text-sm text-gray-600 mb-4">
      Upload a licensee sales report to calculate and verify royalties automatically.
    </p>
    {contract.status === 'active' && (
      <Link
        href={`/sales/upload?contract_id=${contract.id}`}
        className="btn-primary inline-flex items-center gap-2"
      >
        <Upload className="w-4 h-4" />
        Upload Your First Report
      </Link>
    )}
  </div>
) : (
```

### Visual result (entry point)

The button sits at the top-right of the Sales Periods card, aligned with the section heading. On mobile it stacks below the heading (see section 10 for responsive detail).

---

## 3. Wizard Page Shell: `/frontend/app/(app)/sales/upload/page.tsx`

The page handles routing to the correct step, holding all wizard state, and error recovery.

### Page-level structure

```tsx
<div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  {/* Breadcrumb */}
  <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
    <Link href="/dashboard">Dashboard</Link>
    <span>/</span>
    <Link href={`/contracts/${contractId}`}>{contractName}</Link>
    <span>/</span>
    <span className="text-gray-900 font-medium">Upload Report</span>
  </div>

  {/* Page title */}
  <h1 className="text-2xl font-bold text-gray-900 mb-2">Upload Sales Report</h1>
  <p className="text-gray-600 mb-8">
    Upload a spreadsheet from {contractName} to calculate and verify royalties.
  </p>

  {/* Step indicator */}
  <StepIndicator currentStep={step} />

  {/* Step content */}
  <div className="mt-8">
    {step === 1 && <StepUpload ... />}
    {step === 2 && <StepMapColumns ... />}
    {step === 3 && <StepPreview ... />}
    {step === 4 && <StepConfirm ... />}
  </div>
</div>
```

Max width is `max-w-3xl` (narrower than the contracts page `max-w-7xl`) because this is a focused task flow. Keeping it narrow reduces visual noise and keeps the user's eye on the wizard.

### Step indicator component

```tsx
// StepIndicator — horizontal steps with connector lines
// Props: currentStep: 1 | 2 | 3 | 4

const steps = [
  { number: 1, label: 'Upload File' },
  { number: 2, label: 'Map Columns' },
  { number: 3, label: 'Preview Data' },
  { number: 4, label: 'Confirm' },
]

<nav aria-label="Upload progress" className="mb-8">
  <ol className="flex items-center">
    {steps.map((s, i) => (
      <li key={s.number} className="flex items-center flex-1 last:flex-none">
        {/* Step circle */}
        <div className="flex flex-col items-center">
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
            ${s.number < currentStep
              ? 'bg-primary-600 text-white'           // completed
              : s.number === currentStep
              ? 'bg-primary-600 text-white ring-2 ring-primary-200 ring-offset-2'  // active
              : 'bg-gray-200 text-gray-500'           // upcoming
            }
          `}>
            {s.number < currentStep
              ? <Check className="w-4 h-4" />
              : s.number}
          </div>
          <span className={`
            mt-1.5 text-xs font-medium hidden sm:block
            ${s.number === currentStep ? 'text-primary-600' : 'text-gray-500'}
          `}>
            {s.label}
          </span>
        </div>

        {/* Connector line — not after last step */}
        {i < steps.length - 1 && (
          <div className={`
            flex-1 h-0.5 mx-2 mb-5
            ${s.number < currentStep ? 'bg-primary-600' : 'bg-gray-200'}
          `} />
        )}
      </li>
    ))}
  </ol>
</nav>
```

On mobile, step labels are hidden (`hidden sm:block`). Only the numbered circles and connector lines show. The active step circle gets `ring-2 ring-primary-200 ring-offset-2` for clear focus indication.

---

## 4. Step 1: File Upload

**Component:** Inline in `StepUpload` — reuses the same visual pattern as `contract-upload.tsx`.

### Period date fields

Before the drag zone, show two required date inputs for the reporting period. The dates must be entered before the file is sent because the API requires them.

```tsx
<div className="card mb-6">
  <h2 className="text-lg font-semibold text-gray-900 mb-4">Reporting Period</h2>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label htmlFor="period_start" className="block text-sm font-medium text-gray-700 mb-2">
        Period Start <span className="text-red-500">*</span>
      </label>
      <input
        id="period_start"
        type="date"
        required
        className="input"
        value={periodStart}
        onChange={(e) => setPeriodStart(e.target.value)}
      />
    </div>
    <div>
      <label htmlFor="period_end" className="block text-sm font-medium text-gray-700 mb-2">
        Period End <span className="text-red-500">*</span>
      </label>
      <input
        id="period_end"
        type="date"
        required
        className="input"
        value={periodEnd}
        onChange={(e) => setPeriodEnd(e.target.value)}
      />
    </div>
  </div>
</div>
```

### Drag-and-drop file zone

Direct reuse of the `contract-upload.tsx` visual pattern with two changes: accept `.xlsx,.xls,.csv` instead of `.pdf`, and the action button label changes from "Upload & Extract" to "Upload & Parse".

```tsx
// Validation function (replace validateFile in contract-upload.tsx pattern)
export function validateSpreadsheetFile(file: File): string | null {
  const ALLOWED_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel',                                           // .xls
    'text/csv',
    'application/csv',
  ]
  const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv']
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()

  if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
    return 'Please upload an Excel (.xlsx, .xls) or CSV file'
  }
  if (file.size > 10 * 1024 * 1024) {
    return 'File size must be less than 10MB'
  }
  return null
}
```

File zone JSX (matches contract-upload.tsx structure exactly):

```tsx
<div
  className={`
    relative border-2 border-dashed rounded-xl p-12 text-center transition-colors duration-300
    ${dragActive
      ? 'border-primary-500 bg-primary-50'
      : validationError
      ? 'border-red-300 bg-red-50'
      : 'border-gray-300 hover:border-gray-400'
    }
  `}
  onDragEnter={handleDrag}
  onDragLeave={handleDrag}
  onDragOver={handleDrag}
  onDrop={handleDrop}
>
  {/* Empty state */}
  <label className="cursor-pointer w-full flex flex-col items-center">
    <input
      type="file"
      accept=".xlsx,.xls,.csv"
      onChange={handleInputChange}
      className="hidden"
      data-testid="spreadsheet-file-input"
    />
    <Upload className="w-16 h-16 text-gray-400 mb-4" />
    <p className="text-lg font-medium text-gray-900 mb-2">
      Drop your spreadsheet here or click to browse
    </p>
    <p className="text-sm text-gray-500">Excel (.xlsx, .xls) or CSV — max 10MB</p>
  </label>
```

File-selected state (same structure as contract-upload.tsx):

```tsx
  {/* File selected */}
  <>
    <FileText className="w-16 h-16 text-primary-600 mb-4" />
    <p className="text-lg font-medium text-gray-900 mb-1">{file.name}</p>
    <p className="text-sm text-gray-500 mb-6">
      {(file.size / 1024 / 1024).toFixed(2)} MB
    </p>
    <div className="flex items-center gap-3 justify-center">
      <button
        onClick={handleUploadClick}
        disabled={uploading || !periodStart || !periodEnd}
        className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {uploading
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
          : <><Upload className="w-4 h-4" /> Upload &amp; Parse</>
        }
      </button>
      <label className="cursor-pointer">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleInputChange} className="hidden" />
        <span className="btn-secondary text-sm">Change file</span>
      </label>
    </div>
    {(!periodStart || !periodEnd) && (
      <p className="mt-3 text-xs text-amber-600">
        Enter the reporting period dates above before uploading.
      </p>
    )}
  </>
```

### Step 1 error states

| Error | Display |
|---|---|
| Unsupported file type | Red border on drop zone, icon turns red, message: "Please upload an Excel (.xlsx, .xls) or CSV file" |
| File exceeds 10MB | Same treatment: "File size must be less than 10MB" |
| Period dates missing | Amber helper text below button: "Enter the reporting period dates above before uploading." Button is disabled (`disabled` prop). |
| API parse failure | Full-width error banner below the drop zone (see Section 8 for error banner component) |
| Empty file / no rows detected | API returns error; show inline banner: "This file appears to be empty. Please check the file and try again." |
| No mappable columns found | API returns error; show inline banner: "No column headers were detected. The file may use an unsupported format." — with a "Try a different file" link that resets to Step 1. |

---

## 5. Step 2: Column Mapping

**Component file:** `/frontend/components/sales-upload/column-mapper.tsx`

This is the most complex step. It presents one row per detected column from the uploaded file. The user assigns each column to a Likha field using a dropdown.

### Visual structure

The column mapper is a table. On desktop it is a two-column table. On mobile it stacks vertically (see Section 10).

```
+--------------------------------------------------+
| COLUMN MAPPING                                    |
| Map columns from your file to Likha fields.       |
| Required: Net Sales must be mapped.               |
+--------------------------------------------------+
| Detected column          | Maps to               |
+--------------------------------------------------+
| "Net Sales Amt"          | [Net Sales      v]  * |
| "Category"               | [Product Category v]  |
| "Returns & Allow."       | [Returns/Allowances v] |
| "Calculated Royalty"     | [Licensee Reported v]  |
| "SKU"                    | [Ignore         v]    |
| "Product Description"    | [Ignore         v]    |
+--------------------------------------------------+
| [x] Save this mapping for future uploads          |
|     from Sunrise Apparel                          |
+--------------------------------------------------+
|          [Back]             [Continue]            |
+--------------------------------------------------+
```

### Column mapper JSX structure

```tsx
<div className="card">
  <div className="mb-6">
    <h2 className="text-lg font-semibold text-gray-900 mb-1">Map Columns</h2>
    <p className="text-sm text-gray-600">
      We detected {detectedColumns.length} columns in your file.
      Tell us what each one represents.
    </p>
  </div>

  {/* Required field notice */}
  {!hasNetSalesMapped && (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-sm text-amber-700">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      Net Sales must be mapped to continue.
    </div>
  )}

  {/* Mapping table */}
  <div className="border border-gray-200 rounded-lg overflow-hidden mb-6">
    {/* Table header */}
    <div className="grid grid-cols-2 bg-gray-50 border-b border-gray-200 px-4 py-2">
      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        Column in your file
      </span>
      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        Maps to
      </span>
    </div>

    {/* Mapping rows */}
    {detectedColumns.map((col, index) => (
      <MappingRow
        key={col}
        detectedColumn={col}
        selectedField={mappings[col] ?? 'ignore'}
        onChange={(field) => handleMappingChange(col, field)}
        isRequired={col === requiredAutoMatch}
        isLastRow={index === detectedColumns.length - 1}
      />
    ))}
  </div>

  {/* Save mapping checkbox */}
  <label className="flex items-start gap-3 cursor-pointer mb-6">
    <input
      type="checkbox"
      checked={saveMapping}
      onChange={(e) => setSaveMapping(e.target.checked)}
      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600
                 focus:ring-primary-500 focus:ring-offset-0"
    />
    <div>
      <span className="text-sm font-medium text-gray-900">
        Save this mapping for future uploads
      </span>
      <p className="text-xs text-gray-500 mt-0.5">
        Next time you upload a report from {licenseeName}, these column assignments
        will be applied automatically.
      </p>
    </div>
  </label>

  {/* Navigation */}
  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
    <button onClick={onBack} className="btn-secondary flex items-center gap-2">
      <ArrowLeft className="w-4 h-4" />
      Back
    </button>
    <button
      onClick={onContinue}
      disabled={!hasNetSalesMapped}
      className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Continue
      <ArrowRight className="w-4 h-4" />
    </button>
  </div>
</div>
```

### MappingRow sub-component

```tsx
// Individual row in the column mapper table

function MappingRow({ detectedColumn, selectedField, onChange, isRequired, isLastRow }) {
  const isUnmappedRequired = isRequired && selectedField === 'ignore'

  return (
    <div className={`
      grid grid-cols-2 items-center px-4 py-3 gap-4
      ${!isLastRow ? 'border-b border-gray-100' : ''}
      ${isUnmappedRequired ? 'bg-amber-50' : 'hover:bg-gray-50'}
    `}>
      {/* Detected column name */}
      <div className="flex items-center gap-2 min-w-0">
        <code className="text-sm text-gray-800 font-mono bg-gray-100 px-2 py-0.5 rounded truncate">
          {detectedColumn}
        </code>
        {isRequired && (
          <span className="flex-shrink-0 text-xs font-medium text-red-600">required</span>
        )}
      </div>

      {/* Field dropdown */}
      <div>
        <select
          value={selectedField}
          onChange={(e) => onChange(e.target.value)}
          className={`
            w-full px-3 py-2 text-sm border rounded-lg
            focus:ring-2 focus:ring-primary-500 focus:border-transparent
            ${isUnmappedRequired
              ? 'border-amber-400 bg-white'
              : selectedField === 'ignore'
              ? 'border-gray-200 bg-gray-50 text-gray-500'
              : 'border-gray-300 bg-white text-gray-900'
            }
          `}
          aria-label={`Map column "${detectedColumn}" to Likha field`}
        >
          <option value="net_sales">Net Sales</option>
          <option value="gross_sales">Gross Sales</option>
          <option value="returns">Returns / Allowances</option>
          <option value="product_category">Product Category</option>
          <option value="licensee_reported_royalty">Licensee Reported Royalty</option>
          <option value="territory">Territory</option>
          <option value="ignore">Ignore this column</option>
        </select>
      </div>
    </div>
  )
}
```

### Auto-match behavior

When the API response includes `suggested_mappings` (a dict of `{detected_column: likha_field}`), these are pre-applied to the local `mappings` state before the step renders. The user sees the suggestions already filled in and can override any of them. There is no visual badge distinguishing "auto-suggested" vs "user-set" — this reduces cognitive load. The save-mapping checkbox explains the source of truth.

### Saved mapping banner

If the API indicates a saved mapping was applied (from a previous upload by this licensee), show a confirmation banner at the top of the step:

```tsx
{savedMappingApplied && (
  <div className="flex items-center gap-3 px-4 py-3 bg-primary-50 border border-primary-200
                  rounded-lg mb-6 text-sm text-primary-700">
    <CheckCircle className="w-4 h-4 flex-shrink-0 text-primary-600" />
    <span>
      We applied the saved column mapping from your last upload for {licenseeName}.
      Adjust if anything has changed.
    </span>
  </div>
)}
```

---

## 6. Step 3: Data Preview

**Component file:** `/frontend/components/sales-upload/upload-preview.tsx`

Shows the first 3–5 rows of parsed data re-labeled with the user's column mappings, aggregated totals, and the calculated royalty.

### Structure

```tsx
<div className="space-y-6">
  {/* Preview table card */}
  <div className="card">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-gray-900">Preview</h2>
      <span className="text-sm text-gray-500">{totalRows} rows total</span>
    </div>

    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {mappedHeaders.map((header) => (
              <th key={header.field} className="text-left py-2 px-3 text-xs font-semibold
                                                text-gray-600 uppercase tracking-wide whitespace-nowrap">
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {previewRows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {mappedHeaders.map((header) => (
                <td key={header.field}
                    className={`py-2 px-3 ${
                      validationIssues[i]?.[header.field]
                        ? 'text-red-600 font-medium'
                        : 'text-gray-900'
                    }`}>
                  <span className={validationIssues[i]?.[header.field]
                    ? 'flex items-center gap-1'
                    : ''}>
                    {row[header.field] ?? '—'}
                    {validationIssues[i]?.[header.field] && (
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0"
                                   title={validationIssues[i][header.field]} />
                    )}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {totalRows > 5 && (
      <p className="mt-3 text-xs text-gray-500 text-center">
        Showing 5 of {totalRows} rows. All rows will be included.
      </p>
    )}
  </div>

  {/* Aggregated totals card */}
  <div className="card">
    <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
      Aggregated Totals
    </h3>

    {/* Category breakdown — shown when product_category is mapped */}
    {categoryTotals && Object.keys(categoryTotals).length > 0 && (
      <div className="mb-4 space-y-2">
        {Object.entries(categoryTotals).map(([cat, amount]) => (
          <div key={cat} className="flex justify-between text-sm">
            <span className="text-gray-600">{cat}</span>
            <span className="font-medium text-gray-900 tabular-nums">
              {formatCurrency(amount)}
            </span>
          </div>
        ))}
        <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-semibold">
          <span className="text-gray-900">Total Net Sales</span>
          <span className="text-gray-900 tabular-nums">{formatCurrency(totalNetSales)}</span>
        </div>
      </div>
    )}

    {/* No category breakdown */}
    {!categoryTotals && (
      <div className="flex justify-between text-sm mb-4">
        <span className="text-gray-600">Total Net Sales</span>
        <span className="font-semibold text-gray-900 tabular-nums">
          {formatCurrency(totalNetSales)}
        </span>
      </div>
    )}
  </div>

  {/* Royalty calculation card */}
  <div className="card bg-primary-50 border border-primary-100">
    <h3 className="text-sm font-semibold text-primary-800 mb-3 uppercase tracking-wide">
      Royalty Calculation
    </h3>
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-primary-700">Net Sales</span>
        <span className="font-medium text-primary-900 tabular-nums">
          {formatCurrency(totalNetSales)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-primary-700">System Calculated Royalty</span>
        <span className="text-2xl font-bold text-primary-700 tabular-nums">
          {formatCurrency(calculatedRoyalty)}
        </span>
      </div>

      {/* Discrepancy — shown when licensee_reported_royalty is mapped and present */}
      {licenseeReportedRoyalty !== null && (
        <>
          <div className="flex justify-between text-sm pt-2 border-t border-primary-200">
            <span className="text-primary-700">Licensee Reported</span>
            <span className="font-medium text-primary-900 tabular-nums">
              {formatCurrency(licenseeReportedRoyalty)}
            </span>
          </div>
          {discrepancyAmount !== 0 && (
            <div className={`
              flex items-start gap-2 px-3 py-2 rounded-lg text-sm mt-2
              ${discrepancyAmount > 0
                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                : 'bg-primary-100 border border-primary-200 text-primary-800'
              }
            `}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {discrepancyAmount > 0
                  ? `Licensee under-reported by ${formatCurrency(discrepancyAmount)} — they may owe more.`
                  : `Licensee over-reported by ${formatCurrency(Math.abs(discrepancyAmount))}.`
                }
              </span>
            </div>
          )}
        </>
      )}
    </div>
  </div>

  {/* Validation issues summary */}
  {hasValidationIssues && (
    <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-red-900">Some rows have issues</p>
        <p className="text-sm text-red-700 mt-0.5">
          Non-numeric values in the Net Sales column were found and will be skipped.
          Review the highlighted cells above.
        </p>
        <button onClick={onEditMapping} className="mt-2 text-sm font-medium text-red-600
                                                    hover:text-red-700 underline">
          Edit column mapping
        </button>
      </div>
    </div>
  )}

  {/* Navigation */}
  <div className="flex items-center justify-between pt-2">
    <button onClick={onBack} className="btn-secondary flex items-center gap-2">
      <ArrowLeft className="w-4 h-4" />
      Edit Mapping
    </button>
    <button onClick={onContinue} className="btn-primary flex items-center gap-2">
      Continue
      <ArrowRight className="w-4 h-4" />
    </button>
  </div>
</div>
```

### Validation highlighting rules

| Cell state | Classes |
|---|---|
| Valid | `text-gray-900` |
| Non-numeric in a numeric column | `text-red-600 font-medium` + inline `AlertCircle` icon |
| Empty in Net Sales | `text-red-600 italic` — shows "—" in red |

---

## 7. Step 4: Confirm

A concise summary of what will be created. No form fields — just a read-only review with two buttons.

```tsx
<div className="card">
  <h2 className="text-lg font-semibold text-gray-900 mb-6">Confirm Sales Period</h2>

  {/* Summary list */}
  <dl className="space-y-4">
    <div className="flex justify-between py-3 border-b border-gray-100">
      <dt className="text-sm text-gray-600">Licensee</dt>
      <dd className="text-sm font-medium text-gray-900">{licenseeName}</dd>
    </div>
    <div className="flex justify-between py-3 border-b border-gray-100">
      <dt className="text-sm text-gray-600">Reporting Period</dt>
      <dd className="text-sm font-medium text-gray-900">
        {formatDate(periodStart)} – {formatDate(periodEnd)}
      </dd>
    </div>
    <div className="flex justify-between py-3 border-b border-gray-100">
      <dt className="text-sm text-gray-600">Total Net Sales</dt>
      <dd className="text-sm font-semibold text-gray-900 tabular-nums">
        {formatCurrency(totalNetSales)}
      </dd>
    </div>

    {/* Category breakdown — conditional */}
    {categoryTotals && Object.keys(categoryTotals).length > 0 && (
      <div className="py-3 border-b border-gray-100">
        <dt className="text-sm text-gray-600 mb-2">By Category</dt>
        {Object.entries(categoryTotals).map(([cat, amt]) => (
          <dd key={cat} className="flex justify-between text-sm text-gray-700 mb-1">
            <span className="ml-3">{cat}</span>
            <span className="tabular-nums">{formatCurrency(amt)}</span>
          </dd>
        ))}
      </div>
    )}

    <div className="flex justify-between py-3 border-b border-gray-100">
      <dt className="text-sm text-gray-600">Calculated Royalty</dt>
      <dd className="text-base font-bold text-primary-600 tabular-nums">
        {formatCurrency(calculatedRoyalty)}
      </dd>
    </div>

    {/* Licensee reported — conditional */}
    {licenseeReportedRoyalty !== null && (
      <div className="flex justify-between py-3 border-b border-gray-100">
        <dt className="text-sm text-gray-600">Licensee Reported</dt>
        <dd className="text-sm font-medium text-gray-900 tabular-nums">
          {formatCurrency(licenseeReportedRoyalty)}
        </dd>
      </div>
    )}

    {/* Discrepancy — conditional */}
    {discrepancyAmount !== null && Math.abs(discrepancyAmount) > 0.01 && (
      <div className={`
        flex justify-between py-3 border-b border-gray-100
        ${discrepancyAmount > 0 ? 'text-amber-700' : 'text-primary-700'}
      `}>
        <dt className="text-sm">Discrepancy</dt>
        <dd className="text-sm font-semibold tabular-nums">
          {discrepancyAmount > 0 ? '+' : ''}{formatCurrency(discrepancyAmount)}
        </dd>
      </div>
    )}

    <div className="flex justify-between py-3 border-b border-gray-100">
      <dt className="text-sm text-gray-600">Rows Processed</dt>
      <dd className="text-sm font-medium text-gray-900">{totalRows}</dd>
    </div>

    {saveMappingEnabled && (
      <div className="flex items-center gap-2 py-3">
        <CheckCircle className="w-4 h-4 text-green-600" />
        <dt className="text-sm text-gray-600">
          Column mapping will be saved for future uploads from {licenseeName}
        </dt>
      </div>
    )}
  </dl>

  {/* Actions */}
  <div className="flex items-center justify-between pt-6 mt-2 border-t border-gray-100">
    <button
      onClick={onBack}
      disabled={confirming}
      className="btn-secondary flex items-center gap-2 disabled:opacity-50"
    >
      <ArrowLeft className="w-4 h-4" />
      Back
    </button>
    <button
      onClick={onConfirm}
      disabled={confirming}
      className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {confirming
        ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating period...</>
        : <><CheckCircle className="w-4 h-4" /> Confirm &amp; Create Period</>
      }
    </button>
  </div>
</div>
```

---

## 8. Success State

On successful confirm (API returns 200 with `SalesPeriodResponse`):

1. **Redirect** to `/contracts/[id]` — the contract detail page.
2. **Toast notification** — a transient success banner appears at the top of the contract detail page. The banner uses a `?success=period_created` query param or client-side state passed via the router. The contract detail page checks for this on mount and renders the toast.

Toast component (to be added to the app, reusable):

```tsx
// Positioned fixed, top-right, auto-dismisses after 5 seconds
<div
  role="status"
  aria-live="polite"
  className="fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3
             bg-white border border-green-200 rounded-lg shadow-lg
             animate-slide-up max-w-sm"
>
  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
    <CheckCircle className="w-4 h-4 text-green-600" />
  </div>
  <div>
    <p className="text-sm font-semibold text-gray-900">Sales period created</p>
    <p className="text-xs text-gray-500 mt-0.5">
      {formatDate(periodStart)} – {formatDate(periodEnd)} added successfully.
    </p>
  </div>
  <button
    onClick={onDismiss}
    className="ml-2 text-gray-400 hover:text-gray-600 flex-shrink-0"
    aria-label="Dismiss"
  >
    <X className="w-4 h-4" />
  </button>
</div>
```

The new sales period row should appear at the top of the sales history table. No page reload is required — the contract detail page re-fetches `getSalesPeriods` on mount.

---

## 9. Error States

All errors use the same inline banner component:

```tsx
// Reusable error banner — place above the active step content
function ErrorBanner({ title, message, onRetry }: {
  title: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200
                 rounded-lg mb-6 animate-fade-in"
    >
      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-900">{title}</p>
        <p className="text-sm text-red-700 mt-0.5">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 text-sm font-medium text-red-600 hover:text-red-700 underline"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
```

### Error catalog

| Trigger | Title | Message | Action |
|---|---|---|---|
| Unsupported file type | "Unsupported file type" | "Only Excel (.xlsx, .xls) and CSV files can be uploaded." | Drop zone resets; user re-selects file |
| File exceeds 10MB | "File too large" | "Please upload a file under 10MB." | Same |
| API returns 400 on upload | "Could not parse this file" | The API error message, or fallback: "The file could not be read. It may be corrupted or use an unsupported format." | "Try a different file" button resets to Step 1 |
| Empty file / zero rows | "This file is empty" | "No data rows were found. Check that the file contains a header row and at least one data row." | Reset to Step 1 |
| No columns map to Likha fields | "No recognizable columns found" | "None of the column headers could be matched to Likha fields. Try uploading a file that includes a Net Sales column." | Reset to Step 1 |
| Step 2: Net Sales not mapped, user attempts to proceed | Amber inline notice (not full error banner) | "Net Sales must be mapped to continue." | Continue button disabled |
| Step 4: Confirm API failure | "Could not create sales period" | "Something went wrong saving the period. Your mapping has been preserved — please try again." | "Try again" button re-submits the confirm request without losing wizard state |
| Auth error / session expired | "Session expired" | "Please log in again to continue." | Redirect to `/login` |

---

## 10. Tailwind Classes Reference

These classes are used throughout the wizard. All are consistent with the existing design system.

### Reused from globals.css

| Token | Classes |
|---|---|
| `.card` | `bg-white rounded-xl shadow-card p-6` |
| `.btn-primary` | `px-4 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors` |
| `.btn-secondary` | `px-4 py-2 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors` |
| `.input` | `w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors` |
| `.badge-warning` | `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700` |

### New patterns specific to this wizard

| Element | Classes |
|---|---|
| Step indicator — active circle | `w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-semibold ring-2 ring-primary-200 ring-offset-2` |
| Step indicator — completed circle | `w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center` |
| Step indicator — upcoming circle | `w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-semibold` |
| Step connector — completed | `flex-1 h-0.5 mx-2 mb-5 bg-primary-600` |
| Step connector — upcoming | `flex-1 h-0.5 mx-2 mb-5 bg-gray-200` |
| Drag-and-drop zone — default | `border-2 border-dashed border-gray-300 rounded-xl p-12 text-center transition-colors duration-300 hover:border-gray-400` |
| Drag-and-drop zone — active | `border-primary-500 bg-primary-50` (appended to above) |
| Drag-and-drop zone — error | `border-red-300 bg-red-50` (appended to above) |
| Mapping row — default | `grid grid-cols-2 items-center px-4 py-3 gap-4 border-b border-gray-100 hover:bg-gray-50` |
| Mapping row — required + unmapped | `bg-amber-50` (replaces hover:bg-gray-50) |
| Detected column code pill | `text-sm text-gray-800 font-mono bg-gray-100 px-2 py-0.5 rounded truncate` |
| Field dropdown — mapped | `border-gray-300 bg-white text-gray-900` |
| Field dropdown — ignored | `border-gray-200 bg-gray-50 text-gray-500` |
| Field dropdown — required + unmapped | `border-amber-400 bg-white` |
| Royalty result card | `card bg-primary-50 border border-primary-100` |
| Discrepancy — under-reported | `bg-amber-50 border border-amber-200 text-amber-800` |
| Discrepancy — over-reported | `bg-primary-100 border border-primary-200 text-primary-800` |
| Preview table header | `text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap` |
| Confirm summary row | `flex justify-between py-3 border-b border-gray-100` |
| Financial figures (all) | `tabular-nums` (ensures numbers align in columns) |
| Toast — success | `fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-white border border-green-200 rounded-lg shadow-lg animate-slide-up max-w-sm` |

---

## 11. Responsive Behavior

The wizard uses `max-w-3xl` which is 48rem. On screens below this width (mobile), some layout changes apply.

### Step indicator (mobile)

Step labels (`text-xs font-medium`) are hidden with `hidden sm:block`. Only circles and connector lines show. On very small screens (320px) the circles compress naturally. The connector lines use `flex-1` so they fill available space.

### Period date fields (Step 1)

The two-column date grid (`grid grid-cols-2 gap-4`) stays two columns on mobile because each input is short. No change needed.

### File drop zone (Step 1)

The zone is full width. On mobile the `p-12` padding may be reduced to `p-8` with a `sm:p-12` breakpoint to avoid excessive vertical height on small screens:

```tsx
className="relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center ..."
```

### Column mapper (Step 2)

On desktop the mapper is a two-column grid (`grid grid-cols-2`). On mobile below `sm` (640px), each row stacks vertically instead:

```tsx
// MappingRow — responsive grid
<div className="flex flex-col sm:grid sm:grid-cols-2 items-start sm:items-center
                px-4 py-3 gap-2 sm:gap-4 ...">
  {/* Detected column */}
  <div className="flex items-center gap-2 min-w-0 w-full">
    <code className="text-sm text-gray-800 font-mono bg-gray-100 px-2 py-0.5 rounded
                     truncate max-w-full">
      {detectedColumn}
    </code>
    {isRequired && (
      <span className="flex-shrink-0 text-xs font-medium text-red-600">required</span>
    )}
  </div>
  {/* Dropdown — full width on mobile */}
  <div className="w-full">
    <select className="w-full ..." ... />
  </div>
</div>
```

The table header row (`grid grid-cols-2 bg-gray-50`) also becomes `hidden sm:grid` so the mobile view does not show orphaned headers above stacked rows.

### Data preview table (Step 3)

The table uses `overflow-x-auto` so it scrolls horizontally on mobile. Column headers use `whitespace-nowrap` to prevent wrapping. On mobile with many columns, the user scrolls the table horizontally while the rest of the page is static. This is standard and correct for data tables.

### Confirm step (Step 4)

The `dl` summary list is already a vertical stack — no changes needed. Buttons use `flex items-center justify-between` which works at all widths.

### Navigation buttons (all steps)

The back/continue button row uses `flex items-center justify-between`. On mobile these sit at the left and right edges of the card with the full width between them. Minimum touch target size is satisfied by `.btn-primary` and `.btn-secondary` which use `py-2` (32px) — adequate. For extra safety, no change needed as 32px is a borderline acceptable touch target for a wizard with low error cost.

---

## 12. Component File Map

| File | Purpose |
|---|---|
| `/frontend/app/(app)/sales/upload/page.tsx` | Wizard shell: step state, data fetching, navigation logic |
| `/frontend/components/sales-upload/step-upload.tsx` | Step 1: file zone + period date inputs |
| `/frontend/components/sales-upload/column-mapper.tsx` | Step 2: detected column → Likha field mapping table |
| `/frontend/components/sales-upload/upload-preview.tsx` | Step 3: preview rows + aggregated totals + royalty card |
| `/frontend/components/sales-upload/step-confirm.tsx` | Step 4: read-only summary + confirm button |
| `/frontend/components/sales-upload/step-indicator.tsx` | Shared step progress indicator (used across all steps) |
| `/frontend/components/Toast.tsx` | Reusable success/error toast (new, used in contract detail page too) |

Note: `step-upload.tsx` is a new component that uses the same drag-and-drop pattern as `contract-upload.tsx` but with spreadsheet validation. The existing `contract-upload.tsx` is not modified.

---

## 13. Accessibility Notes

- `StepIndicator` uses `<nav aria-label="Upload progress">` and `<ol>` so screen readers announce position.
- Completed steps show a `<Check />` icon inside the circle — add `aria-label={`Step ${s.number}: ${s.label} — completed`}` to each step circle `<div>`.
- The `MappingRow` dropdown has `aria-label={`Map column "${detectedColumn}" to Likha field`}` to give each select a unique accessible name.
- The `AlertCircle` icons in the preview table cells use `title={errorMessage}` for hover tooltip. Add `aria-label` on the icon for screen reader users.
- Error banners use `role="alert"` for live-region announcement.
- The toast uses `role="status"` and `aria-live="polite"`.
- The confirm button's loading state changes label text (`"Creating period..."`) — this is sufficient for screen readers. No additional `aria-busy` needed.
- All focus rings use `focus:ring-2 focus:ring-primary-500 focus:ring-offset-2` — consistent with the existing design system.
- Color is never the sole indicator of state: required fields also show "required" text; discrepancy uses both color and descriptive text; validation issues show an icon and text alongside the color change.
