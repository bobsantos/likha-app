# Spec: Report Template Generation and Parser Improvements

**Status:** Draft
**Date:** 2026-02-24
**Scope:** `backend/app/services/report_template.py` and `backend/app/services/spreadsheet_parser.py`

---

## Problem Statement

The current report template (`GET /api/contracts/{id}/report-template`) generates a minimal Excel file with four or five columns and an embedded title row. Real licensee reports follow a consistent structure — a metadata header block, a multi-column data table with Gross Sales / Returns / Net Sales / Royalty Rate / Royalty Due columns, a TOTAL row, and footer rows for the licensee's reported royalty and a notes field. The current template does not resemble this structure, so licensees either reformat it into something they prefer or ignore it and submit their own layout. The column names in the template also partially overlap with what the parser already recognizes through `FIELD_SYNONYMS`, but the round-trip is incomplete (period dates are data columns, not metadata; `product_description` and `sku` are not in `VALID_FIELDS`; and footer rows like "Licensee Reported Royalty" are discarded by the parser because they appear after TOTAL).

The goal is to close the gap between the template format and the real-world format so that:

1. Licensees receive a template that matches how they already report.
2. A filled-in template uploaded back through the upload flow maps automatically with zero manual column mapping.
3. The parser correctly extracts period dates and the licensee-reported royalty from the file's metadata and footer sections.

---

## Reference: Real-World Report Formats

### Sample 1 — Flat Rate (`sample-1-flat-rate.csv`)

```
Licensee Name,Sunrise Apparel Co.
Licensor Name,BrandCo Holdings LLC
Contract Number,BC-2024-0042
Reporting Period Start,2025-01-01
Reporting Period End,2025-03-31
Report Submission Date,2025-04-28
Territory,United States
                                        ← blank row
Product Description,SKU,Product Category,Gross Sales,Returns / Allowances,Net Sales,Royalty Rate,Royalty Due
Licensed Branded Apparel - All SKUs,ALL,Apparel,87500.00,4200.00,83300.00,8%,6384.00
                                        ← blank row
TOTAL,,,,4200.00,83300.00,,6384.00
                                        ← blank row
Licensee Reported Royalty,6384.00
Notes,"Licensee applied 8% rate..."
```

### Sample 2 — Category Rates (`sample-2-category-rates.csv`)

Same metadata block format. Data table has 11 SKU rows, each with a `Product Category` value. TOTAL row sums gross sales, returns, net sales, and royalty due.

### Sample 3 — Messy Real World (`sample-3-messy-real-world.csv`)

```
VANTAGE RETAIL PARTNERS
ROYALTY STATEMENT - Q3 2025
AGREEMENT REF: VRP / BC-2025-0011
PREPARED BY: Finance Dept.
                                        ← blank row
Item #,Description,Product Line,Gross Revenue,Refunds,Total Revenue,Rate (%),Amount Owed
...data rows...
TOTAL,,,,3950.00,102050.00,,9175.50
                                        ← blank row
Amount Owed This Period: $9175.50
Please remit payment by October 31 2025
```

Key observation: sample-3 uses single-cell title rows (no Label/Value pairs), non-standard column names, and a free-text footer instead of a "Licensee Reported Royalty" field. Sample-3c (`sample-3c-cleaner-q1-2026.csv`) shows this licensee updating their format to match sample-1/2 conventions.

### Structural Pattern Across All Samples

| Section | Rows | Notes |
|---------|------|-------|
| Metadata block | 6–7 rows | Two-column Label/Value pairs |
| Blank separator | 1 row | |
| Data table header | 1 row | Bold column names |
| Data rows | 1–N rows | One row per SKU or product line |
| Blank separator | 1 row | |
| TOTAL row | 1 row | First cell = "TOTAL", SUM values |
| Blank separator | 1 row | |
| "Licensee Reported Royalty" footer | 1 row | Two-column Label/Value |
| Notes footer | 1 row | Two-column Label/Value |

---

## 1. Template Generation Improvements

### 1.1 Replace Single-Row Titles with a Metadata Header Block

**Current behavior** (`report_template.py`, lines 142–165):

- Row 1: `"Royalty Report — {licensee_name}"` (title string, one cell)
- Row 2: `"Contract period: {start} to {end} | Reporting: {frequency}"` (one cell)
- Row 3: `"Royalty rate: {rate_description}"` (one cell)
- Row 4: blank
- Row 5: column headers

**Required behavior**: Replace rows 1–4 with a two-column metadata block that matches sample-1/2 format. Every row is a `Label` / `Value` pair in columns A and B.

