"""
Spreadsheet parser service (Phase 1.1).

Parses .xlsx, .xls, and .csv files uploaded by licensors and maps detected
columns to canonical Likha field names.

Public API:
  parse_upload(file_content, filename)  -> ParsedSheet
  apply_mapping(parsed, column_mapping) -> MappedData
  suggest_mapping(column_names, saved_mapping) -> dict[str, str]
"""

import io
import logging
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ParseError(Exception):
    """Raised when a file cannot be parsed."""
    def __init__(self, message: str, error_code: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


class MappingError(Exception):
    """Raised when a column mapping is invalid or produces bad data."""
    def __init__(self, message: str, error_code: str):
        super().__init__(message)
        self.error_code = error_code
        self.message = message


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ParsedSheet:
    """Result of parse_upload()."""
    column_names: list[str]           # detected column headers
    all_rows: list[dict]              # all data rows as dicts {col_name: str_value}
    sample_rows: list[dict]           # first 5 data rows (same format)
    data_rows: int                    # total data rows (excl. header + summary rows)
    sheet_name: str = "Sheet1"
    total_rows: int = 0               # total rows in file including header


@dataclass
class MappedData:
    """Result of apply_mapping()."""
    net_sales: Decimal
    category_sales: Optional[dict[str, Decimal]]
    licensee_reported_royalty: Optional[Decimal]
    gross_sales: Optional[Decimal] = None
    returns: Optional[Decimal] = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SUPPORTED_EXTENSIONS = {".xlsx", ".xls", ".csv"}

# Summary row detection keywords (first non-empty cell, case-insensitive)
SUMMARY_KEYWORDS = {"total", "subtotal", "sum", "grand total", "totals"}

# Valid canonical Likha field names
VALID_FIELDS = {
    "net_sales",
    "gross_sales",
    "returns",
    "product_category",
    "licensee_reported_royalty",
    "territory",
    "ignore",
}

# Keyword synonyms for column matching — order determines priority
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
        "royalty", "royalty due", "amount due", "calculated royalty",
        "total royalty"
    ],
    "territory": [
        "territory", "region", "market", "country", "geography"
    ],
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_extension(filename: str) -> str:
    """Return lower-case file extension including the dot."""
    dot = filename.rfind(".")
    if dot == -1:
        return ""
    return filename[dot:].lower()


def _is_numeric_value(value) -> bool:
    """Return True if value can be interpreted as a number (int, float, Decimal, or numeric string)."""
    if isinstance(value, (int, float)):
        return True
    if value is None:
        return False
    try:
        Decimal(str(value).replace(",", ""))
        return True
    except InvalidOperation:
        return False


def _is_date_like(value) -> bool:
    """Return True if value looks like a date."""
    import re
    if value is None:
        return False
    s = str(value).strip()
    # Match common date patterns: YYYY-MM-DD, MM/DD/YYYY, etc.
    date_patterns = [
        r"^\d{4}-\d{2}-\d{2}$",
        r"^\d{2}/\d{2}/\d{4}$",
        r"^\d{1,2}/\d{1,2}/\d{2,4}$",
    ]
    return any(re.match(p, s) for p in date_patterns)


def _cell_is_string_like(value) -> bool:
    """Return True if value is a non-empty string that is not numeric or date-like."""
    if value is None:
        return False
    s = str(value).strip()
    if not s:
        return False
    if _is_numeric_value(s):
        return False
    if _is_date_like(s):
        return False
    return True


def _is_summary_row(row_cells: list) -> bool:
    """Return True if this row looks like a TOTAL/SUBTOTAL summary row."""
    for cell in row_cells:
        if cell is None:
            continue
        s = str(cell).strip().lower()
        if s in SUMMARY_KEYWORDS:
            return True
        # Also check if cell starts with a summary keyword
        for kw in SUMMARY_KEYWORDS:
            if s.startswith(kw):
                return True
        # Stop at first non-empty cell
        break
    return False


def _row_is_all_empty(row_cells: list) -> bool:
    """Return True if all cells in the row are None or empty string."""
    return all(
        cell is None or str(cell).strip() == ""
        for cell in row_cells
    )


