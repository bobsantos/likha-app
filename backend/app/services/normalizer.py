"""
Normalization service for contract extraction results.

Converts raw ExtractedTerms (Claude AI output) into FormValues — a cleaned,
form-ready representation that the frontend can bind directly to inputs
without any client-side parsing logic.
"""

import re
import logging
from typing import Optional, Union, List, Dict, Any

from app.models.contract import ExtractedTerms, FormValues, RoyaltyTier

logger = logging.getLogger(__name__)

# Canonical reporting frequency values accepted by the form
_REPORTING_FREQUENCY_MAP = {
    "monthly": "monthly",
    "month": "monthly",
    "quarterly": "quarterly",
    "quarter": "quarterly",
    "semi-annually": "semi_annually",
    "semi_annually": "semi_annually",
    "semiannually": "semi_annually",
    "semi annual": "semi_annually",
    "semi-annual": "semi_annually",
    "biannually": "semi_annually",
    "bi-annually": "semi_annually",
    "twice a year": "semi_annually",
    "every six months": "semi_annually",
    "annually": "annually",
    "annual": "annually",
    "yearly": "annually",
    "year": "annually",
}

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_monetary_value(value: Optional[str]) -> Optional[float]:
    """
    Parse a numeric amount from a monetary string.

    Examples:
        "$50,000 USD"  -> 50000.0
        "$10,000.00"   -> 10000.0
        "50000"        -> 50000.0
        None           -> None
        ""             -> None
        "not a number" -> None
    """
    if not value:
        return None

    if not isinstance(value, str):
        return None

    # Remove commas, then find the first run of digits (with optional decimal)
    cleaned = value.replace(",", "")
    match = re.search(r"[\d]+(?:\.\d+)?", cleaned)
    if not match:
        logger.debug("parse_monetary_value: no numeric content in %r", value)
        return None

    try:
        return float(match.group(0))
    except ValueError:
        logger.debug("parse_monetary_value: could not convert %r to float", match.group(0))
        return None


def parse_royalty_rate(
    rate: Optional[Union[str, List, Dict]]
) -> Any:
    """
    Normalise a royalty rate for form display.

    - Flat string  "8% of net sales"  ->  8.0  (numeric percentage value)
    - Flat string  "8%"               ->  8.0
    - Flat string  "8.5"              ->  8.5   (already a bare number, kept as-is)
    - List (tiered)                   ->  list passed through unchanged
    - Dict (category-specific)        ->  dict passed through unchanged
    - None / empty                    ->  ""
    """
    if rate is None:
        return ""

    # Tiered and category rates pass through unchanged
    if isinstance(rate, list):
        # Convert RoyaltyTier Pydantic models to plain dicts for JSON serialisation
        return [
            tier.model_dump() if isinstance(tier, RoyaltyTier) else tier
            for tier in rate
        ]

    if isinstance(rate, dict):
        return rate

    if not isinstance(rate, str):
        return ""

    rate_str = rate.strip()
    if not rate_str:
        return ""

    # Try to extract a percentage number from strings like "8% of net sales" or "8%"
    match = re.search(r"([\d]+(?:\.\d+)?)\s*%", rate_str)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass

    # Try bare numbers like "8.5" (no percent sign)
    match = re.match(r"^([\d]+(?:\.\d+)?)$", rate_str)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass

    # Fallback: return the raw string so the user can still see something
    return rate_str


def parse_royalty_base(
    base: Optional[str],
    rate: Optional[Union[str, List, Dict]] = None,
) -> str:
    """
    Map a royalty base description to one of 'net_sales' or 'gross_sales'.

    Also inspects the royalty_rate string for mentions of "net sales" or
    "gross sales" when royalty_base itself is missing.

    Examples:
        "net sales"          -> "net_sales"
        "gross sales"        -> "gross_sales"
        None                 -> "net_sales"  (safe default)
        "8% of gross sales"  -> inferred from rate string when base is None
    """
    # Try the explicit royalty_base field first (guard against non-string values)
    if isinstance(base, str) and base:
        lower = base.lower()
        # Check net first: "gross invoiced sales less deductions" containing "net" is net_sales
        if "net" in lower:
            return "net_sales"
        if "gross" in lower:
            return "gross_sales"
        return "net_sales"

    # Fall back to inspecting the royalty_rate string (only when it really is a str)
    if isinstance(rate, str) and rate:
        lower = rate.lower()
        if "net" in lower:
            return "net_sales"
        if "gross" in lower:
            return "gross_sales"

    return "net_sales"


