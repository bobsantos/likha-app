"""
Integration tests for contract extraction flow.
Tests PDF parsing and Claude API integration with real sample contracts.
"""

import pytest
import os
from pathlib import Path
from decimal import Decimal
from app.services.extractor import (
    extract_text_from_pdf,
    extract_terms_with_claude,
    extract_contract,
)
from app.models.contract import ExtractedTerms


# Path to sample contracts from the spike
SAMPLE_CONTRACTS_DIR = Path(__file__).parent.parent.parent.parent / "likha-contract-extraction-spike" / "sample_contracts"


@pytest.fixture
def sample_contract_simple():
    """Path to simple flat-rate contract."""
    return SAMPLE_CONTRACTS_DIR / "contract_simple.pdf"


@pytest.fixture
def sample_contract_tiered():
    """Path to tiered-rate contract."""
    return SAMPLE_CONTRACTS_DIR / "contract_tiered.pdf"


@pytest.fixture
def sample_contract_categories():
    """Path to category-specific contract."""
    return SAMPLE_CONTRACTS_DIR / "contract_categories.pdf"


@pytest.fixture
def sample_contract_sec():
    """Path to real SEC filing (Smith & Wesson)."""
    return SAMPLE_CONTRACTS_DIR / "contract_sec_smith_wesson.pdf"


class TestPdfExtraction:
    """Test PDF text extraction without AI."""

    def test_extract_text_from_simple_contract(self, sample_contract_simple):
        """Test that we can extract text from a simple contract PDF."""
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))

        # Basic checks
        assert text is not None
        assert len(text) > 100
        assert "license" in text.lower() or "agreement" in text.lower()

    def test_extract_text_from_tiered_contract(self, sample_contract_tiered):
        """Test extraction from tiered rate contract."""
        if not sample_contract_tiered.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_tiered))

        assert text is not None
        assert len(text) > 100

    def test_extract_text_from_categories_contract(self, sample_contract_categories):
        """Test extraction from category-specific contract."""
        if not sample_contract_categories.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_categories))

        assert text is not None
        assert len(text) > 100

    def test_extract_text_handles_structured_content(self, sample_contract_tiered):
        """Test that structured content extraction works (tiered rates, lists, etc)."""
        if not sample_contract_tiered.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_tiered))

        # Check for structured content indicators (tables or numbered lists)
        # Tables will have [Table on page] or | markers
        # Numbered/bulleted lists will have (a), (b), (c) or similar
        has_structure = (
            "[Table on page" in text or
            "|" in text or
            "(a)" in text or
            "(b)" in text
        )
        assert has_structure

    def test_extract_text_nonexistent_file(self):
        """Test that nonexistent file raises appropriate error."""
        with pytest.raises(Exception):
            extract_text_from_pdf("/nonexistent/path/contract.pdf")


class TestClaudeExtraction:
    """Test Claude API extraction (requires ANTHROPIC_API_KEY)."""

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_extract_simple_contract(self, sample_contract_simple):
        """Test full extraction pipeline on simple flat-rate contract."""
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))
        extracted, token_usage = extract_terms_with_claude(text)

        # Check that we got a valid ExtractedTerms object
        assert isinstance(extracted, ExtractedTerms)

        # Check token usage
        assert token_usage["input_tokens"] > 0
        assert token_usage["output_tokens"] > 0
        assert token_usage["total_tokens"] == token_usage["input_tokens"] + token_usage["output_tokens"]

        # Check confidence score
        assert extracted.confidence_score is not None
        assert 0.0 <= extracted.confidence_score <= 1.0

        # Simple contract should have basic fields
        assert extracted.licensee_name is not None
        assert extracted.royalty_rate is not None

        # Royalty rate should be a string (flat rate)
        assert isinstance(extracted.royalty_rate, str)
        assert "%" in extracted.royalty_rate

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_extract_tiered_contract(self, sample_contract_tiered):
        """Test extraction of tiered royalty structure."""
        if not sample_contract_tiered.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_tiered))
        extracted, token_usage = extract_terms_with_claude(text)

        assert isinstance(extracted, ExtractedTerms)

        # Tiered contract should have royalty_rate as a list
        assert extracted.royalty_rate is not None
        assert isinstance(extracted.royalty_rate, list)

        # Each tier should have threshold and rate
        for tier in extracted.royalty_rate:
            assert "threshold" in tier
            assert "rate" in tier
            assert "%" in tier["rate"]

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_extract_category_contract(self, sample_contract_categories):
        """Test extraction of category-specific rates."""
        if not sample_contract_categories.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_categories))
        extracted, token_usage = extract_terms_with_claude(text)

        assert isinstance(extracted, ExtractedTerms)

        # Category contract should have royalty_rate as a dict
        assert extracted.royalty_rate is not None
        assert isinstance(extracted.royalty_rate, dict)

        # Should have product categories
        assert extracted.product_categories is not None
        assert len(extracted.product_categories) > 0

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    async def test_extract_contract_full_pipeline(self, sample_contract_simple):
        """Test the full extract_contract async function."""
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        extracted, token_usage = await extract_contract(str(sample_contract_simple))

        assert isinstance(extracted, ExtractedTerms)
        assert token_usage["total_tokens"] > 0


