# Phase 1.1 Implementation Spec: Spreadsheet Upload with Column Mapping

**Created:** 2026-02-22
**Status:** Ready for engineering
**Branch:** `royalty-report-spreadsheet-upload-column-mappring`
**Depends on:** Phase 1 (discrepancy detection) complete — `licensee_reported_royalty` must exist on `sales_periods` before this work begins
**Related docs:**
- `/Users/bobsantos/likha/dev/likha-app/docs/product/prd/royalty-report/prd-royalty-tracking.md` (Phase 1.1 section)
- `/Users/bobsantos/likha/dev/likha-app/work/plan.md` (Phase 1.1 checklist)
- `/Users/bobsantos/likha/dev/likha-app/docs/product/prd/royalty-report/sample-reports/README.md` (test files)

---

## 1. User Stories

### Primary Story

**As a licensor,** I receive an Excel file from my licensee via email each quarter. I currently open the file, manually read numbers off it, and type them into a form. This takes 5-10 minutes per licensee and introduces transcription errors.

**I want to** upload that Excel file directly into Likha, tell it once which column means what, and have the sales period created automatically.

**So that** I spend 30 seconds on repeat uploads instead of 10 minutes, and I catch calculation errors immediately instead of never.

### Secondary Stories

**As a licensor uploading a second report from the same licensee,** I want Likha to remember the column mapping I set up last quarter so I do not have to remap the same columns again.

**As a licensor whose licensee sends a multi-row report** (one row per SKU, multiple rows per category), I want Likha to aggregate all rows in the same category before applying the royalty rate, so the calculation is correct.

**As a licensor whose licensee's report includes their own royalty calculation,** I want Likha to capture that number automatically (if the file has a royalty column) so I immediately see whether their math matches mine, without any extra data entry.

### Out of Scope for This Phase

- AI-assisted column mapping (that is Phase 2 — Claude will suggest mappings)
- Template generation (Phase 2)
- Email intake (Phase 2)
- PDF report parsing (PDF is not parseable for structured data — reject with a clear message)
- Multi-sheet aggregation (aggregate across sheets — defer to Phase 2; single active sheet is sufficient)

---

## 2. Data Model Changes

### 2a. New Table: `licensee_column_mappings`

```sql
CREATE TABLE licensee_column_mappings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  licensee_name TEXT        NOT NULL,
  column_mapping JSONB      NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure one mapping per licensor per licensee
CREATE UNIQUE INDEX licensee_column_mappings_user_licensee_idx
  ON licensee_column_mappings (user_id, licensee_name);
```

**`column_mapping` JSONB shape:**

```json
{
  "Net Sales Amount": "net_sales",
  "Product Category": "product_category",
  "Gross Sales":      "gross_sales",
  "Returns / Allowances": "returns",
  "Royalty Due":      "licensee_reported_royalty",
  "Territory":        "territory",
  "SKU":              "ignore"
}
```

Keys are the exact column header strings detected from the uploaded file. Values are the canonical Likha field names (see Section 5 for the full list of valid values).

**Notes:**
- `licensee_name` matches `contracts.licensee_name` exactly (case-insensitive comparison when looking up)
- When a mapping is updated (licensee uploads again and changes mappings), the existing row is upserted — do not create a second row
- `updated_at` must be updated on every upsert

**Migration file:** `supabase/migrations/20260222000003_add_licensee_column_mappings.sql`

### 2b. No Changes to `sales_periods`

The Phase 1 migration (`licensee_reported_royalty DECIMAL(15,2) NULL`) must already be applied. The upload confirm endpoint will populate this field when the uploaded file contains a royalty column.

The `category_breakdown` JSONB column already exists and is the correct shape for storing aggregated category sales. No schema change needed.

### 2c. `SalesPeriodCreate` Already Handles Upload Output

The existing `SalesPeriodCreate` model accepts `net_sales` and `category_breakdown`. The upload confirm endpoint creates a `SalesPeriodCreate` payload from the parsed, mapped, and aggregated data and calls the same creation logic as the manual entry endpoint. This avoids duplicating royalty calculation logic.

---

## 3. API Contract

All endpoints require `Authorization: Bearer <supabase-jwt-token>`. The user must own the contract referenced by `contract_id`.

### 3a. `POST /api/sales/upload/{contract_id}`

**Purpose:** Parse an uploaded file, apply keyword-based or saved column mapping suggestions, and return a preview. Does NOT create a sales period.

**Request:** `multipart/form-data`

| Field          | Type   | Required | Notes |
|----------------|--------|----------|-------|
| `file`         | File   | Yes      | `.xlsx`, `.xls`, or `.csv` only. Max 10 MB. |
| `period_start` | string | Yes      | ISO date `YYYY-MM-DD` |
| `period_end`   | string | Yes      | ISO date `YYYY-MM-DD` |

**Response `200 OK`:**