```
Row 1:  "Licensee Name"         | <licensee_name>
Row 2:  "Licensor Name"         | <licensor_name>  (or blank if not on contract)
Row 3:  "Contract Number"       | <contract id>
Row 4:  "Reporting Period Start"| [BLANK — licensee fills in]
Row 5:  "Reporting Period End"  | [BLANK — licensee fills in]
Row 6:  "Report Submission Date"| [BLANK — licensee fills in]
Row 7:  "Territory"             | <territories joined by ", "> (or blank)
Row 8:  (blank separator row)
Row 9:  column headers
Row 10+: data rows
```

Pre-filled values come from `contract.get("licensee_name")`, `contract.get("territories")`, and `contract.get("id")`. Period start/end and submission date are left blank for the licensee to complete.

The metadata block rows must use a consistent two-column Label font (bold for column A, normal for column B).

**Why period dates belong in metadata, not data columns**: The current template puts "Period Start" and "Period End" as data columns (columns 1 and 2 of `FLAT_COLUMNS` and `CATEGORY_COLUMNS`). Real reports contain one period per file; the reporting period is file-level metadata, not per-row data. Keeping them as data columns forces the licensee to repeat the same dates on every row, which no real report does. Moving them to the metadata block also enables the parser to extract them correctly (see section 2.2).

### 1.2 Replace Data Columns

**Current `FLAT_COLUMNS`** (lines 39–44):
```python
FLAT_COLUMNS = [
    "Period Start",
    "Period End",
    "Net Sales",
    "Royalty Due",
]
```

**Current `CATEGORY_COLUMNS`** (lines 46–52):
```python
CATEGORY_COLUMNS = [
    "Period Start",
    "Period End",
    "Category",
    "Net Sales",
    "Royalty Due",
]
```

**Required `FLAT_COLUMNS`**:
```python
FLAT_COLUMNS = [
    "Product Description",
    "SKU",
    "Gross Sales",
    "Returns / Allowances",
    "Net Sales",
    "Royalty Rate",
    "Royalty Due",
]
```

**Required `CATEGORY_COLUMNS`**:
```python
CATEGORY_COLUMNS = [
    "Product Description",
    "SKU",
    "Category",
    "Gross Sales",
    "Returns / Allowances",
    "Net Sales",
    "Royalty Rate",
    "Royalty Due",
]
```

Column name choices are deliberate — each must match a synonym in `FIELD_SYNONYMS` to enable auto-mapping (see section 3 for the round-trip guarantee analysis):

| Column Name | Maps to | Synonym that matches |
|-------------|---------|----------------------|
| `Product Description` | `ignore` | none — intentionally ignored |
| `SKU` | `ignore` | none — intentionally ignored |
| `Category` | `product_category` | `"category"` in `product_category` synonyms |
| `Gross Sales` | `gross_sales` | `"gross sales"` in `gross_sales` synonyms |
| `Returns / Allowances` | `returns` | `"returns"` and `"allowances"` both in `returns` synonyms |
| `Net Sales` | `net_sales` | `"net sales"` in `net_sales` synonyms |
| `Royalty Rate` | `royalty_rate` | `"royalty rate"` in `royalty_rate` synonyms |
| `Royalty Due` | `licensee_reported_royalty` | `"royalty due"` in `licensee_reported_royalty` synonyms |

Note: "Returns / Allowances" matches the `returns` synonyms because `suggest_mapping` uses substring matching (`syn_lower in normalized`). The normalized form of "Returns / Allowances" is `"returns / allowances"`, which contains `"returns"`.

### 1.3 Pre-fill Royalty Rate Column

For flat-rate and tiered-rate contracts, pre-fill the "Royalty Rate" column in every data row with the rate value from the contract. This saves licensees from looking up their contract and reduces reporting errors.

- **Flat rate** (e.g., `"8%"`): write `"8%"` in every data row's Royalty Rate cell.
- **Tiered rate**: write `"See contract"` (or the full tiered description) — pre-filling per-row is not meaningful for tiered rates.
- **Category rate**: for the `CATEGORY_COLUMNS` template, write the rate for each pre-populated category row (see section 1.4). For blank rows, leave the cell empty.

Implementation: when building blank data rows (currently lines 182–183), write the rate value for the "Royalty Rate" column position rather than an empty string. For flat rates, this means every blank row has the rate pre-filled.

### 1.4 Pre-populate Category Names for Category-Rate Contracts

When `royalty_rate` is a dict, the contract keys are the category names (e.g., `{"Apparel": "8%", "Accessories": "12%", "Footwear": "10%"}`). Generate one skeleton data row per category with:

- Column `Category`: the category name
- Column `Royalty Rate`: the rate for that category
- All other columns: blank (for the licensee to fill in)

If there are more categories than data rows, expand accordingly. After the pre-populated category rows, do not add additional blank rows — the licensee will insert rows if needed. If there are no product categories on the contract, fall back to 10 blank rows.

