"""
Unit tests for royalty calculation engine.
Tests flat, tiered, and category-specific rate structures.
"""

import pytest
from decimal import Decimal
from app.services.royalty_calc import (
    calculate_royalty,
    calculate_flat_royalty,
    calculate_tiered_royalty,
    calculate_category_royalty,
    parse_percentage,
    parse_threshold,
    parse_threshold_max,
)


class TestParsePercentage:
    """Test percentage string parsing."""

    def test_simple_percentage(self):
        assert parse_percentage("8%") == Decimal("0.08")

    def test_percentage_with_text(self):
        assert parse_percentage("8% of Net Sales") == Decimal("0.08")

    def test_decimal_percentage(self):
        assert parse_percentage("7.5%") == Decimal("0.075")

    def test_percentage_with_spaces(self):
        assert parse_percentage("10 %") == Decimal("0.10")

    def test_invalid_percentage(self):
        with pytest.raises(ValueError):
            parse_percentage("invalid")


class TestParseThreshold:
    """Test threshold parsing for tiered rates."""

    def test_range_threshold(self):
        assert parse_threshold("$0-$2,000,000") == Decimal("0")

    def test_open_ended_threshold(self):
        assert parse_threshold("$5,000,000+") == Decimal("5000000")

    def test_threshold_max_range(self):
        assert parse_threshold_max("$0-$2,000,000") == Decimal("2000000")

    def test_threshold_max_open_ended(self):
        assert parse_threshold_max("$5,000,000+") == Decimal("Infinity")

    def test_threshold_without_dollar_sign(self):
        assert parse_threshold("0-2000000") == Decimal("0")


class TestFlatRoyalty:
    """Test flat rate royalty calculations."""

    def test_flat_8_percent(self):
        """Test basic flat rate: 8% of $100,000 = $8,000"""
        result = calculate_flat_royalty("8%", Decimal("100000"))
        assert result == Decimal("8000")

    def test_flat_with_text(self):
        """Test flat rate with description text."""
        result = calculate_flat_royalty("8% of Net Sales", Decimal("100000"))
        assert result == Decimal("8000")

    def test_flat_decimal_rate(self):
        """Test flat rate with decimal: 7.5% of $100,000 = $7,500"""
        result = calculate_flat_royalty("7.5%", Decimal("100000"))
        assert result == Decimal("7500")

    def test_flat_zero_sales(self):
        """Test flat rate with zero sales."""
        result = calculate_flat_royalty("8%", Decimal("0"))
        assert result == Decimal("0")

    def test_flat_large_sales(self):
        """Test flat rate with large sales amount."""
        result = calculate_flat_royalty("10%", Decimal("5000000"))
        assert result == Decimal("500000")

    def test_flat_preserves_precision(self):
        """Test that Decimal precision is preserved."""
        result = calculate_flat_royalty("8.333%", Decimal("100000"))
        # Should be exactly 8333.0, not rounded
        assert result == Decimal("8333.000")


