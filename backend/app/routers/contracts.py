"""
Contract management API endpoints.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List
import tempfile
import os
import logging

from app.models.contract import Contract, ContractCreate, ExtractedTerms
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

    Returns extraction results including extracted terms, confidence score,
    token usage, storage path, and signed PDF URL.

    Requires authentication.
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # Read file content
    content = await file.read()

    # Save uploaded file temporarily for extraction
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
        tmp_file.write(content)
        tmp_path = tmp_file.name

    try:
        # Upload PDF to storage
        logger.info(f"Uploading PDF to storage for user {user_id}: {file.filename}")
        storage_path = upload_contract_pdf(content, user_id, file.filename)

        # Generate signed URL for frontend access
        pdf_url = get_signed_url(storage_path)

        # Extract terms
        logger.info(f"Extracting terms from PDF: {file.filename}")
        extracted_terms, token_usage = await extract_contract(tmp_path)

        # Normalise raw extraction into form-ready values
        form_values = normalize_extracted_terms(extracted_terms)

        logger.info(f"Extraction complete for {file.filename}, tokens used: {token_usage.get('total_tokens', 'N/A')}")
        return {
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


@router.post("/", response_model=Contract)
async def create_contract(
    contract: ContractCreate,
    user_id: str = Depends(get_current_user),
):
    """
    Create a new contract after user has reviewed and corrected extraction.

    The PDF should have been uploaded during the /extract step, and the
    pdf_url should be included in the ContractCreate data.

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
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create contract")

    return Contract(**result.data[0])


@router.get("/", response_model=List[Contract])
async def list_contracts(
    user_id: str = Depends(get_current_user),
):
    """
    List all contracts for the authenticated user.

    Requires authentication.
    """

    result = supabase.table("contracts").select("*").eq("user_id", user_id).execute()

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
