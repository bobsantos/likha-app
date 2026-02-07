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

router = APIRouter()


@router.post("/extract", response_model=dict)
async def extract_contract_terms(
    file: UploadFile = File(...),
):
    """
    Upload a contract PDF and extract licensing terms using AI.

    Returns extraction results including extracted terms, confidence score,
    and token usage.
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
    # TODO: Add user authentication dependency
):
    """
    Create a new contract after user has reviewed and corrected extraction.
    """
    # TODO: Get user_id from auth token
    user_id = "temp-user-id"  # Placeholder

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
    # TODO: Add user authentication dependency
):
    """
    List all contracts for the authenticated user.
    """
    # TODO: Get user_id from auth token
    user_id = "temp-user-id"  # Placeholder

    result = supabase.table("contracts").select("*").eq("user_id", user_id).execute()

    return [Contract(**row) for row in result.data]


@router.get("/{contract_id}", response_model=Contract)
async def get_contract(
    contract_id: str,
    # TODO: Add user authentication dependency
):
    """
    Get a single contract by ID.
    """
    # TODO: Verify user owns this contract

    result = supabase.table("contracts").select("*").eq("id", contract_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    return Contract(**result.data[0])


@router.delete("/{contract_id}")
async def delete_contract(
    contract_id: str,
    # TODO: Add user authentication dependency
):
    """
    Delete a contract.
    """
    # TODO: Verify user owns this contract
    # TODO: Delete associated sales periods
    # TODO: Delete PDF from storage

    result = supabase.table("contracts").delete().eq("id", contract_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    return {"message": "Contract deleted"}