### 1.5 Add TOTAL Row with SUM Formulas

After the data rows, append:

1. One blank separator row
2. A TOTAL row

The TOTAL row structure:
- Column A: `"TOTAL"` (bold)
- Numeric columns (Gross Sales, Returns / Allowances, Net Sales, Royalty Due): Excel SUM formula referencing the data rows range, e.g., `=SUM(C10:C19)` for a 10-row data table starting at row 10, column C.
- Non-numeric columns (Product Description, SKU, Category, Royalty Rate): left blank.

To construct the SUM formula range, track `data_start_row` (the first data row index, 1-based) and `data_end_row` (the last data row index). Use `openpyxl.utils.get_column_letter` to convert column index to letter.

### 1.6 Add Footer Rows

After the TOTAL row, append:

1. One blank separator row
2. `"Licensee Reported Royalty"` / blank value (two-column Label/Value row — licensee fills in their royalty check amount)
3. `"Notes"` / blank value (two-column Label/Value row)

These row labels match sample-1 and sample-2 exactly. The parser improvements in section 2.3 depend on this exact label text.

### 1.7 Excel Formatting Updates

Update `_COLUMN_WIDTHS` to reflect the new columns:

```python
_COLUMN_WIDTHS: dict[str, int] = {
    "Product Description": 35,
    "SKU": 18,
    "Category": 20,
    "Gross Sales": 16,
    "Returns / Allowances": 22,
    "Net Sales": 16,
    "Royalty Rate": 14,
    "Royalty Due": 16,
}
```

Remove old entries for `"Period Start"` and `"Period End"`.

Apply number format `'#,##0.00'` to all currency columns (Gross Sales, Returns / Allowances, Net Sales, Royalty Due) in both data rows and the TOTAL row. Apply it to the full column range using `ws.column_dimensions` number format, or cell by cell across data rows.

Apply `'0%'` or `'0.00%'` number format to the Royalty Rate column cells that contain pre-filled rate values.

The metadata block column A label cells should use `Font(bold=True)`. Column B value cells use the default font. The TOTAL row first cell uses `Font(bold=True)`.

Freeze pane should move from `header_row_idx + 1` to the data start row (one row below the data table header), since the header is now deeper in the sheet.

### 1.8 Updated Constant and Function Summary

Changes to `report_template.py`:

- **Remove** `FLAT_COLUMNS` and `CATEGORY_COLUMNS` as module-level constants. Replace with `_build_columns(royalty_rate)` that returns the column list so it can be tested independently.
- **Add** `_METADATA_LABELS` constant listing the metadata row labels in order.
- **Add** `_write_metadata_block(ws, contract)` helper that writes rows 1–8.
- **Add** `_write_data_rows(ws, columns, royalty_rate, product_categories, start_row)` helper that writes pre-populated rows and returns `(data_start_row, data_end_row)`.
- **Add** `_write_total_row(ws, columns, data_start_row, data_end_row, total_row_idx)` helper.
- **Add** `_write_footer_rows(ws, footer_start_row)` helper.
- **Update** `generate_report_template` to orchestrate the above helpers in sequence.

---

## 2. Parser Improvements

### 2.1 Fix `_looks_like_metadata_row()` to Recognize Two-Column Label/Value Rows

**Current implementation** (`spreadsheet_parser.py`, lines 221–240):

```python
def _looks_like_metadata_row(row: list) -> bool:
    non_empty = [cell for cell in row if cell is not None and str(cell).strip() != ""]
    if len(non_empty) > 2:
        return False
    if not non_empty:
        return False
    first = str(non_empty[0]).strip()
    # If first cell ends with ':' it's clearly a label:value row
    if first.endswith(":"):
        return True
    # If first cell contains ':' (e.g., "Prepared by: Jane Doe" in same cell)
    if ":" in first and len(non_empty) == 1:
        return True
    return False
```

**Bug**: The two-column `Label, Value` format used in sample-1 and sample-2 (e.g., `"Licensee Name", "Sunrise Apparel Co."`) does not end with `:` and does not contain `:`. This causes `_looks_like_metadata_row` to return `False`, so `_detect_header_row` does not skip these rows. Because the sample reports start with `"Licensee Name"` in column A, which is a two-cell string-like row, `_detect_header_row` may score it as a candidate header depending on what follows. The current parser passes for sample-1/2 in practice because the real header row at row 9 has more string columns and scores higher — but the function's intent is to explicitly skip metadata rows, and it fails to do so for the Label/Value format.

**Fix**: Extend the function to also return `True` for the two-column case where the first cell is a known metadata label (case-insensitive) and the second cell is a non-empty value. This is safer than a purely structural check (which could falsely match two-column data rows).

