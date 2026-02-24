"""
Pydantic models for the email intake feature (Phase 2, Task 3).

Models:
  PostmarkWebhookPayload  — inbound webhook JSON from Postmark
  InboundReport           — DB row from inbound_reports table
  InboundReportResponse   — API response (includes optional contract_name)
  ConfirmReportRequest    — request body for confirm endpoint
"""

from typing import Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Postmark webhook payload
# ---------------------------------------------------------------------------

class PostmarkAttachment(BaseModel):
    """A single file attachment in a Postmark inbound webhook payload."""
    Name: str
    Content: str           # base64-encoded file content
    ContentType: str


class PostmarkWebhookPayload(BaseModel):
    """
    Subset of Postmark's inbound webhook JSON that Likha cares about.

    Postmark sends many more fields; we only model what we need so that
    unknown fields are silently ignored (model_config extra="ignore").
    """
    model_config = {"extra": "ignore"}

    From: str
    To: str
    Subject: Optional[str] = None
    Attachments: list[PostmarkAttachment] = []


# ---------------------------------------------------------------------------
# Inbound report DB row and API response
# ---------------------------------------------------------------------------

class InboundReport(BaseModel):
    """Full inbound_report record from the database."""
    model_config = {"from_attributes": True}

    id: str
    user_id: str
    contract_id: Optional[str] = None
    sender_email: str
    subject: Optional[str] = None
    received_at: str
    attachment_filename: Optional[str] = None
    attachment_path: Optional[str] = None
    match_confidence: str
    status: str
    created_at: str
    updated_at: str


class InboundReportResponse(InboundReport):
    """
    API response model for inbound reports.

    Extends InboundReport with an optional contract_name field that is
    joined in from the contracts table when a contract is matched.
    """
    contract_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ConfirmReportRequest(BaseModel):
    """
    Request body for POST /{report_id}/confirm.

    contract_id is optional — provided when the user manually assigns
    an unmatched report to a specific contract.
    """
    contract_id: Optional[str] = None
