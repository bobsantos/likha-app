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
"""

import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from app.auth import get_current_user
from app.db import supabase_admin
from app.models.email_intake import (
    ConfirmReportRequest,
    InboundReport,
    InboundReportResponse,
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


def _auto_match_contract(user_id: str, sender_email: str) -> tuple[Optional[str], str]:
    """
    Auto-match an inbound report to a contract by sender email.

    Args:
        user_id: The licensor's user ID.
        sender_email: The From address from the inbound email.

    Returns:
        (contract_id, match_confidence) tuple.
        match_confidence is one of: "high", "none".
    """
    try:
        result = (
            supabase_admin.table("contracts")
            .select("id")
            .eq("user_id", user_id)
            .eq("licensee_email", sender_email)
            .eq("status", "active")
            .execute()
        )
        matches = result.data or []
    except Exception as e:
        logger.warning(f"Contract auto-match query failed: {e}")
        return None, "none"

    if len(matches) == 1:
        return matches[0]["id"], "high"

    if len(matches) > 1:
        logger.warning(
            f"Multiple contracts matched sender {sender_email!r} for user {user_id!r}. "
            "Treating as unmatched (MVP cut)."
        )

    return None, "none"


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


def _process_inbound_email(email: InboundEmail) -> dict:
    """
    Core processing logic for a normalized InboundEmail.

    Shared by all provider paths after normalization.

    Steps:
    1. Extract short_id from recipient address.
    2. Look up user whose UUID starts with short_id.
    3. Auto-match to a contract by sender email.
    4. Decode and upload the first attachment (if present).
    5. Insert an inbound_reports row.

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

    # 3. Auto-match contract
    contract_id, match_confidence = _auto_match_contract(user_id, email.sender_email)

    # 4. Process first attachment (best-effort)
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

    # 5. Insert inbound_reports row
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
    """
    # Verify the report exists and belongs to this user
    _get_report_for_user(report_id, user_id)

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

    return InboundReportResponse(**result.data[0])


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