```json
{
  "upload_id": "tmp-uuid-v4",
  "filename": "q1-2025-sunrise-apparel.xlsx",
  "sheet_name": "Sales Report",
  "total_rows": 14,
  "data_rows": 11,
  "detected_columns": [
    "Product Description",
    "SKU",
    "Product Category",
    "Gross Sales",
    "Returns / Allowances",
    "Net Sales Amount",
    "Royalty Rate",
    "Royalty Due"
  ],
  "sample_rows": [
    {
      "Product Description": "Classic Logo Tee - S",
      "SKU": "APP-001-S",
      "Product Category": "Apparel",
      "Gross Sales": "12500.00",
      "Returns / Allowances": "500.00",
      "Net Sales Amount": "12000.00",
      "Royalty Rate": "0.08",
      "Royalty Due": "960.00"
    },
    {
      "Product Description": "Classic Logo Tee - M",
      "SKU": "APP-001-M",
      "Product Category": "Apparel",
      "Gross Sales": "18750.00",
      "Returns / Allowances": "900.00",
      "Net Sales Amount": "17850.00",
      "Royalty Rate": "0.08",
      "Royalty Due": "1428.00"
    }
  ],
  "suggested_mapping": {
    "Product Description": "ignore",
    "SKU": "ignore",
    "Product Category": "product_category",
    "Gross Sales": "gross_sales",
    "Returns / Allowances": "returns",
    "Net Sales Amount": "net_sales",
    "Royalty Rate": "ignore",
    "Royalty Due": "licensee_reported_royalty"
  },
  "mapping_source": "saved",
  "period_start": "2025-01-01",
  "period_end": "2025-03-31"
}
```

**`mapping_source` values:**
- `"saved"` — mapping was loaded from `licensee_column_mappings` for this licensee
- `"suggested"` — no saved mapping; suggestions are from keyword matching only
- `"none"` — no saved mapping and no keyword matches; all columns default to `"ignore"`

**`upload_id`:** A short-lived in-memory key (UUID) that the confirm endpoint uses to reference the already-parsed data without re-uploading the file. Store parsed data in a server-side dict keyed by `upload_id` with a TTL of 15 minutes. After TTL, the client must re-upload. Do not persist raw file bytes to Supabase Storage — this is transient working data.

**Error responses:**

| HTTP Status | Error Code | When |
|-------------|------------|------|
| `400` | `unsupported_file_type` | File extension is not `.xlsx`, `.xls`, or `.csv` |
| `400` | `file_too_large` | File exceeds 10 MB |
| `400` | `parse_failed` | File could not be parsed (corrupt, password-protected, etc.) |
| `400` | `no_data_rows` | File parsed but contained zero data rows after header detection |
| `400` | `invalid_date` | `period_start` or `period_end` is not a valid ISO date |
| `400` | `period_end_before_start` | `period_end` < `period_start` |
| `401` | — | Missing or invalid auth token |
| `403` | — | User does not own this contract |
| `404` | — | Contract not found |

All error responses use the shape: `{"detail": "Human-readable message", "error_code": "snake_case_code"}`

---

### 3b. `POST /api/sales/upload/{contract_id}/confirm`

**Purpose:** Apply a confirmed column mapping to the parsed data, aggregate by category, calculate royalty, save the column mapping for future uploads, and create the sales period.

**Request:** `application/json`

```json
{
  "upload_id": "tmp-uuid-v4",
  "column_mapping": {
    "Product Description": "ignore",
    "SKU": "ignore",
    "Product Category": "product_category",
    "Gross Sales": "gross_sales",
    "Returns / Allowances": "returns",
    "Net Sales Amount": "net_sales",
    "Royalty Rate": "ignore",
    "Royalty Due": "licensee_reported_royalty"
  },
  "period_start": "2025-01-01",
  "period_end": "2025-03-31",
  "save_mapping": true
}
```

| Field            | Type    | Required | Notes |
|------------------|---------|----------|-------|
| `upload_id`      | string  | Yes      | From the `/upload` response. Must still be valid (within TTL). |
| `column_mapping` | object  | Yes      | Keys = detected column names. Values = Likha field names or `"ignore"`. Must include at least one column mapped to `"net_sales"`. |
| `period_start`   | string  | Yes      | ISO date `YYYY-MM-DD` |
| `period_end`     | string  | Yes      | ISO date `YYYY-MM-DD` |
| `save_mapping`   | boolean | No       | Default `true`. When `true`, upsert this mapping into `licensee_column_mappings`. |

**Response `201 Created`:** Returns the full `SalesPeriodResponse` shape (same as `POST /api/sales/`).

```json
{
  "id": "uuid",
  "contract_id": "uuid",
  "period_start": "2025-01-01",
  "period_end": "2025-03-31",
  "net_sales": 83300.00,
  "category_breakdown": null,
  "royalty_calculated": 6664.00,
  "minimum_applied": false,
  "licensee_reported_royalty": 6384.00,
  "discrepancy_amount": 280.00,
  "has_discrepancy": true,
  "created_at": "2026-02-22T10:00:00Z",
  "updated_at": "2026-02-22T10:00:00Z"
}
```

**Error responses:**

| HTTP Status | Error Code | When |
|-------------|------------|------|
| `400` | `upload_expired` | `upload_id` not found or TTL elapsed |
| `400` | `net_sales_column_required` | No column mapped to `"net_sales"` |
| `400` | `net_sales_is_zero` | Aggregated net sales = 0 (warn, allow if intentional — see Section 6) |
| `400` | `category_breakdown_required` | Contract has category rates but no `product_category` column was mapped |
| `400` | `unknown_category` | A category in the upload has no matching rate in the contract |
| `400` | `invalid_date` | `period_start` or `period_end` is not a valid ISO date |
| `400` | `royalty_calculation_failed` | Error in royalty engine (pass through the detail) |
| `401` | — | Missing or invalid auth token |
| `403` | — | User does not own this contract |
| `404` | — | Contract not found |
| `409` | `duplicate_period` | A sales period for this contract already covers this date range |

---

### 3c. `GET /api/sales/upload/mapping/{contract_id}`

**Purpose:** Return the saved column mapping for this contract's licensee, if one exists. The frontend calls this on page load to decide whether to show a "saved mapping will be applied" notice.

**Response `200 OK`:**