```python
# Known metadata label keywords (case-insensitive, substring match)
_METADATA_LABEL_KEYWORDS = {
    "licensee name", "licensor name", "contract number", "contract ref",
    "agreement ref", "reporting period", "report period", "period start",
    "period end", "report submission", "submission date", "territory",
    "prepared by", "fiscal period",
}

def _looks_like_metadata_row(row: list) -> bool:
    non_empty = [cell for cell in row if cell is not None and str(cell).strip() != ""]
    if len(non_empty) > 2:
        return False
    if not non_empty:
        return False
    first = str(non_empty[0]).strip()
    # Existing: ends with ':' is clearly a label
    if first.endswith(":"):
        return True
    # Existing: single cell containing ':' (e.g., "Prepared by: Jane Doe")
    if ":" in first and len(non_empty) == 1:
        return True
    # New: two-column Label/Value format — check if first cell matches a known label
    first_lower = first.lower()
    for keyword in _METADATA_LABEL_KEYWORDS:
        if keyword in first_lower:
            return True
    return False
```

The keyword list should cover all labels used in the generated template (section 1.1) plus common real-world variants from sample-3 (`"agreement ref"`, `"prepared by"`).

### 2.2 Extract Period Dates from Metadata into `MappedData`

**Current state**: `MappedData` (lines 58–66) has no `period_start` or `period_end` fields. Metadata rows are currently skipped by `_detect_header_row` (or passed through as `metadata` if a column is explicitly mapped to `"metadata"`) but never parsed for known date fields.

**Required changes**:

#### 2.2.1 Add fields to `MappedData`

```python
@dataclass
class MappedData:
    net_sales: Decimal
    category_sales: Optional[dict[str, Decimal]]
    licensee_reported_royalty: Optional[Decimal]
    gross_sales: Optional[Decimal] = None
    returns: Optional[Decimal] = None
    period_start: Optional[str] = None   # NEW
    period_end: Optional[str] = None     # NEW
    metadata: Optional[dict[str, list[str]]] = None
```

#### 2.2.2 Add `extract_metadata_from_rows()` helper

This function scans the raw rows that appear before the detected header row and extracts known key/value pairs.

```python
def _extract_period_from_raw_rows(raw_rows: list[list], header_idx: int) -> dict[str, Optional[str]]:
    """
    Scan rows 0..header_idx-1 for known period date labels.

    Returns dict with keys 'period_start' and 'period_end' (or None).
    """
    result = {"period_start": None, "period_end": None}
    for row in raw_rows[:header_idx]:
        non_empty = [str(c).strip() for c in row if c is not None and str(c).strip() != ""]
        if len(non_empty) != 2:
            continue
        label, value = non_empty[0].lower(), non_empty[1]
        if "period start" in label or "start date" in label:
            result["period_start"] = value
        elif "period end" in label or "end date" in label:
            result["period_end"] = value
    return result
```

#### 2.2.3 Store pre-header metadata in `ParsedSheet`

Add an optional field to `ParsedSheet`:

```python
@dataclass
class ParsedSheet:
    column_names: list[str]
    all_rows: list[dict]
    sample_rows: list[dict]
    data_rows: int
    sheet_name: str = "Sheet1"
    total_rows: int = 0
    pre_header_metadata: Optional[dict[str, str]] = None  # NEW
```

In `parse_upload` (`spreadsheet_parser.py`, lines 452–571), after computing `header_idx`, call `_extract_period_from_raw_rows` and store the result in the returned `ParsedSheet`.

#### 2.2.4 Populate `period_start` / `period_end` in `apply_mapping`

In `apply_mapping` (`spreadsheet_parser.py`, lines 578–713), after building the `MappedData` return value, check `parsed.pre_header_metadata` and pass through `period_start` and `period_end`:

```python
pre = parsed.pre_header_metadata or {}
return MappedData(
    net_sales=net_sales_total,
    category_sales=category_sales if category_sales else None,
    licensee_reported_royalty=...,
    gross_sales=...,
    returns=...,
    period_start=pre.get("period_start"),
    period_end=pre.get("period_end"),
    metadata=metadata_values if metadata_cols else None,
)
```

### 2.3 Extract Licensee Reported Royalty from Footer Rows

**Current behavior**: After the first TOTAL/summary row is found, `parse_upload` sets `found_summary = True` and skips all subsequent rows (lines 546–558):

```python
if found_summary:
    # Everything after first summary row is non-data
    continue
```

This means the "Licensee Reported Royalty" row in sample-1 and sample-2 is silently discarded. The `licensee_reported_royalty` field in `MappedData` is only populated when a data column is mapped to `licensee_reported_royalty` — which works for the per-row "Royalty Due" column, but that column value reflects per-SKU royalty, not the licensee's total check amount.