def _looks_like_metadata_row(row: list) -> bool:
    """
    Return True if this row looks like a label:value metadata row.

    Metadata rows typically have only 1-2 populated cells where the first cell
    ends with ':' or contains a colon (a label) and the second is a value.
    """
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


def _detect_header_row(all_rows: list[list]) -> int:
    """
    Find the index (0-based) of the header row.

    Algorithm:
    1. Check up to the first 20 rows.
    2. Score each row by (string_count, subsequent_numeric_count).
    3. Header row = first row with max string_count AND at least 1 subsequent
       row with numeric values.  Among ties, pick the earliest row.
    4. Skip metadata rows (label:value pairs).
    5. Fallback: first row with >= 2 string cells followed by a numeric row,
       or row 0.
    """
    max_scan = min(20, len(all_rows))

    # Calculate the max number of non-empty columns in any row
    max_cols = max(
        (sum(1 for c in row if c is not None and str(c).strip() != "")
         for row in all_rows[:max_scan] if row),
        default=1,
    )

    # Score each candidate: (string_count, index)
    candidates: list[tuple[int, int]] = []  # (string_count, row_index)

    for i in range(max_scan):
        row = all_rows[i]
        if _row_is_all_empty(row):
            continue

        # Skip metadata rows (label: value pairs with <= 2 cells)
        if _looks_like_metadata_row(row):
            continue

        string_count = sum(1 for cell in row if _cell_is_string_like(cell))
        if string_count < 2:
            continue

        # Check if there is at least one subsequent data row with numeric values
        has_numeric_following = False
        for j in range(i + 1, min(i + 6, len(all_rows))):
            next_row = all_rows[j]
            if _row_is_all_empty(next_row):
                continue
            numeric_count = sum(1 for cell in next_row if _is_numeric_value(cell))
            if numeric_count >= 1:
                has_numeric_following = True
                break

        if has_numeric_following:
            candidates.append((string_count, i))

    if not candidates:
        return 0

    # Pick the candidate with the highest string_count; on tie, pick earliest
    best_string_count = max(c[0] for c in candidates)
    for string_count, row_idx in candidates:
        if string_count == best_string_count:
            return row_idx

    return 0


def _forward_fill_column(rows: list[list], col_idx: int) -> list[list]:
    """
    Forward-fill None values in a specific column index.
    Used for merged category cells.
    """
    last_value = None
    result = []
    for row in rows:
        row_copy = list(row)
        if col_idx < len(row_copy):
            if row_copy[col_idx] is None and last_value is not None:
                row_copy[col_idx] = last_value
            elif row_copy[col_idx] is not None:
                last_value = row_copy[col_idx]
        result.append(row_copy)
    return result


def _to_decimal_safe(value) -> Optional[Decimal]:
    """Convert a value to Decimal, returning None if not possible."""
    if value is None:
        return None
    s = str(value).strip().replace(",", "")
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _cell_to_str(value) -> str:
    """Convert a cell value to string representation."""
    if value is None:
        return ""
    return str(value).strip()


# ---------------------------------------------------------------------------
# CSV parsing
# ---------------------------------------------------------------------------

def _parse_csv_bytes(file_content: bytes) -> tuple[list[list], str]:
    """
    Parse CSV bytes with encoding fallback.
    Returns (list_of_rows, encoding_used).
    """
    import csv

    encodings_to_try = ["utf-8", "utf-8-sig", "windows-1252", "latin-1"]

    for encoding in encodings_to_try:
        try:
            text = file_content.decode(encoding)
            reader = csv.reader(io.StringIO(text))
            rows = [row for row in reader]
            return rows, encoding
        except (UnicodeDecodeError, Exception):
            continue

    raise ParseError(
        "CSV file could not be decoded with any supported encoding",
        "parse_failed",
    )


# ---------------------------------------------------------------------------
# xlsx parsing
# ---------------------------------------------------------------------------

