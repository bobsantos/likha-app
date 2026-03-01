"""
Sales period management API endpoints.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
from decimal import Decimal
from datetime import datetime, timezone

from app.models.sales import (
    SalesPeriod,
    SalesPeriodCreate,
    RoyaltySummary,
    DashboardSummary,
    ContractTotals,
    YearlyRoyalties,
)
from app.services.royalty_calc import (
    calculate_royalty,
    calculate_royalty_with_minimum,
    calculate_ytd_summary,
)
from app.db import supabase_admin as supabase
from app.auth import get_current_user, verify_contract_ownership

router = APIRouter()


@router.post(
    "/",
    response_model=SalesPeriod,
    responses={
        200: {
            "description": "Sales period recorded with calculated royalty",
            "content": {
                "application/json": {
                    "example": {
                        "id": "sp-abc123",
                        "contract_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                        "period_start": "2026-01-01",
                        "period_end": "2026-03-31",
                        "net_sales": "125000.00",
                        "royalty_calculated": "10000.00",
                        "minimum_applied": False,
                        "licensee_reported_royalty": "9500.00",
                        "discrepancy_amount": "500.00",
                        "has_discrepancy": True,
                        "category_breakdown": None,
                        "source_file_path": None,
                        "created_at": "2026-04-05T09:00:00Z",
                        "updated_at": "2026-04-05T09:00:00Z",
                    }
                }
            },
        },
        400: {"description": "Royalty calculation failed (invalid rate format)"},
        401: {"description": "Missing or invalid auth token"},
        403: {"description": "Authenticated user does not own this contract"},
        404: {"description": "Contract not found"},
    },
)
async def create_sales_period(
    period: SalesPeriodCreate,
    user_id: str = Depends(get_current_user),
):
    """
    Record a new sales period and calculate royalties.

    Accepts net_sales and an optional category_breakdown (for category-rate
    contracts). Calculates royalty using the contract's royalty_rate structure
    (flat, tiered, or category-specific). Applies the minimum guarantee if the
    calculated royalty falls below the per-period floor.

    Optionally accepts licensee_reported_royalty to track what the licensee
    claimed to owe. The response includes discrepancy_amount and has_discrepancy
    computed fields for instant discrepancy detection.

    Requires authentication. User must own the contract.
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


@router.get("/dashboard-summary", response_model=DashboardSummary)
async def get_dashboard_summary(
    user_id: str = Depends(get_current_user),
) -> DashboardSummary:
    """
    Return the authenticated user's YTD royalties for the current calendar year
    across all their active contracts.

    Uses two queries:
      1. Fetch the user's active contract IDs.
      2. Fetch royalty_calculated for sales periods starting in the current year,
         filtered to those contract IDs.

    Requires authentication.
    """
    current_year = datetime.now(timezone.utc).year
    ytd_start = f"{current_year}-01-01"

    # 1. Fetch the user's active contract IDs
    contracts_result = (
        supabase.table("contracts")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "active")
        .execute()
    )
    contract_ids = [row["id"] for row in (contracts_result.data or [])]

    if not contract_ids:
        return DashboardSummary(ytd_royalties=Decimal("0"), current_year=current_year)

    # 2. Fetch royalty_calculated for periods starting in the current year
    #    across all active contracts (single query using `in` filter)
    periods_result = (
        supabase.table("sales_periods")
        .select("royalty_calculated")
        .in_("contract_id", contract_ids)
        .gte("period_start", ytd_start)
        .execute()
    )
    rows = periods_result.data or []

    ytd_royalties = sum(
        (Decimal(str(row["royalty_calculated"])) for row in rows),
        Decimal("0"),
    )

    return DashboardSummary(ytd_royalties=ytd_royalties, current_year=current_year)


@router.get("/contract/{contract_id}/totals", response_model=ContractTotals)
async def get_contract_totals(
    contract_id: str,
    user_id: str = Depends(get_current_user),
) -> ContractTotals:
    """
    Return all-time total royalties for a single contract with a per-calendar-year
    breakdown. Years are sorted descending (most recent first).

    Fetches only royalty_calculated and period_start to keep the payload minimal.

    Requires authentication. User must own the contract.
    """
    await verify_contract_ownership(contract_id, user_id)

    result = (
        supabase.table("sales_periods")
        .select("royalty_calculated, period_start")
        .eq("contract_id", contract_id)
        .execute()
    )
    rows = result.data or []

    total = Decimal("0")
    by_year: dict[int, Decimal] = {}

    for row in rows:
        amount = Decimal(str(row["royalty_calculated"]))
        total += amount
        # period_start is "YYYY-MM-DD"; extract year without datetime parsing overhead
        year = int(str(row["period_start"])[:4])
        by_year[year] = by_year.get(year, Decimal("0")) + amount

    sorted_years = [
        YearlyRoyalties(year=y, royalties=v)
        for y, v in sorted(by_year.items(), reverse=True)
    ]

    return ContractTotals(
        contract_id=contract_id,
        total_royalties=total,
        by_year=sorted_years,
    )


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


@router.get(
    "/summary/{contract_id}",
    response_model=RoyaltySummary,
    responses={
        200: {
            "description": "YTD royalty summary for the contract",
            "content": {
                "application/json": {
                    "example": {
                        "contract_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                        "contract_year": 1,
                        "total_sales_ytd": "375000.00",
                        "total_royalties_ytd": "30000.00",
                        "minimum_guarantee_ytd": "40000.00",
                        "shortfall": "10000.00",
                        "advance_remaining": "0.00",
                        "updated_at": "2026-09-30T23:59:59Z",
                    }
                }
            },
        },
        401: {"description": "Missing or invalid auth token"},
        403: {"description": "Authenticated user does not own this contract"},
        404: {"description": "Contract not found"},
    },
)
async def get_royalty_summary(
    contract_id: str,
    contract_year: int = 1,
    user_id: str = Depends(get_current_user),
):
    """
    Get year-to-date royalty summary for a contract.

    Aggregates all sales_periods for the contract, computes YTD totals,
    applies minimum guarantee comparison, and tracks advance payment credit.

    Fields:
    - **total_sales_ytd**: Sum of net_sales across all periods in this contract year
    - **total_royalties_ytd**: Sum of royalty_calculated across all periods
    - **minimum_guarantee_ytd**: The full annual minimum guarantee amount
    - **shortfall**: Positive if total_royalties_ytd < minimum_guarantee_ytd (licensor is owed more)
    - **advance_remaining**: Remaining advance credit (only applies in contract Year 1)

    Query parameter:
    - **contract_year** (int, default 1): The 1-based contract year to summarise.
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