In the new template design, the "Royalty Due" per-row column is summed in the TOTAL row, and the "Licensee Reported Royalty" footer row contains the separate figure that the licensee self-declares. These are semantically different: one is calculated, one is self-reported. The parser should capture the self-reported figure from the footer.

**Required changes**:

#### 2.3.1 Add `post_summary_rows` pass in `parse_upload`

After the main loop, scan `data_raw` rows that come after the first summary row for footer label/value pairs. Add a `post_header_metadata` dict to `ParsedSheet` (or extend `pre_header_metadata` into a general `file_metadata` dict covering both pre-header and post-summary rows).

Simplest approach: add a separate `footer_metadata: Optional[dict[str, str]] = None` field to `ParsedSheet`. In the parse loop, instead of `continue` on `found_summary`, collect subsequent two-column label/value rows:

```python
footer_metadata: dict[str, str] = {}
for idx, row in enumerate(data_raw):
    if originally_empty[idx]:
        continue
    if found_summary:
        # Check for footer label/value rows
        non_empty = [str(c).strip() for c in row if c is not None and str(c).strip() != ""]
        if len(non_empty) == 2:
            label, value = non_empty[0], non_empty[1]
            footer_metadata[label.lower()] = value
        continue
    ...
```

Store `footer_metadata` in the returned `ParsedSheet`.

#### 2.3.2 Extract licensee-reported royalty from footer in `apply_mapping`

In `apply_mapping`, after aggregating data rows, check if `parsed.footer_metadata` contains a recognized royalty label:

```python
_LICENSEE_ROYALTY_FOOTER_LABELS = {
    "licensee reported royalty",
    "amount owed",
    "amount owed this period",
    "total royalty due",
    "royalty remittance",
}

footer = parsed.footer_metadata or {}
for label, value in footer.items():
    label_clean = label.lower().strip()
    if label_clean in _LICENSEE_ROYALTY_FOOTER_LABELS:
        val = _to_decimal_safe(value)
        if val is not None and not has_royalty_values:
            # Use footer value only if no per-row royalty column was mapped
            licensee_royalty_total = val
            has_royalty_values = True
```

The priority rule is: per-row `licensee_reported_royalty` column mapping takes precedence over the footer value. The footer value is the fallback for reports that do not have a "Royalty Due" data column but do have the footer row (sample-3-style reports that carry the royalty total only in the footer).

For template-generated files, the per-row "Royalty Due" column will be mapped to `licensee_reported_royalty` and summed. The "Licensee Reported Royalty" footer row value is available as a cross-check figure — store it in a new `MappedData` field:

```python
@dataclass
class MappedData:
    ...
    footer_reported_royalty: Optional[Decimal] = None  # NEW — from footer row only
```

This allows the royalty report upload endpoint to compare the sum of per-row "Royalty Due" values against the footer self-declared total and surface a discrepancy warning if they differ.

### 2.4 `VALID_FIELDS` and `product_description` / `sku`

**Current state**: `VALID_FIELDS` (lines 79–91) does not include `product_description` or `sku`. The parser will map these columns to `"ignore"`, which is the correct behavior — the application does not use these values for royalty calculation or cross-check.

**Decision**: Do not add `product_description` or `sku` to `VALID_FIELDS`. The `"ignore"` mapping is appropriate. This should be explicitly documented in the code comments near `VALID_FIELDS`:

```python
# Note: "product_description" and "sku" are intentionally excluded.
# These columns appear in real reports and templates but are not used
# in royalty calculation or cross-checking. They map to "ignore".
```

No code change required here — only a comment update.

---

## 3. Round-Trip Guarantee

A template generated by `generate_report_template`, filled in by the licensee, and uploaded back must auto-map with zero manual column mapping steps. This section documents the exact requirement and how to verify it.

### 3.1 Column Mapping Contract

Every column header in the generated template must map to the correct canonical field name via `suggest_mapping` with no saved mapping and no AI fallback. The following must hold when `suggest_mapping(column_names, saved_mapping=None)` is called with the template's data table headers:

| Template Column | Expected Field | Synonym Rule |
|-----------------|---------------|--------------|
| `Product Description` | `ignore` | No synonym matches — intentionally ignored |
| `SKU` | `ignore` | No synonym matches — intentionally ignored |
| `Category` | `product_category` | `"category"` is in `product_category` synonyms (line 115) |
| `Gross Sales` | `gross_sales` | `"gross sales"` is in `gross_sales` synonyms (line 107) |
| `Returns / Allowances` | `returns` | `"returns"` is a substring of `"returns / allowances"` (line 112) |
| `Net Sales` | `net_sales` | `"net sales"` is in `net_sales` synonyms (line 103) |
| `Royalty Rate` | `royalty_rate` | `"royalty rate"` is in `royalty_rate` synonyms (line 122) |
| `Royalty Due` | `licensee_reported_royalty` | `"royalty due"` is in `licensee_reported_royalty` synonyms (line 125) |

