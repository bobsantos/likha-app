"""
Contract management API endpoints.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from typing import List, Optional
import io
import re
import tempfile
import os
import time
import logging
from datetime import date as _date

from app.models.contract import (
    Contract,
    ContractCreate,
    ContractConfirm,
    ContractStatus,
    ContractWithFormValues,
    ExtractedTerms,
)
from app.services.extractor import extract_contract
from app.services.normalizer import normalize_extracted_terms
from app.services.storage import upload_contract_pdf, get_signed_url, delete_contract_pdf
from app.services.report_template import generate_report_template
from app.db import supabase, supabase_admin
from app.auth import get_current_user, verify_contract_ownership

router = APIRouter()

logger = logging.getLogger(__name__)


def _refresh_pdf_url(contract: Contract) -> Contract:
    """Regenerate the signed PDF URL from storage_path if available."""
    if contract.storage_path:
        try:
            contract.pdf_url = get_signed_url(contract.storage_path)
        except Exception:
            pass  # Keep the existing (possibly expired) URL
    return contract


@router.post(
    "/extract",
    response_model=dict,
    responses={
        200: {
            "description": "Extraction succeeded — draft contract created",
            "content": {
                "application/json": {
                    "example": {
                        "contract_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                        "filename": "acme_license_2026.pdf",
                        "storage_path": "contracts/user-abc/acme_license_2026.pdf",
                        "pdf_url": "https://project.supabase.co/storage/v1/object/sign/contracts/...",
                        "extracted_terms": {
                            "licensee_name": "Acme Corp",
                            "royalty_rate": "8%",
                            "royalty_base": "net sales",
                            "territories": ["Worldwide"],
                            "contract_start_date": "2026-01-01",
                            "contract_end_date": "2028-12-31",
                            "minimum_guarantee": "$10,000 per year",
                            "reporting_frequency": "quarterly",
                            "confidence_score": 0.92,
                        },
                        "form_values": {
                            "licensee_name": "Acme Corp",
                            "royalty_rate": 8.0,
                            "royalty_base": "net_sales",
                            "minimum_guarantee": 10000.0,
                            "contract_start_date": "2026-01-01",
                            "contract_end_date": "2028-12-31",
                            "reporting_frequency": "quarterly",
                            "territories": ["Worldwide"],
                        },
                        "token_usage": {
                            "input_tokens": 1420,
                            "output_tokens": 380,
                            "total_tokens": 1800,
                        },
                    }
                }
            },
        },
        400: {"description": "File is not a PDF"},
        401: {"description": "Missing or invalid auth token"},
        409: {
            "description": "Duplicate filename (DUPLICATE_FILENAME) or incomplete draft (INCOMPLETE_DRAFT)",
            "content": {
                "application/json": {
                    "example": {
                        "detail": {
                            "code": "DUPLICATE_FILENAME",
                            "message": "A contract with this filename already exists.",
                            "existing_contract": {
                                "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                                "filename": "acme_license_2026.pdf",
                                "licensee_name": "Acme Corp",
                                "created_at": "2026-01-15T10:00:00Z",
                                "status": "active",
                            },
                        }
                    }
                }
            },
        },
    },
)
async def extract_contract_terms(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    """
    Upload a contract PDF and extract licensing terms using AI.

    Before uploading, checks for an existing contract with the same filename
    (case-insensitive) for the current user:
    - Active contract → 409 DUPLICATE_FILENAME
    - Draft contract  → 409 INCOMPLETE_DRAFT

    On success, persists a draft DB row immediately and returns contract_id
    so the frontend can resume even if the tab is closed.

    Requires authentication.
    """
    logger.info(
        f"Extract request received — filename={file.filename!r}, "
        f"content_type={file.content_type!r}"
    )

    filename_lower = (file.filename or "").lower()
    content_type = (file.content_type or "").lower()
    is_pdf_by_name = filename_lower.endswith(".pdf")
    is_pdf_by_type = content_type == "application/pdf"

    if not is_pdf_by_name and not is_pdf_by_type:
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # Normalise the filename: mobile browsers (e.g. Android Chrome) sometimes
    # send None or a content URI instead of a real filename.  Fall back to a
    # timestamped default so the rest of the pipeline has a usable string.
    effective_filename: str
    if file.filename and filename_lower.endswith(".pdf"):
        effective_filename = file.filename
    elif file.filename:
        # Has a name but not .pdf extension — it passed the content-type check,
        # so we keep the name and ensure the stored path has the right extension.
        effective_filename = file.filename + ".pdf"
    else:
        effective_filename = f"contract_{int(time.time())}.pdf"
        logger.info(
            f"No filename from client; using generated fallback: {effective_filename}"
        )

    # Read file content
    content = await file.read()

    # -------------------------------------------------------------------------
    # Step 1: Duplicate filename check (before any upload or extraction)
    # -------------------------------------------------------------------------
    dup_result = (
        supabase_admin.table("contracts")
        .select("id, filename, licensee_name, created_at, status")
        .eq("user_id", user_id)
        .ilike("filename", effective_filename)
        .execute()
    )

    if dup_result.data:
        existing = dup_result.data[0]
        status = existing.get("status", "active")

        if status == ContractStatus.ACTIVE:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DUPLICATE_FILENAME",
                    "message": "A contract with this filename already exists.",
                    "existing_contract": {
                        "id": existing["id"],
                        "filename": existing.get("filename"),
                        "licensee_name": existing.get("licensee_name"),
                        "created_at": existing.get("created_at"),
                        "status": status,
                    },
                },
            )
        else:
            # Draft exists — prompt user to resume
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "INCOMPLETE_DRAFT",
                    "message": "You have an incomplete upload for this file.",
                    "existing_contract": {
                        "id": existing["id"],
                        "filename": existing.get("filename"),
                        "created_at": existing.get("created_at"),
                        "status": status,
                    },
                },
            )

    # -------------------------------------------------------------------------
    # Step 2: Save uploaded file temporarily for extraction
    # -------------------------------------------------------------------------
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
        tmp_file.write(content)
        tmp_path = tmp_file.name

    storage_path = None

    try:
        # Step 3: Upload PDF to storage (deterministic path, upsert)
        logger.info(f"Uploading PDF to storage for user {user_id}: {effective_filename}")
        storage_path = upload_contract_pdf(content, user_id, effective_filename)

        # Step 4: Generate signed URL for frontend access
        pdf_url = get_signed_url(storage_path)

        # Step 5: Extract terms (best-effort cleanup on failure)
        logger.info(f"Extracting terms from PDF: {effective_filename}")
        try:
            extracted_terms, token_usage = await extract_contract(tmp_path)
        except Exception as extraction_err:
            # Best-effort: delete the uploaded PDF since we couldn't extract
            if storage_path:
                try:
                    delete_contract_pdf(storage_path)
                    logger.info(f"Cleaned up storage file after extraction failure: {storage_path}")
                except Exception as cleanup_err:
                    logger.warning(f"Failed to clean up storage file {storage_path}: {cleanup_err}")
            raise extraction_err

        # Normalise raw extraction into form-ready values
        form_values = normalize_extracted_terms(extracted_terms)

        # -----------------------------------------------------------------------
        # Step 6: Persist draft row to DB so work survives tab close
        # -----------------------------------------------------------------------
        draft_insert_data = {
            "user_id": user_id,
            "filename": effective_filename,
            "pdf_url": pdf_url,
            "storage_path": storage_path,
            "extracted_terms": extracted_terms.model_dump(),
            "status": ContractStatus.DRAFT,
        }

        # Use the admin client (service role key) so the server-side insert
        # bypasses RLS. The anon client has no JWT, so auth.uid() would be NULL
        # and the RLS INSERT policy (auth.uid() = user_id) would reject the row.
        if supabase_admin is None:
            raise HTTPException(
                status_code=500,
                detail="Server misconfiguration: SUPABASE_SERVICE_KEY is not set",
            )
        insert_result = supabase_admin.table("contracts").insert(draft_insert_data).execute()

        if not insert_result.data:
            raise HTTPException(status_code=500, detail="Failed to persist draft contract")

        draft_id = insert_result.data[0]["id"]

        logger.info(
            f"Draft contract {draft_id} created for {effective_filename}, "
            f"tokens used: {token_usage.get('total_tokens', 'N/A')}"
        )

        return {
            "contract_id": draft_id,
            "extracted_terms": extracted_terms.model_dump(),
            "form_values": form_values.model_dump(),
            "token_usage": token_usage,
            "filename": effective_filename,
            "storage_path": storage_path,
            "pdf_url": pdf_url,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Extraction failed for {effective_filename}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")
    finally:
        # Clean up temp file
        os.unlink(tmp_path)


@router.put(
    "/{contract_id}/confirm",
    response_model=Contract,
    responses={
        200: {
            "description": "Contract confirmed and now active",
            "content": {
                "application/json": {
                    "example": {
                        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                        "user_id": "user-abc",
                        "status": "active",
                        "agreement_number": "LKH-2026-1",
                        "filename": "acme_license_2026.pdf",
                        "licensee_name": "Acme Corp",
                        "licensee_email": "royalties@acme.com",
                        "royalty_rate": "8%",
                        "royalty_base": "net_sales",
                        "territories": ["Worldwide"],
                        "product_categories": None,
                        "contract_start_date": "2026-01-01",
                        "contract_end_date": "2028-12-31",
                        "minimum_guarantee": "10000.00",
                        "minimum_guarantee_period": "annually",
                        "advance_payment": None,
                        "reporting_frequency": "quarterly",
                        "is_expired": False,
                        "days_until_report_due": 45,
                        "pdf_url": "https://project.supabase.co/storage/v1/object/sign/contracts/...",
                        "created_at": "2026-01-15T10:00:00Z",
                        "updated_at": "2026-01-15T10:05:00Z",
                    }
                }
            },
        },
        401: {"description": "Missing or invalid auth token"},
        403: {"description": "Authenticated user does not own this contract"},
        404: {"description": "Contract not found"},
        409: {"description": "Contract is already active"},
    },
)
async def confirm_contract(
    contract_id: str,
    confirm_data: ContractConfirm,
    user_id: str = Depends(get_current_user),
):
    """
    Promote a draft contract to active after user review.

    Receives the user-reviewed fields and updates the draft row:
    - Populates all contract fields from ContractConfirm
    - Sets status from 'draft' → 'active'
    - Auto-assigns an agreement number (format: LKH-{year}-{seq})

    Returns 409 if the contract is already active.
    Returns 404 if the contract does not exist.

    Requires authentication. User must own the contract.
    """
    # Verify ownership and get the contract row in one query (no double fetch)
    current = await verify_contract_ownership(contract_id, user_id)

    current_status = current.get("status", "active")

    if current_status == ContractStatus.ACTIVE:
        raise HTTPException(
            status_code=409,
            detail="Contract is already active and cannot be confirmed again.",
        )

    # Auto-generate the agreement number: LKH-{year}-{sequential}.
    # Query the most recent agreement_number for this user in the current year
    # to determine the next sequential value.
    current_year = _date.today().year
    year_prefix = f"LKH-{current_year}-%"
    existing_ref = (
        supabase_admin.table("contracts")
        .select("agreement_number")
        .eq("user_id", user_id)
        .like("agreement_number", year_prefix)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    next_seq = 1
    if existing_ref.data:
        last_num = existing_ref.data[0].get("agreement_number", "")
        # Parse the trailing integer after the last '-'
        try:
            last_seq = int(last_num.rsplit("-", 1)[-1])
            next_seq = last_seq + 1
        except (ValueError, IndexError):
            next_seq = 1
    agreement_number = f"LKH-{current_year}-{next_seq}"

    # Build update payload from confirmed fields.
    # Use model_dump() for royalty_rate so that List[RoyaltyTier] Pydantic model
    # instances are converted to plain dicts before being passed to supabase-py,
    # which serializes the payload with json.dumps() and cannot handle Pydantic
    # model objects directly.
    _confirm_dump = confirm_data.model_dump()
    update_data = {
        "status": ContractStatus.ACTIVE,
        "licensee_name": confirm_data.licensee_name,
        "licensee_email": confirm_data.licensee_email,
        "agreement_number": agreement_number,
        "royalty_rate": _confirm_dump["royalty_rate"],
        "royalty_base": confirm_data.royalty_base,
        "territories": confirm_data.territories,
        "product_categories": confirm_data.product_categories,
        "contract_start_date": str(confirm_data.contract_start_date),
        "contract_end_date": str(confirm_data.contract_end_date),
        "minimum_guarantee": str(confirm_data.minimum_guarantee),
        "minimum_guarantee_period": confirm_data.minimum_guarantee_period,
        "advance_payment": str(confirm_data.advance_payment) if confirm_data.advance_payment else None,
        "reporting_frequency": confirm_data.reporting_frequency,
    }

    update_result = (
        supabase_admin.table("contracts")
        .update(update_data)
        .eq("id", contract_id)
        .execute()
    )

    if not update_result.data:
        raise HTTPException(status_code=500, detail="Failed to confirm contract")

    return Contract(**update_result.data[0])


@router.post("/", response_model=Contract)
async def create_contract(
    contract: ContractCreate,
    user_id: str = Depends(get_current_user),
):
    """
    Create a new contract after user has reviewed and corrected extraction.

    Legacy endpoint kept for compatibility. The preferred flow is:
    POST /extract (creates draft) → PUT /{id}/confirm (promotes to active).

    Requires authentication.
    """
    # Insert into database using the PDF URL from storage
    result = supabase_admin.table("contracts").insert({
        "user_id": user_id,
        "licensee_name": contract.licensee_name,
        "pdf_url": contract.pdf_url,
        "extracted_terms": contract.extracted_terms.model_dump(),
        "royalty_rate": contract.royalty_rate,
        "royalty_base": contract.royalty_base,
        "territories": contract.territories,
        "product_categories": contract.product_categories,
        "contract_start_date": str(contract.contract_start_date),
        "contract_end_date": str(contract.contract_end_date),
        "minimum_guarantee": str(contract.minimum_guarantee),
        "minimum_guarantee_period": contract.minimum_guarantee_period,
        "advance_payment": str(contract.advance_payment) if contract.advance_payment else None,
        "reporting_frequency": contract.reporting_frequency,
        "status": ContractStatus.ACTIVE,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create contract")

    return Contract(**result.data[0])


@router.get("/", response_model=List[Contract])
async def list_contracts(
    include_drafts: bool = Query(default=False),
    user_id: str = Depends(get_current_user),
):
    """
    List contracts for the authenticated user.

    By default returns only active contracts (status='active').
    Pass include_drafts=true to include draft contracts as well.

    Returns the stored pdf_url as-is — signed URL refresh is intentionally
    skipped here to avoid N network calls to Supabase Storage (one per contract).
    Use GET /{contract_id} for a fresh signed URL on a specific contract.

    Requires authentication.
    """
    query = supabase_admin.table("contracts").select("*").eq("user_id", user_id)

    if not include_drafts:
        query = query.eq("status", "active")

    result = query.execute()

    # Return stored pdf_url as-is — do NOT call _refresh_pdf_url in a loop.
    # Each get_signed_url call is a network round-trip; refreshing N contracts
    # on every list request is O(N) latency.  The single-contract GET endpoint
    # still refreshes the URL for the detail view.
    return [Contract(**row) for row in result.data]


@router.get("/{contract_id}", response_model=ContractWithFormValues)
async def get_contract(
    contract_id: str,
    user_id: str = Depends(get_current_user),
):
    """
    Get a single contract by ID.

    For draft contracts, also returns a ``form_values`` field containing
    normalized, form-ready values derived from the stored ``extracted_terms``.
    This allows the frontend review form to be pre-populated without any
    client-side parsing of raw extracted text.

    For active contracts ``form_values`` is omitted (None).

    Requires authentication. User must own the contract.
    """
    # Verify ownership and reuse the returned row — no second SELECT needed
    row = await verify_contract_ownership(contract_id, user_id)

    contract = _refresh_pdf_url(Contract(**row))

    form_values = None
    if contract.status == ContractStatus.DRAFT and contract.extracted_terms:
        try:
            raw_terms = ExtractedTerms(**contract.extracted_terms)
            form_values = normalize_extracted_terms(raw_terms)
        except Exception:
            logger.warning(
                f"Could not normalize extracted_terms for draft {contract_id}; "
                "form_values will be None"
            )

    return ContractWithFormValues(**contract.model_dump(), form_values=form_values)


@router.get("/{contract_id}/report-template")
async def get_report_template(
    contract_id: str,
    user_id: str = Depends(get_current_user),
) -> StreamingResponse:
    """
    Generate and download a pre-formatted Excel report template for a contract.

    The template is designed to be emailed to the licensee who fills it in
    and returns it. Column headers match what the spreadsheet parser's
    suggest_mapping function auto-recognizes, enabling zero-effort column
    mapping when the completed file is uploaded back.

    - For flat-rate contracts: Period Start, Period End, Net Sales, Royalty Due
    - For category-rate contracts: adds a Category column

    Returns:
        An .xlsx file as a streaming response (attachment download).

    Raises:
        404 if the contract does not exist.
        409 if the contract is in draft status (not yet active).

    Requires authentication. User must own the contract.
    """
    # Verify ownership and reuse the returned row — no second SELECT needed
    contract = await verify_contract_ownership(contract_id, user_id)

    if contract.get("status") != ContractStatus.ACTIVE:
        raise HTTPException(
            status_code=409,
            detail="Report templates can only be generated for active contracts.",
        )

    try:
        xlsx_bytes = generate_report_template(contract)
    except Exception as e:
        logger.error(f"Failed to generate report template for {contract_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate report template")

    # Build a safe filename from the licensee name
    licensee_name = contract.get("licensee_name") or "report"
    safe_name = re.sub(r"[^\w\s-]", "", licensee_name).strip()
    safe_name = re.sub(r"[\s]+", "_", safe_name)
    filename = f"royalty_report_template_{safe_name}.xlsx"

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.delete("/{contract_id}")
async def delete_contract(
    contract_id: str,
    user_id: str = Depends(get_current_user),
):
    """
    Delete a contract and its associated PDF from storage.

    Works for both draft and active contracts.

    Requires authentication. User must own the contract.
    """
    # Verify ownership and reuse the returned row — no second SELECT needed
    contract = await verify_contract_ownership(contract_id, user_id)

    storage_path = contract.get("storage_path")
    pdf_url = contract.get("pdf_url")

    # Delete PDF from storage (best-effort, continue if it fails)
    if storage_path:
        try:
            delete_contract_pdf(storage_path)
            logger.info(f"Deleted PDF from storage: {storage_path}")
        except Exception as e:
            logger.error(f"Failed to delete PDF from storage: {str(e)}")
    elif pdf_url:
        # Fallback for older rows that only have pdf_url
        try:
            delete_contract_pdf(pdf_url)
            logger.info(f"Deleted PDF from storage: {pdf_url}")
        except Exception as e:
            logger.error(f"Failed to delete PDF from storage: {str(e)}")

    # TODO: Delete associated sales periods (will be handled by cascade delete in DB)

    # Delete contract from database
    result = supabase_admin.table("contracts").delete().eq("id", contract_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    return {"message": "Contract deleted"}