class TestTieredRoyalty:
    """Test tiered (marginal) royalty calculations."""

    def test_tiered_single_tier(self):
        """Test sales within first tier only."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
            {"threshold": "$5,000,000+", "rate": "10%"}
        ]
        # $1M in sales, all in first tier
        result = calculate_tiered_royalty(tiers, Decimal("1000000"))
        assert result == Decimal("60000")  # 1M * 0.06

    def test_tiered_two_tiers(self):
        """Test sales across two tiers (from MVP.md example)."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
            {"threshold": "$5,000,000+", "rate": "10%"}
        ]
        # $3M in sales
        # Tier 1: $2M * 0.06 = $120,000
        # Tier 2: $1M * 0.08 = $80,000
        # Total: $200,000
        result = calculate_tiered_royalty(tiers, Decimal("3000000"))
        assert result == Decimal("200000")

    def test_tiered_three_tiers(self):
        """Test sales across all three tiers."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
            {"threshold": "$5,000,000+", "rate": "10%"}
        ]
        # $6M in sales
        # Tier 1: $2M * 0.06 = $120,000
        # Tier 2: $3M * 0.08 = $240,000
        # Tier 3: $1M * 0.10 = $100,000
        # Total: $460,000
        result = calculate_tiered_royalty(tiers, Decimal("6000000"))
        assert result == Decimal("460000")

    def test_tiered_exact_boundary(self):
        """Test sales exactly at tier boundary."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"}
        ]
        # Exactly $2M
        result = calculate_tiered_royalty(tiers, Decimal("2000000"))
        assert result == Decimal("120000")  # 2M * 0.06

    def test_tiered_zero_sales(self):
        """Test tiered rate with zero sales."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"}
        ]
        result = calculate_tiered_royalty(tiers, Decimal("0"))
        assert result == Decimal("0")

    def test_tiered_unsorted_tiers(self):
        """Test that tiers are sorted correctly even if provided out of order."""
        tiers = [
            {"threshold": "$5,000,000+", "rate": "10%"},
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000-$5,000,000", "rate": "8%"}
        ]
        # Should handle out-of-order tiers correctly
        result = calculate_tiered_royalty(tiers, Decimal("3000000"))
        assert result == Decimal("200000")


class TestCategoryRoyalty:
    """Test category-specific royalty calculations."""

    def test_category_basic(self):
        """Test basic category-specific calculation (from MVP.md example)."""
        rates = {
            "home textiles": "10%",
            "dinnerware": "7%",
            "fragrance": "12%"
        }
        category_breakdown = {
            "home textiles": Decimal("50000"),
            "dinnerware": Decimal("30000"),
            "fragrance": Decimal("20000")
        }
        # ($50K * 0.10) + ($30K * 0.07) + ($20K * 0.12)
        # = $5,000 + $2,100 + $2,400
        # = $9,500
        result = calculate_category_royalty(rates, category_breakdown)
        assert result == Decimal("9500")

    def test_category_single(self):
        """Test single category."""
        rates = {"apparel": "10%"}
        category_breakdown = {"apparel": Decimal("100000")}
        result = calculate_category_royalty(rates, category_breakdown)
        assert result == Decimal("10000")

    def test_category_fuzzy_matching(self):
        """Test fuzzy matching of category names."""
        rates = {
            "apparel": "10%",
            "accessories": "8%"
        }
        # Category names with different casing/spacing
        category_breakdown = {
            "Apparel": Decimal("50000"),
            "ACCESSORIES": Decimal("30000")
        }
        result = calculate_category_royalty(rates, category_breakdown)
        assert result == Decimal("7400")  # (50K * 0.10) + (30K * 0.08) = 5000 + 2400

    def test_category_partial_match(self):
        """Test partial matching (e.g., 'home textiles' matches 'textiles')."""
        rates = {"textiles": "10%"}
        category_breakdown = {"home textiles": Decimal("50000")}
        result = calculate_category_royalty(rates, category_breakdown)
        assert result == Decimal("5000")

    def test_category_no_match_raises_error(self):
        """Test that missing category raises error."""
        rates = {"apparel": "10%"}
        category_breakdown = {"unknown_category": Decimal("50000")}
        with pytest.raises(ValueError, match="No rate found for category"):
            calculate_category_royalty(rates, category_breakdown)

    def test_category_zero_sales(self):
        """Test category with zero sales."""
        rates = {"apparel": "10%"}
        category_breakdown = {"apparel": Decimal("0")}
        result = calculate_category_royalty(rates, category_breakdown)
        assert result == Decimal("0")


class TestCalculateRoyalty:
    """Test main calculate_royalty function that dispatches to specific calculators."""

    def test_dispatch_flat(self):
        """Test that string rate dispatches to flat calculator."""
        result = calculate_royalty("8%", Decimal("100000"))
        assert result == Decimal("8000")

    def test_dispatch_tiered(self):
        """Test that list rate dispatches to tiered calculator."""
        tiers = [
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000+", "rate": "8%"}
        ]
        result = calculate_royalty(tiers, Decimal("3000000"))
        assert result == Decimal("200000")

    def test_dispatch_category(self):
        """Test that dict rate dispatches to category calculator."""
        rates = {"apparel": "10%", "accessories": "8%"}
        category_breakdown = {
            "apparel": Decimal("50000"),
            "accessories": Decimal("30000")
        }
        result = calculate_royalty(rates, Decimal("80000"), category_breakdown)
        assert result == Decimal("7400")

    def test_category_without_breakdown_raises_error(self):
        """Test that category rates require category_breakdown."""
        rates = {"apparel": "10%"}
        with pytest.raises(ValueError, match="category_breakdown required"):
            calculate_royalty(rates, Decimal("100000"))

    def test_invalid_type_raises_error(self):
        """Test that invalid rate type raises error."""
        with pytest.raises(ValueError, match="Unsupported royalty_rate type"):
            calculate_royalty(123, Decimal("100000"))


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_very_small_amounts(self):
        """Test that small amounts are calculated correctly."""
        result = calculate_flat_royalty("8%", Decimal("0.01"))
        assert result == Decimal("0.0008")

    def test_very_large_amounts(self):
        """Test that large amounts don't overflow."""
        result = calculate_flat_royalty("10%", Decimal("1000000000"))
        assert result == Decimal("100000000")

    def test_decimal_precision_maintained(self):
        """Test that Decimal precision is maintained throughout calculations."""
        # Use a rate that creates a repeating decimal
        result = calculate_flat_royalty("8.333%", Decimal("100000.00"))
        # Should preserve precision, not round to float
        assert isinstance(result, Decimal)
        assert result == Decimal("8333.000")

    def test_negative_sales_not_validated_here(self):
        """
        Note: Negative sales should be validated at the API/model level,
        not in the calculation logic. This test just documents current behavior.
        """
        # Calculation logic doesn't prevent negative sales
        # (validation happens in Pydantic models with Field(ge=0))
        result = calculate_flat_royalty("8%", Decimal("-100000"))
        assert result == Decimal("-8000")