The existing test `test_column_names_match_suggest_mapping_synonyms` in `test_report_template.py` verifies this for `net_sales` and `licensee_reported_royalty`. It must be updated to also assert `gross_sales`, `returns`, and `royalty_rate` after the column changes.

### 3.2 Metadata Round-Trip

The metadata block label names in the template must match what `_extract_period_from_raw_rows` recognizes:

| Template Label | Recognized by parser? | Match rule |
|---------------|----------------------|------------|
| `Reporting Period Start` | Yes | `"period start"` in label |
| `Reporting Period End` | Yes | `"period end"` in label |
| `Licensee Name` | No (not extracted, but classified as metadata row) | `"licensee name"` in `_METADATA_LABEL_KEYWORDS` |
| `Territory` | No (not extracted) | `"territory"` in `_METADATA_LABEL_KEYWORDS` |

Period start and end will be extracted into `MappedData.period_start` and `MappedData.period_end` automatically.

### 3.3 Footer Round-Trip

The footer row `"Licensee Reported Royalty"` in the template will be captured by `footer_metadata` after the TOTAL row, and `apply_mapping` will populate `MappedData.footer_reported_royalty` from it.

The per-row "Royalty Due" column will be mapped to `licensee_reported_royalty` and summed into `MappedData.licensee_reported_royalty`. The footer value is a separate cross-check figure in `footer_reported_royalty`.

---

## 4. Files to Change

### `backend/app/services/report_template.py`

| Change | Description |
|--------|-------------|
| Remove `FLAT_COLUMNS` and `CATEGORY_COLUMNS` module constants | Replace with `_build_columns(royalty_rate)` function |
| Add `_METADATA_LABELS` constant | Ordered list of metadata row labels |
| Add `_write_metadata_block(ws, contract)` helper | Writes rows 1–8, returns `next_row` index |
| Update `FLAT_COLUMNS` and `CATEGORY_COLUMNS` values | Add Product Description, SKU, Gross Sales, Returns / Allowances, Royalty Rate; remove Period Start, Period End |
| Update `_COLUMN_WIDTHS` | Reflect new column set |
| Add `_write_data_rows(...)` helper | Handles pre-population for category rates and royalty rate pre-fill |
| Add `_write_total_row(...)` helper | SUM formulas for numeric columns |
| Add `_write_footer_rows(ws, start_row)` helper | Writes "Licensee Reported Royalty" and "Notes" rows |
| Add number format application | Currency format on Gross Sales, Returns, Net Sales, Royalty Due columns |
| Update `generate_report_template` | Orchestrate new helpers; update freeze_panes to data start row |

### `backend/app/services/spreadsheet_parser.py`

| Change | Location | Description |
|--------|----------|-------------|
| Add `_METADATA_LABEL_KEYWORDS` constant | After line 76 | Set of known metadata label strings |
| Update `_looks_like_metadata_row` | Lines 221–240 | Add keyword-based check for Label/Value format |
| Add `_LICENSEE_ROYALTY_FOOTER_LABELS` constant | After `SUMMARY_KEYWORDS` | Set of recognized footer royalty labels |
| Add `_extract_period_from_raw_rows` helper | New function | Scan pre-header rows for period dates |
| Update `ParsedSheet` dataclass | Lines 47–55 | Add `pre_header_metadata: Optional[dict[str, str]]` and `footer_metadata: Optional[dict[str, str]]` fields |
| Update `MappedData` dataclass | Lines 58–66 | Add `period_start`, `period_end`, `footer_reported_royalty` fields |
| Update `parse_upload` | Lines 452–571 | Call `_extract_period_from_raw_rows`; collect `footer_metadata` in post-summary loop |
| Update `apply_mapping` | Lines 578–713 | Populate `period_start`, `period_end`, `footer_reported_royalty` from parsed metadata |
| Add comment to `VALID_FIELDS` | Lines 79–91 | Document that `product_description` and `sku` are intentionally excluded |

### `backend/tests/test_report_template.py`

See section 6.1 for specific new tests required.

### `backend/tests/test_spreadsheet_parser.py`

See section 6.2 for specific new tests required.

---

## 5. Migration Needs

None. All changes are in application logic (service layer and tests). No database schema changes are required.

- `MappedData` is an in-memory dataclass — not persisted to the database.
- `ParsedSheet` is an in-memory dataclass — not persisted.
- The `sales_periods` table stores the final `net_sales`, `royalty_calculated`, and `licensee_reported_royalty` values. If `period_start` and `period_end` are to be saved to `sales_periods`, that is a separate feature decision and would require a migration. This spec does not propose storing them — they are made available in `MappedData` for the upload endpoint to use in the confirm step (e.g., to pre-fill the period dates in the sales period creation form).

