"""
Pydantic models for contracts.
"""

from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Optional, Union, List, Dict, Any
from pydantic import BaseModel, Field


class ReportingFrequency(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    SEMI_ANNUALLY = "semi_annually"
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


class FormValues(BaseModel):
    """
    Normalized, form-ready values derived from ExtractedTerms.

    These values are pre-processed so the frontend can bind them directly
    to form inputs without any client-side parsing logic.
    """
    licensee_name: str = ""
    licensor_name: str = ""
    # For flat rates: the numeric value only, e.g. 8.0 (not "8% of net sales")
    # For tiered/category rates: the structured data passed through as-is
    royalty_rate: Any = ""
    royalty_base: str = "net_sales"  # "net_sales" or "gross_sales"
    minimum_guarantee: Optional[float] = None
    advance_payment: Optional[float] = None
    contract_start_date: str = ""  # ISO format YYYY-MM-DD or empty
    contract_end_date: str = ""    # ISO format YYYY-MM-DD or empty
    reporting_frequency: str = "quarterly"  # one of monthly/quarterly/semi_annually/annually
    territories: List[str] = []


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
