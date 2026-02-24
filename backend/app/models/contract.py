"""
Pydantic models for contracts.
"""

from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Optional, Union, List, Dict, Any
from pydantic import BaseModel, Field, field_validator, computed_field
import calendar


class ReportingFrequency(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    SEMI_ANNUALLY = "semi_annually"
    ANNUALLY = "annually"


class MinimumGuaranteePeriod(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUALLY = "annually"


class ContractStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"


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
    """Request to create a new contract (legacy endpoint — kept for compatibility)."""
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


class ContractDraftCreate(BaseModel):
    """
    Internal model for inserting a draft row at extraction time.

    Fields populated immediately after PDF extraction, before user review.
    All user-review fields (licensee_name, royalty_rate, etc.) are omitted —
    they are populated by the PUT /{id}/confirm endpoint.
    """
    filename: str
    pdf_url: str
    storage_path: str
    extracted_terms: ExtractedTerms
    status: ContractStatus = ContractStatus.DRAFT


class ContractConfirm(BaseModel):
    """
    Request body for PUT /{id}/confirm.

    Receives user-reviewed fields and promotes the draft to active.
    """
    licensee_name: str
    licensee_email: Optional[str] = None
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

    @field_validator("royalty_rate", mode="before")
    @classmethod
    def coerce_numeric_royalty_rate(cls, v: Any) -> Any:
        """
        Coerce numeric royalty_rate values to properly formatted percentage strings.

        The frontend normalizer strips "8% of Net Sales" down to the bare number
        8.0 for form display, then converts it to the string "8" before sending it
        back on confirm.  The canonical DB representation is always a string with a
        "%" suffix (e.g. "8%"), so we normalise here to avoid storing bare values.

        - int/float    → "<value>%"  (e.g. 0.10 → "0.1%", 10.0 → "10.0%")
        - str bare num → "<value>%"  (e.g. "8" → "8%", "10.5" → "10.5%")
        - str with "%"              → unchanged  (e.g. "8%" or "8% of Net Sales")
        - list / dict               → unchanged (tiered / category rates)
        """
        if isinstance(v, (int, float)):
            return f"{v}%"
        if isinstance(v, str) and "%" not in v:
            stripped = v.strip()
            try:
                # Only coerce if the entire string is a valid number (bare numeric)
                float(stripped)
                return f"{stripped}%"
            except ValueError:
                pass
        return v


def _add_months(d: date, months: int) -> date:
    """
    Add a number of months to a date, clamping to the last day of the month
    when the original day doesn't exist in the target month (e.g. Jan 31 + 1 month
    → Feb 28/29).
    """
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


class Contract(BaseModel):
    """Full contract record from database. Accommodates both draft and active rows."""
    id: str
    user_id: str
    status: ContractStatus = ContractStatus.ACTIVE
    filename: Optional[str] = None
    pdf_url: str
    extracted_terms: Any  # dict stored as JSON in DB
    # User-review fields — Optional to accommodate drafts
    licensee_name: Optional[str] = None
    licensee_email: Optional[str] = None
    royalty_rate: Optional[RoyaltyRate] = None
    royalty_base: Optional[str] = None
    territories: Optional[List[str]] = None
    product_categories: Optional[List[str]] = None
    contract_start_date: Optional[date] = None
    contract_end_date: Optional[date] = None
    minimum_guarantee: Optional[Decimal] = None
    minimum_guarantee_period: Optional[MinimumGuaranteePeriod] = None
    advance_payment: Optional[Decimal] = None
    reporting_frequency: Optional[ReportingFrequency] = None
    storage_path: Optional[str] = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

    @computed_field  # type: ignore[misc]
    @property
    def is_expired(self) -> Optional[bool]:
        """
        True if the contract has passed its end date, False if still active,
        None if no end date is set (e.g. draft contracts).

        A contract is considered expired when contract_end_date < today.
        A contract ending today is NOT expired (it expires at end of that day).
        """
        if self.contract_end_date is None:
            return None
        return self.contract_end_date < date.today()

    @computed_field  # type: ignore[misc]
    @property
    def days_until_report_due(self) -> Optional[int]:
        """
        Days until the next royalty report is due, based on reporting_frequency
        and contract_start_date.

        Due dates are computed as recurring intervals from contract_start_date:
        - monthly      → every 1 month
        - quarterly    → every 3 months
        - semi_annually → every 6 months
        - annually     → every 12 months

        Returns None if reporting_frequency or contract_start_date is not set.
        Returns a negative int if the next report is already overdue.
        """
        if self.reporting_frequency is None or self.contract_start_date is None:
            return None

        frequency_months: Dict[str, int] = {
            ReportingFrequency.MONTHLY: 1,
            ReportingFrequency.QUARTERLY: 3,
            ReportingFrequency.SEMI_ANNUALLY: 6,
            ReportingFrequency.ANNUALLY: 12,
        }
        period_months = frequency_months.get(self.reporting_frequency)
        if period_months is None:
            return None

        today = date.today()
        start = self.contract_start_date

        # Walk forward from start_date in period_months increments until we
        # find the first due date that is >= today.
        # Cap iterations at 10 years worth of periods to avoid infinite loops.
        max_iterations = (12 // period_months) * 10 + 1
        due = _add_months(start, period_months)
        for _ in range(max_iterations):
            if due >= today:
                return (due - today).days
            due = _add_months(due, period_months)

        # Fallback: next period after max iterations
        return (due - today).days


class ContractWithFormValues(Contract):
    """
    Contract response model that includes an optional form_values field.

    Returned by GET /{id} for draft contracts so the frontend review form can
    be pre-populated without any client-side parsing of raw extracted_terms.
    For active contracts form_values is None.
    """
    form_values: Optional[FormValues] = None