def _parse_xlsx_bytes(file_content: bytes) -> tuple[list[list[list]], list[str]]:
    """
    Parse xlsx bytes.
    Returns (list_of_sheets_as_row_lists, sheet_names).
    """
    import openpyxl

    try:
        wb = openpyxl.load_workbook(
            io.BytesIO(file_content),
            data_only=True,
        )
    except Exception as e:
        raise ParseError(f"Could not parse xlsx file: {e}", "parse_failed")

    sheet_names = wb.sheetnames
    sheets = []
    for ws in wb.worksheets:
        sheet_rows = []
        for row in ws.iter_rows(values_only=True):
            sheet_rows.append(list(row))
        sheets.append(sheet_rows)

    return sheets, sheet_names


# ---------------------------------------------------------------------------
# xls parsing
# ---------------------------------------------------------------------------

def _parse_xls_bytes(file_content: bytes) -> tuple[list[list[list]], list[str]]:
    """
    Parse xls bytes using xlrd.
    Returns (list_of_sheets_as_row_lists, sheet_names).
    """
    try:
        import xlrd
    except ImportError:
        raise ParseError("xlrd is not installed; cannot parse .xls files", "parse_failed")

    try:
        wb = xlrd.open_workbook(file_contents=file_content)
    except Exception as e:
        raise ParseError(f"Could not parse xls file: {e}", "parse_failed")

    sheet_names = wb.sheet_names()
    sheets = []
    for ws in wb.sheets():
        sheet_rows = []
        for row_idx in range(ws.nrows):
            row = []
            for col_idx in range(ws.ncols):
                cell = ws.cell(row_idx, col_idx)
                # xlrd cell types: 0=empty, 1=text, 2=number, 3=date, 4=bool, 5=error
                import xlrd as _xlrd
                if cell.ctype == _xlrd.XL_CELL_EMPTY:
                    row.append(None)
                elif cell.ctype == _xlrd.XL_CELL_NUMBER:
                    # Return int if whole number, else float
                    v = cell.value
                    row.append(int(v) if v == int(v) else v)
                elif cell.ctype == _xlrd.XL_CELL_DATE:
                    row.append(str(cell.value))
                else:
                    row.append(cell.value)
        sheet_rows.append(row)
        sheets.append(sheet_rows)

    return sheets, sheet_names


# ---------------------------------------------------------------------------
# Core parse_upload
# ---------------------------------------------------------------------------

