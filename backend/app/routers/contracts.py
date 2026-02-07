"""
Contract management API endpoints.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List
import tempfile
import os

from app.models.contract import Contract, ContractCreate, ExtractedTerms
from app.services.extractor import extract_contract
from app.db import supabase
from app.auth import get_current_user, verify_contract_ownership

router = APIRouter()


@router.post("/extract", response_model=dict)
async def extract_contract_terms(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    """
    Upload a contract PDF and extract licensing terms using AI.

    Returns extraction results including extracted terms, confidence score,
    and token usage.

    Requires authentication.
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # Save uploaded file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
        content = await file.read()
        tmp_file.write(content)
        tmp_path = tmp_file.name

    try:
        # Extract terms
        extracted_terms, token_usage = await extract_contract(tmp_path)

        return {
            "extracted_terms": extracted_terms.model_dump(),
            "token_usage": token_usage,
            "filename": file.filename,
        }
    except Exception as e:
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

    Requires authentication.
    """
    # TODO: Upload PDF to Supabase storage and get URL
    pdf_url = "https://placeholder.pdf"  # Placeholder

    # Insert into database
    result = supabase.table("contracts").insert({
        "user_id": user_id,
        "licensee_name": contract.licensee_name,
        "pdf_url": pdf_url,
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
    Delete a contract.

    Requires authentication. User must own the contract.
    """
    # Verify user owns this contract
    await verify_contract_ownership(contract_id, user_id)

    # TODO: Delete associated sales periods
    # TODO: Delete PDF from storage

    result = supabase.table("contracts").delete().eq("id", contract_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    return {"message": "Contract deleted"}
