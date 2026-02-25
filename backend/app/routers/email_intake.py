"""
Email intake router (Phase 2, Task 3).

Handles inbound email webhooks and user review actions for emailed
royalty reports.

The webhook endpoint is provider-agnostic: it normalises the raw payload
via the inbound_email_adapter service, so swapping from Postmark to Resend
(or any future provider) only requires changing the EMAIL_PROVIDER env var.

Environment variables
---------------------
EMAIL_PROVIDER            Which normaliser to use (default: "resend").
                          Supported values: "resend", "postmark".
INBOUND_WEBHOOK_SECRET    Shared secret checked in X-Webhook-Secret header.
POSTMARK_WEBHOOK_SECRET   Legacy alias — checked as a fallback when
                          INBOUND_WEBHOOK_SECRET is not set.

Endpoints:
  POST /inbound                    — provider webhook (auth: X-Webhook-Secret)
  GET  /reports                    — list pending reports (auth: JWT)
  GET  /inbound-address            — get user's inbound email address (auth: JWT)
  POST /{report_id}/confirm        — user confirms a report (auth: JWT)
  POST /{report_id}/reject         — user rejects a report (auth: JWT)
  PATCH /{report_id}               — link sales_period_id after wizard (auth: JWT)
"""

import logging
import os
import re
from datetime import date, datetime, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException

from app.auth import get_current_user
from app.db import supabase_admin
from app.models.email_intake import (
    ConfirmReportRequest,
    InboundReport,
    InboundReportResponse,
    LinkSalesPeriodRequest,
)
from app.models.inbound_email import InboundEmail
from app.services.inbound_email_adapter import normalize_webhook

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_INBOUND_DOMAIN = "inbound.likha.app"
_SHORT_ID_LENGTH = 8

# Number of rows to scan for period labels / agreement refs in attachment text
_SCAN_ROWS = 20

# Quarter-to-date-range mapping: (month_start, day_start, month_end, day_end)
_QUARTER_DATES = {
    1: ("01", "01", "03", "31"),
    2: ("04", "01", "06", "30"),
    3: ("07", "01", "09", "30"),
    4: ("10", "01", "12", "31"),
}

# Short month name → zero-padded month number
_MONTH_ABBR = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "may": "05", "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}

# Last day of each month (non-leap; Q1/Q3/Q4 quarters avoid Feb)
_MONTH_LAST_DAY = {
    "01": "31", "02": "28", "03": "31", "04": "30",
    "05": "31", "06": "30", "07": "31", "08": "31",
    "09": "30", "10": "31", "11": "30", "12": "31",
}


# ---------------------------------------------------------------------------
# Webhook authentication dependency
# ---------------------------------------------------------------------------

def _get_webhook_secret() -> str:
    """
    Return the configured webhook secret.

    Checks INBOUND_WEBHOOK_SECRET first, then falls back to the legacy
    POSTMARK_WEBHOOK_SECRET for backward compatibility.
    """
    return (
        os.getenv("INBOUND_WEBHOOK_SECRET")
        or os.getenv("POSTMARK_WEBHOOK_SECRET")
        or ""
    )


def _verify_webhook_secret(
    x_webhook_secret: Optional[str] = Header(None),
    x_postmark_secret: Optional[str] = Header(None),
) -> None:
    """
    Verify that the inbound webhook request carries the correct shared secret.

    Accepts the secret in either:
      X-Webhook-Secret   — provider-agnostic header (new standard)
      X-Postmark-Secret  — legacy Postmark header (backward compat)

    Raises 401 if the secret is missing, unconfigured, or does not match.
    """
    expected = _get_webhook_secret()
    if not expected:
        logger.warning(
            "No webhook secret configured (INBOUND_WEBHOOK_SECRET / "
            "POSTMARK_WEBHOOK_SECRET) — all inbound webhook requests will be rejected"
        )
        raise HTTPException(status_code=401, detail="Webhook secret not configured")

    # Accept either header
    provided = x_webhook_secret or x_postmark_secret
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_short_id_from_to(to_address: str) -> Optional[str]:
    """
    Extract the 8-char short_id from a To address like:
      reports-abcd1234@inbound.likha.app

    Returns None if the address does not match the expected pattern.
    """
    # Some providers wrap the address: "Name <addr@host>" — extract just the addr
    match = re.search(r"<([^>]+)>", to_address)
    addr = match.group(1) if match else to_address.strip()

    # Match: reports-{short_id}@inbound.likha.app
    pattern = rf"^reports-([a-zA-Z0-9]{{8}})@{re.escape(_INBOUND_DOMAIN)}$"
    m = re.match(pattern, addr)
    if not m:
        return None
    return m.group(1)


