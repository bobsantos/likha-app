"""
Pydantic models for the email intake feature (Phase 2, Task 3).

Models:
  PostmarkWebhookPayload  — inbound webhook JSON from Postmark
  InboundReport           — DB row from inbound_reports table
  InboundReportResponse   — API response (includes optional contract_name)
  ConfirmReportRequest    — request body for confirm endpoint
  ConfirmResponse         — response body for confirm endpoint (includes redirect_url)
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

    # New fields added by ADR 20260225095833
    candidate_contract_ids: Optional[list[str]] = None
    suggested_period_start: Optional[str] = None
    suggested_period_end: Optional[str] = None
    sales_period_id: Optional[str] = None

    # Attachment preview fields (migration 20260225220000)
    # attachment_metadata_rows: key/value rows from the attachment header block
    #   (rows before the data header row), e.g.
    #   [{"key": "Licensee Name", "value": "Sunrise Apparel Co."}, ...]
    attachment_metadata_rows: Optional[list[dict[str, str]]] = None
    # attachment_sample_rows: the detected column headers plus up to 3 data rows
    #   {"headers": ["Product Description", "Net Sales", ...],
    #    "rows": [["Licensed Branded Apparel", "83300.00", ...], ...]}
    attachment_sample_rows: Optional[dict] = None


class InboundReportResponse(InboundReport):
    """
    API response model for inbound reports.

    Extends InboundReport with an optional contract_name field that is
    joined in from the contracts table when a contract is matched, and
    an optional redirect_url for post-confirm wizard navigation.
    """
    contract_name: Optional[str] = None
    redirect_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class ConfirmReportRequest(BaseModel):
    """
    Request body for POST /{report_id}/confirm.

    contract_id is optional — provided when the user manually assigns
    an unmatched report to a specific contract.

    open_wizard — when True, the response includes a redirect_url pointing
    to the upload wizard pre-loaded with contract and period information.
    """
    contract_id: Optional[str] = None
    open_wizard: bool = False


class ConfirmResponse(BaseModel):
    """
    Response body wrapper for POST /{report_id}/confirm when open_wizard=True.

    redirect_url is set only when open_wizard=True and the report has an
    attachment (otherwise 422 is returned). When open_wizard=False, this
    field is None (omitted from the response).
    """
    redirect_url: Optional[str] = None


# ---------------------------------------------------------------------------
# PATCH request body
# ---------------------------------------------------------------------------

class LinkSalesPeriodRequest(BaseModel):
    """
    Request body for PATCH /{report_id}.

    Links a confirmed inbound_report to a sales_period row created by the
    upload wizard, and transitions the report status to 'processed'.
    """
    sales_period_id: str
