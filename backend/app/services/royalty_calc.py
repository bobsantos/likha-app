"""
Royalty calculation engine.
Handles flat, tiered, and category-specific royalty structures.
Also provides minimum guarantee enforcement and advance payment tracking.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, List, Optional, Union

from app.models.sales import RoyaltySummary


def parse_percentage(rate_str: str) -> Decimal:
    """Parse a percentage string like '8%' or '8% of Net Sales' to a decimal."""
    match = re.search(r'(\d+(?:\.\d+)?)\s*%', rate_str)
    if match:
        return Decimal(match.group(1)) / Decimal(100)
    raise ValueError(f"Could not parse percentage from: {rate_str}")


def parse_threshold(threshold: str) -> Decimal:
    """Parse the lower bound of a threshold like '$0-$2,000,000' or '$5,000,000+'."""
    # Remove '$', ',', and spaces
    clean = threshold.replace('$', '').replace(',', '').replace(' ', '')
    # Extract first number
    match = re.search(r'(\d+(?:\.\d+)?)', clean)
    if match:
        return Decimal(match.group(1))
    return Decimal(0)


def parse_threshold_max(threshold: str) -> Decimal:
    """Parse the upper bound of a threshold, or return infinity for open-ended."""
    clean = threshold.replace('$', '').replace(',', '').replace(' ', '')
    # Look for pattern like "0-2000000"
    if '-' in clean:
        parts = clean.split('-')
        if len(parts) == 2:
            match = re.search(r'(\d+(?:\.\d+)?)', parts[1])
            if match:
                return Decimal(match.group(1))
    # Open-ended (e.g., "$5,000,000+")
    return Decimal('Infinity')


def calculate_flat_royalty(rate: str, net_sales: Decimal) -> Decimal:
    """Calculate royalty for a flat rate structure."""
    rate_decimal = parse_percentage(rate)
    return net_sales * rate_decimal


def calculate_tiered_royalty(tiers: List[Dict], net_sales: Decimal) -> Decimal:
    """
    Calculate royalty for a tiered rate structure.
    Uses marginal rates (like tax brackets).
    """
    # Sort tiers by threshold
    sorted_tiers = sorted(tiers, key=lambda t: parse_threshold(t['threshold']))

    total_royalty = Decimal(0)
    remaining_sales = net_sales

    for tier in sorted_tiers:
        tier_min = parse_threshold(tier['threshold'])
        tier_max = parse_threshold_max(tier['threshold'])
        tier_rate = parse_percentage(tier['rate'])

        # Calculate sales in this tier
        if tier_max == Decimal('Infinity'):
            tier_sales = remaining_sales
        else:
            tier_range = tier_max - tier_min
            tier_sales = min(remaining_sales, tier_range)

        # Apply rate
        total_royalty += tier_sales * tier_rate
        remaining_sales -= tier_sales

        if remaining_sales <= 0:
            break

    return total_royalty


def calculate_category_royalty(
    rates: Dict[str, str],
    category_breakdown: Dict[str, Decimal]
) -> Decimal:
    """
    Calculate royalty for category-specific rates.

    Args:
        rates: Dict mapping category name to rate (e.g., {"apparel": "10%", "accessories": "8%"})
        category_breakdown: Dict mapping category name to sales amount

    Returns:
        Total royalty across all categories
    """
    total_royalty = Decimal(0)

    for category, sales in category_breakdown.items():
        # Normalize category name for matching (lowercase, no extra context)
        normalized = category.lower().strip()

        # Find matching rate
        rate_str = None
        for rate_category, rate in rates.items():
            if normalized in rate_category.lower() or rate_category.lower() in normalized:
                rate_str = rate
                break

        if rate_str is None:
            raise ValueError(f"No rate found for category: {category}")

        rate_decimal = parse_percentage(rate_str)
        total_royalty += sales * rate_decimal

    return total_royalty


def calculate_royalty(
    royalty_rate: Union[str, List[Dict], Dict[str, str]],
    net_sales: Decimal,
    category_breakdown: Dict[str, Decimal] = None
) -> Decimal:
    """
    Calculate royalty based on rate structure.

    Args:
        royalty_rate: Flat (str), tiered (list), or category-specific (dict)
        net_sales: Total net sales for the period
        category_breakdown: Required for category-specific rates

    Returns:
        Calculated royalty amount
    """
    if isinstance(royalty_rate, str):
        # Flat rate
        return calculate_flat_royalty(royalty_rate, net_sales)

    elif isinstance(royalty_rate, list):
        # Tiered rate
        return calculate_tiered_royalty(royalty_rate, net_sales)

    elif isinstance(royalty_rate, dict):
        # Category-specific
        if category_breakdown is None:
            raise ValueError("category_breakdown required for category-specific rates")
        return calculate_category_royalty(royalty_rate, category_breakdown)

    else:
        raise ValueError(f"Unsupported royalty_rate type: {type(royalty_rate)}")


# ---------------------------------------------------------------------------
# Minimum guarantee helpers
# ---------------------------------------------------------------------------

# Number of periods per year for each guarantee period type
_PERIODS_PER_YEAR: Dict[str, int] = {
    "monthly": 12,
    "quarterly": 4,
    "semi_annually": 2,
    "annually": 1,
}


@dataclass
class RoyaltyWithMinimum:
    """Result of a royalty calculation that may have had a minimum guarantee applied."""
    royalty: Decimal
    minimum_applied: bool


def apply_minimum_guarantee(
    calculated_royalty: Decimal,
    minimum_guarantee: Decimal,
    guarantee_period: str,
    periods_in_year: Optional[int] = None,
) -> RoyaltyWithMinimum:
    """
    Enforce a minimum guarantee floor on a calculated royalty.

    For quarterly/monthly/semi-annual guarantees the annual figure is divided
    by the number of periods so each period has its own floor.  For annual
    guarantees the full amount is the floor for the period (used when doing
    year-end true-up).

    Args:
        calculated_royalty: The royalty computed from sales * rate.
        minimum_guarantee: The annual minimum guarantee amount (from contract).
        guarantee_period: One of "monthly", "quarterly", "semi_annually", "annually".
        periods_in_year: Override the number of periods (defaults to the value
            looked up from guarantee_period).

    Returns:
        RoyaltyWithMinimum with the final royalty and whether the floor was applied.
    """
    if minimum_guarantee <= Decimal("0"):
        return RoyaltyWithMinimum(royalty=calculated_royalty, minimum_applied=False)

    if periods_in_year is None:
        periods_in_year = _PERIODS_PER_YEAR.get(guarantee_period, 1)

    period_floor = minimum_guarantee / Decimal(periods_in_year)

    if calculated_royalty < period_floor:
        return RoyaltyWithMinimum(royalty=period_floor, minimum_applied=True)

    return RoyaltyWithMinimum(royalty=calculated_royalty, minimum_applied=False)


def calculate_royalty_with_minimum(
    royalty_rate: Union[str, List[Dict], Dict[str, str]],
    net_sales: Decimal,
    minimum_guarantee: Decimal = Decimal("0"),
    guarantee_period: str = "annually",
    category_breakdown: Optional[Dict[str, Decimal]] = None,
) -> RoyaltyWithMinimum:
    """
    Calculate royalty from sales and apply minimum guarantee if needed.

    Combines calculate_royalty() and apply_minimum_guarantee() in a single call.

    Args:
        royalty_rate: Flat, tiered, or category-specific rate.
        net_sales: Net sales for the period.
        minimum_guarantee: Annual minimum guarantee (0 = no minimum).
        guarantee_period: Frequency of guarantee measurement.
        category_breakdown: Required for category-specific rates.

    Returns:
        RoyaltyWithMinimum with final royalty and minimum_applied flag.
    """
    calculated = calculate_royalty(
        royalty_rate=royalty_rate,
        net_sales=net_sales,
        category_breakdown=category_breakdown,
    )
    return apply_minimum_guarantee(
        calculated_royalty=calculated,
        minimum_guarantee=minimum_guarantee,
        guarantee_period=guarantee_period,
    )


# ---------------------------------------------------------------------------
# Advance payment tracking
# ---------------------------------------------------------------------------

def calculate_advance_remaining(
    advance_payment: Optional[Decimal],
    total_royalties_ytd: Decimal,
    contract_year: int,
) -> Decimal:
    """
    Calculate the remaining advance payment credit.

    Advances are recoupable against Year 1 royalties only.  Once royalties
    earned in Year 1 meet or exceed the advance, the credit is exhausted and
    remaining = 0 (never negative).  For Year 2+, remaining is always 0.

    Args:
        advance_payment: Total advance paid at contract start (None or 0 = no advance).
        total_royalties_ytd: Sum of all royalties earned so far this contract year.
        contract_year: 1-based contract year (advance only applies in Year 1).

    Returns:
        Remaining advance credit as a non-negative Decimal.
    """
    if advance_payment is None or advance_payment <= Decimal("0"):
        return Decimal("0")

    # Advance only applies in Year 1
    if contract_year != 1:
        return Decimal("0")

    remaining = advance_payment - total_royalties_ytd
    return max(remaining, Decimal("0"))


# ---------------------------------------------------------------------------
# YTD summary aggregation
# ---------------------------------------------------------------------------

def calculate_ytd_summary(
    contract_id: str,
    contract_year: int,
    sales_periods: List[Dict],
    minimum_guarantee: Decimal,
    guarantee_period: str,
    advance_payment: Optional[Decimal],
) -> RoyaltySummary:
    """
    Aggregate sales_periods into a year-to-date RoyaltySummary.

    Args:
        contract_id: The contract being summarised.
        contract_year: 1-based contract year (used for advance tracking).
        sales_periods: List of raw DB dicts from the sales_periods table.
        minimum_guarantee: Annual minimum guarantee from the contract.
        guarantee_period: How often the guarantee is measured (e.g. "annually").
        advance_payment: Advance amount paid at contract start, or None.

    Returns:
        A populated RoyaltySummary model instance.
    """
    total_sales = Decimal("0")
    total_royalties = Decimal("0")

    for period in sales_periods:
        total_sales += Decimal(str(period["net_sales"]))
        total_royalties += Decimal(str(period["royalty_calculated"]))

    # Annual minimum guarantee for YTD comparison purposes
    # (we always compare the full annual MG against total YTD royalties)
    minimum_guarantee_ytd = minimum_guarantee if minimum_guarantee else Decimal("0")
    shortfall = max(minimum_guarantee_ytd - total_royalties, Decimal("0"))

    advance_remaining = calculate_advance_remaining(
        advance_payment=advance_payment,
        total_royalties_ytd=total_royalties,
        contract_year=contract_year,
    )

    now = datetime.now(timezone.utc).isoformat()

    return RoyaltySummary(
        contract_id=contract_id,
        contract_year=contract_year,
        total_sales_ytd=total_sales,
        total_royalties_ytd=total_royalties,
        minimum_guarantee_ytd=minimum_guarantee_ytd,
        shortfall=shortfall,
        advance_remaining=advance_remaining,
        updated_at=now,
    )