```json
{
  "licensee_name": "Sunrise Apparel Co.",
  "column_mapping": {
    "Net Sales Amount": "net_sales",
    "Product Category": "product_category",
    "Royalty Due": "licensee_reported_royalty",
    "SKU": "ignore"
  },
  "updated_at": "2026-01-15T09:22:00Z"
}
```

**Response `200 OK` when no mapping exists:**

```json
{
  "licensee_name": "Sunrise Apparel Co.",
  "column_mapping": null,
  "updated_at": null
}
```

This endpoint always returns `200`. The frontend uses `column_mapping: null` to decide there is no saved mapping.

**Error responses:** `401`, `403`, `404` (contract not found).

---

### 3d. Router Registration

Create `backend/app/routers/sales_upload.py` as a separate router. Register it in `backend/app/main.py` under the same `/api/sales` prefix so URL paths work as documented:

```python
# main.py
from app.routers import sales, sales_upload

app.include_router(sales.router, prefix="/api/sales", tags=["sales"])
app.include_router(sales_upload.router, prefix="/api/sales", tags=["sales-upload"])
```

Do not put upload endpoints inside `sales.py` — the file is already long and the upload flow is a distinct concern.

---

## 4. Upload Flow (Step by Step)

### Frontend: 4-Step Wizard at `/app/(app)/sales/upload/page.tsx?contract_id=[id]`

```
Step 1: File Upload
  → User selects or drags in a file
  → Frontend validates extension and size client-side (fail fast before API call)
  → On submit: POST /api/sales/upload/{contract_id} with file + period dates
  → On success: advance to Step 2 with the response payload

Step 2: Column Mapper
  → Display one row per detected column
  → Each row: column name | first sample value | dropdown (Likha field)
  → Pre-select suggested_mapping values from Step 1 response
  → Show banner if mapping_source == "saved": "Saved mapping from previous upload applied — review and confirm"
  → Show banner if mapping_source == "suggested": "Columns matched by keyword — verify before confirming"
  → Show banner if mapping_source == "none": "No automatic suggestions — map each column below"
  → Highlight unmapped required columns in amber (Net Sales is always required)
  → "Save this mapping for [Licensee Name]" checkbox, checked by default
  → "Next: Preview" button disabled until net_sales column is mapped
  → User clicks "Next: Preview" — frontend calls POST /api/sales/upload/{contract_id}/confirm with column_mapping

Step 3: Data Preview
  → Display first 3 sample rows with mapped field labels as column headers
  → Display aggregated totals section:
    - If flat rate: "Total Net Sales: $83,300.00"
    - If category rate: one line per category ("Apparel: $61,800.00 | Accessories: $29,450.00 | ...")
  → Display calculated royalty card (same design as manual entry success card)
  → If licensee_reported_royalty present: show discrepancy card (same design as Phase 1)
  → "Confirm and Create Sales Period" button
  → "Back to Column Mapping" link
  → "Cancel" link (returns to contract detail page)

Step 4: Confirmation
  → On "Confirm": POST /api/sales/upload/{contract_id}/confirm
  → On success: redirect to /contracts/[id] with a success toast
    "Sales period created. Licensee reported $6,384.00 — discrepancy of $280.00 flagged."
  → On error: show inline error message and stay on Step 3
```

### Backend Processing Flow (per request)

```
POST /api/sales/upload/{contract_id}:
  1. Auth: verify token → get user_id
  2. Ownership: verify user owns contract
  3. Parse file: detect type, find header row, extract column names + sample rows
  4. Look up saved mapping for contract's licensee_name
  5. If saved mapping: use it as suggested_mapping, set mapping_source = "saved"
  6. If no saved mapping: run keyword synonym matching, set mapping_source = "suggested" or "none"
  7. Store parsed data in memory keyed by upload_id (TTL 15 min)
  8. Return preview response

POST /api/sales/upload/{contract_id}/confirm:
  1. Auth + ownership check
  2. Look up upload_id in memory; 400 if expired
  3. Apply column_mapping to full parsed data (all rows, not just sample)
  4. Strip header row(s) and summary/total rows
  5. Aggregate net_sales by product_category (sum all rows per category)
  6. If contract has category rates: build category_breakdown dict
  7. If contract has flat/tiered rates: sum to single net_sales total
  8. Extract licensee_reported_royalty if that column was mapped (take the FIRST non-null value encountered; this field is typically a freestanding summary row, not a per-row column)
  9. Call calculate_royalty_with_minimum() — same engine as manual entry
  10. If save_mapping: upsert into licensee_column_mappings
  11. Insert into sales_periods (same as manual entry endpoint)
  12. Return SalesPeriodResponse
```

---

## 5. Column Mapping Logic

### 5a. Canonical Likha Field Names

The dropdown in the column mapper offers exactly these options:

| Display Label in UI | Internal Field Name | Required? |
|---------------------|---------------------|-----------|
| Net Sales | `net_sales` | Yes — at least one column must map here |
| Gross Sales | `gross_sales` | No |
| Returns / Allowances | `returns` | No |
| Product Category | `product_category` | Required when contract has category rates |
| Licensee Reported Royalty | `licensee_reported_royalty` | No |
| Territory | `territory` | No (reserved for Phase 2 territory rates) |
| Ignore | `ignore` | — |

Any column not mapped to a named field must be explicitly set to `"ignore"`. An unmapped column (absent from the `column_mapping` dict in the confirm request) should be treated as `"ignore"` — do not error on it.

### 5b. Keyword Synonym Matching

Matching is case-insensitive, trim whitespace, and check if the detected column name contains any synonym as a substring. A column name of `"Total Net Sales Amount"` matches the synonym `"Net Sales"` because `"net sales"` is a substring.