def parse_upload(file_content: bytes, filename: str) -> ParsedSheet:
    """
    Parse an uploaded spreadsheet file and return structured data.

    Args:
        file_content: Raw bytes of the uploaded file.
        filename: Original filename (used to determine file type).

    Returns:
        ParsedSheet with detected columns, sample rows, and data row count.

    Raises:
        ParseError: If the file type is unsupported or the file cannot be parsed.
    """
    ext = _get_extension(filename)

    if ext not in SUPPORTED_EXTENSIONS:
        raise ParseError(
            f"Unsupported file type '{ext}'. Upload a .xlsx, .xls, or .csv file.",
            "unsupported_file_type",
        )

    # Parse to raw rows
    if ext == ".xlsx":
        sheets, sheet_names = _parse_xlsx_bytes(file_content)
        # Use first sheet; fall back to second if first has < 3 rows
        active_sheet_idx = 0
        if len(sheets) > 1 and len(sheets[0]) < 3:
            active_sheet_idx = 1
        raw_rows = sheets[active_sheet_idx]
        sheet_name = sheet_names[active_sheet_idx]

    elif ext == ".xls":
        sheets, sheet_names = _parse_xls_bytes(file_content)
        active_sheet_idx = 0
        if len(sheets) > 1 and len(sheets[0]) < 3:
            active_sheet_idx = 1
        raw_rows = sheets[active_sheet_idx]
        sheet_name = sheet_names[active_sheet_idx]

    else:  # .csv
        raw_rows, _ = _parse_csv_bytes(file_content)
        # Convert list-of-lists of strings (csv reader returns strings)
        raw_rows = [row for row in raw_rows]
        sheet_name = "Sheet1"

    if not raw_rows:
        raise ParseError("File is empty", "parse_failed")

    # Detect header row
    header_idx = _detect_header_row(raw_rows)
    header_row = raw_rows[header_idx]

    # Forward-fill None headers (merged header cells)
    filled_headers: list[Optional[str]] = []
    last_header = None
    for cell in header_row:
        if cell is None or str(cell).strip() == "":
            filled_headers.append(last_header)
        else:
            last_header = str(cell).strip()
            filled_headers.append(last_header)

    # Build column names (deduplicate if needed)
    column_names: list[str] = []
    seen_names: dict[str, int] = {}
    for h in filled_headers:
        name = h if h else f"Column_{len(column_names) + 1}"
        if name in seen_names:
            seen_names[name] += 1
            name = f"{name}_{seen_names[name]}"
        else:
            seen_names[name] = 0
        column_names.append(name)

    n_cols = len(column_names)

    # Get raw data rows (after header)
    raw_data = raw_rows[header_idx + 1:]

    # Mark which rows were originally empty BEFORE any normalization/forward-fill
    originally_empty = [_row_is_all_empty(row) for row in raw_data]

    # Normalize to n_cols length
    data_raw = [
        (list(row) + [None] * n_cols)[:n_cols]
        for row in raw_data
    ]
    # Forward-fill each column to handle merged cells (openpyxl merged cell regions)
    for col_idx in range(n_cols):
        data_raw = _forward_fill_column(data_raw, col_idx)

    # Filter out empty rows and summary rows
    data_rows_list: list[dict] = []
    found_summary = False
    for idx, row in enumerate(data_raw):
        # Skip rows that were originally empty (before forward-fill)
        if originally_empty[idx]:
            continue
        if found_summary:
            # Everything after first summary row is non-data
            continue
        if _is_summary_row(row):
            found_summary = True
            continue
        # Build dict
        row_dict = {column_names[i]: _cell_to_str(row[i]) for i in range(n_cols)}
        data_rows_list.append(row_dict)

    total_rows = len(raw_rows) - 1  # subtract header
    sample = data_rows_list[:5]

    return ParsedSheet(
        column_names=column_names,
        all_rows=data_rows_list,
        sample_rows=sample,
        data_rows=len(data_rows_list),
        sheet_name=sheet_name,
        total_rows=total_rows,
    )


# ---------------------------------------------------------------------------
# apply_mapping
# ---------------------------------------------------------------------------

