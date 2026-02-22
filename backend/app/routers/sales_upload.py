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

    return SalesPeriod(**result_db.data[0])


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