```python
FIELD_SYNONYMS = {
    "net_sales": [
        "net sales", "net revenue", "net proceeds", "royalty base",
        "net sales amount", "total net sales", " ns"
    ],
    "gross_sales": [
        "gross sales", "gross revenue", "gross proceeds", "gross amount",
        "total sales"
    ],
    "returns": [
        "returns", "allowances", "deductions", "credits",
        "returns and allowances", "r&a"
    ],
    "product_category": [
        "category", "product line", "product type", "line",
        "division", "collection", "segment"
    ],
    "licensee_reported_royalty": [
        "royalty", "royalty due", "amount due", "calculated royalty",
        "total royalty"
    ],
    "territory": [
        "territory", "region", "market", "country", "geography"
    ],
}
```

**Matching priority:** Apply synonyms in the order listed. The first match wins. If a column name matches synonyms for two different fields (edge case), the field that appears earlier in the `FIELD_SYNONYMS` dict wins.

**`" ns"` note:** The leading space is intentional — `"ns"` alone would false-match column names like `"units"` or `"transactions"`. Space-prefixed `" ns"` prevents this. Apply the synonym check against `" " + normalized_column_name` as well as the column name itself to handle this edge case.

**No match:** If no synonym matches, set field to `"ignore"`.

### 5c. Saved Mapping Lookup

When loading a saved mapping for Step 1:

```python
result = supabase.table("licensee_column_mappings") \
    .select("*") \
    .eq("user_id", user_id) \
    .ilike("licensee_name", contract["licensee_name"]) \
    .limit(1) \
    .execute()
```

Use `.ilike()` (case-insensitive match) because licensee names may have minor capitalization differences across uploads.

When upserting on confirm:

```python
supabase.table("licensee_column_mappings") \
    .upsert({
        "user_id": user_id,
        "licensee_name": contract["licensee_name"],
        "column_mapping": confirmed_mapping,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }, on_conflict="user_id,licensee_name") \
    .execute()
```

### 5d. `licensee_reported_royalty` Extraction from Uploaded Files

Licensees typically do NOT put their calculated royalty as a per-row column. They put it as a summary row at the bottom of the file (e.g., `"Royalty Due: $6,384.00"`). The parser should handle this in two ways:

1. **Column-based (preferred when available):** If a column is mapped to `licensee_reported_royalty` and at least one data row has a non-null numeric value in that column, sum those values (in case each row has a per-row royalty). Use the result.

2. **Summary row detection (fallback):** During header/summary row detection (see Section 6a), if a row looks like a freestanding label-value pair (e.g., only two cells populated: `"Royalty Due"` and `"6384.00"`), capture the numeric value and expose it as `detected_licensee_royalty` in the preview response. The frontend can pre-fill the `licensee_reported_royalty` input with this detected value and let the user confirm it.

For Phase 1.1, implement approach 1. Approach 2 (freestanding row detection) is a stretch goal — call it out in the response as `"detected_licensee_royalty": null` for now and let the user enter it manually if not column-mapped.

---

## 6. Edge Cases

### 6a. Header Row Detection

Many licensee files have title/metadata rows above the actual column headers. The parser must find the real header row rather than treating row 1 as headers.

**Algorithm:**

1. Read up to the first 20 rows of the file.
2. For each row, count how many cells contain non-empty string values that are NOT numeric and NOT a date.
3. The header row is the first row where at least 3 cells pass this test AND the row is followed by at least one row with predominantly numeric values in the same columns.
4. If no row passes this test, fall back to treating row 1 as the header.

**What this handles:**

- `sample-1-flat-rate.csv`: rows 1-6 are metadata (Licensee Name: ..., Contract Number: ..., etc.). Row 7 is the real header (`Product Description, SKU, Category, ...`).
- `sample-3-messy-real-world.csv`: rows 1-5 are company name, report title, agreement ref, preparer, and a blank row. Row 6 is the header.

**Safety check:** After header detection, if the first data row below the detected header is all strings (no numeric columns), move the header down one more row. Repeat up to 3 times.

### 6b. Summary/Total Row Exclusion

Files typically end with a TOTAL or SUBTOTAL row that would double-count values if included in aggregation.

**Detection rules (any match → skip row):**

1. The first non-empty cell in the row contains any of: `"total"`, `"subtotal"`, `"sum"`, `"grand total"` (case-insensitive)
2. The first non-empty cell is blank but the net_sales cell value equals the sum of all other net_sales values in the data (i.e., it is a formula-calculated total)
3. The row is below a row that was a TOTAL row (treat everything after first TOTAL row as non-data)

**Be conservative:** Prefer to include a row over excluding it in ambiguous cases. A double-counted row produces incorrect math that the user will notice. A missing row is harder to spot. The data preview in Step 3 gives the user a chance to verify before confirming.

### 6c. Merged Cells

When `openpyxl` reads a merged cell region, the value appears only in the top-left cell; all other cells in the region are `None`. The parser must forward-fill merged column headers: if the detected header row has a `None` value at column index N, use the last non-None value to the left of N as the column name for column N.

For merged data cells (e.g., category names that span multiple rows): forward-fill downward in the category column. A `None` value in the category column of a data row should inherit the last non-None category value from the row above.

### 6d. Multiple Sheets

**Phase 1.1 behavior:** Parse only the first sheet. The parser should log which sheet was selected (include `sheet_name` in the response). If the first sheet has fewer than 3 rows, try the second sheet before giving up.

Do not attempt to aggregate across sheets in this phase. If a file has meaningful data split across multiple sheets, the user will need to consolidate manually and re-upload.