---

## 6. Test Plan

### 6.1 Template Generation Tests (`test_report_template.py`)

The following tests must be added or updated. Tests marked **UPDATE** require modifying an existing test; tests marked **ADD** are new.

#### Metadata Block

**ADD** `test_metadata_block_present`: Generate a flat-rate template. Verify that the sheet contains cells with text `"Licensee Name"`, `"Contract Number"`, `"Reporting Period Start"`, `"Reporting Period End"`, `"Territory"` each in column A of distinct rows before the data table header row.

**ADD** `test_metadata_block_licensee_name_prefilled`: Contract has `licensee_name="Sunrise Apparel Co."`. The cell in column B of the "Licensee Name" row equals `"Sunrise Apparel Co."`.

**ADD** `test_metadata_block_period_dates_blank`: The column B cells for "Reporting Period Start" and "Reporting Period End" rows are empty (None or `""`). Period dates must not be pre-filled — the licensee enters them.

**ADD** `test_metadata_block_territory_prefilled`: Contract has `territories=["United States", "Canada"]`. The "Territory" row column B value equals `"United States, Canada"`.

**ADD** `test_metadata_block_territory_blank_when_no_territories`: Contract has `territories=[]`. The "Territory" row column B is blank.

#### Data Columns

**UPDATE** `test_flat_rate_has_required_columns`: Replace assertions for `"Period Start"` and `"Period End"` with assertions for `"Product Description"`, `"SKU"`, `"Gross Sales"`, `"Returns / Allowances"`, `"Net Sales"`, `"Royalty Rate"`, `"Royalty Due"`.

**ADD** `test_flat_rate_has_no_period_columns`: The data table header row must not contain `"Period Start"` or `"Period End"` as column headers.

**UPDATE** `test_category_rate_includes_category_column`: Keep assertion for `"Category"`. Add assertions for `"Gross Sales"` and `"Returns / Allowances"`.

**ADD** `test_tiered_rate_has_no_category_column`: Tiered-rate template column headers do not include `"Category"`. (Currently this test exists as `test_tiered_rate_has_required_columns` — extend it rather than duplicate.)

#### Royalty Rate Pre-fill

**ADD** `test_flat_rate_royalty_rate_column_prefilled`: Flat-rate contract with `royalty_rate="8%"`. Every data row (up to the 10 blank rows) has `"8%"` in the Royalty Rate column.

**ADD** `test_category_rate_rows_prefilled_with_per_category_rate`: Category-rate contract with `{"Apparel": "10%", "Accessories": "12%"}`. The generated data rows include one row where Category=`"Apparel"` and Royalty Rate=`"10%"`, and one row where Category=`"Accessories"` and Royalty Rate=`"12%"`.

**ADD** `test_tiered_rate_royalty_rate_column_not_prefilled_with_number`: Tiered-rate contract. The Royalty Rate column in data rows does not contain a simple percentage string — it contains `"See contract"` or is blank.

#### TOTAL Row

**ADD** `test_total_row_present`: The sheet contains a row where the first non-empty cell value is `"TOTAL"`.

**ADD** `test_total_row_net_sales_has_sum_formula`: Open the template with `keep_vba=False, data_only=False` so formulas are visible. Find the TOTAL row. The cell in the Net Sales column position contains a string starting with `"=SUM("`.

**ADD** `test_total_row_position_after_data_rows`: The TOTAL row appears after all data rows and before the footer rows.

#### Footer Rows

**ADD** `test_footer_licensee_reported_royalty_present`: The sheet contains a row where column A contains `"Licensee Reported Royalty"` and column B is blank or None.

**ADD** `test_footer_notes_row_present`: The sheet contains a row where column A contains `"Notes"`.

#### Round-Trip Column Recognition

**UPDATE** `test_column_names_match_suggest_mapping_synonyms`: Extend to assert that `gross_sales`, `returns`, and `royalty_rate` are also recognized by `suggest_mapping`. Full assertion set:
- `net_sales` recognized
- `gross_sales` recognized
- `returns` recognized
- `royalty_rate` recognized
- `licensee_reported_royalty` recognized
- `product_category` recognized (for category-rate contracts — move from `test_category_column_recognized_by_suggest_mapping`)

### 6.2 Parser Tests (`test_spreadsheet_parser.py`)

#### `_looks_like_metadata_row` with Label/Value format

**ADD** `TestLooksLikeMetadataRow` class:

