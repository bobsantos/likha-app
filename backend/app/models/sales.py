"""
Pydantic models for sales periods.
"""

from datetime import date
from decimal import Decimal
from typing import Optional, Dict
from pydantic import BaseModel, Field


class SalesPeriodCreate(BaseModel):
    """Request to create a new sales period."""
    contract_id: str
    period_start: date
    period_end: date
    net_sales: Decimal = Field(ge=0)
    category_breakdown: Optional[Dict[str, Decimal]] = None


class SalesPeriod(SalesPeriodCreate):
    """Full sales period record from database."""
    id: str
    royalty_calculated: Decimal
    minimum_applied: bool
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class RoyaltySummary(BaseModel):
    """Year-to-date royalty summary for a contract."""
    contract_id: str
    contract_year: int
    total_sales_ytd: Decimal
    total_royalties_ytd: Decimal
    minimum_guarantee_ytd: Decimal
    shortfall: Decimal  # positive if behind minimum
    advance_remaining: Decimal
    updated_at: str

    class Config:
        from_attributes = True