def _lookup_user_by_short_id(short_id: str) -> Optional[dict]:
    """
    Find a user whose UUID starts with short_id (case-insensitive).

    Queries the public.users view (a thin SELECT over auth.users created in
    migration 20260225100000_expose_auth_users_view.sql) via PostgREST.
    auth.users is not directly accessible through PostgREST — the view is
    required.

    Returns the user row dict (keys: id, email, created_at) or None if not found.
    """
    try:
        result = (
            supabase_admin.table("users")
            .select("id")
            .ilike("id", f"{short_id}%")
            .execute()
        )
        if result.data:
            return result.data[0]
    except Exception as e:
        logger.warning(f"Failed to look up user by short_id '{short_id}': {e}")
    return None


def _auto_match_contract(
    sender_email: str,
    attachment_text: str,
    user_contracts: list[dict],
) -> tuple[Optional[str], str, list[str]]:
    """
    Auto-match an inbound report to a contract using a signal hierarchy.

    Signals are evaluated in order; the first match sets confidence and stops.

    Signal 1 (high):   Exact sender email match against contracts.licensee_email.
    Signal 2 (high):   Agreement reference number regex in attachment_text.
    Signal 3 (medium): Licensee name substring in attachment_text.

    Args:
        sender_email:    The From address from the inbound email.
        attachment_text: Decoded text content of the first attachment (may be empty).
        user_contracts:  List of active contract dicts for the user (pre-fetched).

    Returns:
        (contract_id, confidence, candidate_contract_ids) tuple.
        - contract_id is set when confidence == 'high' and exactly one match.
        - candidate_contract_ids lists matched contract IDs when confidence is
          'medium' or when multiple high-confidence matches tie.
        - When no signal matches, candidate_contract_ids = all contract IDs.
        - confidence is one of: 'high', 'medium', 'none'.
    """
    if not user_contracts:
        return None, "none", []

    # --- Signal 1: exact sender email match (case-insensitive) ---------------
    sender_lower = sender_email.lower()
    email_matches = [
        c for c in user_contracts
        if (c.get("licensee_email") or "").lower() == sender_lower
    ]

    if len(email_matches) == 1:
        return email_matches[0]["id"], "high", []

    if len(email_matches) > 1:
        # Tie — surface all as candidates, no auto-pick
        return None, "high", [c["id"] for c in email_matches]

    # --- Signal 2: agreement reference number in attachment text --------------
    # Scan only the first _SCAN_ROWS rows
    scan_text = "\n".join(attachment_text.splitlines()[:_SCAN_ROWS])

    ref_matches: list[dict] = []
    for contract in user_contracts:
        agr_num = contract.get("agreement_number")
        if not agr_num:
            continue
        # Escape the agreement number for safe regex use
        pattern = re.escape(str(agr_num))
        if re.search(pattern, scan_text, re.IGNORECASE):
            ref_matches.append(contract)

    if len(ref_matches) == 1:
        return ref_matches[0]["id"], "high", []

    if len(ref_matches) > 1:
        return None, "high", [c["id"] for c in ref_matches]

    # --- Signal 3: licensee name substring in attachment text -----------------
    # Match if: (a) the full licensee name appears in the attachment text, OR
    # (b) a meaningful portion of the licensee name (≥ the first 2 words,
    #     minimum 5 chars) appears in the attachment text. This handles the
    #     common case where an attachment abbreviates "Beta Boutique Ltd" as
    #     "Beta Boutique".
    name_matches: list[dict] = []
    scan_lower = scan_text.lower()
    for contract in user_contracts:
        name = contract.get("licensee_name") or ""
        if not name:
            continue
        name_lower = name.lower()
        # Check (a): full name in text
        if name_lower in scan_lower:
            name_matches.append(contract)
            continue
        # Check (b): leading words of the licensee name appear in the text.
        # Build progressively shorter prefixes (stopping at ≥ 2 words and ≥ 5 chars).
        words = name_lower.split()
        for word_count in range(len(words), 1, -1):
            prefix = " ".join(words[:word_count])
            if len(prefix) >= 5 and prefix in scan_lower:
                name_matches.append(contract)
                break

    if name_matches:
        return None, "medium", [c["id"] for c in name_matches]

    # --- No signal matched — return all contracts as candidates ---------------
    return None, "none", [c["id"] for c in user_contracts]


