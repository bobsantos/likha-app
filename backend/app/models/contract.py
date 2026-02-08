"""
Pydantic models for contracts.
"""

from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Optional, Union, List, Dict
from pydantic import BaseModel, Field


class ReportingFrequency(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUALLY = "annually"


class MinimumGuaranteePeriod(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUALLY = "annually"


class RoyaltyTier(BaseModel):
    """Single tier in a tiered royalty structure."""
    threshold: str  # e.g., "$0-$2,000,000"
    rate: str       # e.g., "6%"


# Royalty rate can be flat (str), tiered (list), or category-specific (dict)
RoyaltyRate = Union[str, List[RoyaltyTier], Dict[str, str]]


class ExtractedTerms(BaseModel):
    """Raw extraction output from Claude."""
    licensor_name: Optional[str] = None
    licensee_name: Optional[str] = None
    royalty_rate: Optional[RoyaltyRate] = None
    royalty_base: Optional[str] = None
    territories: Optional[List[str]] = None
    product_categories: Optional[List[str]] = None
    contract_start_date: Optional[str] = None
    contract_end_date: Optional[str] = None
    minimum_guarantee: Optional[str] = None
    advance_payment: Optional[str] = None
    payment_terms: Optional[str] = None
    reporting_frequency: Optional[str] = None
    exclusivity: Optional[str] = None
    confidence_score: Optional[float] = None
    extraction_notes: Optional[List[str]] = None


class ContractCreate(BaseModel):
    """Request to create a new contract."""
    licensee_name: str
    pdf_url: str  # From storage upload during extraction
    extracted_terms: ExtractedTerms
    # Normalized/validated fields (from extraction review)
    royalty_rate: RoyaltyRate
    royalty_base: str = "net sales"
    territories: List[str] = []
    product_categories: Optional[List[str]] = None
    contract_start_date: date
    contract_end_date: date
    minimum_guarantee: Decimal = Decimal("0")
    minimum_guarantee_period: MinimumGuaranteePeriod = MinimumGuaranteePeriod.ANNUALLY
    advance_payment: Optional[Decimal] = None
    reporting_frequency: ReportingFrequency = ReportingFrequency.QUARTERLY


class Contract(ContractCreate):
    """Full contract record from database."""
    id: str
    user_id: str
    pdf_url: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True