class TestGroundTruthValidation:
    """
    Validate extraction against known ground truth from the spike.
    These tests define expected values for the sample contracts.
    """

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_simple_contract_ground_truth(self, sample_contract_simple):
        """
        Validate simple contract extraction against expected values.

        Expected from contract_simple.pdf:
        - Flat 8% rate
        - Net sales as base
        - Should have licensee name
        """
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))
        extracted, _ = extract_terms_with_claude(text)

        # Licensee should be extracted
        assert extracted.licensee_name is not None
        assert len(extracted.licensee_name) > 0

        # Should be a flat rate
        assert isinstance(extracted.royalty_rate, str)
        assert "8" in extracted.royalty_rate  # Should contain 8%
        assert "%" in extracted.royalty_rate

        # Royalty base should mention net sales
        if extracted.royalty_base:
            assert "net" in extracted.royalty_base.lower() or "sales" in extracted.royalty_base.lower()

        # Confidence should be high for simple contract
        assert extracted.confidence_score >= 0.7

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_tiered_contract_ground_truth(self, sample_contract_tiered):
        """
        Validate tiered contract extraction.

        Expected from contract_tiered.pdf:
        - Multiple tiers with different rates
        - Thresholds in dollar amounts
        """
        if not sample_contract_tiered.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_tiered))
        extracted, _ = extract_terms_with_claude(text)

        # Should be a list of tiers
        assert isinstance(extracted.royalty_rate, list)
        assert len(extracted.royalty_rate) >= 2  # At least 2 tiers

        # Each tier should have proper structure
        for tier in extracted.royalty_rate:
            assert "threshold" in tier
            assert "rate" in tier
            # Threshold should contain dollar amount or range
            assert "$" in tier["threshold"] or "million" in tier["threshold"].lower()
            # Rate should be a percentage
            assert "%" in tier["rate"]

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_categories_contract_ground_truth(self, sample_contract_categories):
        """
        Validate category-specific contract extraction.

        Expected from contract_categories.pdf:
        - Dictionary mapping categories to rates
        - Product categories list
        """
        if not sample_contract_categories.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_categories))
        extracted, _ = extract_terms_with_claude(text)

        # Should be a dictionary
        assert isinstance(extracted.royalty_rate, dict)
        assert len(extracted.royalty_rate) >= 2  # At least 2 categories

        # Each category should have a rate
        for category, rate in extracted.royalty_rate.items():
            assert len(category) > 0
            assert "%" in rate

        # Should have product categories extracted
        assert extracted.product_categories is not None
        assert len(extracted.product_categories) > 0


class TestExtractionEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_pdf_raises_error(self, tmp_path):
        """Test that an empty or corrupt PDF raises an error."""
        # Create an empty file
        empty_pdf = tmp_path / "empty.pdf"
        empty_pdf.write_text("")

        with pytest.raises(Exception):
            extract_text_from_pdf(str(empty_pdf))

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_minimal_text_extraction(self):
        """Test extraction with minimal contract-like text."""
        minimal_text = """
        LICENSING AGREEMENT

        This agreement is between XYZ Corp (Licensor) and ABC Inc (Licensee).

        Royalty Rate: 8% of net sales
        Territory: United States
        Term: January 1, 2024 to December 31, 2026
        """

        extracted, token_usage = extract_terms_with_claude(minimal_text)

        assert isinstance(extracted, ExtractedTerms)
        # Should at least extract the licensor, licensee, and rate
        assert extracted.licensor_name is not None
        assert extracted.licensee_name is not None
        assert extracted.royalty_rate is not None

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_ambiguous_contract_has_notes(self):
        """Test that ambiguous terms result in extraction_notes."""
        ambiguous_text = """
        AGREEMENT

        Party A and Party B agree to terms.
        Payment will be determined based on various factors.
        """

        extracted, _ = extract_terms_with_claude(ambiguous_text)

        # Should have notes about ambiguities or missing info
        assert extracted.extraction_notes is not None
        assert len(extracted.extraction_notes) > 0

        # Confidence should be lower for ambiguous contract
        assert extracted.confidence_score < 0.8


class TestTokenUsageTracking:
    """Test that token usage is properly tracked."""

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_token_usage_structure(self, sample_contract_simple):
        """Test that token usage dict has expected structure."""
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))
        _, token_usage = extract_terms_with_claude(text)

        # Check structure
        assert "input_tokens" in token_usage
        assert "output_tokens" in token_usage
        assert "total_tokens" in token_usage

        # Check values are positive
        assert token_usage["input_tokens"] > 0
        assert token_usage["output_tokens"] > 0
        assert token_usage["total_tokens"] > 0

        # Check math
        assert token_usage["total_tokens"] == token_usage["input_tokens"] + token_usage["output_tokens"]

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_cost_estimate(self, sample_contract_simple):
        """
        Test that extraction cost is within expected range.
        From MVP.md: ~$0.02-0.05 per extraction
        """
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))
        _, token_usage = extract_terms_with_claude(text)

        # Rough cost estimate (as of 2026-02)
        # Claude Sonnet 4.5: ~$3 per million input tokens, ~$15 per million output tokens
        input_cost = (token_usage["input_tokens"] / 1_000_000) * 3
        output_cost = (token_usage["output_tokens"] / 1_000_000) * 15
        total_cost = input_cost + output_cost

        # Should be in expected range from MVP.md
        assert total_cost < 0.10, f"Cost ${total_cost:.4f} exceeds expected maximum"

        # Log for visibility
        print(f"\nExtraction cost: ${total_cost:.4f}")
        print(f"  Input tokens: {token_usage['input_tokens']} (${input_cost:.4f})")
        print(f"  Output tokens: {token_usage['output_tokens']} (${output_cost:.4f})")


class TestExtractionNotes:
    """Test that extraction_notes provide useful feedback."""

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_extraction_notes_present(self, sample_contract_simple):
        """Test that extraction_notes are present and useful."""
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))
        extracted, _ = extract_terms_with_claude(text)

        # Notes should be present (even if empty list for perfect extraction)
        assert extracted.extraction_notes is not None
        assert isinstance(extracted.extraction_notes, list)

    @pytest.mark.skipif(
        not os.getenv("ANTHROPIC_API_KEY"),
        reason="ANTHROPIC_API_KEY not set"
    )
    def test_confidence_score_present(self, sample_contract_simple):
        """Test that confidence_score is present and reasonable."""
        if not sample_contract_simple.exists():
            pytest.skip("Sample contract not found")

        text = extract_text_from_pdf(str(sample_contract_simple))
        extracted, _ = extract_terms_with_claude(text)

        # Confidence should be present
        assert extracted.confidence_score is not None

        # Should be a valid probability
        assert 0.0 <= extracted.confidence_score <= 1.0

        # For well-formatted sample contracts, should be reasonably high
        assert extracted.confidence_score >= 0.5