class TestRealWorldScenarios:
    """Test realistic contract scenarios."""

    def test_scenario_simple_apparel_license(self):
        """
        Scenario: Simple apparel license
        - 8% of net sales
        - Q1 sales: $250,000
        """
        result = calculate_royalty("8% of Net Sales", Decimal("250000"))
        assert result == Decimal("20000")

    def test_scenario_home_goods_tiered(self):
        """
        Scenario: Home goods with volume incentives
        - 0-1M: 6%
        - 1M-3M: 8%
        - 3M+: 10%
        - Year 1 sales: $2.5M
        """
        tiers = [
            {"threshold": "$0-$1,000,000", "rate": "6%"},
            {"threshold": "$1,000,000-$3,000,000", "rate": "8%"},
            {"threshold": "$3,000,000+", "rate": "10%"}
        ]
        # Tier 1: $1M * 0.06 = $60,000
        # Tier 2: $1.5M * 0.08 = $120,000
        # Total: $180,000
        result = calculate_royalty(tiers, Decimal("2500000"))
        assert result == Decimal("180000")

    def test_scenario_multi_category_license(self):
        """
        Scenario: Multi-category home brand
        - Textiles: 10%
        - Dinnerware: 7%
        - Fragrance: 12%
        - Q1 breakdown: textiles $150K, dinnerware $80K, fragrance $50K
        """
        rates = {
            "textiles": "10%",
            "dinnerware": "7%",
            "fragrance": "12%"
        }
        category_breakdown = {
            "textiles": Decimal("150000"),
            "dinnerware": Decimal("80000"),
            "fragrance": Decimal("50000")
        }
        # (150K * 0.10) + (80K * 0.07) + (50K * 0.12)
        # = $15,000 + $5,600 + $6,000
        # = $26,600
        result = calculate_royalty(rates, Decimal("280000"), category_breakdown)
        assert result == Decimal("26600")

    def test_scenario_high_volume_licensee(self):
        """
        Scenario: High-performing licensee hitting top tier
        - 0-5M: 6%
        - 5M-10M: 8%
        - 10M+: 10%
        - Year 1 sales: $12M
        """
        tiers = [
            {"threshold": "$0-$5,000,000", "rate": "6%"},
            {"threshold": "$5,000,000-$10,000,000", "rate": "8%"},
            {"threshold": "$10,000,000+", "rate": "10%"}
        ]
        # Tier 1: $5M * 0.06 = $300,000
        # Tier 2: $5M * 0.08 = $400,000
        # Tier 3: $2M * 0.10 = $200,000
        # Total: $900,000
        result = calculate_royalty(tiers, Decimal("12000000"))
        assert result == Decimal("900000")
