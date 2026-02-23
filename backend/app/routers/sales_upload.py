"""
Sales upload router (Phase 1.1).

Endpoints:
  POST /upload/{contract_id}           — parse file, return preview
  POST /upload/{contract_id}/confirm   — create sales period from upload
  GET  /upload/mapping/{contract_id}   — get saved column mapping for licensee
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth import get_current_user, verify_contract_ownership
from app.db import supabase_admin as supabase
from app.models.sales import SalesPeriod
from app.services.royalty_calc import calculate_royalty
from app.services.storage import get_signed_url, upload_sales_report
from app.services.spreadsheet_parser import (
    MappingError,
    ParseError,
    ParsedSheet,
    apply_mapping,
    extract_cross_check_values,
    parse_upload,
    suggest_mapping,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory upload store with TTL (15 minutes)
# ---------------------------------------------------------------------------

_UPLOAD_TTL_SECONDS = 15 * 60  # 15 minutes
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


@dataclass
class _UploadEntry:
    """In-memory storage for a parsed upload awaiting confirmation."""
    parsed: ParsedSheet
    contract_id: str
    user_id: str
    raw_bytes: bytes = field(default_factory=bytes)
    original_filename: str = "upload.xlsx"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# Module-level dict: upload_id -> _UploadEntry
_upload_store: dict[str, _UploadEntry] = {}


def _store_upload(
    parsed: ParsedSheet,
    contract_id: str,
    user_id: str,
    raw_bytes: bytes = b"",
    original_filename: str = "upload.xlsx",
) -> str:
    """Store a parsed sheet in memory and return the upload_id."""
    upload_id = str(uuid.uuid4())
    _upload_store[upload_id] = _UploadEntry(
        parsed=parsed,
        contract_id=contract_id,
        user_id=user_id,
        raw_bytes=raw_bytes,
        original_filename=original_filename,
    )
    return upload_id


def _get_upload(upload_id: str) -> Optional[_UploadEntry]:
    """Retrieve an upload entry, returning None if expired or missing."""
    entry = _upload_store.get(upload_id)
    if entry is None:
        return None

    # Check TTL
    age = (datetime.now(timezone.utc) - entry.created_at).total_seconds()
    if age > _UPLOAD_TTL_SECONDS:
        del _upload_store[upload_id]
        return None

    return entry


def _error(status_code: int, message: str, error_code: str) -> HTTPException:
    """Build an HTTPException with a structured detail payload."""
    return HTTPException(
        status_code=status_code,
        detail={"detail": message, "error_code": error_code},
    )


# ---------------------------------------------------------------------------
# Cross-check helpers (Phase 1.1.1)
# ---------------------------------------------------------------------------

def _parse_rate_to_decimal(rate_str: str) -> Optional[Decimal]:
    """
    Parse a royalty rate string like "8%", "0.08", "8" to a Decimal percentage.

    Returns the value as a percentage (e.g., 8.0 for 8%), or None if unparseable.
    """
    if not rate_str:
        return None
    s = str(rate_str).strip().replace(",", "")
    # Strip trailing %
    is_percent = s.endswith("%")
    if is_percent:
        s = s[:-1].strip()
    try:
        value = Decimal(s)
    except Exception:
        return None
    # If value is between 0 and 1 (e.g., "0.08") treat as fractional percent
    if not is_percent and value < Decimal("1") and value > Decimal("0"):
        return value * Decimal("100")
    return value


def _parse_contract_flat_rate(royalty_rate: Any) -> Optional[Decimal]:
    """
    Extract a flat rate Decimal from the contract's royalty_rate field.

    Returns None if the contract uses tiered/category rates or if the value
    cannot be parsed.
    """
    if royalty_rate is None:
        return None
    # Category or tiered rates are dicts — skip
    if isinstance(royalty_rate, dict):
        return None
    return _parse_rate_to_decimal(str(royalty_rate))


def _parse_period_string(period_str: str) -> Optional[tuple["date", "date"]]:
    """
    Attempt to parse a period string like "Q1 2025", "Jan-Mar 2025",
    "2025-01-01", "January 2025" into a (start_date, end_date) tuple.

    Returns None if the string cannot be parsed.
    """
    from datetime import date
    import re

    s = str(period_str).strip()

    # Quarter pattern: Q1 2025, Q2 2024, etc.
    m = re.match(r"^Q([1-4])\s*(\d{4})$", s, re.IGNORECASE)
    if m:
        q = int(m.group(1))
        year = int(m.group(2))
        quarter_months = {1: (1, 3), 2: (4, 6), 3: (7, 9), 4: (10, 12)}
        start_month, end_month = quarter_months[q]
        import calendar
        end_day = calendar.monthrange(year, end_month)[1]
        return date(year, start_month, 1), date(year, end_month, end_day)

    # ISO date: YYYY-MM-DD
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return d, d
        except ValueError:
            pass

    # Month name ranges: "Jan-Mar 2025", "January-March 2025"
    month_abbr = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
        "january": 1, "february": 2, "march": 3, "april": 4,
        "june": 6, "july": 7, "august": 8, "september": 9,
        "october": 10, "november": 11, "december": 12,
    }
    m = re.match(r"^([a-zA-Z]+)[-/]([a-zA-Z]+)\s*(\d{4})$", s, re.IGNORECASE)
    if m:
        start_month_str = m.group(1).lower()
        end_month_str = m.group(2).lower()
        year = int(m.group(3))
        if start_month_str in month_abbr and end_month_str in month_abbr:
            import calendar
            start_m = month_abbr[start_month_str]
            end_m = month_abbr[end_month_str]
            end_day = calendar.monthrange(year, end_m)[1]
            try:
                return date(year, start_m, 1), date(year, end_m, end_day)
            except ValueError:
                pass

    # Single month: "January 2025", "Jan 2025"
    m = re.match(r"^([a-zA-Z]+)\s*(\d{4})$", s, re.IGNORECASE)
    if m:
        month_str = m.group(1).lower()
        year = int(m.group(2))
        if month_str in month_abbr:
            import calendar
            month_num = month_abbr[month_str]
            last_day = calendar.monthrange(year, month_num)[1]
            try:
                return date(year, month_num, 1), date(year, month_num, last_day)
            except ValueError:
                pass

    # Year only: "2025"
    m = re.match(r"^(\d{4})$", s)
    if m:
        year = int(m.group(1))
        if 1900 <= year <= 2100:
            return date(year, 1, 1), date(year, 12, 31)

    return None


def _build_upload_warnings(
    cross_check_values: dict,
    contract: dict,
    period_start: "date",
    period_end: "date",
) -> list[dict]:
    """
    Compare cross-check values against contract data and return a list of warnings.

    Each warning is a dict with keys: field, extracted_value, contract_value, message.
    Returns an empty list when no mismatches are found.
    """
    from datetime import date
    warnings: list[dict] = []

    # --- licensee_name cross-check ---
    extracted_licensee = cross_check_values.get("licensee_name")
    contract_licensee = contract.get("licensee_name") or ""
    if extracted_licensee and contract_licensee:
        extracted_lower = extracted_licensee.lower()
        contract_lower = contract_licensee.lower()
        # Match if either is a substring of the other (case-insensitive)
        if extracted_lower not in contract_lower and contract_lower not in extracted_lower:
            warnings.append({
                "field": "licensee_name",
                "extracted_value": extracted_licensee,
                "contract_value": contract_licensee,
                "message": (
                    f"Uploaded file says licensee is '{extracted_licensee}' — "
                    f"your contract says '{contract_licensee}'. "
                    "Verify the file is from the correct licensee."
                ),
            })

    # --- royalty_rate cross-check (flat-rate contracts only) ---
    extracted_rate_str = cross_check_values.get("royalty_rate")
    contract_royalty_rate = contract.get("royalty_rate")
    # Only compare for flat-rate contracts (not dicts)
    if extracted_rate_str and not isinstance(contract_royalty_rate, dict):
        extracted_rate = _parse_rate_to_decimal(extracted_rate_str)
        contract_rate = _parse_contract_flat_rate(contract_royalty_rate)
        if extracted_rate is not None and contract_rate is not None:
            tolerance = Decimal("0.01")
            if abs(extracted_rate - contract_rate) > tolerance:
                warnings.append({
                    "field": "royalty_rate",
                    "extracted_value": str(extracted_rate),
                    "contract_value": str(contract_rate),
                    "message": (
                        f"Uploaded file uses rate {extracted_rate}% — "
                        f"your contract specifies {contract_rate}%. "
                        "Verify your contract terms."
                    ),
                })

    # --- report_period cross-check ---
    extracted_period_str = cross_check_values.get("report_period")
    if extracted_period_str:
        parsed_period = _parse_period_string(extracted_period_str)
        if parsed_period is not None:
            extracted_start, extracted_end = parsed_period
            # Check overlap: two ranges overlap if start1 <= end2 AND start2 <= end1
            overlaps = (extracted_start <= period_end) and (period_start <= extracted_end)
            if not overlaps:
                warnings.append({
                    "field": "report_period",
                    "extracted_value": extracted_period_str,
                    "contract_value": f"{period_start} to {period_end}",
                    "message": (
                        f"Uploaded file reports period '{extracted_period_str}' — "
                        f"you entered {period_start} to {period_end} in Step 1. "
                        "Verify the dates are correct."
                    ),
                })

    return warnings


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class UploadConfirmRequest(BaseModel):
    upload_id: str
    column_mapping: dict[str, str]
    period_start: str
    period_end: str
    save_mapping: bool = True


# ---------------------------------------------------------------------------
# Helper: look up saved column mapping for a licensee
# ---------------------------------------------------------------------------

def _get_saved_mapping_for_licensee(
    user_id: str, licensee_name: str
) -> Optional[dict]:
    """Return the saved column_mapping dict for this user+licensee, or None."""
    try:
        result = (
            supabase.table("licensee_column_mappings")
            .select("*")
            .eq("user_id", user_id)
            .ilike("licensee_name", licensee_name)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0].get("column_mapping")
    except Exception as e:
        logger.warning(f"Could not load saved mapping: {e}")
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/upload/{contract_id}")
async def upload_file(
    contract_id: str,
    file: UploadFile = File(...),
    period_start: str = Form(...),
    period_end: str = Form(...),
    user_id: str = Depends(get_current_user),
) -> dict:
    """
    Parse an uploaded file and return a preview with suggested column mapping.

    Does NOT create a sales period — call /confirm to do that.
    """
    # Auth + ownership
    await verify_contract_ownership(contract_id, user_id)

    # File size check (before reading full content)
    if hasattr(file, "size") and file.size is not None:
        if file.size > _MAX_FILE_SIZE_BYTES:
            raise _error(400, "File exceeds 10 MB limit.", "file_too_large")

    # Read file content
    file_content = await file.read()

    # Double-check size after reading (in case .size was not set)
    if len(file_content) > _MAX_FILE_SIZE_BYTES:
        raise _error(400, "File exceeds 10 MB limit.", "file_too_large")

    filename = file.filename or "upload.xlsx"

    # Parse the file
    try:
        parsed = parse_upload(file_content, filename)
    except ParseError as e:
        raise _error(400, e.message, e.error_code)

    # Load the contract to get licensee_name
    contract_result = (
        supabase.table("contracts")
        .select("*")
        .eq("id", contract_id)
        .execute()
    )
    if not contract_result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract = contract_result.data[0]
    licensee_name = contract.get("licensee_name", "")

    # Look up saved mapping
    saved_mapping = _get_saved_mapping_for_licensee(user_id, licensee_name)

    # Determine mapping source
    if saved_mapping:
        mapping_source = "saved"
    else:
        mapping_source = "suggested"

    # Generate suggested mapping (uses saved_mapping if available, else keyword matching)
    suggested = suggest_mapping(parsed.column_names, saved_mapping=saved_mapping)

    # If keyword matching produced all-ignore, change source to "none"
    if mapping_source == "suggested":
        if all(v == "ignore" for v in suggested.values()):
            mapping_source = "none"

    # Store in memory (including raw bytes for later upload to storage at confirm time)
    upload_id = _store_upload(parsed, contract_id, user_id, raw_bytes=file_content, original_filename=filename)

    return {
        "upload_id": upload_id,
        "filename": filename,
        "sheet_name": parsed.sheet_name,
        "total_rows": parsed.total_rows,
        "data_rows": parsed.data_rows,
        "detected_columns": parsed.column_names,
        "sample_rows": parsed.sample_rows,
        "suggested_mapping": suggested,
        "mapping_source": mapping_source,
        "period_start": period_start,
        "period_end": period_end,
    }


@router.post("/upload/{contract_id}/confirm", status_code=201)
async def confirm_upload(
    contract_id: str,
    body: UploadConfirmRequest,
    user_id: str = Depends(get_current_user),
) -> SalesPeriod:
    """
    Apply confirmed column mapping, aggregate data, calculate royalty,
    optionally save mapping, and create the sales period.
    """
    # Auth + ownership
    await verify_contract_ownership(contract_id, user_id)

    # Retrieve parsed data from store
    entry = _get_upload(body.upload_id)
    if entry is None:
        raise _error(
            400,
            "Upload session expired or not found. Please re-upload the file.",
            "upload_expired",
        )

    # Verify ownership of the upload (user must match)
    if entry.user_id != user_id or entry.contract_id != contract_id:
        raise HTTPException(status_code=403, detail="You are not authorized to access this upload")

    # Validate dates
    try:
        from datetime import date as _date
        period_start = _date.fromisoformat(body.period_start)
        period_end = _date.fromisoformat(body.period_end)
    except ValueError:
        raise _error(400, "Invalid date format. Use YYYY-MM-DD.", "invalid_date")

    if period_end < period_start:
        raise _error(400, "period_end must be on or after period_start.", "period_end_before_start")

    # Load contract
    contract_result = (
        supabase.table("contracts")
        .select("*")
        .eq("id", contract_id)
        .execute()
    )
    if not contract_result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract = contract_result.data[0]
    royalty_rate = contract.get("royalty_rate")
    licensee_name = contract.get("licensee_name", "")

    # Check if contract has category rates
    is_category_contract = isinstance(royalty_rate, dict)

    # Validate mapping: category contract requires product_category column
    has_category_mapped = any(v == "product_category" for v in body.column_mapping.values())
    if is_category_contract and not has_category_mapped:
        raise _error(
            400,
            "This contract has category-specific rates. Map a column to 'Product Category' before confirming.",
            "category_breakdown_required",
        )

    # Apply mapping to parsed data
    try:
        mapped = apply_mapping(entry.parsed, body.column_mapping)
    except MappingError as e:
        raise _error(400, e.message, e.error_code)
    except Exception as e:
        raise _error(400, f"Mapping failed: {e}", "royalty_calculation_failed")

    # Extract cross-check values (licensee_name, report_period, royalty_rate)
    cross_check_values = extract_cross_check_values(entry.parsed, body.column_mapping)

    # Build upload warnings (non-blocking — always run, never raise)
    try:
        upload_warnings = _build_upload_warnings(
            cross_check_values=cross_check_values,
            contract=contract,
            period_start=period_start,
            period_end=period_end,
        )
    except Exception as e:
        logger.warning(f"Cross-check failed (non-blocking): {e}")
        upload_warnings = []

    # Validate unknown categories for category-rate contracts
    if is_category_contract and mapped.category_sales:
        for category in mapped.category_sales.keys():
            normalized = category.lower().strip()
            found = False
            for rate_cat in royalty_rate.keys():
                if normalized in rate_cat.lower() or rate_cat.lower() in normalized:
                    found = True
                    break
            if not found:
                raise _error(
                    400,
                    f"Category '{category}' in the uploaded file has no matching rate in this contract. "
                    "Update your contract's royalty rates or correct the file.",
                    "unknown_category",
                )

    # Build category_breakdown for calculation (convert to Dict[str, Decimal])
    category_breakdown: Optional[dict[str, Decimal]] = None
    if is_category_contract and mapped.category_sales:
        category_breakdown = mapped.category_sales

    # Calculate royalty: sales × rate only.
    # The minimum guarantee is an ANNUAL true-up check, not a per-period floor.
    # It must never inflate a single period's royalty — that would misstate earnings
    # and produce a wrong effective rate. Minimum guarantee tracking is handled
    # separately via the YTD summary endpoint.
    try:
        royalty = calculate_royalty(
            royalty_rate=royalty_rate,
            net_sales=mapped.net_sales,
            category_breakdown=category_breakdown,
        )
        minimum_applied = False  # always False; MG is an annual check only
    except Exception as e:
        raise _error(400, f"Royalty calculation failed: {e}", "royalty_calculation_failed")

    # Check for duplicate period (exact match only)
    dupe_result = (
        supabase.table("sales_periods")
        .select("id")
        .eq("contract_id", contract_id)
        .eq("period_start", str(period_start))
        .execute()
    )
    if dupe_result.data:
        raise _error(
            409,
            "A sales period for this contract already exists with the same start date.",
            "duplicate_period",
        )

    # Save mapping if requested
    if body.save_mapping and licensee_name:
        try:
            supabase.table("licensee_column_mappings").upsert(
                {
                    "user_id": user_id,
                    "licensee_name": licensee_name,
                    "column_mapping": body.column_mapping,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="user_id,licensee_name",
            ).execute()
        except Exception as e:
            logger.warning(f"Could not save column mapping: {e}")

    # Build category_breakdown for storage (as plain dict with string values)
    category_breakdown_for_db: Optional[dict] = None
    if category_breakdown:
        category_breakdown_for_db = {k: str(v) for k, v in category_breakdown.items()}

    # Upload the original spreadsheet to Supabase Storage (best-effort)
    source_file_path: Optional[str] = None
    if entry.raw_bytes:
        try:
            source_file_path = upload_sales_report(
                file_content=entry.raw_bytes,
                user_id=user_id,
                contract_id=contract_id,
                filename=entry.original_filename,
            )
        except Exception as e:
            logger.warning(f"Could not upload sales report file to storage: {e}")

    # Insert sales period
    insert_data: dict[str, Any] = {
        "contract_id": contract_id,
        "period_start": str(period_start),
        "period_end": str(period_end),
        "net_sales": str(mapped.net_sales),
        "category_breakdown": category_breakdown_for_db,
        "royalty_calculated": str(royalty),
        "minimum_applied": minimum_applied,
    }
    if mapped.licensee_reported_royalty is not None:
        insert_data["licensee_reported_royalty"] = str(mapped.licensee_reported_royalty)
    if source_file_path is not None:
        insert_data["source_file_path"] = source_file_path

    result_db = supabase.table("sales_periods").insert(insert_data).execute()

    if not result_db.data:
        raise HTTPException(status_code=500, detail="Failed to create sales period")

    period = SalesPeriod(**result_db.data[0])
    period.upload_warnings = upload_warnings
    return period


@router.get("/upload/mapping/{contract_id}")
async def get_saved_mapping(
    contract_id: str,
    user_id: str = Depends(get_current_user),
) -> dict:
    """
    Return the saved column mapping for this contract's licensee, or null if none exists.
    Always returns 200.
    """
    # Auth + ownership
    await verify_contract_ownership(contract_id, user_id)

    # Load contract to get licensee_name
    contract_result = (
        supabase.table("contracts")
        .select("*")
        .eq("id", contract_id)
        .execute()
    )
    if not contract_result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract = contract_result.data[0]
    licensee_name = contract.get("licensee_name", "")

    # Look up saved mapping
    try:
        mapping_result = (
            supabase.table("licensee_column_mappings")
            .select("*")
            .eq("user_id", user_id)
            .ilike("licensee_name", licensee_name)
            .limit(1)
            .execute()
        )
        if mapping_result.data:
            row = mapping_result.data[0]
            return {
                "licensee_name": licensee_name,
                "column_mapping": row.get("column_mapping"),
                "updated_at": row.get("updated_at"),
            }
    except Exception as e:
        logger.warning(f"Could not load saved mapping: {e}")

    return {
        "licensee_name": licensee_name,
        "column_mapping": None,
        "updated_at": None,
    }


@router.get("/upload/{contract_id}/periods/{period_id}/source-file")
async def get_sales_report_download_url(
    contract_id: str,
    period_id: str,
    user_id: str = Depends(get_current_user),
) -> dict:
    """
    Return a short-lived signed URL for downloading the original sales report file.

    Returns 404 if the period has no source file stored.
    """
    # Auth + ownership
    await verify_contract_ownership(contract_id, user_id)

    # Fetch the sales period
    period_result = (
        supabase.table("sales_periods")
        .select("id, contract_id, source_file_path")
        .eq("id", period_id)
        .eq("contract_id", contract_id)
        .execute()
    )
    if not period_result.data:
        raise HTTPException(status_code=404, detail="Sales period not found")

    period = period_result.data[0]
    source_file_path = period.get("source_file_path")

    if not source_file_path:
        raise HTTPException(status_code=404, detail="No source file stored for this sales period")

    try:
        signed_url = get_signed_url(source_file_path)
    except Exception as e:
        logger.error(f"Failed to generate signed URL for {source_file_path}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate download URL")

    return {"download_url": signed_url}
