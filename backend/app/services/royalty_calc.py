"""
Royalty calculation engine.
Handles flat, tiered, and category-specific royalty structures.
"""

import re
from decimal import Decimal
from typing import Union, List, Dict


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
