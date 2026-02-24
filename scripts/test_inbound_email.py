#!/usr/bin/env python3
"""
Dev helper: send a test inbound-email webhook to the local Likha backend.

Constructs a valid webhook payload for the configured provider, optionally
attaches a real file (or generates a sample CSV), and POST-s it to the
/api/email-intake/inbound endpoint.

Usage
-----
# Basic — Resend payload with a generated CSV, targeting localhost:8000
python scripts/test_inbound_email.py

# Send a specific file
python scripts/test_inbound_email.py --file path/to/report.xlsx

# Target a specific user short_id (first 8 chars of their Supabase UUID)
python scripts/test_inbound_email.py --short-id abcd1234

# Custom sender address
python scripts/test_inbound_email.py --from licensee@example.com

# Use Postmark payload format instead of Resend
python scripts/test_inbound_email.py --provider postmark

# Target a different backend URL
python scripts/test_inbound_email.py --url http://staging.example.com

Environment / .env
------------------
INBOUND_WEBHOOK_SECRET   Shared webhook secret (required).
                         Falls back to POSTMARK_WEBHOOK_SECRET for
                         backward compatibility.
EMAIL_PROVIDER           Provider format to use (default: resend).
                         Overridden by --provider flag.

The script reads these from a .env file in the project root if present,
without requiring python-dotenv to be installed (it parses the file directly).
"""

import argparse
import base64
import json
import os
import sys
import textwrap
from pathlib import Path


# ---------------------------------------------------------------------------
# .env loader (no dependencies required)
# ---------------------------------------------------------------------------

def _load_dotenv(path: Path) -> None:
    """
    Parse a .env file and set variables in os.environ.

    Only sets variables that are not already in the environment — the same
    behavior as python-dotenv's load_dotenv(override=False).
    """
    if not path.exists():
        return
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


# ---------------------------------------------------------------------------
# Secret resolution
# ---------------------------------------------------------------------------

def _resolve_secret() -> str:
    """
    Return the webhook secret from environment.

    Checks INBOUND_WEBHOOK_SECRET first, then falls back to the legacy
    POSTMARK_WEBHOOK_SECRET.
    """
    return (
        os.getenv("INBOUND_WEBHOOK_SECRET")
        or os.getenv("POSTMARK_WEBHOOK_SECRET")
        or ""
    )


# ---------------------------------------------------------------------------
# Sample CSV generator
# ---------------------------------------------------------------------------

def _make_sample_csv() -> bytes:
    """Return a minimal royalty report CSV as bytes."""
    lines = [
        "licensee,product,territory,net_sales,royalty_rate,royalty_due",
        "Acme Corp,Widget Pro,US,125000.00,8%,10000.00",
        "Acme Corp,Widget Lite,US,50000.00,6%,3000.00",
        "Acme Corp,Widget Pro,EU,75000.00,8%,6000.00",
    ]
    return "\n".join(lines).encode()


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------

def _build_resend_payload(
    from_email: str,
    to_address: str,
    subject: str,
    file_content: bytes,
    filename: str,
    content_type: str,
) -> dict:
    """
    Build a Resend inbound webhook payload (snake_case keys).

    Resend inbound format:
      from          — sender address
      to            — recipient address
      subject       — email subject
      attachments[] — {filename, content (base64), content_type}
    """
    return {
        "from": from_email,
        "to": to_address,
        "subject": subject,
        "attachments": [
            {
                "filename": filename,
                "content": base64.b64encode(file_content).decode(),
                "content_type": content_type,
            }
        ],
    }


def _build_postmark_payload(
    from_email: str,
    to_address: str,
    subject: str,
    file_content: bytes,
    filename: str,
    content_type: str,
) -> dict:
    """
    Build a Postmark inbound webhook payload (PascalCase keys).

    Postmark inbound format:
      From          — sender address
      To            — recipient address
      Subject       — email subject
      Attachments[] — {Name, Content (base64), ContentType}
    """
    return {
        "From": from_email,
        "To": to_address,
        "Subject": subject,
        "Attachments": [
            {
                "Name": filename,
                "Content": base64.b64encode(file_content).decode(),
                "ContentType": content_type,
            }
        ],
    }


_PAYLOAD_BUILDERS = {
    "resend": _build_resend_payload,
    "postmark": _build_postmark_payload,
}


# ---------------------------------------------------------------------------
# Content-type detection
# ---------------------------------------------------------------------------

def _detect_content_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".csv": "text/csv",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
    }.get(ext, "application/octet-stream")


# ---------------------------------------------------------------------------
# Pretty printer
# ---------------------------------------------------------------------------