### 6e. Empty Rows

Skip any row where all cells are `None` or empty strings. Do not count empty rows toward `data_rows`.

### 6f. Zero-Sales Periods

A period where net_sales = 0 after aggregation is valid — the licensee may have had no sales in the period and is submitting a zero report (common in contracts with minimum guarantees). The confirm endpoint must allow this. Log a warning but do not error.

### 6g. Negative Net Sales (Returns Exceeding Gross)

If the aggregated net_sales value is negative (returns exceeded gross sales), return a `400` error with code `negative_net_sales` and the message: "Net sales aggregated to a negative value ($X). Verify the returns column is mapped correctly." A negative net sales total almost always indicates a mapping error (e.g., returns mapped to net_sales by mistake).

### 6h. Category Rate Contract with No Category Column

If the contract's `royalty_rate` is a dict (category rates) and no column in the confirmed mapping is assigned to `product_category`, return `400` with code `category_breakdown_required` and message: "This contract has category-specific rates. Map a column to 'Product Category' before confirming."

### 6i. Unknown Category in Category-Rate Contract

If the upload contains a category value (e.g., `"Handbags"`) that has no matching rate in the contract's `royalty_rate` dict, return `400` with code `unknown_category` and message: "Category 'Handbags' in the uploaded file has no matching rate in this contract. Update your contract's royalty rates or correct the file."

Case-insensitive substring matching (same logic as `calculate_category_royalty()` in `royalty_calc.py`) should be used before raising this error.

### 6j. Encoding

Attempt to parse CSV files in this order: UTF-8, UTF-8-BOM, Windows-1252, Latin-1. Use the first encoding that parses without errors. `openpyxl` handles encoding internally for `.xlsx` files. `xlrd` handles encoding for `.xls` files.

### 6k. File Size Validation

Enforce 10 MB maximum both client-side (before upload) and server-side (in the endpoint). Server-side check must happen before parsing. Use FastAPI's `UploadFile.size` or stream the file and count bytes.

### 6l. Duplicate Period Detection

Before inserting into `sales_periods`, check whether a record already exists for this `contract_id` where `period_start` and `period_end` match exactly. If found, return `409` with code `duplicate_period`. Do not check for overlapping ranges — exact match only for now.

---

## 7. Acceptance Criteria

### Backend

- [ ] `POST /api/sales/upload/{contract_id}` parses a `.xlsx`, `.xls`, and `.csv` file and returns detected columns, 2-5 sample rows, and suggested mappings
- [ ] Suggested mappings use saved mapping from `licensee_column_mappings` when one exists, with `mapping_source: "saved"`
- [ ] Suggested mappings use keyword synonyms when no saved mapping exists, with `mapping_source: "suggested"` or `"none"`
- [ ] `POST /api/sales/upload/{contract_id}/confirm` creates a sales period with the correct `net_sales`, `category_breakdown`, `royalty_calculated`, and `licensee_reported_royalty`
- [ ] Confirm endpoint upserts into `licensee_column_mappings` when `save_mapping: true`
- [ ] Confirm endpoint does NOT create a duplicate mapping row — it updates the existing one
- [ ] `GET /api/sales/upload/mapping/{contract_id}` returns saved mapping or `null`, always `200`
- [ ] Multi-row reports are aggregated by category before rate application
- [ ] Summary/TOTAL rows are excluded from aggregation
- [ ] Metadata rows above the real header are correctly skipped
- [ ] A file with merged cells parses correctly via forward-fill
- [ ] A file with 5 title rows and the real header at row 6 parses correctly
- [ ] Unsupported file types (`.pdf`, `.docx`, `.txt`) return `400` with `unsupported_file_type`
- [ ] Expired `upload_id` returns `400` with `upload_expired`
- [ ] Missing net_sales mapping returns `400` with `net_sales_column_required`
- [ ] Category contract without category column returns `400` with `category_breakdown_required`
- [ ] Zero-sales period is allowed (no error)
- [ ] Negative net sales returns `400` with `negative_net_sales`
- [ ] Windows-1252 CSV parses without error
- [ ] All new tests passing (TDD approach maintained)

### Frontend

- [ ] "Upload Report" button appears on the contract detail page
- [ ] Step 1: File upload accepts `.xlsx`, `.xls`, `.csv` only; rejects `.pdf` and other types with a message
- [ ] Step 1: 10 MB limit enforced client-side with a message
- [ ] Step 1: Period date fields are present and required
- [ ] Step 2: Column mapper shows one row per detected column with a dropdown for each
- [ ] Step 2: Saved mapping notice shown when `mapping_source == "saved"`
- [ ] Step 2: "Next" button disabled until `net_sales` column is mapped
- [ ] Step 2: "Save mapping" checkbox is present and checked by default
- [ ] Step 3: Preview shows sample rows with mapped column labels as headers
- [ ] Step 3: Aggregated net sales total displayed
- [ ] Step 3: Calculated royalty displayed using the same result card as manual entry
- [ ] Step 3: Discrepancy card displayed when `has_discrepancy: true` (same design as Phase 1)
- [ ] Step 4: On confirm success, redirect to contract detail page with success toast
- [ ] Error states are handled at each step with inline messages (not just console logs)
- [ ] All new frontend tests passing (TDD approach maintained)

### End-to-End

- [ ] Licensor uploads `sample-1-flat-rate.csv`, maps columns, and creates a sales period in under 3 minutes (timed)
- [ ] Second upload from the same licensee auto-applies the saved mapping — user goes directly to Step 3
- [ ] `sample-2-category-rates.csv` produces correct per-category royalties ($6,180 + $3,534 + $4,416 = $14,130)
- [ ] `sample-3-messy-real-world.csv` parses past the 5 title rows and presents correct data rows for mapping (keyword matching partially fails — user manually maps remaining columns — this is expected behavior)