def _extract_period_dates(
    attachment_text: str,
) -> tuple[Optional[str], Optional[str]]:
    """
    Scan the first ~20 rows of attachment_text for common period date patterns.

    Patterns recognised (in priority order):
    1. Quarter labels:   Q1 2025, Q3 2025, etc.
    2. Named ranges:     Jan-Mar 2025, Apr-Jun 2025, etc. (with optional prefix)
    3. Explicit ranges:  01/01/2025 - 03/31/2025  or  2025-01-01 to 2025-03-31

    Returns:
        (suggested_period_start, suggested_period_end) as ISO date strings,
        or (None, None) when no pattern matches.
    """
    if not attachment_text:
        return None, None

    rows = attachment_text.splitlines()[:_SCAN_ROWS]
    scan_text = "\n".join(rows)

    # Pattern 1: quarter labels — Q1 2025
    quarter_pattern = re.compile(r"\bQ([1-4])\s+(\d{4})\b", re.IGNORECASE)
    m = quarter_pattern.search(scan_text)
    if m:
        q = int(m.group(1))
        year = m.group(2)
        ms, ds, me, de = _QUARTER_DATES[q]
        return f"{year}-{ms}-{ds}", f"{year}-{me}-{de}"

    # Pattern 2: named month ranges — Jan-Mar 2025, Apr-Jun 2025, etc.
    # Optionally preceded by "Reporting Period:", "Period:", "Period From:", etc.
    month_range_pattern = re.compile(
        r"\b([A-Za-z]{3})-([A-Za-z]{3})\s+(\d{4})\b"
    )
    m = month_range_pattern.search(scan_text)
    if m:
        start_abbr = m.group(1).lower()
        end_abbr = m.group(2).lower()
        year = m.group(3)
        start_mm = _MONTH_ABBR.get(start_abbr)
        end_mm = _MONTH_ABBR.get(end_abbr)
        if start_mm and end_mm:
            end_day = _MONTH_LAST_DAY.get(end_mm, "30")
            return f"{year}-{start_mm}-01", f"{year}-{end_mm}-{end_day}"

    # Pattern 3a: explicit US date range — 01/01/2025 - 03/31/2025
    us_range_pattern = re.compile(
        r"\b(\d{2})/(\d{2})/(\d{4})\s*[-–to]+\s*(\d{2})/(\d{2})/(\d{4})\b"
    )
    m = us_range_pattern.search(scan_text)
    if m:
        sm, sd, sy = m.group(1), m.group(2), m.group(3)
        em, ed, ey = m.group(4), m.group(5), m.group(6)
        return f"{sy}-{sm}-{sd}", f"{ey}-{em}-{ed}"

    # Pattern 3b: explicit ISO date range — 2025-01-01 to 2025-03-31
    iso_range_pattern = re.compile(
        r"\b(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})\b"
    )
    m = iso_range_pattern.search(scan_text)
    if m:
        return m.group(1), m.group(2)

    return None, None