def _print_response(response) -> None:
    status = response.status_code
    symbol = "OK" if status == 200 else "FAIL"
    print(f"\n[{symbol}] HTTP {status}")
    try:
        body = response.json()
        print(json.dumps(body, indent=2))
    except Exception:
        print(response.text)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    # Locate project root (scripts/ lives one level below the root)
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    _load_dotenv(project_root / ".env")
    _load_dotenv(project_root / "backend" / ".env")

    parser = argparse.ArgumentParser(
        prog="test_inbound_email.py",
        description=textwrap.dedent("""\
            Send a test inbound-email webhook to the Likha backend.

            Reads INBOUND_WEBHOOK_SECRET (or legacy POSTMARK_WEBHOOK_SECRET)
            from the environment or a .env file in the project root.
        """),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              python scripts/test_inbound_email.py
              python scripts/test_inbound_email.py --file exports/q1.xlsx
              python scripts/test_inbound_email.py --short-id abcd1234
              python scripts/test_inbound_email.py --provider postmark
              python scripts/test_inbound_email.py --url http://localhost:8000
        """),
    )
    parser.add_argument(
        "--url",
        default="http://localhost:8000",
        help="Backend base URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--provider",
        default=os.getenv("EMAIL_PROVIDER", "resend"),
        choices=list(_PAYLOAD_BUILDERS),
        help="Webhook payload format to use (default: resend)",
    )
    parser.add_argument(
        "--file",
        default=None,
        metavar="PATH",
        help="Path to a file to attach. A sample CSV is used if omitted.",
    )
    parser.add_argument(
        "--short-id",
        default="abcd1234",
        metavar="SHORT_ID",
        help=(
            "8-character short_id (first 8 chars of a real user UUID). "
            "The recipient address is reports-SHORT_ID@inbound.likha.app. "
            "(default: abcd1234)"
        ),
    )
    parser.add_argument(
        "--from",
        dest="from_email",
        default="licensee@example.com",
        help="Sender email address (default: licensee@example.com)",
    )
    parser.add_argument(
        "--subject",
        default="Test Royalty Report",
        help='Email subject (default: "Test Royalty Report")',
    )
    parser.add_argument(
        "--secret",
        default=None,
        metavar="SECRET",
        help=(
            "Override the webhook secret. "
            "Defaults to INBOUND_WEBHOOK_SECRET / POSTMARK_WEBHOOK_SECRET env var."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the payload JSON without sending it.",
    )

    args = parser.parse_args()

    # Resolve webhook secret
    secret = args.secret or _resolve_secret()
    if not secret and not args.dry_run:
        print(
            "ERROR: No webhook secret found.\n"
            "Set INBOUND_WEBHOOK_SECRET in your environment or .env file, "
            "or pass --secret.",
            file=sys.stderr,
        )
        return 1

    # Load or generate attachment
    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"ERROR: File not found: {file_path}", file=sys.stderr)
            return 1
        file_content = file_path.read_bytes()
        filename = file_path.name
        content_type = _detect_content_type(filename)
        print(f"Attaching file: {file_path} ({len(file_content):,} bytes)")
    else:
        file_content = _make_sample_csv()
        filename = "sample_royalty_report.csv"
        content_type = "text/csv"
        print(f"No --file specified; using generated sample CSV ({len(file_content)} bytes)")

    # Build To address
    to_address = f"reports-{args.short_id}@inbound.likha.app"

    # Build payload
    builder = _PAYLOAD_BUILDERS[args.provider]
    payload = builder(
        from_email=args.from_email,
        to_address=to_address,
        subject=args.subject,
        file_content=file_content,
        filename=filename,
        content_type=content_type,
    )

    endpoint = f"{args.url.rstrip('/')}/api/email-intake/inbound"

    print(f"\nProvider  : {args.provider}")
    print(f"Endpoint  : {endpoint}")
    print(f"From      : {args.from_email}")
    print(f"To        : {to_address}")
    print(f"Subject   : {args.subject}")
    print(f"Attachment: {filename}")

    if args.dry_run:
        # Print payload without the (potentially large) base64 blob
        display = dict(payload)
        att_key = "attachments" if args.provider == "resend" else "Attachments"
        if display.get(att_key):
            display[att_key] = [
                {
                    **a,
                    ("content" if args.provider == "resend" else "Content"): (
                        "<base64-encoded, %d bytes>" % len(file_content)
                    ),
                }
                for a in display[att_key]
            ]
        print("\n[DRY RUN] Payload:")
        print(json.dumps(display, indent=2))
        return 0

    # Determine auth headers for the selected provider
    # Both X-Webhook-Secret and X-Postmark-Secret work; use the one
    # that matches provider convention for clarity.
    if args.provider == "postmark":
        auth_headers = {"X-Postmark-Secret": secret}
    else:
        auth_headers = {"X-Webhook-Secret": secret}

    # Send the request
    try:
        import httpx
    except ImportError:
        # httpx is in requirements.txt but fall back to urllib if not available
        import urllib.request
        import urllib.error

        req_body = json.dumps(payload).encode()
        req = urllib.request.Request(
            endpoint,
            data=req_body,
            headers={"Content-Type": "application/json", **auth_headers},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                body = resp.read().decode()
                print(f"\n[OK] HTTP {resp.status}")
                try:
                    print(json.dumps(json.loads(body), indent=2))
                except Exception:
                    print(body)
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"\n[FAIL] HTTP {e.code}")
            try:
                print(json.dumps(json.loads(body), indent=2))
            except Exception:
                print(body)
            return 1
        return 0

    try:
        response = httpx.post(
            endpoint,
            json=payload,
            headers=auth_headers,
            timeout=30,
        )
        _print_response(response)
        return 0 if response.status_code == 200 else 1
    except httpx.ConnectError:
        print(
            f"\nERROR: Could not connect to {endpoint}\n"
            "Is the backend running? Start it with:\n"
            "  cd backend && source .venv/bin/activate && uvicorn app.main:app --reload",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
