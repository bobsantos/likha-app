"""
Provider-agnostic inbound email model (Phase 2, Task 3 — abstraction layer).

These models represent a normalized inbound email after provider-specific
fields have been stripped away. The router and business logic work exclusively
with these models; only the adapter layer knows about Postmark/Resend formats.
"""

from typing import Optional
from pydantic import BaseModel


class InboundAttachment(BaseModel):
    """A single file attachment, already decoded to raw bytes."""

    filename: str
    content: bytes          # raw bytes — adapter is responsible for base64-decoding
    content_type: str


class InboundEmail(BaseModel):
    """
    Normalized inbound email, provider-agnostic.

    All provider-specific field names (e.g. Postmark's PascalCase, Resend's
    snake_case) are mapped to these canonical names by the adapter layer before
    the router ever sees the data.
    """

    sender_email: str
    recipient_email: str
    subject: Optional[str] = None
    attachments: list[InboundAttachment] = []