- `test_colon_suffix_returns_true`: `["Licensee:", "Sunrise Apparel Co."]` → `True`
- `test_single_cell_with_colon_returns_true`: `["Prepared by: Jane Doe"]` → `True`
- `test_two_column_known_label_returns_true`: `["Licensee Name", "Sunrise Apparel Co."]` → `True`
- `test_two_column_known_label_period_start_returns_true`: `["Reporting Period Start", "2025-01-01"]` → `True`
- `test_two_column_known_label_contract_number_returns_true`: `["Contract Number", "BC-2024-0042"]` → `True`
- `test_two_column_unknown_label_returns_false`: `["APP-001", "Apparel"]` → `False` (normal data row — two string cells but not a known metadata label)
- `test_three_cells_returns_false`: `["Licensee Name", "Value", "Extra"]` → `False`
- `test_all_empty_returns_false`: `[None, None, ""]` → `False`

#### Period Date Extraction

**ADD** `TestPeriodDateExtraction` class:

- `test_period_start_extracted_from_csv_metadata`: Parse a CSV with `"Reporting Period Start,2025-01-01"` before the header row. `result.pre_header_metadata["period_start"]` == `"2025-01-01"`.
- `test_period_end_extracted_from_csv_metadata`: Same for `"Reporting Period End,2025-03-31"`. `result.pre_header_metadata["period_end"]` == `"2025-03-31"`.
- `test_both_period_dates_extracted`: CSV with both labels. Both fields populated.
- `test_period_dates_none_when_no_metadata`: CSV with no metadata block (header at row 0). `result.pre_header_metadata` is `None` or both fields are `None`.
- `test_apply_mapping_populates_period_start_end`: Call `apply_mapping` on a `ParsedSheet` whose `pre_header_metadata` contains both period dates. `result.period_start` and `result.period_end` are populated.

#### Footer Metadata Extraction

**ADD** `TestFooterMetadataExtraction` class:

- `test_licensee_reported_royalty_extracted_from_footer`: CSV with TOTAL row followed by `"Licensee Reported Royalty,6384.00"`. `result.footer_metadata` contains the label/value pair.
- `test_footer_royalty_in_mapped_data`: `apply_mapping` on the above sheet (no `licensee_reported_royalty` data column mapped). `mapped.footer_reported_royalty` == `Decimal("6384.00")`.
- `test_per_row_royalty_takes_precedence_over_footer`: Sheet has both a "Royalty Due" data column and a footer row. `mapped.licensee_reported_royalty` = sum of per-row values; `mapped.footer_reported_royalty` = footer value. Neither overwrites the other.
- `test_footer_after_blank_row_still_captured`: Footer row separated from TOTAL by a blank row. Still captured.
- `test_notes_row_not_confused_with_royalty_footer`: `"Notes,Some text here"` after TOTAL does not populate `footer_reported_royalty`.

#### Sample File Parsing

**ADD** `TestSampleFilesParsing` class (loads actual sample CSV files from `docs/product/prd/royalty-report/sample-reports/`):

- `test_sample_1_flat_rate_parses_correctly`: Load `sample-1-flat-rate.csv` as bytes. Parse. Assert `data_rows == 1`, `column_names` includes `"Net Sales"`, `pre_header_metadata["period_start"] == "2025-01-01"`, `pre_header_metadata["period_end"] == "2025-03-31"`.
- `test_sample_1_apply_mapping_round_trip`: Parse sample-1, call `suggest_mapping` on its columns, call `apply_mapping`. Assert `mapped.net_sales == Decimal("83300.00")` and `mapped.footer_reported_royalty == Decimal("6384.00")`.
- `test_sample_2_category_rates_parses_correctly`: Load `sample-2-category-rates.csv`. Assert `data_rows == 11`, `category_sales` has entries for Apparel, Accessories, Footwear.
- `test_sample_3_messy_parses_correctly`: Load `sample-3-messy-real-world.csv`. Assert `data_rows == 10` and `column_names` includes the detected header (not the title rows). `pre_header_metadata` may be `None` or partially populated (sample-3 uses single-cell title rows, not Label/Value pairs — the parser should not crash).

---

## 7. Out of Scope

The following are noted as future work and should not be included in this implementation:

- Persisting `period_start` and `period_end` from `MappedData` to the `sales_periods` table. This would require a migration and a decision about how to handle conflicts with the period range already captured at sales period creation.
- Generating a PDF version of the template.
- Sending the template directly to the licensee by email (covered separately in the email intake spec).
- Frontend changes to display `period_start`/`period_end` from the upload confirm response. The parser improvement makes the data available in the API response; surfacing it in the UI is a separate task.
- Tiered-rate per-row royalty calculation in the template (e.g., generating a formula that applies the correct tier). The Royalty Due column in tiered templates will remain blank for the licensee to fill.