def apply_mapping(
    parsed: ParsedSheet,
    column_mapping: dict[str, str],
) -> MappedData:
    """
    Apply a confirmed column mapping to parsed sheet data and aggregate results.

    Derives net_sales via:
      1. Direct mapping if a column is mapped to "net_sales".
      2. Derived: gross_sales - returns (if both are mapped and net_sales is not).
      3. Gross as net: if only gross_sales is mapped and returns is not.

    Args:
        parsed: Result from parse_upload().
        column_mapping: Maps detected column names to canonical Likha field names.

    Returns:
        MappedData with aggregated net_sales, category_sales, and other fields.

    Raises:
        MappingError: If net_sales cannot be determined or the result is negative.
    """
    # Reverse map: field_name -> list of column names mapped to it
    field_to_columns: dict[str, list[str]] = {}
    for col, field in column_mapping.items():
        if field and field != "ignore":
            field_to_columns.setdefault(field, []).append(col)

    has_net_sales_col = "net_sales" in field_to_columns
    has_gross_sales_col = "gross_sales" in field_to_columns
    has_returns_col = "returns" in field_to_columns
    has_category_col = "product_category" in field_to_columns

    # Determine how we will compute net_sales
    if not has_net_sales_col and not has_gross_sales_col:
        raise MappingError(
            "No column is mapped to 'Net Sales'. Map a column to 'Net Sales' before confirming.",
            "net_sales_column_required",
        )

    # Aggregate data
    net_sales_total = Decimal("0")
    gross_sales_total = Decimal("0")
    returns_total = Decimal("0")
    category_sales: dict[str, Decimal] = {}
    licensee_royalty_total = Decimal("0")
    has_royalty_values = False

    net_sales_cols = field_to_columns.get("net_sales", [])
    gross_sales_cols = field_to_columns.get("gross_sales", [])
    returns_cols = field_to_columns.get("returns", [])
    category_cols = field_to_columns.get("product_category", [])
    royalty_cols = field_to_columns.get("licensee_reported_royalty", [])

    for row in parsed.all_rows:
        # Category for this row
        row_category: Optional[str] = None
        if category_cols:
            cat_val = row.get(category_cols[0], "").strip()
            if cat_val:
                row_category = cat_val

        # Net sales for this row
        row_net = Decimal("0")
        if has_net_sales_col:
            for col in net_sales_cols:
                val = _to_decimal_safe(row.get(col))
                if val is not None:
                    row_net += val
        elif has_gross_sales_col:
            row_gross = Decimal("0")
            for col in gross_sales_cols:
                val = _to_decimal_safe(row.get(col))
                if val is not None:
                    row_gross += val
            row_ret = Decimal("0")
            if has_returns_col:
                for col in returns_cols:
                    val = _to_decimal_safe(row.get(col))
                    if val is not None:
                        row_ret += val
            row_net = row_gross - row_ret
            gross_sales_total += row_gross
            returns_total += row_ret

        net_sales_total += row_net

        if has_category_col and row_category:
            category_sales[row_category] = category_sales.get(row_category, Decimal("0")) + row_net

        # Gross/returns aggregation (for direct net_sales path)
        if has_net_sales_col and has_gross_sales_col:
            for col in gross_sales_cols:
                val = _to_decimal_safe(row.get(col))
                if val is not None:
                    gross_sales_total += val
        if has_net_sales_col and has_returns_col:
            for col in returns_cols:
                val = _to_decimal_safe(row.get(col))
                if val is not None:
                    returns_total += val

        # Licensee reported royalty
        for col in royalty_cols:
            val = _to_decimal_safe(row.get(col))
            if val is not None:
                licensee_royalty_total += val
                has_royalty_values = True

    # Validate net_sales
    if net_sales_total < Decimal("0"):
        raise MappingError(
            f"Net sales aggregated to a negative value (${net_sales_total}). "
            "Verify the returns column is mapped correctly.",
            "negative_net_sales",
        )

    return MappedData(
        net_sales=net_sales_total,
        category_sales=category_sales if category_sales else None,
        licensee_reported_royalty=licensee_royalty_total if has_royalty_values else None,
        gross_sales=gross_sales_total if gross_sales_total else None,
        returns=returns_total if returns_total else None,
    )


# ---------------------------------------------------------------------------
# suggest_mapping
# ---------------------------------------------------------------------------

def suggest_mapping(
    column_names: list[str],
    saved_mapping: Optional[dict[str, str]],
) -> dict[str, str]:
    """
    Suggest a column mapping based on keyword synonyms and/or a saved mapping.

    When a saved_mapping is provided, columns present in the saved mapping
    use their saved value.  New columns (not in the saved mapping) fall back
    to keyword matching.

    Args:
        column_names: List of detected column names from the uploaded file.
        saved_mapping: Optional previously-saved mapping for this licensee.

    Returns:
        Dict mapping each column name to a canonical Likha field name.
    """
    result: dict[str, str] = {}

    for col in column_names:
        # 1. Check saved mapping first
        if saved_mapping and col in saved_mapping:
            result[col] = saved_mapping[col]
            continue

        # 2. Keyword synonym matching (case-insensitive, substring)
        normalized = col.lower().strip()
        # Prepend a space to support the ' ns' synonym check against leading space
        padded = " " + normalized

        matched_field = "ignore"
        for field_name, synonyms in FIELD_SYNONYMS.items():
            for synonym in synonyms:
                syn_lower = synonym.lower()
                # Check both the normalized name and the padded name
                if syn_lower in normalized or syn_lower in padded:
                    matched_field = field_name
                    break
            if matched_field != "ignore":
                break

        result[col] = matched_field

    return result