def _extract_attachment_preview(
    attachment_text: str,
) -> tuple[Optional[list[dict[str, str]]], Optional[dict]]:
    """
    Extract a structured preview from the raw attachment text.

    Two things are extracted from the first _SCAN_ROWS rows:

    1. **Metadata rows** — rows that appear before the main data header.  A
       row is treated as metadata when it has exactly 1 or 2 non-empty cells
       and the first cell looks like a label.  A label is identified by any
       of these signals:
         - it contains a colon (e.g. "Reporting Period Start:")
         - it is in ALL-CAPS with no numeric content (e.g. "AGREEMENT REF")
         - it is shorter than 40 characters and contains no digits
       Each qualifying row is stored as {"key": first_cell, "value": second_cell}.
       The value is the second non-empty cell when present, otherwise an empty
       string.

    2. **Sample rows** — the first recognised data header row (a row with
       ≥3 non-empty cells where the cells look like column names rather than
       data values) plus up to 3 data rows immediately following it.
       Returned as {"headers": [...], "rows": [[...], ...]}.

    Either element of the returned tuple may be None when:
      - attachment_text is empty / None
      - no metadata rows are found
      - no data header row is found

    Args:
        attachment_text: raw decoded text content of the attachment.

    Returns:
        (metadata_rows, sample_rows) tuple.
    """
    if not attachment_text or not attachment_text.strip():
        return None, None

    import csv
    import io

    rows_text = attachment_text.splitlines()[:_SCAN_ROWS]

    # Parse each scanned row as CSV so we handle quoted fields correctly.
    parsed_rows: list[list[str]] = []
    for line in rows_text:
        try:
            reader = csv.reader(io.StringIO(line))
            cells = next(reader, [])
        except Exception:
            cells = [c.strip() for c in line.split(",")]
        # Strip whitespace from every cell
        cells = [c.strip() for c in cells]
        parsed_rows.append(cells)

    # --------------- Metadata rows ---------------
    # A row qualifies as a metadata row when it has ≤2 non-empty cells and
    # the first cell does not look like a pure numeric value.
    #
    # Rationale for the two sub-rules:
    #
    #   Single-cell rows (len(non_empty) == 1):
    #     Any row that has only one non-empty cell is treated as a metadata
    #     (title) row as long as it is not a bare decimal number.  Real data
    #     rows always have multiple populated columns; a single-cell row in
    #     the header block is almost always a title line (e.g. "VANTAGE
    #     RETAIL PARTNERS" or "ROYALTY STATEMENT - Q3 2025" or even a value
    #     like "Licensee Reported Royalty,6384.00" which has 2 cells).
    #
    #   Two-cell rows (len(non_empty) == 2):
    #     Only accepted as metadata when the first cell looks like a label:
    #       - contains a colon (classic "Key: Value" / "Key," "Value" pattern)
    #       - is ALL-CAPS text (e.g. "PREPARED BY")
    #       - is short text (< 40 chars) with no digits
    #     This prevents a two-column data row (e.g. a subtotal line with two
    #     populated cells) from being misclassified as a metadata row.
    #
    # When neither rule matches, the row is the data header boundary.

    def _is_pure_number(text: str) -> bool:
        """Return True when text is a bare integer or decimal, e.g. '6384.00'."""
        try:
            float(text.replace(",", ""))
            return True
        except ValueError:
            return False

    def _looks_like_label(text: str) -> bool:
        """Return True when `text` reads like a row label rather than a data value."""
        if not text:
            return False
        if _is_pure_number(text):
            return False
        # Has a colon separator — classic "Key: Value" pattern
        if ":" in text:
            return True
        stripped = text.strip()
        # ALL-CAPS word(s) — title rows like "VANTAGE RETAIL PARTNERS"
        if stripped == stripped.upper() and stripped.replace(" ", "").replace("-", "").replace("/", "").isalpha():
            return True
        # Short text (< 40 chars) with no digits — likely a field label
        if len(stripped) < 40 and not any(ch.isdigit() for ch in stripped):
            return True
        return False

    metadata_rows: list[dict[str, str]] = []
    header_row_index: Optional[int] = None

    for i, cells in enumerate(parsed_rows):
        non_empty = [c for c in cells if c]
        if len(non_empty) == 0:
            # Blank row — skip but continue scanning (blank line between
            # header block and data is common in sample-1 style files)
            continue

        if len(non_empty) == 1 and not _is_pure_number(non_empty[0]):
            # Single non-empty cell — treat as a title/metadata row.
            key = non_empty[0].rstrip(":").strip()
            metadata_rows.append({"key": key, "value": ""})
        elif len(non_empty) == 2 and _looks_like_label(non_empty[0]):
            # Two-cell key/value row — classic metadata pattern.
            key = non_empty[0].rstrip(":").strip()
            value = non_empty[1]
            metadata_rows.append({"key": key, "value": value})
        else:
            # This row has ≥3 non-empty cells or does not match any metadata
            # pattern — treat it as the start of the data section.
            header_row_index = i
            break

    # --------------- Sample rows (header + up to 3 data rows) ---------------
    sample_rows: Optional[dict] = None
    if header_row_index is not None:
        header_cells = parsed_rows[header_row_index]
        # Collect non-empty column headers preserving order; use column index
        # as a fallback name for blank header cells to avoid key collisions.
        headers = [
            (cell if cell else f"Col{j+1}")
            for j, cell in enumerate(header_cells)
        ]

        data_rows: list[list[str]] = []
        for data_row in parsed_rows[header_row_index + 1:]:
            if not any(c for c in data_row):
                # Blank row — stop collecting data rows
                break
            # Pad or truncate to match header length
            aligned = (data_row + [""] * len(headers))[: len(headers)]
            data_rows.append(aligned)
            if len(data_rows) >= 3:
                break

        if headers:
            sample_rows = {"headers": headers, "rows": data_rows}

    return (metadata_rows if metadata_rows else None), sample_rows


