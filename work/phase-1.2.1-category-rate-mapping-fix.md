# Phase 1.2.1 — Category Rate Column Mapping Fix

## Problem Statement

When a user uploads `sample-2-category-rates.csv`, the auto-mapper produces a silent data corruption:
both the "Royalty Rate" column and the "Royalty Due" column are suggested as
`licensee_reported_royalty`. This happens because `suggest_mapping` does substring matching
and the bare keyword `"royalty"` in `FIELD_SYNONYMS["licensee_reported_royalty"]` matches
any column name that contains the word "royalty" — which includes "Royalty Rate".

In the CSV, the data header row is:

```
Product Description, SKU, Product Category, Gross Sales, Returns / Allowances,
Net Sales, Royalty Rate, Royalty Due
```

The word "royalty" appears in both "Royalty Rate" and "Royalty Due". The current synonym list
has `"royalty"` as its first entry, so both columns match it before any more-specific synonym
gets a chance to run. The user would see two columns suggested as `licensee_reported_royalty`
with no indication anything is wrong.

---

## Question 1: Should "Royalty Rate" be a mappable field or "ignore"?

### Recommendation: Map to "ignore" — do not add it as a new canonical field for MVP.

The Likha system is licensor-facing. Royalty rates are authoritative from the contract record
stored in Likha, not from the licensee's self-reported CSV. For this contract (BC-2024-0078),
the rates are defined per category in the contract:

- Apparel: 10%
- Accessories: 12%
- Footwear: 8%

The "Royalty Rate" column in the licensee's spreadsheet is informational. It confirms which
rate the licensee applied, but Likha's royalty calculation engine uses the contract-stored
rates. Accepting a rate column from the CSV as an input would:

1. Create ambiguity about which rates are authoritative (contract vs. spreadsheet).
2. Open a vector for licensee error or manipulation to go undetected.
3. Add complexity to the royalty calculation path that is not needed at this stage.

The right use of the "Royalty Rate" column — when present — is as a cross-check that the
licensee applied the correct rates. That is a future discrepancy-detection feature, not MVP.

For now: "Royalty Rate" columns should be auto-mapped to `"ignore"`. The synonym table should
include specific rate-flavored keywords that route to `"ignore"` ahead of the royalty amount
synonyms, or the royalty amount synonyms should be tightened so they no longer match rate
columns by substring.

---

## Question 2: How should "Royalty Due" (per-line) vs. the summary row be used?

### Recommendation: Use the per-line "Royalty Due" column summed across rows, not the summary row value.

There are three representations of the licensee's reported royalty total in this CSV:

1. Per-line "Royalty Due" column values (rows 10-20 in the file): individual SKU-level amounts
2. TOTAL row (row 22): `14130.00` in the "Royalty Due" column of the aggregate summary row
3. Dedicated summary row (row 24): `Licensee Reported Royalty, 14130.00`

The parser already strips the TOTAL row via `_is_summary_row()` detection. It also only reads
rows from `data_rows_list`, which excludes the summary row at line 24 since that row follows
the TOTAL row and `found_summary` is set to `True` after the TOTAL row is encountered — meaning
row 24 never enters `data_rows_list`. So the parser cannot read the dedicated summary row
directly from `all_rows`.

This means `apply_mapping` must sum the per-line "Royalty Due" values from the data rows.
That is the correct approach anyway, because:

- It is consistent with how `net_sales` is aggregated (row-by-row summation).
- It works whether or not the licensee includes a summary row.
- It does not depend on the structural position of the summary row, which varies across
  licensees and file formats.
- The summed result will equal the summary row total in a correct report, providing a natural
  internal consistency check if we later want to surface it.

Verified: 1730 + 890 + 2140 + 1420 + 1320 + 1014 + 492 + 708 + 2304 + 1440 + 672 = 14130.00.
The per-line sum matches the summary row value, so using row-level data is accurate.

---

## Question 3: What synonyms should distinguish "Royalty Due" from "Royalty Rate"?

### Root Cause

The `suggest_mapping` function uses case-insensitive substring matching. The current first
synonym for `licensee_reported_royalty` is `"royalty"` — a bare, three-syllable word that
appears in every royalty-related column name. This is too broad.

The matching loop also checks fields in FIELD_SYNONYMS insertion order, and within each field
it checks synonyms in list order. The bare `"royalty"` entry fires immediately on any column
containing that word, so "Royalty Rate" and "Royalty Due" are treated identically.

### Fix

Two coordinated changes are needed:

**Change A: Remove the bare `"royalty"` synonym from `licensee_reported_royalty`.**

The bare keyword is the proximate cause of the ambiguity. Every more-specific synonym already
covers the legitimate cases ("royalty due", "amount due", "calculated royalty", "total royalty").
No licensee column named simply "Royalty" would be left unmatched — but that is the right
tradeoff. If a column is just "Royalty" with no qualifier, the user reviewing the mapping
screen can select the correct field manually in one click.

**Change B: Add explicit synonyms that route "Royalty Rate" columns to `"ignore"`.**

The `VALID_FIELDS` set already includes `"ignore"` as a target. The synonym table does not
currently have a mechanism to explicitly route known-but-irrelevant columns to `"ignore"`.
The cleanest approach is to add `"royalty rate"` and `"rate"` as a new entry under a
dedicated `"ignore"` key, or to handle it via a pre-pass exclusion list.