def normalize_date(value: Optional[str]) -> str:
    """
    Ensure a date string is in ISO 8601 format YYYY-MM-DD.

    Claude usually returns ISO dates, but sometimes provides month names or
    other formats.  This function normalises the common cases; anything it
    cannot parse is returned as an empty string so the user can fill it in.

    Examples:
        "2024-01-01"    -> "2024-01-01"
        None            -> ""
        ""              -> ""
        "January 2024"  -> ""  (cannot reliably convert without a day)
    """
    if not value:
        return ""

    if not isinstance(value, str):
        return ""

    stripped = value.strip()

    # Already in ISO format
    if _ISO_DATE_RE.match(stripped):
        return stripped

    # Attempt to parse common written formats like "January 1, 2024"
    import datetime

    _FORMATS = [
        "%B %d, %Y",   # "January 1, 2024"
        "%b %d, %Y",   # "Jan 1, 2024"
        "%d %B %Y",    # "1 January 2024"
        "%d %b %Y",    # "1 Jan 2024"
        "%m/%d/%Y",    # "01/01/2024"
        "%d/%m/%Y",    # "01/01/2024" (ambiguous, US-first is a reasonable default)
        "%Y/%m/%d",    # "2024/01/01"
    ]

    for fmt in _FORMATS:
        try:
            parsed = datetime.datetime.strptime(stripped, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue

    logger.debug("normalize_date: could not parse date string %r", value)
    return ""


def normalize_reporting_frequency(value: Optional[str]) -> str:
    """
    Map an arbitrary reporting frequency string to a canonical enum value.

    Canonical values: "monthly", "quarterly", "semi_annually", "annually"
    Default (when unrecognised): "quarterly"

    Examples:
        "Quarterly"          -> "quarterly"
        "semi-annually"      -> "semi_annually"
        "every six months"   -> "semi_annually"
        "yearly"             -> "annually"
        None                 -> "quarterly"
    """
    if not value:
        return "quarterly"

    if not isinstance(value, str):
        return "quarterly"

    lower = value.strip().lower()
    return _REPORTING_FREQUENCY_MAP.get(lower, "quarterly")


def normalize_extracted_terms(terms: ExtractedTerms) -> FormValues:
    """
    Convert raw ExtractedTerms into FormValues.

    This is the main entry point.  It applies all parsing/normalisation helpers
    and returns a FormValues instance ready for the frontend review form.

    Args:
        terms: Raw extraction output from Claude AI.

    Returns:
        FormValues with cleaned, form-ready values.
    """
    royalty_rate_normalized = parse_royalty_rate(terms.royalty_rate)
    royalty_base_normalized = parse_royalty_base(
        terms.royalty_base,
        rate=terms.royalty_rate,
    )

    # territories must be a list of strings; fall back to [] for any other type
    territories = terms.territories
    if not isinstance(territories, list):
        territories = []

    # licensee/licensor must be strings
    licensee_name = terms.licensee_name if isinstance(terms.licensee_name, str) else ""
    licensor_name = terms.licensor_name if isinstance(terms.licensor_name, str) else ""

    return FormValues(
        licensee_name=licensee_name,
        licensor_name=licensor_name,
        royalty_rate=royalty_rate_normalized,
        royalty_base=royalty_base_normalized,
        minimum_guarantee=parse_monetary_value(terms.minimum_guarantee),
        advance_payment=parse_monetary_value(terms.advance_payment),
        contract_start_date=normalize_date(terms.contract_start_date),
        contract_end_date=normalize_date(terms.contract_end_date),
        reporting_frequency=normalize_reporting_frequency(terms.reporting_frequency),
        territories=territories,
    )
