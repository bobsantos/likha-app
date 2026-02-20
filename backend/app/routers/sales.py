"""
Sales period management API endpoints.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
from decimal import Decimal

from app.models.sales import SalesPeriod, SalesPeriodCreate, RoyaltySummary
from app.services.royalty_calc import calculate_royalty
from app.db import supabase
from app.auth import get_current_user, verify_contract_ownership

router = APIRouter()


@router.post("/", response_model=SalesPeriod)
async def create_sales_period(
    period: SalesPeriodCreate,
    user_id: str = Depends(get_current_user),
):
    """
    Record a new sales period and calculate royalties.

    Requires authentication. User must own the contract.
    """
    # Verify user owns the contract
    await verify_contract_ownership(period.contract_id, user_id)

    # Get contract to determine royalty structure
    contract_result = supabase.table("contracts").select("*").eq("id", period.contract_id).execute()

    if not contract_result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract = contract_result.data[0]

    # Calculate royalty
    try:
        royalty = calculate_royalty(
            royalty_rate=contract['royalty_rate'],
            net_sales=period.net_sales,
            category_breakdown=period.category_breakdown
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Royalty calculation failed: {str(e)}")

    # Check if minimum guarantee applies
    minimum_guarantee = Decimal(contract.get('minimum_guarantee', 0))
    minimum_applied = False

    # TODO: Implement minimum guarantee logic
    # For quarterly minimum: if royalty < minimum, set royalty = minimum
    # For annual minimum: need to check YTD total

    # Insert sales period
    result = supabase.table("sales_periods").insert({
        "contract_id": period.contract_id,
        "period_start": str(period.period_start),
        "period_end": str(period.period_end),
        "net_sales": str(period.net_sales),
        "category_breakdown": period.category_breakdown,
        "royalty_calculated": str(royalty),
        "minimum_applied": minimum_applied,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create sales period")

    return SalesPeriod(**result.data[0])


@router.get("/contract/{contract_id}", response_model=List[SalesPeriod])
async def list_sales_periods(
    contract_id: str,
    user_id: str = Depends(get_current_user),
):
    """
    List all sales periods for a contract.

    Requires authentication. User must own the contract.
    """
    # Verify user owns the contract
    await verify_contract_ownership(contract_id, user_id)

    result = supabase.table("sales_periods").select("*").eq("contract_id", contract_id).order("period_start", desc=True).execute()

    return [SalesPeriod(**row) for row in result.data]


@router.get("/summary/{contract_id}", response_model=RoyaltySummary)
async def get_royalty_summary(
    contract_id: str,
    contract_year: int = 1,
    user_id: str = Depends(get_current_user),
):
    """
    Get year-to-date royalty summary for a contract.

    Requires authentication. User must own the contract.
    """
    # Verify user owns the contract
    await verify_contract_ownership(contract_id, user_id)

    # TODO: Implement aggregation logic
    # - Sum sales_periods for the contract year
    # - Calculate shortfall vs minimum guarantee
    # - Track advance payment credit

    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.delete("/{period_id}")
async def delete_sales_period(
    period_id: str,
    user_id: str = Depends(get_current_user),
):
    """
    Delete a sales period.

    Requires authentication. User must own the associated contract.
    """
    # Get the sales period to find the contract_id
    period_result = supabase.table("sales_periods").select("*").eq("id", period_id).execute()

    if not period_result.data:
        raise HTTPException(status_code=404, detail="Sales period not found")

    contract_id = period_result.data[0]["contract_id"]

    # Verify user owns the contract
    await verify_contract_ownership(contract_id, user_id)

    # TODO: Recalculate YTD summary

    result = supabase.table("sales_periods").delete().eq("id", period_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Sales period not found")

    return {"message": "Sales period deleted"}
