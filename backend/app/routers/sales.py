"""
Sales period management API endpoints.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
from decimal import Decimal

from app.models.sales import SalesPeriod, SalesPeriodCreate, RoyaltySummary
from app.services.royalty_calc import (
    calculate_royalty,
    calculate_royalty_with_minimum,
    calculate_ytd_summary,
)
from app.db import supabase_admin as supabase
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
    Minimum guarantee is applied if the calculated royalty falls below the
    per-period floor derived from the contract's minimum_guarantee and
    minimum_guarantee_period fields.
    """
    # Verify user owns the contract
    await verify_contract_ownership(period.contract_id, user_id)

    # Get contract to determine royalty structure
    contract_result = supabase.table("contracts").select("*").eq("id", period.contract_id).execute()

    if not contract_result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract = contract_result.data[0]

    # Parse minimum guarantee from contract (stored as string in DB)
    minimum_guarantee = Decimal(str(contract.get('minimum_guarantee') or 0))
    guarantee_period = contract.get('minimum_guarantee_period', 'annually') or 'annually'

    # Calculate royalty with minimum guarantee enforcement
    try:
        result = calculate_royalty_with_minimum(
            royalty_rate=contract['royalty_rate'],
            net_sales=period.net_sales,
            minimum_guarantee=minimum_guarantee,
            guarantee_period=guarantee_period,
            category_breakdown=period.category_breakdown,
        )
        royalty = result.royalty
        minimum_applied = result.minimum_applied
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Royalty calculation failed: {str(e)}")

    # Insert sales period
    result_db = supabase.table("sales_periods").insert({
        "contract_id": period.contract_id,
        "period_start": str(period.period_start),
        "period_end": str(period.period_end),
        "net_sales": str(period.net_sales),
        "category_breakdown": period.category_breakdown,
        "royalty_calculated": str(royalty),
        "minimum_applied": minimum_applied,
    }).execute()

    if not result_db.data:
        raise HTTPException(status_code=500, detail="Failed to create sales period")

    return SalesPeriod(**result_db.data[0])


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

    Aggregates all sales_periods for the contract, computes YTD totals,
    applies minimum guarantee comparison, and tracks advance payment credit.

    Query parameter:
    - contract_year (int, default 1): The 1-based contract year to summarise.
      Year 1 = first year of the contract. Advance payment credit only applies
      in Year 1.

    Requires authentication. User must own the contract.
    """
    # Verify user owns the contract
    await verify_contract_ownership(contract_id, user_id)

    # Fetch contract for minimum guarantee and advance payment details
    contract_result = supabase.table("contracts").select("*").eq("id", contract_id).execute()

    if not contract_result.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract = contract_result.data[0]

    # Parse financial fields from contract (stored as strings in DB)
    minimum_guarantee = Decimal(str(contract.get('minimum_guarantee') or 0))
    guarantee_period = contract.get('minimum_guarantee_period', 'annually') or 'annually'
    raw_advance = contract.get('advance_payment')
    advance_payment = Decimal(str(raw_advance)) if raw_advance is not None else None

    # Fetch all sales periods for this contract
    periods_result = supabase.table("sales_periods").select("*").eq("contract_id", contract_id).execute()
    sales_periods = periods_result.data or []

    # Aggregate into YTD summary
    summary = calculate_ytd_summary(
        contract_id=contract_id,
        contract_year=contract_year,
        sales_periods=sales_periods,
        minimum_guarantee=minimum_guarantee,
        guarantee_period=guarantee_period,
        advance_payment=advance_payment,
    )

    return summary


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

    result = supabase.table("sales_periods").delete().eq("id", period_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Sales period not found")

    return {"message": "Sales period deleted"}