---

## 8. Test Scenarios

### 8a. Backend: Spreadsheet Parser (`backend/tests/test_spreadsheet_parser.py`)

Engineers should write these tests using real bytes constructed in the test (use `openpyxl` to generate `.xlsx` bytes in-memory; use `io.StringIO` for CSV). Do not rely on the sample files from disk — tests must be self-contained.

```
test_parse_xlsx_standard_headers
  - Build xlsx with headers: SKU, Category, Net Sales, Returns, Gross Sales, Royalty Due
  - Data: 3 rows, TOTAL row at bottom
  - Assert: column_names == [expected list], data_rows == 3 (TOTAL excluded), sample_rows has 3 entries

test_parse_csv_with_metadata_rows
  - Build CSV where rows 1-3 are metadata ("Licensee:", "Period:", "Contract:"), row 4 is headers
  - Assert: header_row_index == 3 (0-indexed), detected_columns are from row 4

test_parse_xlsx_5_title_rows
  - Build xlsx mirroring sample-3 structure (5 title rows, real header at row 6)
  - Assert: detected_columns match row 6, data_rows is correct

test_parse_csv_with_empty_rows
  - CSV with 3 data rows, 2 empty rows interspersed
  - Assert: data_rows == 3 (empty rows excluded)

test_parse_xlsx_merged_category_column
  - Build xlsx where "Apparel" in category column is merged across 4 rows
  - After forward-fill, all 4 rows have category = "Apparel"
  - Assert: all 4 rows in parsed output have product_category == "Apparel"

test_parse_csv_windows1252_encoding
  - Encode a CSV with Windows-1252 encoding (include a non-ASCII character like €)
  - Assert: parse succeeds, no UnicodeDecodeError

test_parse_unsupported_type_raises_error
  - Call parse_upload with a .pdf extension
  - Assert: raises ParseError with error_code == "unsupported_file_type"

test_parse_corrupt_file_raises_error
  - Call parse_upload with random bytes and .xlsx extension
  - Assert: raises ParseError with error_code == "parse_failed"

test_apply_mapping_flat_rate_aggregation
  - ParsedSheet with 4 rows: net_sales column mapped, no category column
  - Call apply_mapping
  - Assert: net_sales == sum of all 4 rows, category_sales == None

test_apply_mapping_category_aggregation
  - ParsedSheet with 11 rows: 4 Apparel, 4 Accessories, 3 Footwear
  - net_sales column and product_category column mapped
  - Call apply_mapping
  - Assert: category_sales == {"Apparel": sum, "Accessories": sum, "Footwear": sum}
  - Assert: net_sales == total of all three

test_apply_mapping_total_row_excluded
  - ParsedSheet with 3 data rows and a TOTAL row
  - Assert: aggregated net_sales == sum of 3 rows (TOTAL row not included)

test_apply_mapping_licensee_royalty_extraction
  - ParsedSheet with Royalty Due column containing per-row values
  - Column mapped to licensee_reported_royalty
  - Assert: licensee_reported_royalty == sum of per-row values

test_apply_mapping_missing_net_sales_column_raises_error
  - Call apply_mapping with a mapping that has no "net_sales" field
  - Assert: raises MappingError with error_code == "net_sales_column_required"

test_apply_mapping_negative_net_sales_raises_error
  - ParsedSheet where returns > gross (negative net)
  - Assert: raises MappingError with error_code == "negative_net_sales"

test_keyword_matching_standard_names
  - Column names: "Net Sales Amount", "Product Category", "Gross Sales", "Royalty Due"
  - Assert: suggested_mapping == {
      "Net Sales Amount": "net_sales",
      "Product Category": "product_category",
      "Gross Sales": "gross_sales",
      "Royalty Due": "licensee_reported_royalty"
    }

test_keyword_matching_non_standard_names
  - Column names from sample-3: "Total Revenue", "Refunds", "Amount Owed", "Gross Revenue", "Rate (%)"
  - Assert: "Total Revenue" → "ignore" (not in synonym list)
  - Assert: "Refunds" → "ignore"
  - Assert: "Amount Owed" → "ignore"
  - Assert: "Gross Revenue" → "gross_sales" (IS in synonym list)
  - Assert: "Rate (%)" → "ignore" (borderline; should not auto-match)

test_keyword_matching_case_insensitive
  - Column name: "NET SALES"
  - Assert: matches net_sales

test_keyword_matching_substring
  - Column name: "Total Net Sales Amount"
  - Assert: matches net_sales (because "net sales" is a substring)
```

### 8b. Backend: Upload Router (`backend/tests/test_sales_upload.py`)

These tests mock the Supabase client (same pattern as all other router tests).

