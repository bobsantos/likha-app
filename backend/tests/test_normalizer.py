"""
Unit tests for the contract extraction normalizer.

Tests convert raw ExtractedTerms (Claude AI output) into FormValues
that the frontend can bind directly to form inputs.
"""

import pytest
from app.models.contract import ExtractedTerms, FormValues
from app.services.normalizer import (
    parse_monetary_value,
    parse_royalty_rate,
    parse_royalty_base,
    normalize_date,
    normalize_reporting_frequency,
    normalize_extracted_terms,
)


# ---------------------------------------------------------------------------
# parse_monetary_value
# ---------------------------------------------------------------------------

class TestParseMonetaryValue:
    """Tests for monetary string -> float conversion."""

    def test_dollar_amount_with_currency_label(self):
        assert parse_monetary_value("$50,000 USD") == 50000.0

    def test_dollar_amount_with_cents(self):
        assert parse_monetary_value("$10,000.00") == 10000.0

    def test_bare_integer_string(self):
        assert parse_monetary_value("50000") == 50000.0

    def test_bare_decimal_string(self):
        assert parse_monetary_value("12345.67") == 12345.67

    def test_large_amount_with_commas(self):
        assert parse_monetary_value("$1,000,000 USD") == 1000000.0

    def test_none_returns_none(self):
        assert parse_monetary_value(None) is None

    def test_empty_string_returns_none(self):
        assert parse_monetary_value("") is None

    def test_non_numeric_string_returns_none(self):
        assert parse_monetary_value("not a number") is None

    def test_currency_only_returns_none(self):
        # "$" alone has no digits
        assert parse_monetary_value("$") is None

    def test_amount_without_dollar_sign(self):
        assert parse_monetary_value("75,000") == 75000.0

    def test_small_decimal(self):
        assert parse_monetary_value("$0.99") == 0.99

    def test_no_whitespace(self):
        assert parse_monetary_value("25000USD") == 25000.0


# ---------------------------------------------------------------------------
# parse_royalty_rate
# ---------------------------------------------------------------------------

