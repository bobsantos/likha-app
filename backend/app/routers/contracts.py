"""
Contract management API endpoints.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query
from typing import List, Optional
import tempfile
import os
import logging

from app.models.contract import (
    Contract,
    ContractCreate,
    ContractConfirm,
    ContractStatus,
    ExtractedTerms,
)
from app.services.extractor import extract_contract
from app.services.normalizer import normalize_extracted_terms
from app.services.storage import upload_contract_pdf, get_signed_url, delete_contract_pdf
from app.db import supabase
from app.auth import get_current_user, verify_contract_ownership

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/extract", response_model=dict)
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
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # Read file content
    content = await file.read()

    # -------------------------------------------------------------------------
    # Step 1: Duplicate filename check (before any upload or extraction)
    # -------------------------------------------------------------------------
    dup_result = (
        supabase.table("contracts")
        .select("id, filename, licensee_name, created_at, status")
        .eq("user_id", user_id)
        .ilike("filename", file.filename)
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
        logger.info(f"Uploading PDF to storage for user {user_id}: {file.filename}")
        storage_path = upload_contract_pdf(content, user_id, file.filename)

        # Step 4: Generate signed URL for frontend access
        pdf_url = get_signed_url(storage_path)

        # Step 5: Extract terms (best-effort cleanup on failure)
        logger.info(f"Extracting terms from PDF: {file.filename}")
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
            "filename": file.filename,
            "pdf_url": pdf_url,
            "storage_path": storage_path,
            "extracted_terms": extracted_terms.model_dump(),
            "status": ContractStatus.DRAFT,
        }

        insert_result = supabase.table("contracts").insert(draft_insert_data).execute()

        if not insert_result.data:
            raise HTTPException(status_code=500, detail="Failed to persist draft contract")

        draft_id = insert_result.data[0]["id"]

        logger.info(
            f"Draft contract {draft_id} created for {file.filename}, "
            f"tokens used: {token_usage.get('total_tokens', 'N/A')}"
        )

        return {
            "contract_id": draft_id,
            "extracted_terms": extracted_terms.model_dump(),
            "form_values": form_values.model_dump(),
            "token_usage": token_usage,
            "filename": file.filename,
            "storage_path": storage_path,
            "pdf_url": pdf_url,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Extraction failed for {file.filename}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")
    finally:
        # Clean up temp file
        os.unlink(tmp_path)


@router.put("/{contract_id}/confirm", response_model=Contract)
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

    Returns 409 if the contract is already active.
    Returns 404 if the contract does not exist.

    Requires authentication. User must own the contract.
    """
    # Verify ownership first (raises 404 or 403 as appropriate)
    await verify_contract_ownership(contract_id, user_id)

    # Fetch the current contract to check its status
    result = supabase.table("contracts").select("*").eq("id", contract_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    current = result.data[0]
    current_status = current.get("status", "active")

    if current_status == ContractStatus.ACTIVE:
        raise HTTPException(
            status_code=409,
            detail="Contract is already active and cannot be confirmed again.",
        )

    # Build update payload from confirmed fields
    update_data = {
        "status": ContractStatus.ACTIVE,
        "licensee_name": confirm_data.licensee_name,
        "royalty_rate": confirm_data.royalty_rate,
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
        supabase.table("contracts")
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
    result = supabase.table("contracts").insert({
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

    Requires authentication.
    """
    query = supabase.table("contracts").select("*").eq("user_id", user_id)

    if not include_drafts:
        query = query.eq("status", "active")

    result = query.execute()

    return [Contract(**row) for row in result.data]


@router.get("/{contract_id}", response_model=Contract)
async def get_contract(
    contract_id: str,
    user_id: str = Depends(get_current_user),
):
    """
    Get a single contract by ID.

    Requires authentication. User must own the contract.
    """
    # Verify user owns this contract
    await verify_contract_ownership(contract_id, user_id)

    result = supabase.table("contracts").select("*").eq("id", contract_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    return Contract(**result.data[0])


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
    # Verify user owns this contract
    await verify_contract_ownership(contract_id, user_id)

    # Get contract to retrieve PDF URL
    contract_result = supabase.table("contracts").select("*").eq("id", contract_id).execute()

    if not contract_result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract = contract_result.data[0]
    pdf_url = contract.get("pdf_url")

    # Delete PDF from storage (best-effort, continue if it fails)
    if pdf_url:
        try:
            delete_contract_pdf(pdf_url)
            logger.info(f"Deleted PDF from storage: {pdf_url}")
        except Exception as e:
            # Log error but don't fail the request
            logger.error(f"Failed to delete PDF from storage: {str(e)}")

    # TODO: Delete associated sales periods (will be handled by cascade delete in DB)

    # Delete contract from database
    result = supabase.table("contracts").delete().eq("id", contract_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    return {"message": "Contract deleted"}