However, adding `"rate"` as a broad ignore synonym would incorrectly suppress legitimate
columns that happen to contain "rate" (e.g., "Net Sales Rate" in some formats). The safer
approach is to match specific patterns: `"royalty rate"`, `"applicable rate"`, `"rate per
category"`, `"rate %"`, `"royalty %"`.

These patterns are specific enough to identify rate-display columns without capturing
financial amount columns.

### Recommended FIELD_SYNONYMS Changes

```python
FIELD_SYNONYMS: dict[str, list[str]] = {
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
        "royalty due", "amount due", "calculated royalty",
        "total royalty", "royalties due", "royalty amount",
        "royalties payable", "royalty payable"
    ],
    "territory": [
        "territory", "region", "market", "country", "geography"
    ],
}

# Columns that should always be ignored — checked before FIELD_SYNONYMS
IGNORE_SYNONYMS: list[str] = [
    "royalty rate", "applicable rate", "rate per category",
    "royalty %", "rate %", "sku", "product description",
    "description", "product name", "item number", "item #",
    "style", "style number", "upc",
]
```

The `IGNORE_SYNONYMS` list is evaluated first in `suggest_mapping`, before iterating
`FIELD_SYNONYMS`. If a column matches any entry in `IGNORE_SYNONYMS`, it is immediately
mapped to `"ignore"` without consulting the main synonym table.

This approach keeps the two concerns separate: "what should be ignored" is its own explicit
list, rather than encoding it as a negative pattern inside FIELD_SYNONYMS. It also makes it
easy for future developers to add new always-ignore patterns (like "SKU" or "Product
Description") without touching the financial field matching logic.

### Updated `suggest_mapping` Logic

```python
def suggest_mapping(
    column_names: list[str],
    saved_mapping: Optional[dict[str, str]],
) -> dict[str, str]:
    result: dict[str, str] = {}

    for col in column_names:
        # 1. Check saved mapping first
        if saved_mapping and col in saved_mapping:
            result[col] = saved_mapping[col]
            continue

        normalized = col.lower().strip()
        padded = " " + normalized

        # 2. Check explicit ignore list before field synonyms
        is_ignore = False
        for ignore_kw in IGNORE_SYNONYMS:
            if ignore_kw in normalized:
                is_ignore = True
                break
        if is_ignore:
            result[col] = "ignore"
            continue

        # 3. Keyword synonym matching (case-insensitive, substring)
        matched_field = "ignore"
        for field_name, synonyms in FIELD_SYNONYMS.items():
            for synonym in synonyms:
                syn_lower = synonym.lower()
                if syn_lower in normalized or syn_lower in padded:
                    matched_field = field_name
                    break
            if matched_field != "ignore":
                break

        result[col] = matched_field

    return result
```

---

## Expected Behavior After Fix

For the column names in `sample-2-category-rates.csv`:

| Column Name             | Current Suggestion             | Correct Suggestion             |
|-------------------------|--------------------------------|--------------------------------|
| Product Description     | ignore                         | ignore (via IGNORE_SYNONYMS)   |
| SKU                     | ignore                         | ignore (via IGNORE_SYNONYMS)   |
| Product Category        | product_category               | product_category               |
| Gross Sales             | gross_sales                    | gross_sales                    |
| Returns / Allowances    | returns                        | returns                        |
| Net Sales               | net_sales                      | net_sales                      |
| Royalty Rate            | licensee_reported_royalty (BUG)| ignore (via IGNORE_SYNONYMS)   |
| Royalty Due             | licensee_reported_royalty      | licensee_reported_royalty      |

"Royalty Due" still resolves correctly because the synonym `"royalty due"` is an exact match
(substring) against the normalized column name `"royalty due"`. The more-specific
`IGNORE_SYNONYMS` check for `"royalty rate"` does not match "royalty due", so it falls through
to the FIELD_SYNONYMS lookup where `"royalty due"` is found.

---

## Files to Change

**Backend:**
- `/Users/bobsantos/likha/dev/likha-app/backend/app/services/spreadsheet_parser.py`
  - Remove `"royalty"` from `FIELD_SYNONYMS["licensee_reported_royalty"]`
  - Add `IGNORE_SYNONYMS` list constant after `FIELD_SYNONYMS`
  - Update `suggest_mapping` to check `IGNORE_SYNONYMS` before `FIELD_SYNONYMS`

**Tests:**
- `/Users/bobsantos/likha/dev/likha-app/backend/tests/` — add or update tests for
  `suggest_mapping` covering:
  - "Royalty Rate" maps to "ignore"
  - "Royalty Due" maps to "licensee_reported_royalty"
  - "Royalty %" maps to "ignore"
  - A bare "Royalty" column maps to "ignore" (acceptable manual-intervention case)
  - Regression: existing mappings for "Net Sales", "Gross Sales", "Returns" are unaffected

---

## Out of Scope for This Fix

- Using the "Royalty Rate" column from the CSV as a cross-check against contract rates.
  That is a discrepancy-detection feature and belongs in a future phase.
- Reading the dedicated `Licensee Reported Royalty, 14130.00` summary row. The parser
  architecture excludes post-TOTAL rows from `data_rows_list`, and the row-level summation
  approach is correct and sufficient.
- Adding a `royalty_rate` canonical field to `VALID_FIELDS`. Not needed until the
  cross-check feature is built.