def _upload_inbound_attachment(
    content_bytes: bytes,
    user_id: str,
    report_id: str,
    filename: str,
    content_type: str,
) -> str:
    """
    Upload an attachment to Supabase Storage.

    Storage path: inbound/{user_id}/{report_id}/{sanitized_filename}

    Returns the storage path string.
    Raises Exception on failure.
    """
    _admin = supabase_admin
    if not _admin:
        raise ValueError("SUPABASE_SERVICE_KEY is required for storage operations")

    sanitized = re.sub(r"[^\w\-.]", "_", filename)
    storage_path = f"inbound/{user_id}/{report_id}/{sanitized}"

    _admin.storage.from_("contracts").upload(
        storage_path,
        content_bytes,
        {"content-type": content_type, "upsert": "true"},
    )
    return storage_path


def _get_report_for_user(report_id: str, user_id: str) -> dict:
    """
    Fetch an inbound_report row, enforcing that it belongs to the user.

    Raises HTTPException 404 if not found or not owned by user.
    """
    result = (
        supabase_admin.table("inbound_reports")
        .select("*")
        .eq("id", report_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Report not found")
    return result.data[0]


def _fetch_active_contracts_for_user(user_id: str) -> list[dict]:
    """
    Fetch all active contracts for a user in a single query.

    Returns list of contract dicts with id, licensee_email, licensee_name,
    and agreement_number. Returns [] on error (best-effort).
    """
    try:
        result = (
            supabase_admin.table("contracts")
            .select("id, licensee_email, licensee_name, agreement_number")
            .eq("user_id", user_id)
            .eq("status", "active")
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.warning(f"Failed to fetch contracts for user {user_id!r}: {e}")
        return []


def _process_inbound_email(email: InboundEmail) -> dict:
    """
    Core processing logic for a normalized InboundEmail.

    Shared by all provider paths after normalization.

    Steps:
    1. Extract short_id from recipient address.
    2. Look up user whose UUID starts with short_id.
    3. Fetch all active contracts for the user.
    4. Decode first attachment text (for matching / period extraction).
    5. Auto-match to a contract using the multi-signal hierarchy.
    6. Extract suggested period dates from attachment text.
    6b. Extract attachment preview (metadata rows + sample data rows).
    7. Upload the first attachment (if present).
    8. Insert an inbound_reports row.

    Returns a dict suitable for the HTTP response.
    """
    # 1. Extract short_id from recipient address
    short_id = _extract_short_id_from_to(email.recipient_email)
    if not short_id:
        logger.warning(
            f"Could not extract short_id from recipient address: {email.recipient_email!r}"
        )
        return {"received": True, "processed": False, "reason": "invalid_to_address"}

    # 2. Look up user
    user = _lookup_user_by_short_id(short_id)
    if not user:
        logger.warning(f"No user found for short_id '{short_id}'")
        return {"received": True, "processed": False, "reason": "unknown_user"}

    user_id: str = user["id"]

    # 3. Fetch all active contracts for this user
    user_contracts = _fetch_active_contracts_for_user(user_id)

    # 4. Decode attachment text for matching / period extraction
    attachment_text = ""
    if email.attachments:
        try:
            attachment_text = email.attachments[0].content.decode("utf-8", errors="ignore")
        except Exception:
            pass  # Best-effort — matching proceeds without text

    # 5. Auto-match contract (multi-signal)
    contract_id, match_confidence, candidate_contract_ids = _auto_match_contract(
        sender_email=email.sender_email,
        attachment_text=attachment_text,
        user_contracts=user_contracts,
    )

    # 6. Extract suggested period dates
    suggested_period_start, suggested_period_end = _extract_period_dates(attachment_text)

    # 6b. Extract attachment preview (metadata rows + sample data rows)
    attachment_metadata_rows, attachment_sample_rows = _extract_attachment_preview(
        attachment_text
    )

    # 7. Process first attachment (best-effort upload)
    attachment_filename: Optional[str] = None
    attachment_path: Optional[str] = None
    report_id = _generate_report_id()

    if email.attachments:
        attachment = email.attachments[0]
        try:
            attachment_path = _upload_inbound_attachment(
                content_bytes=attachment.content,
                user_id=user_id,
                report_id=report_id,
                filename=attachment.filename,
                content_type=attachment.content_type,
            )
            attachment_filename = attachment.filename
        except Exception as e:
            logger.warning(f"Failed to upload inbound attachment: {e}")

    # 8. Insert inbound_reports row
    now_iso = datetime.now(timezone.utc).isoformat()
    insert_data: dict = {
        "id": report_id,
        "user_id": user_id,
        "sender_email": email.sender_email,
        "subject": email.subject,
        "received_at": now_iso,
        "attachment_filename": attachment_filename,
        "attachment_path": attachment_path,
        "match_confidence": match_confidence,
        "status": "pending",
        "created_at": now_iso,
        "updated_at": now_iso,
        "candidate_contract_ids": candidate_contract_ids if candidate_contract_ids else None,
        "suggested_period_start": suggested_period_start,
        "suggested_period_end": suggested_period_end,
        "attachment_metadata_rows": attachment_metadata_rows,
        "attachment_sample_rows": attachment_sample_rows,
    }
    if contract_id is not None:
        insert_data["contract_id"] = contract_id

    try:
        result = supabase_admin.table("inbound_reports").insert(insert_data).execute()
        if not result.data:
            logger.error("inbound_reports insert returned no data")
            return {"received": True, "processed": False, "reason": "db_insert_failed"}
        row = result.data[0]
    except Exception as e:
        logger.error(f"Failed to insert inbound_report: {e}")
        return {"received": True, "processed": False, "reason": "db_error"}

    return InboundReport(**row).model_dump()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/inbound")
async def receive_inbound_email(
    payload: dict,
    _: None = Depends(_verify_webhook_secret),
) -> dict:
    """
    Provider-agnostic inbound email webhook receiver.

    Accepts a raw JSON payload and normalizes it using the adapter selected
    by the EMAIL_PROVIDER environment variable (default: "resend").

    Always returns 200 so the provider does not retry on processing errors.
    Errors are logged and silently swallowed where possible.
    """
    provider = os.getenv("EMAIL_PROVIDER", "resend")
    try:
        email = normalize_webhook(payload, provider=provider)
    except ValueError as exc:
        logger.error(f"Webhook normalization failed: {exc}")
        return {"received": True, "processed": False, "reason": "unsupported_provider"}

    return _process_inbound_email(email)


def _generate_report_id() -> str:
    """Generate a new UUID string for an inbound report."""
    import uuid
    return str(uuid.uuid4())


@router.get("/inbound-address")
async def get_inbound_address(
    user_id: str = Depends(get_current_user),
) -> dict:
    """
    Return the user's inbound email address.

    The address is derived from the first 8 characters of their Supabase UUID.
    """
    short_id = user_id[:_SHORT_ID_LENGTH]
    inbound_address = f"reports-{short_id}@{_INBOUND_DOMAIN}"
    return {"inbound_address": inbound_address, "user_id": user_id}


@router.get("/reports")
async def list_reports(
    user_id: str = Depends(get_current_user),
) -> list[InboundReportResponse]:
    """
    List all inbound_reports for the authenticated user, most recent first.

    Joins contract name for matched reports.
    """
    result = (
        supabase_admin.table("inbound_reports")
        .select("*")
        .eq("user_id", user_id)
        .order("received_at", desc=True)
        .execute()
    )
    rows = result.data or []

    if not rows:
        return []

    # Collect unique contract IDs to join names in a single query
    contract_ids = list({r["contract_id"] for r in rows if r.get("contract_id")})
    contract_name_by_id: dict[str, str] = {}

    if contract_ids:
        try:
            contracts_result = (
                supabase_admin.table("contracts")
                .select("id, licensee_name")
                .in_("id", contract_ids)
                .execute()
            )
            for c in contracts_result.data or []:
                contract_name_by_id[c["id"]] = c.get("licensee_name") or ""
        except Exception as e:
            logger.warning(f"Could not join contract names for inbound reports: {e}")

    responses: list[InboundReportResponse] = []
    for row in rows:
        report = InboundReportResponse(**row)
        cid = row.get("contract_id")
        if cid and cid in contract_name_by_id:
            report.contract_name = contract_name_by_id[cid]
        responses.append(report)

    return responses


@router.post("/{report_id}/confirm")
async def confirm_report(
    report_id: str,
    body: ConfirmReportRequest = ConfirmReportRequest(),
    user_id: str = Depends(get_current_user),
) -> InboundReportResponse:
    """
    User confirms an inbound report, optionally assigning it to a contract.

    If body.contract_id is provided it overrides (or supplies) the matched
    contract. Updates status to 'confirmed'.

    When body.open_wizard is True, the response includes a redirect_url
    pointing to the upload wizard pre-loaded with contract_id, report_id,
    and detected period dates. Requires the report to have an attachment;
    returns 422 if attachment_path is null.
    """
    # Verify the report exists and belongs to this user
    report_row = _get_report_for_user(report_id, user_id)

    # Validate open_wizard precondition: attachment must be present
    if body.open_wizard and not report_row.get("attachment_path"):
        raise HTTPException(
            status_code=422,
            detail="open_wizard requires an attachment on the report",
        )

    # Verify contract ownership when a contract_id override is provided
    if body.contract_id is not None:
        contract_result = (
            supabase_admin.table("contracts")
            .select("id")
            .eq("id", body.contract_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not contract_result.data:
            raise HTTPException(
                status_code=403,
                detail="Contract not found or not owned by user",
            )

    # Build update payload
    update_data: dict = {
        "status": "confirmed",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.contract_id is not None:
        update_data["contract_id"] = body.contract_id

    result = (
        supabase_admin.table("inbound_reports")
        .update(update_data)
        .eq("id", report_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update report")

    confirmed_row = result.data[0]
    response = InboundReportResponse(**confirmed_row)

    # Build redirect_url when open_wizard=True
    if body.open_wizard:
        effective_contract_id = body.contract_id or confirmed_row.get("contract_id")
        params: dict = {
            "report_id": report_id,
            "source": "inbox",
        }
        if effective_contract_id:
            params["contract_id"] = effective_contract_id

        period_start = confirmed_row.get("suggested_period_start")
        period_end = confirmed_row.get("suggested_period_end")
        if period_start:
            params["period_start"] = period_start
        if period_end:
            params["period_end"] = period_end

        response.redirect_url = f"/sales/upload?{urlencode(params)}"

    return response


@router.post("/{report_id}/reject")
async def reject_report(
    report_id: str,
    user_id: str = Depends(get_current_user),
) -> InboundReportResponse:
    """
    User rejects an inbound report. Updates status to 'rejected'.
    """
    # Verify the report exists and belongs to this user
    _get_report_for_user(report_id, user_id)

    result = (
        supabase_admin.table("inbound_reports")
        .update({
            "status": "rejected",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", report_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update report")

    return InboundReportResponse(**result.data[0])


@router.patch("/{report_id}")
async def link_sales_period(
    report_id: str,
    body: LinkSalesPeriodRequest,
    user_id: str = Depends(get_current_user),
) -> InboundReportResponse:
    """
    Link a confirmed inbound_report to the sales_period row produced by the
    upload wizard. Transitions status from 'confirmed' to 'processed'.

    This creates a durable audit trail: inbound email → inbound_reports row
    → sales_periods row.
    """
    # Verify the report exists and belongs to this user
    _get_report_for_user(report_id, user_id)

    result = (
        supabase_admin.table("inbound_reports")
        .update({
            "sales_period_id": body.sales_period_id,
            "status": "processed",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", report_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update report")

    return InboundReportResponse(**result.data[0])
