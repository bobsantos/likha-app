"""
Pydantic models for sales periods.
"""

from datetime import date
from decimal import Decimal
from typing import Optional, Dict
from pydantic import BaseModel, Field, computed_field


class SalesPeriodCreate(BaseModel):
    """Request to create a new sales period."""
    contract_id: str
    period_start: date
    period_end: date
    net_sales: Decimal = Field(ge=0)
    category_breakdown: Optional[Dict[str, Decimal]] = None
    licensee_reported_royalty: Optional[Decimal] = None  # Phase 1
    source_file_path: Optional[str] = None


class SalesPeriod(SalesPeriodCreate):
    """Full sales period record from database."""
    id: str
    royalty_calculated: Decimal
    minimum_applied: bool
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

    @computed_field  # type: ignore[misc]
    @property
    def discrepancy_amount(self) -> Optional[Decimal]:
        """
        Difference between licensee-reported and system-calculated royalty.
        Positive = licensee under-reported; Negative = licensee over-reported.
        None if licensee_reported_royalty is not set.
        """
        if self.licensee_reported_royalty is None:
            return None
        return self.royalty_calculated - self.licensee_reported_royalty

    @computed_field  # type: ignore[misc]
    @property
    def has_discrepancy(self) -> bool:
        """True if there is a non-zero discrepancy between reported and calculated."""
        if self.licensee_reported_royalty is None:
            return False
        return self.licensee_reported_royalty != self.royalty_calculated


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