class TestParseRoyaltyRate:
    """Tests for royalty rate normalisation."""

    # --- Flat string rates ---

    def test_flat_rate_with_percentage_and_text(self):
        """'8% of net sales' -> 8.0"""
        result = parse_royalty_rate("8% of net sales")
        assert result == 8.0

    def test_flat_rate_percentage_only(self):
        """'8%' -> 8.0"""
        assert parse_royalty_rate("8%") == 8.0

    def test_flat_rate_decimal_percentage(self):
        """'7.5%' -> 7.5"""
        assert parse_royalty_rate("7.5%") == 7.5

    def test_flat_rate_percentage_with_spaces(self):
        """'10 % of gross sales' -> 10.0"""
        assert parse_royalty_rate("10 % of gross sales") == 10.0

    def test_flat_rate_bare_number_string(self):
        """'8' (no % sign) -> 8.0"""
        assert parse_royalty_rate("8") == 8.0

    def test_flat_rate_bare_decimal_number(self):
        """'8.5' -> 8.5"""
        assert parse_royalty_rate("8.5") == 8.5

    # --- None / empty ---

    def test_none_returns_empty_string(self):
        assert parse_royalty_rate(None) == ""

    def test_empty_string_returns_empty_string(self):
        assert parse_royalty_rate("") == ""

    def test_whitespace_only_returns_empty_string(self):
        assert parse_royalty_rate("   ") == ""

    # --- Tiered rates (pass-through) ---

    def test_tiered_rate_passthrough(self):
        """A list of tier dicts passes through unchanged."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        result = parse_royalty_rate(tiers)
        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0]["rate"] == "6%"
        assert result[0]["threshold"] == "$0-$2,000,000"

    def test_tiered_rate_empty_list(self):
        """An empty list passes through as an empty list."""
        result = parse_royalty_rate([])
        assert result == []

    # --- Category rates (pass-through) ---

    def test_category_rate_passthrough(self):
        """A dict of category->rate passes through unchanged."""
        rates = {
            "home textiles": "10%",
            "dinnerware": "7%",
            "fragrance": "12%",
        }
        result = parse_royalty_rate(rates)
        assert isinstance(result, dict)
        assert result["home textiles"] == "10%"
        assert result["fragrance"] == "12%"

    def test_category_rate_empty_dict(self):
        assert parse_royalty_rate({}) == {}

    # --- Pydantic RoyaltyTier models in a list ---

    def test_tiered_rate_with_pydantic_models(self):
        """RoyaltyTier Pydantic objects are serialised to dicts."""
        from app.models.contract import RoyaltyTier as RT
        tiers = [
            RT(threshold="$0-$1,000,000", rate="5%"),
            RT(threshold="$1,000,000+", rate="8%"),
        ]
        result = parse_royalty_rate(tiers)
        assert isinstance(result, list)
        assert result[0] == {"threshold": "$0-$1,000,000", "rate": "5%"}
        assert result[1] == {"threshold": "$1,000,000+", "rate": "8%"}


# ---------------------------------------------------------------------------
# parse_royalty_base
# ---------------------------------------------------------------------------

class TestParseRoyaltyBase:
    """Tests for royalty base mapping."""

    def test_net_sales_string(self):
        assert parse_royalty_base("net sales") == "net_sales"

    def test_net_sales_capitalised(self):
        assert parse_royalty_base("Net Sales") == "net_sales"

    def test_gross_sales_string(self):
        assert parse_royalty_base("gross sales") == "gross_sales"

    def test_gross_sales_capitalised(self):
        assert parse_royalty_base("Gross Sales") == "gross_sales"

    def test_gross_in_longer_phrase(self):
        assert parse_royalty_base("based on gross wholesale sales") == "gross_sales"

    def test_none_defaults_to_net_sales(self):
        assert parse_royalty_base(None) == "net_sales"

    def test_empty_string_defaults_to_net_sales(self):
        assert parse_royalty_base("") == "net_sales"

    def test_unknown_string_defaults_to_net_sales(self):
        assert parse_royalty_base("fob price") == "net_sales"

    def test_infers_from_rate_string_gross(self):
        """When base is None but rate string says 'gross', infer gross_sales."""
        result = parse_royalty_base(None, rate="8% of gross sales")
        assert result == "gross_sales"

    def test_infers_from_rate_string_net(self):
        """When base is None and rate string says 'net', infer net_sales."""
        result = parse_royalty_base(None, rate="8% of net sales")
        assert result == "net_sales"

    def test_explicit_base_overrides_rate_string(self):
        """An explicit base value takes precedence over the rate string."""
        result = parse_royalty_base("net sales", rate="8% of gross sales")
        assert result == "net_sales"

    def test_no_base_no_rate_defaults_to_net_sales(self):
        assert parse_royalty_base(None, rate=None) == "net_sales"


# ---------------------------------------------------------------------------
# normalize_date
# ---------------------------------------------------------------------------

class TestNormalizeDate:
    """Tests for date string normalisation."""

    def test_iso_date_passthrough(self):
        assert normalize_date("2024-01-01") == "2024-01-01"

    def test_iso_date_end_of_year(self):
        assert normalize_date("2026-12-31") == "2026-12-31"

    def test_none_returns_empty_string(self):
        assert normalize_date(None) == ""

    def test_empty_string_returns_empty_string(self):
        assert normalize_date("") == ""

    def test_us_long_format(self):
        """'January 1, 2024' -> '2024-01-01'"""
        assert normalize_date("January 1, 2024") == "2024-01-01"

    def test_us_abbreviated_month(self):
        """'Jan 1, 2024' -> '2024-01-01'"""
        assert normalize_date("Jan 1, 2024") == "2024-01-01"

    def test_slash_format(self):
        """'01/01/2024' -> '2024-01-01'"""
        assert normalize_date("01/01/2024") == "2024-01-01"

    def test_ambiguous_format_returns_empty(self):
        """Vague strings like 'January 2024' (no day) cannot be parsed."""
        assert normalize_date("January 2024") == ""

    def test_unrecognised_format_returns_empty(self):
        assert normalize_date("some random text") == ""

    def test_whitespace_stripped(self):
        assert normalize_date("  2024-06-15  ") == "2024-06-15"


# ---------------------------------------------------------------------------
# normalize_reporting_frequency
# ---------------------------------------------------------------------------

class TestNormalizeReportingFrequency:
    """Tests for reporting frequency normalisation."""

    def test_quarterly_exact(self):
        assert normalize_reporting_frequency("quarterly") == "quarterly"

    def test_quarterly_capitalised(self):
        assert normalize_reporting_frequency("Quarterly") == "quarterly"

    def test_monthly_exact(self):
        assert normalize_reporting_frequency("monthly") == "monthly"

    def test_monthly_capitalised(self):
        assert normalize_reporting_frequency("Monthly") == "monthly"

    def test_annually_exact(self):
        assert normalize_reporting_frequency("annually") == "annually"

    def test_annually_as_yearly(self):
        assert normalize_reporting_frequency("yearly") == "annually"

    def test_annually_as_annual(self):
        assert normalize_reporting_frequency("annual") == "annually"

    def test_semi_annually_hyphenated(self):
        assert normalize_reporting_frequency("semi-annually") == "semi_annually"

    def test_semi_annually_underscore(self):
        assert normalize_reporting_frequency("semi_annually") == "semi_annually"

    def test_semi_annually_no_separator(self):
        assert normalize_reporting_frequency("semiannually") == "semi_annually"

    def test_semi_annually_biannually(self):
        assert normalize_reporting_frequency("biannually") == "semi_annually"

    def test_semi_annually_bi_hyphen(self):
        assert normalize_reporting_frequency("bi-annually") == "semi_annually"

    def test_semi_annually_phrase(self):
        assert normalize_reporting_frequency("every six months") == "semi_annually"

    def test_semi_annually_twice_a_year(self):
        assert normalize_reporting_frequency("twice a year") == "semi_annually"

    def test_none_defaults_to_quarterly(self):
        assert normalize_reporting_frequency(None) == "quarterly"

    def test_empty_string_defaults_to_quarterly(self):
        assert normalize_reporting_frequency("") == "quarterly"

    def test_unrecognised_defaults_to_quarterly(self):
        assert normalize_reporting_frequency("whenever we feel like it") == "quarterly"


# ---------------------------------------------------------------------------
# normalize_extracted_terms (integration-style)
# ---------------------------------------------------------------------------

class TestNormalizeExtractedTerms:
    """Integration tests for the main normalize_extracted_terms function."""

    def _make_terms(self, **kwargs) -> ExtractedTerms:
        """Helper: build an ExtractedTerms with only specified fields set."""
        defaults = {
            "licensor_name": None,
            "licensee_name": None,
            "royalty_rate": None,
            "royalty_base": None,
            "territories": None,
            "product_categories": None,
            "contract_start_date": None,
            "contract_end_date": None,
            "minimum_guarantee": None,
            "advance_payment": None,
            "payment_terms": None,
            "reporting_frequency": None,
            "exclusivity": None,
            "confidence_score": None,
            "extraction_notes": None,
        }
        defaults.update(kwargs)
        return ExtractedTerms(**defaults)

    # --- Flat rate scenario ---

    def test_flat_rate_full_scenario(self):
        """
        Flat rate contract: "8% of net sales"
        - royalty_rate should be 8.0 (numeric)
        - royalty_base should be "net_sales"
        """
        terms = self._make_terms(
            licensee_name="Acme Corp",
            licensor_name="Brand Owner LLC",
            royalty_rate="8% of net sales",
            royalty_base="net sales",
            minimum_guarantee="$50,000 USD",
            advance_payment="$10,000 USD",
            contract_start_date="2024-01-01",
            contract_end_date="2026-12-31",
            reporting_frequency="quarterly",
            territories=["United States", "Canada"],
        )

        form = normalize_extracted_terms(terms)

        assert isinstance(form, FormValues)
        assert form.licensee_name == "Acme Corp"
        assert form.licensor_name == "Brand Owner LLC"
        assert form.royalty_rate == 8.0
        assert form.royalty_base == "net_sales"
        assert form.minimum_guarantee == 50000.0
        assert form.advance_payment == 10000.0
        assert form.contract_start_date == "2024-01-01"
        assert form.contract_end_date == "2026-12-31"
        assert form.reporting_frequency == "quarterly"
        assert form.territories == ["United States", "Canada"]

    def test_flat_rate_base_inferred_from_rate_string(self):
        """
        When royalty_base is None, infer from rate string.
        "8% of net sales" -> royalty_base = "net_sales"
        """
        terms = self._make_terms(
            royalty_rate="8% of net sales",
            royalty_base=None,
        )
        form = normalize_extracted_terms(terms)
        assert form.royalty_rate == 8.0
        assert form.royalty_base == "net_sales"

    def test_flat_rate_gross_inferred_from_rate_string(self):
        """
        "8% of gross sales" with no explicit royalty_base
        -> royalty_base = "gross_sales"
        """
        terms = self._make_terms(
            royalty_rate="8% of gross sales",
            royalty_base=None,
        )
        form = normalize_extracted_terms(terms)
        assert form.royalty_rate == 8.0
        assert form.royalty_base == "gross_sales"

    # --- Tiered rate scenario ---

    def test_tiered_rate_passthrough(self):
        """Tiered rate list passes through to form_values unchanged."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
            {"threshold": "$5,000,000+", "rate": "10%"},
        ]
        terms = self._make_terms(
            royalty_rate=tiers,
            royalty_base="net sales",
        )
        form = normalize_extracted_terms(terms)
        assert isinstance(form.royalty_rate, list)
        assert len(form.royalty_rate) == 3
        assert form.royalty_rate[0]["rate"] == "6%"
        assert form.royalty_rate[2]["rate"] == "10%"
        assert form.royalty_base == "net_sales"

    # --- Category rate scenario ---

    def test_category_rate_passthrough(self):
        """Category rate dict passes through to form_values unchanged."""
        rates = {
            "home textiles": "10%",
            "dinnerware": "7%",
            "fragrance": "12%",
        }
        terms = self._make_terms(
            royalty_rate=rates,
            royalty_base="net sales",
        )
        form = normalize_extracted_terms(terms)
        assert isinstance(form.royalty_rate, dict)
        assert form.royalty_rate["home textiles"] == "10%"
        assert form.royalty_rate["fragrance"] == "12%"
        assert form.royalty_base == "net_sales"

    # --- Monetary value parsing ---

    def test_monetary_parsing_minimum_guarantee(self):
        terms = self._make_terms(minimum_guarantee="$50,000 USD")
        form = normalize_extracted_terms(terms)
        assert form.minimum_guarantee == 50000.0

    def test_monetary_parsing_advance_payment(self):
        terms = self._make_terms(advance_payment="$10,000.00")
        form = normalize_extracted_terms(terms)
        assert form.advance_payment == 10000.0

    def test_monetary_none_stays_none(self):
        terms = self._make_terms(minimum_guarantee=None, advance_payment=None)
        form = normalize_extracted_terms(terms)
        assert form.minimum_guarantee is None
        assert form.advance_payment is None

    # --- Date normalisation ---

    def test_dates_already_iso(self):
        terms = self._make_terms(
            contract_start_date="2024-01-01",
            contract_end_date="2026-12-31",
        )
        form = normalize_extracted_terms(terms)
        assert form.contract_start_date == "2024-01-01"
        assert form.contract_end_date == "2026-12-31"

    def test_dates_none_become_empty_string(self):
        terms = self._make_terms(contract_start_date=None, contract_end_date=None)
        form = normalize_extracted_terms(terms)
        assert form.contract_start_date == ""
        assert form.contract_end_date == ""

    def test_dates_long_format_normalised(self):
        terms = self._make_terms(
            contract_start_date="January 1, 2024",
            contract_end_date="December 31, 2026",
        )
        form = normalize_extracted_terms(terms)
        assert form.contract_start_date == "2024-01-01"
        assert form.contract_end_date == "2026-12-31"

    # --- Reporting frequency ---

    def test_reporting_frequency_quarterly(self):
        terms = self._make_terms(reporting_frequency="quarterly")
        form = normalize_extracted_terms(terms)
        assert form.reporting_frequency == "quarterly"

    def test_reporting_frequency_semi_annually(self):
        terms = self._make_terms(reporting_frequency="semi-annually")
        form = normalize_extracted_terms(terms)
        assert form.reporting_frequency == "semi_annually"

    def test_reporting_frequency_annually(self):
        terms = self._make_terms(reporting_frequency="annually")
        form = normalize_extracted_terms(terms)
        assert form.reporting_frequency == "annually"

    def test_reporting_frequency_none_defaults_quarterly(self):
        terms = self._make_terms(reporting_frequency=None)
        form = normalize_extracted_terms(terms)
        assert form.reporting_frequency == "quarterly"

    # --- Territories ---

    def test_territories_passthrough(self):
        terms = self._make_terms(territories=["United States", "Canada", "Mexico"])
        form = normalize_extracted_terms(terms)
        assert form.territories == ["United States", "Canada", "Mexico"]

    def test_territories_none_becomes_empty_list(self):
        terms = self._make_terms(territories=None)
        form = normalize_extracted_terms(terms)
        assert form.territories == []

    # --- Null / empty input handling ---

    def test_all_null_fields_returns_safe_defaults(self):
        """All-null ExtractedTerms should produce safe, non-crashing defaults."""
        terms = self._make_terms()
        form = normalize_extracted_terms(terms)

        assert form.licensee_name == ""
        assert form.licensor_name == ""
        assert form.royalty_rate == ""
        assert form.royalty_base == "net_sales"
        assert form.minimum_guarantee is None
        assert form.advance_payment is None
        assert form.contract_start_date == ""
        assert form.contract_end_date == ""
        assert form.reporting_frequency == "quarterly"
        assert form.territories == []

    def test_return_type_is_form_values(self):
        """normalize_extracted_terms always returns a FormValues instance."""
        terms = self._make_terms()
        form = normalize_extracted_terms(terms)
        assert isinstance(form, FormValues)

    # --- model_dump is JSON-serialisable ---

    def test_form_values_model_dump_is_serialisable(self):
        """form_values.model_dump() must be serialisable to JSON (used in API response)."""
        import json

        terms = self._make_terms(
            licensee_name="Test Corp",
            royalty_rate="8% of net sales",
            minimum_guarantee="$50,000 USD",
            contract_start_date="2024-01-01",
            territories=["United States"],
        )
        form = normalize_extracted_terms(terms)
        # Should not raise
        serialised = json.dumps(form.model_dump())
        data = json.loads(serialised)

        assert data["licensee_name"] == "Test Corp"
        assert data["royalty_rate"] == 8.0
        assert data["minimum_guarantee"] == 50000.0

    def test_tiered_rate_model_dump_is_serialisable(self):
        """Tiered-rate form_values must also be JSON serialisable."""
        import json

        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"},
        ]
        terms = self._make_terms(royalty_rate=tiers)
        form = normalize_extracted_terms(terms)
        serialised = json.dumps(form.model_dump())
        data = json.loads(serialised)

        assert isinstance(data["royalty_rate"], list)
        assert data["royalty_rate"][0]["rate"] == "6%"