```
test_upload_endpoint_returns_preview
  - POST /api/sales/upload/{contract_id} with a valid xlsx file
  - Assert 200, response contains detected_columns, sample_rows, suggested_mapping, upload_id

test_upload_endpoint_no_saved_mapping_uses_keywords
  - No entry in licensee_column_mappings for this user+licensee
  - Assert: mapping_source == "suggested"

test_upload_endpoint_saved_mapping_applied
  - Supabase mock returns a saved mapping for this user+licensee
  - Assert: mapping_source == "saved", suggested_mapping matches saved mapping

test_upload_endpoint_rejects_pdf
  - POST with a .pdf file
  - Assert 400, error_code == "unsupported_file_type"

test_upload_endpoint_rejects_oversized_file
  - POST with a file > 10 MB
  - Assert 400, error_code == "file_too_large"

test_confirm_endpoint_creates_sales_period
  - POST /api/sales/upload/{contract_id}/confirm with valid upload_id and mapping
  - Assert 201, response matches SalesPeriodResponse shape
  - Assert: royalty_calculated is correct
  - Assert: licensee_reported_royalty populated if mapped column was present

test_confirm_endpoint_expired_upload_id
  - POST with an upload_id not in memory
  - Assert 400, error_code == "upload_expired"

test_confirm_endpoint_missing_net_sales_mapping
  - POST with column_mapping that has no "net_sales" value
  - Assert 400, error_code == "net_sales_column_required"

test_confirm_endpoint_saves_mapping_when_flag_true
  - POST with save_mapping: true
  - Assert: supabase.table("licensee_column_mappings").upsert called once

test_confirm_endpoint_does_not_save_mapping_when_flag_false
  - POST with save_mapping: false
  - Assert: upsert NOT called

test_confirm_endpoint_category_contract_requires_category_column
  - Contract has category rates; column_mapping has no product_category value
  - Assert 400, error_code == "category_breakdown_required"

test_confirm_endpoint_unknown_category_in_file
  - Category contract; uploaded file has category "Handbags" not in contract rates
  - Assert 400, error_code == "unknown_category"

test_confirm_endpoint_zero_sales_period_allowed
  - Upload file with net_sales = 0
  - Assert 201 (not 400)

test_get_mapping_returns_saved_mapping
  - GET /api/sales/upload/mapping/{contract_id}
  - Supabase mock returns a saved mapping
  - Assert 200, column_mapping is not null

test_get_mapping_returns_null_when_none_exists
  - GET /api/sales/upload/mapping/{contract_id}
  - No saved mapping in mock
  - Assert 200, column_mapping == null

test_upload_endpoint_requires_auth
  - POST with no Authorization header
  - Assert 401

test_confirm_endpoint_requires_contract_ownership
  - POST with valid auth but contract belongs to different user
  - Assert 403
```

### 8c. Frontend: Column Mapper Component (`__tests__/column-mapper.test.tsx`)

```
renders one row per detected column
shows dropdown with all Likha field options
pre-selects suggested mapping values
shows "saved mapping" banner when mappingSource == "saved"
shows "keyword matched" banner when mappingSource == "suggested"
shows "no suggestions" banner when mappingSource == "none"
disables "Next" button when net_sales column is not mapped
enables "Next" button when net_sales column is mapped
shows amber highlight on net_sales row when unmapped
"Save mapping" checkbox is rendered and checked by default
calls onMappingConfirm with correct mapping object on Next click
"save_mapping" value is passed correctly from checkbox state
```

### 8d. Frontend: Upload Preview Component (`__tests__/upload-preview.test.tsx`)

```
renders sample rows with mapped column labels as headers
renders aggregated net sales total
renders calculated royalty card for flat rate contract
renders per-category breakdown for category-rate contract
renders discrepancy card when has_discrepancy is true
renders no discrepancy card when has_discrepancy is false
renders no discrepancy card when licensee_reported_royalty is null
"Confirm" button is present and enabled
"Back to Column Mapping" link is present
"Cancel" link is present
calls onConfirm when Confirm is clicked
shows loading state while confirm request is in flight
shows error message inline when confirm returns an error
```

### 8e. Frontend: Upload Wizard Page (`__tests__/sales-upload-page.test.tsx`)

```
renders Step 1 (file upload) on initial load
calls GET /mapping/{contract_id} on page load
advances to Step 2 after successful file upload
shows correct banner in Step 2 based on mapping_source
advances to Step 3 (preview) after mapping is confirmed
returns to Step 2 from Step 3 via "Back" link
creates sales period on Step 3 confirm
redirects to contract detail page on successful creation
shows toast with discrepancy message when has_discrepancy is true
shows generic success toast when no discrepancy
stays on Step 3 and shows error message when confirm fails
rejects non-xlsx/xls/csv files before upload with error message
rejects files > 10 MB before upload with error message
```

---

## 9. New Files to Create

### Backend

| File | Purpose |
|------|---------|
| `backend/app/services/spreadsheet_parser.py` | `parse_upload()` and `apply_mapping()` functions, keyword synonym matching |
| `backend/app/routers/sales_upload.py` | Upload endpoints: `POST /upload/{id}`, `POST /upload/{id}/confirm`, `GET /mapping/{id}` |
| `backend/tests/test_spreadsheet_parser.py` | Parser unit tests (Section 8a) |
| `backend/tests/test_sales_upload.py` | Router tests (Section 8b) |
| `supabase/migrations/20260222000003_add_licensee_column_mappings.sql` | New table + unique index |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/app/(app)/sales/upload/page.tsx` | 4-step wizard page |
| `frontend/components/sales-upload/column-mapper.tsx` | Step 2 column mapping table component |
| `frontend/components/sales-upload/upload-preview.tsx` | Step 3 preview + royalty/discrepancy cards |
| `frontend/__tests__/column-mapper.test.tsx` | Column mapper tests (Section 8c) |
| `frontend/__tests__/upload-preview.test.tsx` | Preview component tests (Section 8d) |
| `frontend/__tests__/sales-upload-page.test.tsx` | Wizard page tests (Section 8e) |

### Files to Modify

| File | Change |
|------|--------|
| `backend/app/main.py` | Register `sales_upload` router under `/api/sales` |
| `backend/requirements.txt` | Add `openpyxl` and `xlrd` |
| `frontend/types/index.ts` | Add new types (see Section 9a below) |
| `frontend/app/(app)/contracts/[id]/page.tsx` | Add "Upload Report" button |

### 9a. TypeScript Types to Add in `frontend/types/index.ts`

```typescript
// --- Phase 1.1: Spreadsheet Upload ---

