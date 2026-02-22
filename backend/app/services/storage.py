"""
Supabase Storage service for contract PDFs.
Handles upload, signed URL generation, and deletion.
"""

import os
import re
from uuid import uuid4
from urllib.parse import urlparse, urlunparse

from app.db import supabase_admin


def upload_contract_pdf(
    file_content: bytes,
    user_id: str,
    filename: str | None = None
) -> str:
    """
    Upload a contract PDF to Supabase Storage.

    Storage path is deterministic: contracts/{user_id}/{sanitized_filename}
    Using upsert=true so re-uploads overwrite orphaned files from failed sessions.

    Args:
        file_content: Binary content of the PDF file
        user_id: User ID for organizing storage by user
        filename: Original filename (optional, will generate UUID if not provided)

    Returns:
        Storage path (e.g., "contracts/user-123/filename.pdf")

    Raises:
        Exception: If upload fails
    """
    if not supabase_admin:
        raise ValueError("SUPABASE_SERVICE_KEY is required for storage operations")

    # Generate filename if not provided
    if not filename:
        filename = f"{uuid4().hex}.pdf"
        storage_path = f"contracts/{user_id}/{filename}"
    else:
        # Sanitize filename: replace spaces and special chars with underscores.
        # No UUID prefix — path is deterministic for duplicate detection purposes.
        sanitized_filename = re.sub(r'[^\w\-.]', '_', filename)
        storage_path = f"contracts/{user_id}/{sanitized_filename}"

    # Upload to Supabase Storage with upsert so re-uploads overwrite orphaned files
    try:
        result = supabase_admin.storage.from_("contracts").upload(
            storage_path,
            file_content,
            {
                "content-type": "application/pdf",
                "upsert": "true"  # Overwrite existing files (deterministic paths)
            }
        )

        # Return the storage path
        return storage_path
    except Exception as e:
        raise Exception(f"Failed to upload PDF to storage: {str(e)}")


def _rewrite_signed_url_host(signed_url: str) -> str:
    """
    Replace the host in a signed URL with the browser-accessible Supabase URL.

    When the backend runs inside Docker it uses an internal URL like
    ``http://host.docker.internal:54321`` so it can reach the Supabase API.
    Supabase embeds that internal host in every signed URL it generates, making
    those URLs unreachable from a browser.

    If ``SUPABASE_PUBLIC_URL`` is set it is used as the replacement origin so
    the signed URLs returned to the frontend always use the public-facing host
    (e.g. ``http://localhost:54321`` or ``https://xxx.supabase.co``).

    If the env var is not set the URL is returned unchanged — this is the correct
    behaviour for production deployments where the backend and Supabase share the
    same public URL.
    """
    public_url = os.getenv("SUPABASE_PUBLIC_URL", "").strip()
    if not public_url:
        return signed_url

    parsed_signed = urlparse(signed_url)
    parsed_public = urlparse(public_url)

    # Swap scheme + netloc; keep path/query/fragment from the signed URL.
    rewritten = urlunparse((
        parsed_public.scheme,
        parsed_public.netloc,
        parsed_signed.path,
        parsed_signed.params,
        parsed_signed.query,
        parsed_signed.fragment,
    ))
    return rewritten


def get_signed_url(storage_path: str, expiry_seconds: int = 3600) -> str:
    """
    Generate a signed URL for accessing a file in Supabase Storage.

    The URL host is rewritten via ``_rewrite_signed_url_host`` so that
    Docker-internal hostnames (``host.docker.internal``) are replaced with the
    browser-accessible ``SUPABASE_PUBLIC_URL`` before the URL is returned.

    Args:
        storage_path: Storage path (e.g., "contracts/user-123/filename.pdf")
        expiry_seconds: URL expiry time in seconds (default: 1 hour)

    Returns:
        Signed URL for accessing the file, with a browser-accessible host.

    Raises:
        Exception: If URL generation fails
    """
    if not supabase_admin:
        raise ValueError("SUPABASE_SERVICE_KEY is required for storage operations")

    try:
        result = supabase_admin.storage.from_("contracts").create_signed_url(
            storage_path,
            expiry_seconds
        )

        if not result or "signedURL" not in result:
            raise Exception("No signed URL returned from storage")

        return _rewrite_signed_url_host(result["signedURL"])
    except Exception as e:
        raise Exception(f"Failed to generate signed URL: {str(e)}")


def upload_sales_report(
    file_content: bytes,
    user_id: str,
    contract_id: str,
    filename: str,
) -> str:
    """
    Upload a sales report spreadsheet to Supabase Storage.

    Storage path: sales-reports/{user_id}/{contract_id}/{sanitized_filename}
    Using upsert=true so re-uploads overwrite orphaned files.

    Args:
        file_content: Binary content of the spreadsheet file
        user_id: User ID for organizing storage by user
        contract_id: Contract ID the report belongs to
        filename: Original filename (e.g. "Q1_report.xlsx")

    Returns:
        Storage path (e.g., "sales-reports/user-123/contract-456/Q1_report.xlsx")

    Raises:
        Exception: If upload fails
    """
    if not supabase_admin:
        raise ValueError("SUPABASE_SERVICE_KEY is required for storage operations")

    # Sanitize filename: replace spaces and special chars with underscores
    sanitized_filename = re.sub(r'[^\w\-.]', '_', filename)
    storage_path = f"sales-reports/{user_id}/{contract_id}/{sanitized_filename}"

    # Determine content type from extension
    lower = filename.lower()
    if lower.endswith(".csv"):
        content_type = "text/csv"
    else:
        # Default to xlsx content type for .xlsx and anything else
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    try:
        supabase_admin.storage.from_("contracts").upload(
            storage_path,
            file_content,
            {
                "content-type": content_type,
                "upsert": "true"
            }
        )
        return storage_path
    except Exception as e:
        raise Exception(f"Failed to upload sales report to storage: {str(e)}")


def delete_contract_pdf(pdf_url_or_path: str) -> bool:
    """
    Delete a contract PDF from Supabase Storage.

    Args:
        pdf_url_or_path: Either full signed URL or storage path

    Returns:
        True if deleted successfully, False if file not found

    Raises:
        Exception: If deletion fails (other than file not found)
    """
    if not supabase_admin:
        raise ValueError("SUPABASE_SERVICE_KEY is required for storage operations")

    # Extract storage path from URL if full URL provided
    storage_path = pdf_url_or_path
    if pdf_url_or_path.startswith("http"):
        # Parse URL to extract path
        # Example: https://test.supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=abc123
        parsed = urlparse(pdf_url_or_path)
        path_parts = parsed.path.split("/object/")
        if len(path_parts) > 1:
            # Remove "sign/" prefix if present
            storage_path = path_parts[1].replace("sign/", "")

    try:
        result = supabase_admin.storage.from_("contracts").remove([storage_path])

        # Supabase returns list of deleted files
        if result and len(result) > 0:
            return True
        else:
            # File not found
            return False
    except Exception as e:
        raise Exception(f"Failed to delete PDF from storage: {str(e)}")
