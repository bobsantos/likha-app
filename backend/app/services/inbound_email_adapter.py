"""
Inbound email adapter service (Phase 2, Task 3).

Normalizes provider-specific inbound webhook payloads into a single
provider-agnostic InboundEmail model.

Supported providers:
  - postmark  (default legacy provider)
  - resend    (new default; set EMAIL_PROVIDER=resend or pass provider="resend")

Adding a new provider:
  1. Write a normalize_<provider>(payload: dict) -> InboundEmail function.
  2. Register it in _NORMALIZERS.
  3. Set EMAIL_PROVIDER=<provider> in the environment.

Resend inbound webhook field assumptions
----------------------------------------
Resend's inbound email feature (as of 2025) delivers a JSON body with these
top-level keys (snake_case):

  from          str   — sender address, e.g. "Alice <alice@example.com>"
  to            str   — recipient address (or comma-separated list)
  subject       str   — email subject line
  attachments   list  — each item has:
                          filename     str   — original filename
                          content      str   — base64-encoded file bytes
                          content_type str   — MIME type

If Resend changes their schema, only this file needs updating.
"""

import base64
import os
from typing import Callable

from app.models.inbound_email import InboundAttachment, InboundEmail


# ---------------------------------------------------------------------------
# Postmark normalizer
# ---------------------------------------------------------------------------

def normalize_postmark(payload: dict) -> InboundEmail:
    """
    Convert a Postmark inbound webhook payload to InboundEmail.

    Postmark uses PascalCase keys:
      From, To, Subject, Attachments[].{Name, Content, ContentType}

    Content is base64-encoded in Postmark payloads.
    """
    attachments: list[InboundAttachment] = []
    for att in payload.get("Attachments") or []:
        raw = att.get("Content", "")
        try:
            content_bytes = base64.b64decode(raw)
        except Exception:
            content_bytes = b""
        attachments.append(
            InboundAttachment(
                filename=att.get("Name", "attachment"),
                content=content_bytes,
                content_type=att.get("ContentType", "application/octet-stream"),
            )
        )

    return InboundEmail(
        sender_email=payload.get("From", ""),
        recipient_email=payload.get("To", ""),
        subject=payload.get("Subject"),
        attachments=attachments,
    )


# ---------------------------------------------------------------------------
# Resend normalizer
# ---------------------------------------------------------------------------

def normalize_resend(payload: dict) -> InboundEmail:
    """
    Convert a Resend inbound webhook payload to InboundEmail.

    Resend uses snake_case keys:
      from, to, subject, attachments[].{filename, content, content_type}

    content is base64-encoded in Resend payloads.
    """
    attachments: list[InboundAttachment] = []
    for att in payload.get("attachments") or []:
        raw = att.get("content", "")
        try:
            content_bytes = base64.b64decode(raw)
        except Exception:
            content_bytes = b""
        attachments.append(
            InboundAttachment(
                filename=att.get("filename", "attachment"),
                content=content_bytes,
                content_type=att.get("content_type", "application/octet-stream"),
            )
        )

    return InboundEmail(
        sender_email=payload.get("from", ""),
        recipient_email=payload.get("to", ""),
        subject=payload.get("subject"),
        attachments=attachments,
    )


# ---------------------------------------------------------------------------
# Registry and dispatcher
# ---------------------------------------------------------------------------

_NORMALIZERS: dict[str, Callable[[dict], InboundEmail]] = {
    "postmark": normalize_postmark,
    "resend": normalize_resend,
}


def normalize_webhook(payload: dict, provider: str | None = None) -> InboundEmail:
    """
    Route to the correct normalizer based on the provider argument or the
    EMAIL_PROVIDER environment variable.

    Priority:
      1. provider argument (explicit, used in tests and the webhook endpoint)
      2. EMAIL_PROVIDER env var
      3. Default: "resend"

    Raises ValueError for unknown provider names.
    """
    resolved = provider or os.getenv("EMAIL_PROVIDER", "resend")
    resolved = resolved.lower().strip()

    normalizer = _NORMALIZERS.get(resolved)
    if normalizer is None:
        raise ValueError(
            f"Unknown email provider {resolved!r}. "
            f"Supported providers: {sorted(_NORMALIZERS)}"
        )

    return normalizer(payload)