export type LikhaField =
  | 'net_sales'
  | 'gross_sales'
  | 'returns'
  | 'product_category'
  | 'licensee_reported_royalty'
  | 'territory'
  | 'ignore'

export type MappingSource = 'saved' | 'suggested' | 'none'

export interface ColumnMapping {
  [detectedColumnName: string]: LikhaField
}

export interface UploadPreviewResponse {
  upload_id: string
  filename: string
  sheet_name: string
  total_rows: number
  data_rows: number
  detected_columns: string[]
  sample_rows: Record<string, string>[]
  suggested_mapping: ColumnMapping
  mapping_source: MappingSource
  period_start: string
  period_end: string
}

export interface UploadConfirmRequest {
  upload_id: string
  column_mapping: ColumnMapping
  period_start: string
  period_end: string
  save_mapping: boolean
}

export interface SavedMappingResponse {
  licensee_name: string
  column_mapping: ColumnMapping | null
  updated_at: string | null
}
```

Also update the existing `SalesPeriod` interface to add the Phase 1 discrepancy fields if not already present:

```typescript
export interface SalesPeriod {
  id: string
  contract_id: string
  period_start: string
  period_end: string
  net_sales: number
  category_sales: CategorySales | null
  calculated_royalty: number
  minimum_applied: boolean
  licensee_reported_royalty?: number | null   // Phase 1
  discrepancy_amount?: number | null           // Phase 1
  has_discrepancy?: boolean                    // Phase 1
  created_at: string
}
```

---

## 10. Dependencies to Add

### Backend (`backend/requirements.txt`)

```
openpyxl>=3.1.0    # Read .xlsx files
xlrd>=2.0.1        # Read legacy .xls files (xlrd 2.x supports .xls only — not .xlsx)
```

**Note:** `xlrd` 2.x intentionally dropped `.xlsx` support. Use `openpyxl` for `.xlsx` and `xlrd` for `.xls`. Do not attempt to use `xlrd` for `.xlsx` — it will raise `XLRDError: Excel xlsx file; not supported`.

### Frontend

No new npm dependencies required. `fetch` handles multipart form uploads natively. The existing Tailwind CSS setup handles all new UI.

---

## 11. Implementation Order

The following order minimizes blocked work. Each step should have tests written first (TDD).

1. **Migration** — Create and apply `20260222000003_add_licensee_column_mappings.sql`. Unblocks all backend work.

2. **`spreadsheet_parser.py`** — `parse_upload()` and `apply_mapping()` with no router dependency. Write `test_spreadsheet_parser.py` first. This is the most complex backend work and should be done before the router.

3. **`sales_upload.py` router** — Depends on parser. Write `test_sales_upload.py` first. Register router in `main.py`.

4. **TypeScript types** — Update `frontend/types/index.ts`. Unblocks all frontend work.

5. **`column-mapper.tsx`** — Write `column-mapper.test.tsx` first. No API dependency — accepts props, calls callbacks.

6. **`upload-preview.tsx`** — Write `upload-preview.test.tsx` first. No API dependency — accepts props, calls callbacks.

7. **`sales/upload/page.tsx`** — Depends on both components and backend endpoints being available. Write `sales-upload-page.test.tsx` first (mock the API calls).

8. **"Upload Report" button on contract detail page** — One-line change after the page is built.

---

## 12. Out of Scope (Do Not Build in This Phase)

- AI-assisted column mapping (Phase 2 — Claude API call to suggest mappings)
- Template generation (Phase 2 — `GET /api/contracts/{id}/report-template`)
- Email intake webhook (Phase 2)
- Aggregation across multiple sheets in the same file
- PDF parsing (not feasible for structured data — reject with a clear message)
- Editing or deleting a saved column mapping through the UI (users can overwrite by re-uploading)
- Licensee portal (out of scope for all current phases)
- Multi-currency support
- Territory-level royalty rates (the `territory` field is mapped and stored but not used in calculation yet)

---

## 13. Open Questions (Resolve Before Development Starts)

1. **In-memory upload_id store:** The spec calls for storing parsed file data in a server-side dict with a 15-minute TTL. FastAPI is stateless across restarts and potentially multi-worker. For a single-worker Railway deployment, an in-process dict works. If Railway is configured with multiple workers, this breaks. Decide: (a) single worker in Railway config (simpler, sufficient for beta), or (b) use Supabase Storage for transient parsed data with a `processed_at` TTL check. Recommendation: single worker for Phase 1.1, revisit before Phase 2.

2. **`licensee_reported_royalty` from freestanding rows:** The sample files put the licensee's royalty total as a freestanding text row below the data, not as a column. The Phase 1.1 parser will not auto-extract this (it only extracts column-mapped values). Users will need to enter it manually in the form. Is this acceptable for launch, or should we invest in freestanding row detection? Recommendation: accept the limitation for launch — the manual field is already built. Document it as a known limitation.

3. **`net_sales` vs. `gross_sales - returns` calculation:** Some uploaded files provide gross sales and returns as separate columns but not net sales. Should Likha auto-compute `net_sales = gross_sales - returns` when no net_sales column is present but both gross_sales and returns columns are mapped? Recommendation: yes, implement this in `apply_mapping()` as a derived field. If `gross_sales` and `returns` are both mapped and `net_sales` is not, compute net_sales. If only gross_sales is mapped (no returns column), treat gross as net (warn in the preview that no deductions were detected).
